import { describe, it, expect } from 'vitest'
import {
  buildCreateOptions,
  isLanguageModelSupported,
} from '../src/summarize/llmClient'

describe('buildCreateOptions', () => {
  it('出力言語を expectedOutputs に反映する', () => {
    const opts = buildCreateOptions({ outputLanguage: 'ja' })
    expect(opts.expectedOutputs).toEqual([{ type: 'text', languages: ['ja'] }])
  })

  it('systemPrompt を initialPrompts(system) に変換する', () => {
    const opts = buildCreateOptions({ systemPrompt: 'あなたは要約者です' })
    expect(opts.initialPrompts).toEqual([
      { role: 'system', content: 'あなたは要約者です' },
    ])
  })

  it('未指定の項目は省略する', () => {
    const opts = buildCreateOptions({})
    expect(opts.initialPrompts).toBeUndefined()
    expect(opts.expectedOutputs).toBeUndefined()
  })
})

describe('isLanguageModelSupported', () => {
  it('グローバルが無ければ false', () => {
    expect(isLanguageModelSupported(undefined)).toBe(false)
  })

  it('create を持つオブジェクトなら true', () => {
    expect(isLanguageModelSupported({ create: () => {} })).toBe(true)
  })
})
