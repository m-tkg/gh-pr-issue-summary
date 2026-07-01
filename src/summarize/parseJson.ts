// LLM/CLI のテキスト出力から JSON オブジェクトを頑健に取り出す。
// responseConstraint を持たない CLI は、コードフェンスや前置き文を付けることがある。

function tryParse(s: string): { ok: true; val: unknown } | { ok: false } {
  try {
    return { ok: true, val: JSON.parse(s) }
  } catch {
    return { ok: false }
  }
}

/** 位置 start の '{' に対応する '}' の位置を返す（文字列/エスケープを考慮）。無ければ -1。 */
function matchBalanced(s: string, start: number): number {
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < s.length; i++) {
    const ch = s[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
    } else if (ch === '"') {
      inStr = true
    } else if (ch === '{') {
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** 出力テキストからバランスの取れた JSON オブジェクト候補を列挙し、パースできるものを返す。 */
function extractCandidates(text: string): unknown[] {
  const out: unknown[] = []
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue
    const end = matchBalanced(text, i)
    if (end > i) {
      const p = tryParse(text.slice(i, end + 1))
      if (p.ok) out.push(p.val)
    }
  }
  return out
}

function hasExpectedKeys(o: unknown): boolean {
  if (!o || typeof o !== 'object') return false
  const obj = o as Record<string, unknown>
  return (
    'clusters' in obj ||
    'overview' in obj ||
    'gist' in obj ||
    'overallDiscussion' in obj
  )
}

/**
 * LLM 出力から JSON オブジェクトを取り出してパースする。
 * 1) そのまま 2) コードフェンス除去 3) バランス走査で候補を試行。
 */
export function parseJsonLoose(raw: string): unknown {
  const trimmed = raw.trim()
  const direct = tryParse(trimmed)
  if (direct.ok) return direct.val

  // ```json ... ``` / ``` ... ``` を除去
  const noFence = trimmed.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '').trim()
  const d2 = tryParse(noFence)
  if (d2.ok) return d2.val

  // バランス走査。期待キーを持つ候補を優先し、無ければ最初にパースできたもの。
  const candidates = extractCandidates(noFence)
  const good = candidates.find(hasExpectedKeys)
  if (good) return good
  if (candidates.length > 0) return candidates[0]

  throw new Error(
    `要約結果の JSON 解析に失敗しました: ${raw.slice(0, 120)}`,
  )
}
