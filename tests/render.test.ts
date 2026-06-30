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

  it('複数範囲でも提供するのは「全体を要約」のみ（部分要約ボタンは出さない）', () => {
    const node = renderSegments(segs, new Map(), { onSummarizeAll: () => {} })
    const allBtn = node.querySelector('.summarize-all-btn')
    expect(allBtn?.textContent).toBe('全体を要約')
    expect(node.querySelectorAll('button')).toHaveLength(1)
    expect(node.querySelectorAll('.segment-btn')).toHaveLength(0)
  })

  it('複数範囲のときは時間がかかる旨を注記し件数を示す', () => {
    const node = renderSegments(segs, new Map(), { onSummarizeAll: () => {} })
    const notice = node.querySelector('.notice')?.textContent ?? ''
    expect(notice).toContain('時間がかかります')
    expect(notice).toContain('4 件') // 末尾セグメントの endOrdinal
  })

  it('単一範囲では注記を出さない', () => {
    const node = renderSegments([segs[0]], new Map(), {
      onSummarizeAll: () => {},
    })
    expect(node.querySelector('.notice')).toBeNull()
  })

  it('「全体を要約」クリックで onSummarizeAll を呼ぶ', () => {
    const onAll = vi.fn()
    const node = renderSegments(segs, new Map(), { onSummarizeAll: onAll })
    node.querySelector('.summarize-all-btn')!.dispatchEvent(new Event('click'))
    expect(onAll).toHaveBeenCalled()
  })

  it('全範囲が要約済みなら「全体を要約」は disable', () => {
    const states = new Map<number, SegmentViewState>([
      [0, { status: 'done' }],
      [1, { status: 'done' }],
    ])
    const node = renderSegments(segs, states, { onSummarizeAll: () => {} })
    expect(
      (node.querySelector('.summarize-all-btn') as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('要約中は「全体を要約」を disable', () => {
    const states = new Map<number, SegmentViewState>([
      [0, { status: 'running' }],
    ])
    const node = renderSegments(segs, states, { onSummarizeAll: () => {} })
    expect(
      (node.querySelector('.summarize-all-btn') as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('未実行なら「全体を要約」は有効', () => {
    const node = renderSegments(segs, new Map(), { onSummarizeAll: () => {} })
    expect(
      (node.querySelector('.summarize-all-btn') as HTMLButtonElement).disabled,
    ).toBe(false)
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
