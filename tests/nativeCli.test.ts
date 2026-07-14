import { describe, it, expect, beforeEach } from 'vitest'
import { NativeCliLlmClient } from '../src/summarize/nativeCliClient'
import { cliSpec, parseCodexOutput } from '../native-host/gh_summary_host.mjs'

// chrome.runtime.sendNativeMessage をモック
function mockChrome(responder: (msg: unknown) => unknown) {
  ;(globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      sendNativeMessage: (_host: string, msg: unknown) =>
        Promise.resolve(responder(msg)),
    },
  }
}

beforeEach(() => {
  delete (globalThis as unknown as { chrome?: unknown }).chrome
})

describe('parseCodexOutput', () => {
  it('JSONL から最後の agent_message テキストを取り出す', () => {
    const raw = [
      '{"type":"thread.started","thread_id":"x"}',
      '{"type":"turn.started"}',
      '{"type":"item.completed","item":{"id":"i","type":"agent_message","text":"{\\"a\\":1}"}}',
      '{"type":"turn.completed","usage":{}}',
    ].join('\n')
    expect(parseCodexOutput(raw)).toBe('{"a":1}')
  })

  it('壊れた行は無視する', () => {
    const raw =
      'not json\n{"type":"item.completed","item":{"type":"agent_message","text":"OK"}}\ngarbage'
    expect(parseCodexOutput(raw)).toBe('OK')
  })
})

describe('cliSpec', () => {
  it('Cursor Agent を ask/read-only 相当で非対話実行する', () => {
    const spec = cliSpec(
      'cursor',
      { cursor: '/usr/local/bin/cursor-agent' },
      'gpt-5',
    )
    expect(spec).not.toBeNull()
    expect(spec?.bin).toBe('/usr/local/bin/cursor-agent')
    expect(spec?.args('これを要約')).toEqual([
      '--print',
      '--output-format',
      'text',
      '--mode',
      'ask',
      '--sandbox',
      'enabled',
      '--model',
      'gpt-5',
      'これを要約',
    ])
    expect(spec?.useStdin).toBe(false)
  })

  it('cursor のパス未指定時は agent コマンドを使う', () => {
    const spec = cliSpec('cursor')
    expect(spec?.bin).toBe('agent')
  })
})

describe('NativeCliLlmClient', () => {
  it('availability: ping に pong で available', async () => {
    mockChrome((msg) =>
      (msg as { ping?: boolean }).ping ? { ok: true, pong: true } : {},
    )
    const c = new NativeCliLlmClient('claude-code')
    expect(await c.availability()).toBe('available')
  })

  it('availability: 例外(ホスト未導入)なら unavailable', async () => {
    ;(globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: {
        sendNativeMessage: () => Promise.reject(new Error('no host')),
      },
    }
    const c = new NativeCliLlmClient('codex')
    expect(await c.availability()).toBe('unavailable')
  })

  it('prompt: cli と prompt をホストへ送り text を返す', async () => {
    const seen: unknown[] = []
    mockChrome((msg) => {
      seen.push(msg)
      return { ok: true, text: '要約結果' }
    })
    const c = new NativeCliLlmClient('antigravity')
    const session = await c.createSession({})
    const out = await session.prompt('これを要約')
    expect(out).toBe('要約結果')
    expect(seen[0]).toEqual({
      cli: 'antigravity',
      prompt: 'これを要約',
      model: '',
    })
  })

  it('prompt: 選択モデルをホストへ渡す', async () => {
    const seen: unknown[] = []
    mockChrome((msg) => {
      seen.push(msg)
      return { ok: true, text: 'x' }
    })
    const c = new NativeCliLlmClient('claude-code', 'haiku')
    const session = await c.createSession({})
    await session.prompt('p')
    expect(seen[0]).toEqual({ cli: 'claude-code', prompt: 'p', model: 'haiku' })
  })

  it('prompt: cursor をホストへ送れる', async () => {
    const seen: unknown[] = []
    mockChrome((msg) => {
      seen.push(msg)
      return { ok: true, text: 'x' }
    })
    const c = new NativeCliLlmClient('cursor')
    const session = await c.createSession({})
    await session.prompt('p')
    expect(seen[0]).toEqual({ cli: 'cursor', prompt: 'p', model: '' })
  })

  it('prompt: ホストが ok:false ならエラー', async () => {
    mockChrome(() => ({ ok: false, error: 'CLI not found' }))
    const c = new NativeCliLlmClient('claude-code')
    const session = await c.createSession({})
    await expect(session.prompt('x')).rejects.toThrow('CLI not found')
  })
})
