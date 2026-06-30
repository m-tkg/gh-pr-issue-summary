import { describe, it, expect } from 'vitest'
import { estimateTokens } from '../src/summarize/tokens'
import { planSegments } from '../src/summarize/segment'
import type { CommentData } from '../src/content/extract'

function comment(id: number, text: string): CommentData {
  return {
    id: `issuecomment-${id}`,
    author: 'u',
    permalink: `/r/r/issues/1#issuecomment-${id}`,
    text,
  }
}

describe('estimateTokens', () => {
  it('空文字は 0', () => {
    expect(estimateTokens('')).toBe(0)
  })

  it('長文ほど大きい（単調増加）', () => {
    expect(estimateTokens('a'.repeat(400))).toBeGreaterThan(
      estimateTokens('a'.repeat(40)),
    )
  })

  it('日本語は ASCII より 1 文字あたり多めに見積もる', () => {
    expect(estimateTokens('あ'.repeat(50))).toBeGreaterThan(
      estimateTokens('a'.repeat(50)),
    )
  })
})

describe('planSegments', () => {
  it('予算内に収まる連続コメントを 1 セグメントにまとめる', () => {
    const comments = [
      comment(1, 'short'),
      comment(2, 'short'),
      comment(3, 'short'),
    ]
    const segs = planSegments(comments, 10_000)
    expect(segs).toHaveLength(1)
    expect(segs[0]).toMatchObject({
      index: 0,
      startOrdinal: 1,
      endOrdinal: 3,
    })
    expect(segs[0].commentIds).toEqual([
      'issuecomment-1',
      'issuecomment-2',
      'issuecomment-3',
    ])
  })

  it('予算を超えると次のセグメントに分割する', () => {
    const big = 'a'.repeat(400) // ~100+ tokens 程度
    const comments = [comment(1, big), comment(2, big), comment(3, big)]
    const segs = planSegments(comments, estimateTokens(big) + 1)
    // 1 コメントごとに分かれる
    expect(segs).toHaveLength(3)
    expect(segs.map((s) => s.startOrdinal)).toEqual([1, 2, 3])
  })

  it('単一コメントが予算超過でも独立したセグメントになる', () => {
    const huge = 'a'.repeat(100_000)
    const segs = planSegments([comment(1, huge)], 1000)
    expect(segs).toHaveLength(1)
    expect(segs[0].startOrdinal).toBe(1)
    expect(segs[0].endOrdinal).toBe(1)
  })

  it('コメントが無ければ空配列', () => {
    expect(planSegments([], 1000)).toEqual([])
  })
})
