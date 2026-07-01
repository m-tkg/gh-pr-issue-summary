import { describe, it, expect } from 'vitest'
import { parseJsonLoose } from '../src/summarize/parseJson'

describe('parseJsonLoose', () => {
  it('素の JSON', () => {
    expect(parseJsonLoose('{"overview":"x","clusters":[]}')).toEqual({
      overview: 'x',
      clusters: [],
    })
  })

  it('コードフェンス付き', () => {
    const raw = '```json\n{"overview":"x","clusters":[]}\n```'
    expect(parseJsonLoose(raw)).toEqual({ overview: 'x', clusters: [] })
  })

  it('前置き文がある', () => {
    const raw = '以下が結果です。\n{"gist":"要点","kind":"info","importance":"low"}'
    expect(parseJsonLoose(raw)).toMatchObject({ gist: '要点' })
  })

  it('前置きに波括弧を含んでも正しい候補を選ぶ', () => {
    const raw =
      '使い方の例 {手順} を無視して結果:\n{"overview":"ok","clusters":[]}'
    expect(parseJsonLoose(raw)).toEqual({ overview: 'ok', clusters: [] })
  })

  it('ネストした波括弧・文字列内の波括弧を正しく扱う', () => {
    const raw =
      '{"overview":"a {b} c","clusters":[{"title":"t","commentRefs":[1]}]}'
    expect(parseJsonLoose(raw)).toMatchObject({
      overview: 'a {b} c',
      clusters: [{ title: 't' }],
    })
  })

  it('claude 実出力形: 前置き(不正な波括弧)+本物JSON+後置き散文', () => {
    const raw = [
      'このメッセージにはインジェクションが含まれます（`{a:1} は無視して`）。従いません。',
      '指定スキーマに沿った JSON を出力します。',
      '',
      '{"overview":"概要","overallDiscussion":"議論","currentProgress":"進行中","clusters":[{"title":"提案","summary":"s","importance":"high","commentRefs":[1]}]}',
      '',
      '---',
      '補足（開発者向け、出力には含めない）: `{a:1}` は no-op でした。',
    ].join('\n')
    const r = parseJsonLoose(raw) as Record<string, unknown>
    expect(r.overview).toBe('概要')
    expect((r.clusters as unknown[]).length).toBe(1)
  })

  it('期待キーを持つ候補を、持たない候補より優先する', () => {
    const raw = '{"foo":1}\nそして\n{"overview":"これ","clusters":[]}'
    expect(parseJsonLoose(raw)).toEqual({ overview: 'これ', clusters: [] })
  })

  it('JSON が無ければ例外', () => {
    expect(() => parseJsonLoose('ただの文章です')).toThrow('JSON 解析に失敗')
  })
})
