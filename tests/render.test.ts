// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  segmentLabel,
  renderSegments,
  renderSummary,
  type SegmentViewState,
} from '../src/sidepanel/render'
import type { Segment } from '../src/summarize/segment'
import type { FinalSummary } from '../src/summarize/types'

beforeEach(() => {
  document.body.replaceChildren()
})

describe('segmentLabel', () => {
  it('範囲ラベルを作る', () => {
    expect(
      segmentLabel({ index: 0, startOrdinal: 1, endOrdinal: 18, commentIds: [], estTokens: 0 }),
    ).toBe('コメント 1〜18')
  })
  it('単一コメントは 1 つだけ表示', () => {
    expect(
      segmentLabel({ index: 0, startOrdinal: 5, endOrdinal: 5, commentIds: [], estTokens: 0 }),
    ).toBe('コメント 5')
  })
})

describe('renderSegments', () => {
  const segs: Segment[] = [
    { index: 0, startOrdinal: 1, endOrdinal: 2, commentIds: ['a', 'b'], estTokens: 10 },
    { index: 1, startOrdinal: 3, endOrdinal: 4, commentIds: ['c', 'd'], estTokens: 10 },
  ]

  it('範囲ごとにボタンを描画し、状態を反映する', () => {
    const states = new Map<number, SegmentViewState>([[1, { status: 'done' }]])
    const node = renderSegments(segs, states, () => {})
    expect(node.textContent).toContain('コメント 1〜2')
    expect(node.textContent).toContain('コメント 3〜4')
    expect(node.textContent).toContain('要約済み')
    expect(node.querySelectorAll('button')).toHaveLength(2)
    expect(node.querySelector('button')?.textContent).toBe('全体を要約')
  })

  it('ボタンクリックでハンドラに segment index を渡す', () => {
    const onClick = vi.fn()
    const node = renderSegments(segs, new Map(), onClick)
    node.querySelectorAll('button')[1].dispatchEvent(new Event('click'))
    expect(onClick).toHaveBeenCalledWith(1)
  })
})

describe('renderSummary', () => {
  const summary: FinalSummary = {
    overview: 'これは概要',
    parentAndLinks: '関連なし',
    overallDiscussion: '議論の流れ',
    currentProgress: '進行中',
    clusters: [
      {
        title: '論点A',
        summary: 'Aの要約',
        importance: 'high',
        commentUrls: ['/r/r/issues/1#issuecomment-10'],
      },
    ],
  }

  it('各セクションとクラスタを描画する', () => {
    const node = renderSummary(summary, () => {})
    const t = node.textContent ?? ''
    expect(t).toContain('これは概要')
    expect(t).toContain('議論の流れ')
    expect(t).toContain('論点A')
    expect(t).toContain('議論のかたまり (1)')
  })

  it('コメントリンクのクリックで commentId を渡す', () => {
    const onLink = vi.fn()
    const node = renderSummary(summary, onLink)
    const a = node.querySelector('a.comment-link') as HTMLAnchorElement
    a.dispatchEvent(new Event('click'))
    expect(onLink).toHaveBeenCalledWith('issuecomment-10')
  })
})
