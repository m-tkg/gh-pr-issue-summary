import { describe, it, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import { findLoadMoreButtons } from '../src/content/expand'

function doc(html: string): Document {
  return new JSDOM(html).window.document
}

describe('findLoadMoreButtons', () => {
  it('data-testid に load-more を含む領域のボタンを拾う', () => {
    const d = doc(`
      <div data-testid="issue-timeline-load-more-wrapper-load-top">
        <button data-testid="issue-timeline-load-more-load-top">Load more</button>
      </div>`)
    expect(findLoadMoreButtons(d)).toHaveLength(1)
  })

  it('テキストが「もっと見る」系のボタンを拾う', () => {
    const d = doc(`<button>さらに表示</button><button>Reply</button>`)
    const btns = findLoadMoreButtons(d)
    expect(btns).toHaveLength(1)
    expect(btns[0].textContent).toBe('さらに表示')
  })

  it('重複して数えない', () => {
    const d = doc(`
      <div data-testid="issue-timeline-load-more-x">
        <button>Load more</button>
      </div>`)
    // testid 経由とテキスト経由の両方にマッチするが 1 つ
    expect(findLoadMoreButtons(d)).toHaveLength(1)
  })

  it('該当が無ければ空', () => {
    const d = doc(`<button>Comment</button><button>Close</button>`)
    expect(findLoadMoreButtons(d)).toEqual([])
  })
})
