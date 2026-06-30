import { describe, it, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import { extractTheme, DEFAULT_PALETTE } from '../src/content/theme'

describe('extractTheme', () => {
  it('Primer の新変数(--bgColor-*)を読み取る', () => {
    const dom = new JSDOM(`<!doctype html><html style="
      --bgColor-default:#0d1117;
      --fgColor-default:#f0f6fc;
      --borderColor-default:#3d444d;
      --fgColor-accent:#4493f8;
      --bgColor-done-emphasis:#8957e5;
    "><body></body></html>`)
    const p = extractTheme(dom.window.document)
    expect(p.bg).toBe('#0d1117')
    expect(p.fg).toBe('#f0f6fc')
    expect(p.border).toBe('#3d444d')
    expect(p.accent).toBe('#4493f8')
    expect(p.merged).toBe('#8957e5')
  })

  it('旧変数(--color-*)もフォールバックで読む', () => {
    const dom = new JSDOM(`<!doctype html><html style="
      --color-canvas-default:#ffffff;
      --color-accent-fg:#0969da;
    "><body></body></html>`)
    const p = extractTheme(dom.window.document)
    expect(p.bg).toBe('#ffffff')
    expect(p.accent).toBe('#0969da')
  })

  it('変数が無ければ既定パレット', () => {
    const dom = new JSDOM(`<!doctype html><html><body></body></html>`)
    expect(extractTheme(dom.window.document)).toEqual(DEFAULT_PALETTE)
  })
})
