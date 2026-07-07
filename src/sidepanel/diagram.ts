import type { FinalSummary, FlowStep } from '../summarize/types'

// FinalSummary から mermaid ソースを決定的に組み立てる純粋関数群。
// LLM には mermaid コードを直接書かせない（構文エラーを原理的に排除するため）。
//
// セキュリティ上の前提: cluster.title / summary 等は LLM 出力であり、
// プロンプトインジェクション経由で攻撃者が制御しうる。そのためノード ID・
// エッジ・ディレクティブの位置には一切 LLM テキストを使わず、テキストは
// 常に escapeLabel を通した上で二重引用符のラベル内にのみ配置する。

/**
 * mermaid のラベル文字列として安全な形にエスケープする。
 * `#` を最初に処理すること（後続で挿入する `#quot;` 等のエンティティ自体が
 * 二重にエスケープされるのを防ぐため）。
 */
export function escapeLabel(input: string): string {
  return input
    .replace(/#/g, '#35;')
    .replace(/"/g, '#quot;')
    .replace(/</g, '#lt;')
    .replace(/>/g, '#gt;')
    .replace(/&/g, '#38;')
    .replace(/[\r\n\t\f\v]/g, ' ')
    .replace(/`/g, '')
}

/** ラベルを指定文字数に切り詰め、超過時は末尾に … を付与する。 */
export function truncateLabel(input: string, max = 40): string {
  if (input.length <= max) return input
  return `${input.slice(0, max)}…`
}

/** 図の重要度別スタイルに使う色。GitHub ページから抽出した Palette 由来の hex 値を渡す。 */
export interface DiagramTheme {
  high: string
  medium: string
  low: string
}

const MAX_STRUCTURE_CLUSTERS = 12

function label(text: string, max = 40): string {
  return escapeLabel(truncateLabel(text, max))
}

function classDefBlock(theme: DiagramTheme): string {
  return [
    `classDef high stroke:${theme.high},stroke-width:3px`,
    `classDef medium stroke:${theme.medium},stroke-width:2px`,
    `classDef low stroke:${theme.low},stroke-width:1px`,
  ].join('\n')
}

/**
 * 決着済み(resolved)ノードのラベルに付ける決定的サフィックス。
 * escapeLabel 済みラベルの後にコード側で付与するため注入経路にならない。
 */
function statusSuffix(status: 'resolved' | 'open' | undefined): string {
  return status === 'resolved' ? ' ✓' : ''
}

/** 未決(open)ノード用の点線スタイル。重要度の色クラスと直交して共存できる。 */
const OPEN_CLASS_DEF = 'classDef stOpen stroke-dasharray:4 3'

/** 議論の構造図（概要 → 各クラスタ(重要度付き) → 現状の進捗）を組み立てる。 */
export function buildStructureDiagram(
  summary: FinalSummary,
  theme: DiagramTheme,
): string {
  const lines = ['flowchart TD']
  lines.push(`ov["${label(summary.overview)}"]`)
  lines.push(`pg["${label(summary.currentProgress)}"]`)

  const clusters = summary.clusters.slice(0, MAX_STRUCTURE_CLUSTERS)
  const overflow = summary.clusters.length - clusters.length

  if (clusters.length === 0 && overflow === 0) {
    lines.push('ov --> pg')
  } else {
    clusters.forEach((c, i) => {
      const id = `c${i}`
      lines.push(`${id}["${label(c.title)}${statusSuffix(c.status)}"]`)
      lines.push(`ov --> ${id}`)
      lines.push(`${id} --> pg`)
    })
    if (overflow > 0) {
      lines.push(`cmore["他 ${overflow} 件"]`)
      lines.push('ov --> cmore')
      lines.push('cmore --> pg')
    }
  }

  lines.push(classDefBlock(theme))
  clusters.forEach((c, i) => {
    lines.push(`class c${i} ${c.importance}`)
  })
  if (clusters.some((c) => c.status === 'open')) {
    lines.push(OPEN_CLASS_DEF)
    clusters.forEach((c, i) => {
      if (c.status === 'open') lines.push(`class c${i} stOpen`)
    })
  }

  return lines.join('\n')
}

function ordinalRangeSuffix(comments: { ordinal: number }[]): string {
  if (comments.length === 0) return ''
  const min = comments[0].ordinal
  const max = comments[comments.length - 1].ordinal
  return min === max ? ` #${min}` : ` #${min}〜#${max}`
}

/**
 * 議論の時系列フロー（クラスタを最早コメント序数の昇順で鎖状接続）を組み立てる。
 * クラスタが 1 件以下では時系列を示す意味が無いため null を返す。
 */
export function buildTimelineDiagram(
  summary: FinalSummary,
  theme: DiagramTheme,
): string | null {
  if (summary.clusters.length <= 1) return null

  const lines = ['flowchart LR']
  summary.clusters.forEach((c, i) => {
    const text =
      label(c.title) + ordinalRangeSuffix(c.comments) + statusSuffix(c.status)
    lines.push(`c${i}["${text}"]`)
  })
  for (let i = 0; i < summary.clusters.length - 1; i++) {
    lines.push(`c${i} --> c${i + 1}`)
  }
  lines.push(`classDef step stroke:${theme.medium}`)
  summary.clusters.forEach((_c, i) => lines.push(`class c${i} step`))
  if (summary.clusters.some((c) => c.status === 'open')) {
    lines.push(OPEN_CLASS_DEF)
    summary.clusters.forEach((c, i) => {
      if (c.status === 'open') lines.push(`class c${i} stOpen`)
    })
  }

  return lines.join('\n')
}

/**
 * やろうとしている作業・提案内容の流れ（CLI バックエンド限定・任意）を
 * 鎖状接続の flowchart LR として組み立てる。1 件以下では意味が無いため null。
 */
export function buildContentFlowDiagram(
  steps: FlowStep[],
  theme: DiagramTheme,
): string | null {
  if (steps.length <= 1) return null

  const lines = ['flowchart LR']
  steps.forEach((s, i) => {
    lines.push(`s${i}["${label(s.label)}"]`)
  })
  for (let i = 0; i < steps.length - 1; i++) {
    lines.push(`s${i} --> s${i + 1}`)
  }
  lines.push(`classDef step stroke:${theme.medium}`)
  steps.forEach((_s, i) => lines.push(`class s${i} step`))

  return lines.join('\n')
}
