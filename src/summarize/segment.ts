// コメント列を、推定トークンが予算内に収まる連続範囲（セグメント）に分割する。
// セグメントは (1) UI での範囲可視化、(2) 任意開始位置からの要約、
// (3) reduce のバッチ化、を兼ねる単位。各コメントは分割せず丸ごと 1 つに含める。

import type { CommentData } from '../content/extract'
import { estimateTokens } from './tokens'

/** セグメント分割の既定トークン予算（コメント本文ベース）。 */
export const DEFAULT_SEGMENT_BUDGET = 4000

export interface Segment {
  /** 0 始まりのセグメント番号。 */
  index: number
  /** このセグメントが含む最初/最後のコメントの 1 始まり序数（スレッド内順）。 */
  startOrdinal: number
  endOrdinal: number
  /** 含まれるコメントの canonical id。 */
  commentIds: string[]
  /** 推定トークン数。 */
  estTokens: number
}

/**
 * コメント列を予算（トークン）以内のセグメントに分割する。
 * 単一コメントが予算を超える場合でも、そのコメント単独で 1 セグメントにする
 * （map 時に切り詰める前提）。
 */
export function planSegments(
  comments: CommentData[],
  budgetTokens: number,
): Segment[] {
  const segments: Segment[] = []
  let start = 0
  let acc = 0
  let ids: string[] = []

  const flush = (endExclusive: number) => {
    if (ids.length === 0) return
    segments.push({
      index: segments.length,
      startOrdinal: start + 1,
      endOrdinal: endExclusive,
      commentIds: ids,
      estTokens: acc,
    })
    ids = []
    acc = 0
  }

  for (let i = 0; i < comments.length; i++) {
    const t = estimateTokens(comments[i].text)
    // 既に何か積んでいて、追加すると予算超過 → ここで一旦締める。
    if (ids.length > 0 && acc + t > budgetTokens) {
      flush(i)
      start = i
    }
    ids.push(comments[i].id)
    acc += t
  }
  flush(comments.length)
  return segments
}
