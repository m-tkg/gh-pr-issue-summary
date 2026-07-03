import type { FinalSummary } from '../summarize/types'

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
      lines.push(`${id}["${label(c.title)}"]`)
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

  return lines.join('\n')
}
