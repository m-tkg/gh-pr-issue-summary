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
