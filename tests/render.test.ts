// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  segmentLabel,
  formatDate,
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

describe('formatDate', () => {
  it('ISO を YYYY-MM-DD HH:mm 形式にする', () => {
    expect(formatDate('2020-05-04T02:06:39.000Z')).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/,
    )
  })
  it('空・不正は空文字', () => {
    expect(formatDate(undefined)).toBe('')
    expect(formatDate('not-a-date')).toBe('')
  })
})

describe('renderSegments', () => {
  const segs: Segment[] = [
    { index: 0, startOrdinal: 1, endOrdinal: 2, commentIds: ['a', 'b'], estTokens: 10 },
    { index: 1, startOrdinal: 3, endOrdinal: 4, commentIds: ['c', 'd'], estTokens: 10 },
  ]

  it('「全体を要約」をリスト外に出し、各範囲は「この範囲を要約」', () => {
    const states = new Map<number, SegmentViewState>([[1, { status: 'done' }]])
    const node = renderSegments(segs, states, {
      onSummarizeAll: () => {},
      onSummarizeRange: () => {},
    })
    expect(node.textContent).toContain('コメント 1〜2')
    expect(node.textContent).toContain('コメント 3〜4')
    expect(node.textContent).toContain('要約済み')
    const allBtn = node.querySelector('.summarize-all-btn')
    expect(allBtn?.textContent).toBe('全体を要約')
    // 全体ボタン1 + 範囲ボタン2
    expect(node.querySelectorAll('button')).toHaveLength(3)
    const rangeBtns = node.querySelectorAll('.segment-btn')
    expect(rangeBtns).toHaveLength(2)
    expect(rangeBtns[0].textContent).toBe('この範囲を要約')
  })

  it('「全体を要約」クリックで onSummarizeAll を呼ぶ', () => {
    const onAll = vi.fn()
    const node = renderSegments(segs, new Map(), {
      onSummarizeAll: onAll,
      onSummarizeRange: () => {},
    })
    node.querySelector('.summarize-all-btn')!.dispatchEvent(new Event('click'))
    expect(onAll).toHaveBeenCalled()
  })

  it('範囲ボタンクリックで onSummarizeRange に index を渡す', () => {
    const onRange = vi.fn()
    const node = renderSegments(segs, new Map(), {
      onSummarizeAll: () => {},
      onSummarizeRange: onRange,
    })
    node.querySelectorAll('.segment-btn')[1].dispatchEvent(new Event('click'))
    expect(onRange).toHaveBeenCalledWith(1)
  })

  it('要約済みの範囲ボタンは disable される', () => {
    const states = new Map<number, SegmentViewState>([[0, { status: 'done' }]])
    const node = renderSegments(segs, states, {
      onSummarizeAll: () => {},
      onSummarizeRange: () => {},
    })
    const rangeBtns = node.querySelectorAll('.segment-btn')
    expect((rangeBtns[0] as HTMLButtonElement).disabled).toBe(true)
    expect((rangeBtns[1] as HTMLButtonElement).disabled).toBe(false)
  })

  it('全範囲が要約済みなら「全体を要約」も disable される', () => {
    const states = new Map<number, SegmentViewState>([
      [0, { status: 'done' }],
      [1, { status: 'done' }],
    ])
    const node = renderSegments(segs, states, {
      onSummarizeAll: () => {},
      onSummarizeRange: () => {},
    })
    expect(
      (node.querySelector('.summarize-all-btn') as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('一部のみ要約済みなら「全体を要約」は有効', () => {
    const states = new Map<number, SegmentViewState>([[0, { status: 'done' }]])
    const node = renderSegments(segs, states, {
      onSummarizeAll: () => {},
      onSummarizeRange: () => {},
    })
    expect(
      (node.querySelector('.summarize-all-btn') as HTMLButtonElement).disabled,
    ).toBe(false)
  })

  it('単一範囲なら「全体を要約」のみで範囲リストは出さない', () => {
    const node = renderSegments([segs[0]], new Map(), {
      onSummarizeAll: () => {},
      onSummarizeRange: () => {},
    })
    expect(node.querySelector('.summarize-all-btn')).not.toBeNull()
    expect(node.querySelectorAll('.segment-btn')).toHaveLength(0)
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
        comments: [
          {
            url: '/r/r/issues/1#issuecomment-10',
            ordinal: 3,
            author: 'alice',
            timestampISO: '2020-05-04T02:06:39.000Z',
          },
          {
            url: '/r/r/issues/1#issuecomment-20',
            ordinal: 7,
            author: 'bob',
          },
        ],
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

  it('該当コメントはデフォルト折りたたみ(details, open無し)', () => {
    const node = renderSummary(summary, () => {})
    const details = node.querySelector('details.cluster-comments') as HTMLDetailsElement
    expect(details).not.toBeNull()
    expect(details.open).toBe(false)
    expect(details.querySelector('summary')?.textContent).toBe('該当コメント (2)')
  })

  it('1行1リンクで番号・日時・投稿者を表示する', () => {
    const node = renderSummary(summary, () => {})
    const lines = node.querySelectorAll('.comment-line')
    expect(lines).toHaveLength(2)
    expect(lines[0].querySelector('a.comment-link')?.textContent).toBe('#3')
    // タイムゾーン非依存に日時フォーマットの形だけ検証
    expect(lines[0].textContent).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/)
    expect(lines[0].textContent).toContain('alice')
    // 日時が無い場合は投稿者のみ（日時文字列は出ない）
    expect(lines[1].textContent).toContain('#7')
    expect(lines[1].textContent).toContain('bob')
    expect(lines[1].textContent).not.toMatch(/\d{4}-\d{2}-\d{2}/)
  })

  it('コメントリンクのクリックで commentId を渡す', () => {
    const onLink = vi.fn()
    const node = renderSummary(summary, onLink)
    const a = node.querySelector('a.comment-link') as HTMLAnchorElement
    a.dispatchEvent(new Event('click'))
    expect(onLink).toHaveBeenCalledWith('issuecomment-10')
  })
})
