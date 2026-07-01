import { describe, it, expect } from 'vitest'
import { isIssueOrPrUrl } from '../src/shared/url'

describe('isIssueOrPrUrl', () => {
  it('issue/PR の詳細ページは true', () => {
    expect(isIssueOrPrUrl('https://github.com/cli/cli/issues/326')).toBe(true)
    expect(isIssueOrPrUrl('https://github.com/cli/cli/pull/9')).toBe(true)
    expect(
      isIssueOrPrUrl('https://github.com/cli/cli/pull/9/files'),
    ).toBe(true)
    expect(
      isIssueOrPrUrl('https://github.com/cli/cli/issues/326#issuecomment-1'),
    ).toBe(true)
  })

  it('一覧ページ・その他は false', () => {
    expect(isIssueOrPrUrl('https://github.com/cli/cli/issues')).toBe(false)
    expect(isIssueOrPrUrl('https://github.com/cli/cli/pulls')).toBe(false)
    expect(isIssueOrPrUrl('https://github.com/cli/cli')).toBe(false)
    expect(isIssueOrPrUrl('https://github.com/cli/cli/issues/')).toBe(false)
    expect(isIssueOrPrUrl('https://example.com/a/b/issues/1')).toBe(false)
    expect(isIssueOrPrUrl(undefined)).toBe(false)
  })
})
