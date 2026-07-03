import { describe, it, expect } from 'vitest'
import { escapeLabel, truncateLabel } from '../src/sidepanel/diagram'

describe('escapeLabel', () => {
  it('# を最初にエスケープする（後続のエンティティ挿入を壊さない）', () => {
    // 先に " を #quot; に変換してから # を処理すると #quot; の # まで
    // 二重にエスケープされてしまうため、# が最初に処理される必要がある。
    expect(escapeLabel('#')).toBe('#35;')
  })

  it('ダブルクオートをエスケープし、生の " が残らない', () => {
    const out = escapeLabel('foo"bar')
    expect(out).not.toContain('"')
    expect(out).toContain('#quot;')
  })

  it('山括弧とアンパサンドをエスケープする', () => {
    const out = escapeLabel('<script>&alert</script>')
    expect(out).not.toContain('<')
    expect(out).not.toContain('>')
    expect(out).toContain('#lt;')
    expect(out).toContain('#gt;')
    expect(out).toContain('#38;')
  })

  it('改行や制御文字を空白に置換する', () => {
    expect(escapeLabel('line1\nline2\r\ttab')).toBe('line1 line2  tab')
  })

  it('バッククォートを除去する（mermaid の markdown 文字列モード起動を防ぐ）', () => {
    expect(escapeLabel('`code`')).not.toContain('`')
  })

  it('mermaid 構文の注入を試みるラベルが構文として脱出できない', () => {
    const malicious = '"] click ov href "javascript:alert(1)"'
    const out = escapeLabel(malicious)
    expect(out).not.toContain('"')
  })

  it('ディレクティブ風の文字列も " が除去され二重引用符ラベルから脱出できない', () => {
    // %%{init}%% はソース内で行頭に置かれて初めて解釈されるディレクティブであり、
    // ラベルは常に "..." の内側（行の途中）に配置されるため文字列として無害化されれば十分。
    const malicious = '%%{init: {"theme":"dark"}}%%'
    const out = escapeLabel(malicious)
    expect(out).not.toContain('"')
  })
})

describe('truncateLabel', () => {
  it('デフォルト 40 文字以内ならそのまま返す', () => {
    expect(truncateLabel('short label')).toBe('short label')
  })

  it('40 文字を超える場合は 40 文字に切って … を付与する', () => {
    const long = 'あ'.repeat(50)
    const out = truncateLabel(long)
    expect(out).toBe('あ'.repeat(40) + '…')
    expect(out.length).toBe(41)
  })

  it('max を指定できる', () => {
    expect(truncateLabel('abcdefghij', 5)).toBe('abcde…')
  })

  it('ちょうど max の長さなら省略しない', () => {
    expect(truncateLabel('abcde', 5)).toBe('abcde')
  })
})
