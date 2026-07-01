// issue/PR の「詳細」ページ（一覧ページは除く）かを判定する共通ユーティリティ。
// - 対象:   https://github.com/owner/repo/issues/123, .../pull/123
// - 対象外: https://github.com/owner/repo/issues, .../pulls, その他

const ISSUE_OR_PR_DETAIL =
  /^https:\/\/github\.com\/[^/]+\/[^/]+\/(?:issues|pull)\/\d+(?:[/?#]|$)/

export function isIssueOrPrUrl(url: string | undefined): boolean {
  return !!url && ISSUE_OR_PR_DETAIL.test(url)
}
