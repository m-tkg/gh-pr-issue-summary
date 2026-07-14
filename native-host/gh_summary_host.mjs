#!/usr/bin/env node
// gh-pr-issue-summary の Native Messaging ホスト。
// 拡張から {cli, prompt} を受け取り、許可された CLI を stdin 経由で実行し、
// 生成テキストを返す。CLI は allowlist のみ。シェルを介さず spawn する。

import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))

// install.sh が解決した CLI 絶対パス（無ければ PATH 検索にフォールバック）。
function loadCliPaths() {
  try {
    return JSON.parse(readFileSync(join(HERE, 'cli-paths.json'), 'utf-8'))
  } catch {
    return {}
  }
}

/** codex --json の JSONL から最後の agent_message テキストを取り出す。 */
export function parseCodexOutput(raw) {
  let text = ''
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t) continue
    try {
      const ev = JSON.parse(t)
      if (
        ev.type === 'item.completed' &&
        ev.item?.type === 'agent_message' &&
        typeof ev.item.text === 'string'
      ) {
        text = ev.item.text
      }
    } catch {
      /* JSON でない行は無視 */
    }
  }
  return text.trim()
}

/**
 * CLI ごとの起動仕様。prompt の渡し方（stdin/arg）と出力の解釈が異なる。
 * model が指定された場合は各 CLI のモデル指定フラグを付与する。
 */
// 未信頼コメントによるプロンプトインジェクションでツールが悪用されるのを防ぐため、
// 要約はツール無効・読み取り専用で実行する。
// claude はファイル読取/書込/ネットワーク系ツールを明示的に禁止する。
const CLAUDE_DISALLOWED_TOOLS =
  'Bash,Edit,Write,NotebookEdit,WebFetch,WebSearch,Read,Task,Glob,Grep,MultiEdit'

export function cliSpec(cliKey, paths = {}, model = '') {
  const m = (model || '').trim()
  switch (cliKey) {
    case 'claude-code':
      return {
        bin: paths.claude || 'claude',
        args: () => [
          '-p',
          '--output-format',
          'text',
          '--disallowed-tools',
          CLAUDE_DISALLOWED_TOOLS,
          ...(m ? ['--model', m] : []),
        ],
        useStdin: true,
        parse: (raw) => raw.trim(),
      }
    case 'codex':
      // read-only サンドボックスで実行（書込・ネットワーク実行を抑止）。
      return {
        bin: paths.codex || 'codex',
        args: () => [
          'exec',
          '--json',
          '--sandbox',
          'read-only',
          ...(m ? ['-m', m] : []),
          '-',
        ],
        useStdin: true,
        parse: parseCodexOutput,
      }
    case 'antigravity':
      // agy: 非対話 print モード + サンドボックス（端末制限）。
      // --dangerously-skip-permissions は付けない（未承認ツールは実行されない）。
      return {
        bin: paths.antigravity || 'agy',
        args: () => ['-p', '--sandbox', ...(m ? ['--model', m] : [])],
        useStdin: true,
        parse: (raw) => raw.trim(),
      }
    case 'cursor':
      // Cursor Agent: ask モード + sandbox enabled で読み取り専用の応答用途に寄せる。
      // --print はツールアクセスを持つため、--force/--yolo は付けない。
      return {
        bin: paths.cursor || 'agent',
        args: (prompt) => [
          '--print',
          '--output-format',
          'text',
          '--mode',
          'ask',
          '--sandbox',
          'enabled',
          ...(m ? ['--model', m] : []),
          prompt,
        ],
        useStdin: false,
        parse: (raw) => raw.trim(),
      }
    default:
      return null
  }
}

function augmentedPath() {
  const home = process.env.HOME || ''
  const extra = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    join(home, '.local/bin'),
    '/usr/bin',
    '/bin',
  ]
  return [process.env.PATH || '', ...extra].filter(Boolean).join(':')
}

function runCli(cliKey, prompt, paths, model) {
  return new Promise((resolve) => {
    const spec = cliSpec(cliKey, paths, model)
    if (!spec) return resolve({ ok: false, error: `unknown cli: ${cliKey}` })

    let child
    try {
      child = spawn(spec.bin, spec.args(prompt), {
        env: { ...process.env, PATH: augmentedPath() },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (e) {
      return resolve({ ok: false, error: `spawn failed: ${e.message}` })
    }

    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve({ ok: false, error: 'CLI がタイムアウトしました（180秒）。' })
    }, 180_000)

    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ ok: false, error: `CLI を起動できません: ${e.message}` })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      const text = spec.parse(out)
      if (!text) {
        resolve({
          ok: false,
          error: `CLI の出力が空でした (code ${code}): ${err.slice(0, 300)}`,
        })
      } else {
        resolve({ ok: true, text })
      }
    })

    if (spec.useStdin) child.stdin.end(prompt)
    else child.stdin.end()
  })
}

// --- Native Messaging フレーミング（4byte LE 長 + UTF-8 JSON） ---

function readOneMessage() {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0)
    let need = null
    const onData = (d) => {
      buf = Buffer.concat([buf, d])
      if (need === null && buf.length >= 4) {
        need = buf.readUInt32LE(0)
        buf = buf.subarray(4)
      }
      if (need !== null && buf.length >= need) {
        cleanup()
        try {
          resolve(JSON.parse(buf.subarray(0, need).toString('utf-8')))
        } catch (e) {
          reject(e)
        }
      }
    }
    const onEnd = () => {
      cleanup()
      reject(new Error('stdin ended before full message'))
    }
    const onErr = (e) => {
      cleanup()
      reject(e)
    }
    const cleanup = () => {
      process.stdin.off('data', onData)
      process.stdin.off('end', onEnd)
      process.stdin.off('error', onErr)
    }
    process.stdin.on('data', onData)
    process.stdin.on('end', onEnd)
    process.stdin.on('error', onErr)
  })
}

function writeMessage(obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf-8')
  const header = Buffer.alloc(4)
  header.writeUInt32LE(body.length, 0)
  process.stdout.write(header)
  process.stdout.write(body)
}

async function main() {
  try {
    const msg = await readOneMessage()
    if (msg?.ping) {
      writeMessage({ ok: true, pong: true })
      process.exit(0)
    }
    const paths = loadCliPaths()
    const res = await runCli(
      msg.cli,
      String(msg.prompt ?? ''),
      paths,
      String(msg.model ?? ''),
    )
    writeMessage(res)
  } catch (e) {
    writeMessage({ ok: false, error: e instanceof Error ? e.message : String(e) })
  }
  process.exit(0)
}

// vitest などから import された場合は実行しない（ホストとして直接起動された時のみ動く）。
const isMain = (process.argv[1] || '').endsWith('gh_summary_host.mjs')
if (isMain) void main()
