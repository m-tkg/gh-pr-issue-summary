// map-reduce 要約パイプライン。LlmClient 経由で Gemini Nano を呼ぶ。

import type { CommentData, PageData } from '../content/extract'
import type { LlmClient } from './llmClient'
import type {
  Cluster,
  ClusterComment,
  ClusterStatus,
  CommentKind,
  CommentNote,
  FinalSummary,
  FlowStep,
  FlowStepKind,
  Importance,
  ProblemFactor,
  ProblemStructure,
  PrSummary,
} from './types'
import { NOTE_SCHEMA, FINAL_SCHEMA, FINAL_SCHEMA_WITH_FLOW } from './schema'
import {
  systemPrompt,
  mapPrompt,
  reducePrompt,
  mergeReducePrompt,
  formatNotesForReduce,
  singleShotPrompt,
} from './prompts'
import { estimateTokens } from './tokens'
import { parseJsonLoose as parseJson } from './parseJson'

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

const VALID_STATUS: ClusterStatus[] = ['resolved', 'open']

/** 不正値・欠落は undefined（従来表示）にフォールバックする。 */
function coerceStatus(v: unknown): ClusterStatus | undefined {
  return VALID_STATUS.includes(v as ClusterStatus)
    ? (v as ClusterStatus)
    : undefined
}

const VALID_FLOW_KINDS: FlowStepKind[] = ['action', 'decision', 'outcome']

/** 不正値・欠落は undefined（action と同じ描画）にフォールバックする。 */
function coerceFlowKind(v: unknown): FlowStepKind | undefined {
  return VALID_FLOW_KINDS.includes(v as FlowStepKind)
    ? (v as FlowStepKind)
    : undefined
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
  /**
   * CLI バックエンド限定の拡張フィールド一式（flowSteps / cluster.status /
   * flowStep.kind）を生成させるか。summarizeSingleShot のみで有効。
   */
  includeExtendedFields?: boolean
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
  byOrdinal: Map<number, ClusterComment>,
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
  byOrdinal: Map<number, ClusterComment>,
): Cluster[] {
  const raw = Array.isArray(obj.clusters) ? obj.clusters : []
  const clusters: Cluster[] = raw.map((c: Record<string, unknown>) => {
    const status = coerceStatus(c.status)
    return {
      title: String(c.title ?? ''),
      summary: String(c.summary ?? ''),
      importance: coerceImportance(c.importance),
      ...(status ? { status } : {}),
      comments: refsToComments(c.commentRefs, byOrdinal),
    }
  })
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

const MAX_FLOW_STEPS = 10
const FLOW_STEP_LABEL_MAX = 60

/**
 * flowSteps（CLI バックエンド限定・任意項目）を防御的に解析する。
 * Nano の出力（FINAL_SCHEMA）には flowSteps キー自体が存在しないため、
 * 常にこの関数を通しても Nano 経路には影響しない。
 */
function parseFlowSteps(
  raw: unknown,
  byOrdinal: Map<number, ClusterComment>,
): FlowStep[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const steps = raw
    .slice(0, MAX_FLOW_STEPS)
    .map((s: Record<string, unknown>) => {
      const kind = coerceFlowKind(s?.kind)
      return {
        label:
          typeof s?.label === 'string'
            ? s.label.trim().slice(0, FLOW_STEP_LABEL_MAX)
            : '',
        ...(kind ? { kind } : {}),
        comments: refsToComments(s?.commentRefs, byOrdinal),
      }
    })
    .filter((s) => s.label.length > 0)
  return steps.length > 0 ? steps : undefined
}

const MAX_PROBLEM_FACTORS = 4
const PROBLEM_LABEL_MAX = 60

/** causes / impacts の 1 配列を防御的に解析する。 */
function parseProblemFactors(
  raw: unknown,
  byOrdinal: Map<number, ClusterComment>,
): ProblemFactor[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((f: Record<string, unknown>) => ({
      label:
        typeof f?.label === 'string'
          ? f.label.trim().slice(0, PROBLEM_LABEL_MAX)
          : '',
      comments: refsToComments(f?.commentRefs, byOrdinal),
    }))
    .filter((f) => f.label.length > 0)
    .slice(0, MAX_PROBLEM_FACTORS)
}

/**
 * problemStructure（CLI バックエンド限定・任意項目）を防御的に解析する。
 * 中心課題が空、または原因・影響・あるべき姿がすべて空なら図にならないため
 * undefined を返す。Nano の出力にはキー自体が無いため常に通しても影響しない。
 */
function parseProblemStructure(
  raw: unknown,
  byOrdinal: Map<number, ClusterComment>,
): ProblemStructure | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return undefined
  }
  const obj = raw as Record<string, unknown>
  const problem =
    typeof obj.problem === 'string'
      ? obj.problem.trim().slice(0, PROBLEM_LABEL_MAX)
      : ''
  if (problem.length === 0) return undefined
  const causes = parseProblemFactors(obj.causes, byOrdinal)
  const impacts = parseProblemFactors(obj.impacts, byOrdinal)
  const goal =
    typeof obj.goal === 'string'
      ? obj.goal.trim().slice(0, PROBLEM_LABEL_MAX)
      : ''
  if (causes.length === 0 && impacts.length === 0 && goal.length === 0) {
    return undefined
  }
  return { problem, causes, impacts, ...(goal ? { goal } : {}) }
}

const PR_SUMMARY_TEXT_MAX = 300

/**
 * prSummary（CLI バックエンド限定・PR のみの任意項目）を防御的に解析する。
 * 問題と解決方法は対で意味を成すため、どちらかが空なら undefined を返す。
 */
function parsePrSummary(raw: unknown): PrSummary | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return undefined
  }
  const obj = raw as Record<string, unknown>
  const text = (v: unknown) =>
    typeof v === 'string' ? v.trim().slice(0, PR_SUMMARY_TEXT_MAX) : ''
  const problem = text(obj.problem)
  const solution = text(obj.solution)
  if (problem.length === 0 || solution.length === 0) return undefined
  return { problem, solution }
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

/** モデル出力(JSON)と序数マップから FinalSummary を組み立てる（共通）。 */
export function assembleFinalSummary(
  obj: Record<string, unknown>,
  page: PageData,
  lang: string,
  byOrdinal: Map<number, ClusterComment>,
): FinalSummary {
  const flowSteps = parseFlowSteps(obj.flowSteps, byOrdinal)
  const problemStructure = parseProblemStructure(obj.problemStructure, byOrdinal)
  const prSummary = parsePrSummary(obj.prSummary)
  return {
    overview: String(obj.overview ?? ''),
    parentAndLinks: buildParentAndLinks(page, lang),
    overallDiscussion: String(obj.overallDiscussion ?? ''),
    currentProgress: String(obj.currentProgress ?? ''),
    clusters: parseClusters(obj, byOrdinal),
    ...(flowSteps ? { flowSteps } : {}),
    ...(problemStructure ? { problemStructure } : {}),
    ...(prSummary ? { prSummary } : {}),
  }
}

function ordinalMapFromNotes(
  notes: CommentNote[],
): Map<number, ClusterComment> {
  return new Map(
    notes.map((n) => [
      n.ordinal,
      {
        url: n.url,
        ordinal: n.ordinal,
        author: n.author,
        timestampISO: n.timestampISO,
      },
    ]),
  )
}

/** メモ列を最終要約へ集約する。多すぎる場合は階層 reduce。 */
export async function reduceNotes(
  llm: LlmClient,
  notes: CommentNote[],
  page: PageData,
  opts: SummarizeOptions,
): Promise<FinalSummary> {
  const byOrdinal = ordinalMapFromNotes(notes)
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

  return assembleFinalSummary(obj, page, opts.lang, byOrdinal)
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

/**
 * 大コンテキストのバックエンド（CLI 等）向け: 全コメントを 1 回の呼び出しで
 * 構造化要約する。プロセス起動回数を最小化でき高速。
 */
export async function summarizeSingleShot(
  llm: LlmClient,
  page: PageData,
  comments: CommentData[],
  opts: SummarizeOptions,
): Promise<{ summary: FinalSummary }> {
  const session = await llm.createSession({
    systemPrompt: systemPrompt(opts.lang),
    outputLanguage: opts.lang,
    signal: opts.signal,
  })
  try {
    opts.onProgress?.(0, 1, 'reduce')
    const raw = await session.prompt(
      singleShotPrompt(page, comments, opts.lang, {
        includeExtendedFields: opts.includeExtendedFields,
      }),
      {
        responseConstraint: opts.includeExtendedFields
          ? FINAL_SCHEMA_WITH_FLOW
          : FINAL_SCHEMA,
        signal: opts.signal,
      },
    )
    const obj = parseJson(raw) as Record<string, unknown>
    const byOrdinal = new Map<number, ClusterComment>(
      comments.map((c, i) => [
        i + 1,
        {
          url: c.permalink,
          ordinal: i + 1,
          author: c.author,
          timestampISO: c.timestampISO,
        },
      ]),
    )
    opts.onProgress?.(1, 1, 'reduce')
    return { summary: assembleFinalSummary(obj, page, opts.lang, byOrdinal) }
  } finally {
    session.destroy()
  }
}
