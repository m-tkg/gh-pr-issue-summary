// タイムラインの遅延ロード（"Load more"）を可能な範囲で展開する。
// GitHub は古いコメントを data-testid="issue-timeline-load-more-..." の
// ボタンや "Load more" ボタンの背後に隠す。

/** ページ内の「もっと読み込む」系ボタンを集める（純粋・テスト対象）。 */
export function findLoadMoreButtons(doc: Document): HTMLElement[] {
  const found = new Set<HTMLElement>()

  // 1) data-testid に load-more を含む領域内のボタン
  for (const wrap of doc.querySelectorAll('[data-testid*="load-more"]')) {
    const btn =
      wrap.tagName === 'BUTTON'
        ? (wrap as HTMLElement)
        : wrap.querySelector('button')
    if (btn) found.add(btn as HTMLElement)
  }

  // 2) テキストが「もっと読み込む」系のボタン
  const re = /load more|show more|もっと|さらに表示|展開/i
  for (const btn of doc.querySelectorAll('button')) {
    const t = (btn.textContent ?? '').trim()
    if (t && re.test(t)) found.add(btn as HTMLElement)
  }

  return [...found]
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

const CANONICAL = /^issuecomment-\d+$/

function countComments(doc: Document): number {
  return [...doc.querySelectorAll('[id^="issuecomment-"]')].filter((e) =>
    CANONICAL.test(e.id),
  ).length
}

/**
 * "Load more" を繰り返しクリックして全コメントを展開する。
 * 変化が無くなるか上限回数に達したら停止する。展開後のコメント件数を返す。
 */
export async function expandHiddenComments(
  doc: Document = document,
  maxIterations = 20,
): Promise<number> {
  let last = countComments(doc)
  for (let i = 0; i < maxIterations; i++) {
    const buttons = findLoadMoreButtons(doc)
    if (buttons.length === 0) break
    for (const b of buttons) b.click()
    await delay(600)
    const now = countComments(doc)
    if (now <= last && findLoadMoreButtons(doc).length === 0) break
    last = now
  }
  return countComments(doc)
}
