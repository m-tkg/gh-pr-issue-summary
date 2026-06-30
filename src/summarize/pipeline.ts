// map-reduce 要約パイプライン。LlmClient 経由で Gemini Nano を呼ぶ。

import type { CommentData, PageData } from '../content/extract'
import type { LlmClient } from './llmClient'
import type {
  Cluster,
  ClusterComment,
  CommentKind,
  CommentNote,
  FinalSummary,
  Importance,
} from './types'
import { NOTE_SCHEMA, FINAL_SCHEMA } from './schema'
import {
  systemPrompt,
  mapPrompt,
  reducePrompt,
  mergeReducePrompt,
  formatNotesForReduce,
} from './prompts'
import { estimateTokens } from './tokens'

/** reduce 入力（メモ列）のトークン上限。超えると階層 reduce に切替。 */
export const REDUCE_INPUT_TOKEN_BUDGET = 3000

const VALID_KINDS: CommentKind[] = [
  'question',
  'proposal',
  'decision',
  'bug',
  'nit',
  'info',
  'other',
]
const VALID_IMPORTANCE: Importance[] = ['high', 'medium', 'low']

function coerceKind(v: unknown): CommentKind {
  return VALID_KINDS.includes(v as CommentKind) ? (v as CommentKind) : 'other'
}
function coerceImportance(v: unknown): Importance {
  return VALID_IMPORTANCE.includes(v as Importance)
    ? (v as Importance)
    : 'medium'
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    // モデルが前後に文字を付けた場合に最初の { … } を救出する。
    const m = raw.match(/\{[\s\S]*\}/)
    if (m) return JSON.parse(m[0])
    throw new Error(`要約結果の JSON 解析に失敗しました: ${raw.slice(0, 80)}`)
  }
}

export interface ProgressCallback {
  (done: number, total: number, phase: 'map' | 'reduce'): void
}

export interface NoteCache {
  get(commentId: string, lang: string): Promise<CommentNote | null>
  set(note: CommentNote, lang: string): Promise<void>
}

export interface SummarizeOptions {
  lang: string
  onProgress?: ProgressCallback
  signal?: AbortSignal
  /** map 結果の再利用キャッシュ（任意）。 */
  noteCache?: NoteCache
}

/** コメント 1 件を圧縮メモ化する。 */
export async function mapComment(
  llm: LlmClient,
  comment: CommentData,
  ordinal: number,
  lang: string,
  signal?: AbortSignal,
): Promise<CommentNote> {
  const session = await llm.createSession({
    systemPrompt: systemPrompt(lang),
    outputLanguage: lang,
    signal,
  })
  try {
    const raw = await session.prompt(mapPrompt(comment, lang), {
      responseConstraint: NOTE_SCHEMA,
      signal,
    })
    const obj = parseJson(raw) as Record<string, unknown>
    return {
      ordinal,
      id: comment.id,
      url: comment.permalink,
      author: comment.author,
      timestampISO: comment.timestampISO,
      gist: String(obj.gist ?? ''),
      kind: coerceKind(obj.kind),
      importance: coerceImportance(obj.importance),
      stance: obj.stance ? String(obj.stance) : undefined,
    }
  } finally {
    session.destroy()
  }
}

/** 指定コメント列を順に map する。 */
export async function mapComments(
  llm: LlmClient,
  comments: CommentData[],
  startOrdinal: number,
  opts: SummarizeOptions,
): Promise<CommentNote[]> {
  const notes: CommentNote[] = []
  for (let i = 0; i < comments.length; i++) {
    const ordinal = startOrdinal + i
    const cached = await opts.noteCache?.get(comments[i].id, opts.lang)
    let note: CommentNote
    if (cached) {
      // 序数は対象範囲により変わるため上書きする。
      note = { ...cached, ordinal }
    } else {
      note = await mapComment(llm, comments[i], ordinal, opts.lang, opts.signal)
      await opts.noteCache?.set(note, opts.lang)
    }
    notes.push(note)
    opts.onProgress?.(i + 1, comments.length, 'map')
  }
  return notes
}

function refsToComments(
  refs: unknown,
  byOrdinal: Map<number, CommentNote>,
): ClusterComment[] {
  if (!Array.isArray(refs)) return []
  const seen = new Set<string>()
  const out: ClusterComment[] = []
  for (const r of refs) {
    const note = byOrdinal.get(Number(r))
    if (!note || seen.has(note.url)) continue
    seen.add(note.url)
    out.push({
      url: note.url,
      ordinal: note.ordinal,
      author: note.author,
      timestampISO: note.timestampISO,
    })
  }
  // 序数の昇順で並べる。
  return out.sort((a, b) => a.ordinal - b.ordinal)
}

function parseClusters(
  obj: Record<string, unknown>,
  byOrdinal: Map<number, CommentNote>,
): Cluster[] {
  const raw = Array.isArray(obj.clusters) ? obj.clusters : []
  const clusters: Cluster[] = raw.map((c: Record<string, unknown>) => ({
    title: String(c.title ?? ''),
    summary: String(c.summary ?? ''),
    importance: coerceImportance(c.importance),
    comments: refsToComments(c.commentRefs, byOrdinal),
  }))
  // 議論のかたまりを時系列に並べる（各クラスタの最早コメント序数の昇順）。
  // 部分要約を任意の順で実行しても、表示は常に時系列になる。
  // 該当コメントが無いクラスタは末尾へ。元の順序を保つ安定ソート。
  const earliest = (c: Cluster) =>
    c.comments.length ? c.comments[0].ordinal : Number.POSITIVE_INFINITY
  return clusters
    .map((c, i) => ({ c, i }))
    .sort((a, b) => earliest(a.c) - earliest(b.c) || a.i - b.i)
    .map(({ c }) => c)
}

async function reduceOnce(
  llm: LlmClient,
  prompt: string,
  lang: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const session = await llm.createSession({
    systemPrompt: systemPrompt(lang),
    outputLanguage: lang,
    signal,
  })
  try {
    const raw = await session.prompt(prompt, {
      responseConstraint: FINAL_SCHEMA,
      signal,
    })
    return parseJson(raw) as Record<string, unknown>
  } finally {
    session.destroy()
  }
}

/** 関連 PR・関連 issue から親子・関連の説明文を決定的に生成する。 */
export function buildParentAndLinks(page: PageData, lang: string): string {
  const { linkedPRs, relatedIssues } = page.relationships
  const ja = lang === 'ja'
  if (linkedPRs.length === 0 && relatedIssues.length === 0) {
    return ja
      ? '親 issue や関連する PR・issue は見つかりませんでした。'
      : 'No parent or linked issues/PRs were found.'
  }
  const lines: string[] = []
  if (relatedIssues.length) {
    lines.push(ja ? '関連 issue:' : 'Related issues:')
    for (const r of relatedIssues) lines.push(`- ${r.title} (${r.url})`)
  }
  if (linkedPRs.length) {
    lines.push(ja ? '関連 PR:' : 'Linked PRs:')
    for (const r of linkedPRs) lines.push(`- ${r.title} (${r.url})`)
  }
  return lines.join('\n')
}

/** メモ列を最終要約へ集約する。多すぎる場合は階層 reduce。 */
export async function reduceNotes(
  llm: LlmClient,
  notes: CommentNote[],
  page: PageData,
  opts: SummarizeOptions,
): Promise<FinalSummary> {
  const byOrdinal = new Map(notes.map((n) => [n.ordinal, n]))
  const single = formatNotesForReduce(notes)

  let obj: Record<string, unknown>
  if (estimateTokens(single) <= REDUCE_INPUT_TOKEN_BUDGET || notes.length <= 1) {
    obj = await reduceOnce(llm, reducePrompt(notes, page, opts.lang), opts.lang, opts.signal)
    opts.onProgress?.(1, 1, 'reduce')
  } else {
    // 階層 reduce: メモを予算ごとのバッチに分け、各バッチを部分要約。
    const batches = batchByTokens(notes, REDUCE_INPUT_TOKEN_BUDGET)
    const partials: string[] = []
    for (let i = 0; i < batches.length; i++) {
      const p = await reduceOnce(
        llm,
        reducePrompt(batches[i], page, opts.lang),
        opts.lang,
        opts.signal,
      )
      partials.push(summarizePartialForMerge(p))
      opts.onProgress?.(i + 1, batches.length + 1, 'reduce')
    }
    obj = await reduceOnce(
      llm,
      mergeReducePrompt(partials, page, opts.lang),
      opts.lang,
      opts.signal,
    )
    opts.onProgress?.(batches.length + 1, batches.length + 1, 'reduce')
  }

  return {
    overview: String(obj.overview ?? ''),
    parentAndLinks: buildParentAndLinks(page, opts.lang),
    overallDiscussion: String(obj.overallDiscussion ?? ''),
    currentProgress: String(obj.currentProgress ?? ''),
    clusters: parseClusters(obj, byOrdinal),
  }
}

function batchByTokens(
  notes: CommentNote[],
  budget: number,
): CommentNote[][] {
  const batches: CommentNote[][] = []
  let cur: CommentNote[] = []
  let acc = 0
  for (const n of notes) {
    const t = estimateTokens(formatNotesForReduce([n]))
    if (cur.length > 0 && acc + t > budget) {
      batches.push(cur)
      cur = []
      acc = 0
    }
    cur.push(n)
    acc += t
  }
  if (cur.length) batches.push(cur)
  return batches
}

/** 部分 reduce 結果を統合 reduce へ渡すためのテキスト化（[番号] 参照を保持）。 */
function summarizePartialForMerge(obj: Record<string, unknown>): string {
  const lines: string[] = []
  if (obj.overallDiscussion) lines.push(String(obj.overallDiscussion))
  const clusters = Array.isArray(obj.clusters) ? obj.clusters : []
  for (const c of clusters as Record<string, unknown>[]) {
    const refs = Array.isArray(c.commentRefs) ? c.commentRefs.join(',') : ''
    lines.push(`- ${c.title}: ${c.summary} [refs: ${refs}]`)
  }
  return lines.join('\n')
}

/** 抽出済みデータと指定コメント範囲から要約を生成する（map → reduce）。 */
export async function summarize(
  llm: LlmClient,
  page: PageData,
  comments: CommentData[],
  startOrdinal: number,
  opts: SummarizeOptions,
): Promise<{ notes: CommentNote[]; summary: FinalSummary }> {
  const notes = await mapComments(llm, comments, startOrdinal, opts)
  const summary = await reduceNotes(llm, notes, page, opts)
  return { notes, summary }
}
