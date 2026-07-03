// mermaid への依存をこのモジュールに隔離する。
// mermaid はサイズが大きいため dynamic import で初期ロードへの影響を避ける。

import type { Palette } from '../content/theme'

/** Palette の hex 値を mermaid の themeVariables にマップする（var() は解釈されないため生の hex を渡す）。 */
export function buildThemeVariables(palette: Palette): Record<string, string> {
  return {
    primaryColor: palette.bgMuted,
    primaryTextColor: palette.fg,
    primaryBorderColor: palette.border,
    lineColor: palette.fgMuted,
    background: palette.bg,
    fontFamily: 'inherit',
  }
}

/**
 * SVG 文字列を安全に Element へ変換する。innerHTML は使わず、
 * DOMParser の image/svg+xml パース（スクリプト非実行）のみを用いる。
 * ルートが svg でない、またはパースエラーの場合は null。
 */
export function svgToElement(svg: string): SVGElement | null {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
  if (doc.getElementsByTagName('parsererror').length > 0) return null
  const root = doc.documentElement
  if (root.tagName.toLowerCase() !== 'svg') return null
  return document.importNode(root, true) as unknown as SVGElement
}

let renderCount = 0

/** mermaid ソースを描画し、container の中身を置き換える。失敗時はエラーテキストを表示する。 */
export async function renderDiagram(
  src: string,
  container: HTMLElement,
  palette: Palette,
): Promise<void> {
  try {
    const mermaid = (await import('mermaid')).default
    // テーマはページごとに変わりうるため、描画のたびに初期化し直す（コストは軽微）。
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      themeVariables: buildThemeVariables(palette),
      flowchart: { htmlLabels: false },
    })
    const id = `mermaid-diagram-${renderCount++}`
    const { svg } = await mermaid.render(id, src)
    const el = svgToElement(svg)
    container.replaceChildren()
    if (el) container.append(el)
  } catch {
    container.replaceChildren(document.createTextNode('図を表示できませんでした。'))
  }
}
