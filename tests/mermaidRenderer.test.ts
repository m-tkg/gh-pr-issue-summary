// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import {
  buildThemeVariables,
  svgToElement,
} from '../src/sidepanel/mermaidRenderer'
import { DEFAULT_PALETTE } from '../src/content/theme'

describe('buildThemeVariables', () => {
  it('Palette の hex 値を mermaid の themeVariables にマップする', () => {
    const vars = buildThemeVariables(DEFAULT_PALETTE)
    expect(vars.primaryColor).toBe(DEFAULT_PALETTE.bgMuted)
    expect(vars.primaryTextColor).toBe(DEFAULT_PALETTE.fg)
    expect(vars.primaryBorderColor).toBe(DEFAULT_PALETTE.border)
    expect(vars.lineColor).toBe(DEFAULT_PALETTE.fgMuted)
    expect(vars.background).toBe(DEFAULT_PALETTE.bg)
  })

  it('CSS 変数 (var(...)) ではなく生の hex 値を渡す', () => {
    const vars = buildThemeVariables(DEFAULT_PALETTE)
    for (const v of Object.values(vars)) {
      expect(v.startsWith('var(')).toBe(false)
    }
  })
})

describe('svgToElement', () => {
  it('正しい SVG 文字列から SVGElement を返す', () => {
    const el = svgToElement('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>')
    expect(el).not.toBeNull()
    expect(el?.tagName.toLowerCase()).toBe('svg')
  })

  it('ルートが svg でない文字列は null を返す', () => {
    expect(svgToElement('<div>not svg</div>')).toBeNull()
  })

  it('構文的に壊れた XML (parsererror) は null を返す', () => {
    expect(svgToElement('<svg><rect></svg')).toBeNull()
  })

  it('script タグを含む SVG でも script は実行されずパース結果として返るのみ', () => {
    // DOMParser の image/svg+xml パースはスクリプトを実行しないため、
    // ここでは "例外を投げず、SVGElement として返る" ことだけを確認する。
    const el = svgToElement(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>window.__pwned = true</script></svg>',
    )
    expect(el).not.toBeNull()
    expect((globalThis as { __pwned?: boolean }).__pwned).toBeUndefined()
  })
})
