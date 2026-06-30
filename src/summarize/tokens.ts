// トークン数の概算。正確なトークナイザは持たないため、コンテキスト超過を
// 避けるべく「やや多め」に見積もる保守的なヒューリスティック。
//
// CJK 文字は概ね 1 文字 ≒ 1 トークン、ASCII 等はおよそ 4 文字 ≒ 1 トークン。

const CJK_RE =
  /[　-〿぀-ゟ゠-ヿ㐀-䶿一-鿿豈-﫿＀-￯]/

export function estimateTokens(textValue: string): number {
  if (!textValue) return 0
  let cjk = 0
  let other = 0
  for (const ch of textValue) {
    if (CJK_RE.test(ch)) cjk++
    else other++
  }
  return Math.ceil(cjk + other / 4)
}

/**
 * 推定トークンが maxTokens に収まるよう末尾を切り詰める。
 * 切り詰めた場合は省略記号を付す。
 */
export function truncateToTokens(textValue: string, maxTokens: number): string {
  if (estimateTokens(textValue) <= maxTokens) return textValue
  // 二分探索で収まる最大長を求める。
  let lo = 0
  let hi = textValue.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (estimateTokens(textValue.slice(0, mid)) <= maxTokens) lo = mid
    else hi = mid - 1
  }
  return textValue.slice(0, lo).trimEnd() + ' …(以下省略)'
}
