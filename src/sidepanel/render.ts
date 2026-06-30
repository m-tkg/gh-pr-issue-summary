// サイドパネルの DOM 描画。textContent を用い XSS を避ける。

import type { PageData } from '../content/extract'
import type { Palette } from '../content/theme'
import type { Segment } from '../summarize/segment'
import type { Cluster, FinalSummary, Importance } from '../summarize/types'

/** GitHub ページの配色をサイドパネルの CSS 変数へ反映する。 */
export function applyPalette(palette: Palette): void {
  const s = document.documentElement.style
  s.setProperty('--bg', palette.bg)
  s.setProperty('--bg-muted', palette.bgMuted)
  s.setProperty('--fg', palette.fg)
  s.setProperty('--fg-muted', palette.fgMuted)
  s.setProperty('--border', palette.border)
  s.setProperty('--accent', palette.accent)
  s.setProperty('--state-open', palette.open)
  s.setProperty('--state-merged', palette.merged)
  s.setProperty('--state-closed', palette.closed)
  s.setProperty('--state-draft', palette.draft)
}

type Attrs = Record<string, string>

export function el(
  tag: string,
  attrs: Attrs = {},
  children: (Node | string)[] = [],
): HTMLElement {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v
    else node.setAttribute(k, v)
  }
  for (const c of children) {
    node.append(typeof c === 'string' ? document.createTextNode(c) : c)
  }
  return node
}

const IMPORTANCE_LABEL: Record<Importance, string> = {
  high: '重要',
  medium: '中',
  low: '低',
}

export function renderHeader(page: PageData): HTMLElement {
  const typeLabel = page.type === 'pull' ? 'PR' : 'Issue'
  return el('div', { class: 'header' }, [
    el('div', { class: `state-badge state-${page.state}` }, [
      page.state.toUpperCase(),
    ]),
    el('div', { class: 'header-title' }, [
      el('span', { class: 'title-text' }, [page.title]),
      el('span', { class: 'title-meta' }, [
        ` ${page.repo} ${typeLabel} #${page.number}`,
      ]),
    ]),
  ])
}

/** 範囲ラベル（例: コメント 19〜37）。 */
export function segmentLabel(seg: Segment): string {
  return seg.startOrdinal === seg.endOrdinal
    ? `コメント ${seg.startOrdinal}`
    : `コメント ${seg.startOrdinal}〜${seg.endOrdinal}`
}

export interface SegmentViewState {
  status: 'pending' | 'running' | 'done'
}

export interface SegmentHandlers {
  /** スレッド全体を要約する。 */
  onSummarizeAll: () => void
}

/**
 * 要約の起点 UI を描画する。
 * コメントが多く複数範囲に分かれる場合でも、要約は「全体を要約」のみを提供し、
 * 時間がかかる旨を注記する（部分要約 UI は提供しない）。
 */
export function renderSegments(
  segments: Segment[],
  states: Map<number, SegmentViewState>,
  handlers: SegmentHandlers,
): HTMLElement {
  const wrap = el('div', { class: 'segments' })
  if (segments.length === 0) {
    wrap.append(el('p', { class: 'muted' }, ['コメントはありません。']))
    return wrap
  }

  const allDone = segments.every(
    (seg) => states.get(seg.index)?.status === 'done',
  )
  const running = segments.some(
    (seg) => states.get(seg.index)?.status === 'running',
  )
  const allBtn = el('button', { class: 'summarize-all-btn' }, [
    allDone ? '全体を要約済み' : running ? '要約中…' : '全体を要約',
  ]) as HTMLButtonElement
  allBtn.disabled = allDone || running
  allBtn.addEventListener('click', () => handlers.onSummarizeAll())
  wrap.append(allBtn)

  // 複数範囲に分かれる＝コメントが多い場合は時間がかかる旨を注記。
  if (segments.length > 1) {
    const totalComments = segments[segments.length - 1].endOrdinal
    wrap.append(
      el('p', { class: 'muted notice' }, [
        `コメントが多い（${totalComments} 件）ため、全体の要約には時間がかかります。`,
      ]),
    )
  }
  return wrap
}

/** ISO8601 を "YYYY-MM-DD HH:mm" に整形（不正/空なら ''）。 */
export function formatDate(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function renderCluster(
  cluster: Cluster,
  onLinkClick: (commentId: string) => void,
): HTMLElement {
  const card = el('div', { class: `cluster cluster-${cluster.importance}` }, [
    el('div', { class: 'cluster-head' }, [
      el('span', { class: `badge badge-${cluster.importance}` }, [
        IMPORTANCE_LABEL[cluster.importance],
      ]),
      el('span', { class: 'cluster-title' }, [cluster.title]),
    ]),
    el('p', { class: 'cluster-summary' }, [cluster.summary]),
  ])
  if (cluster.comments.length) {
    // デフォルト折りたたみ（open 属性なし）。
    const details = el('details', { class: 'cluster-comments' })
    details.append(
      el('summary', {}, [`該当コメント (${cluster.comments.length})`]),
    )
    for (const c of cluster.comments) {
      const id = c.url.split('#')[1] ?? ''
      const a = el('a', { href: c.url, class: 'comment-link' }, [
        `#${c.ordinal}`,
      ])
      a.addEventListener('click', (e) => {
        e.preventDefault()
        onLinkClick(id)
      })
      const meta = [formatDate(c.timestampISO), c.author]
        .filter(Boolean)
        .join(' ・ ')
      const line = el('div', { class: 'comment-line' }, [a])
      if (meta) line.append(document.createTextNode(` ${meta}`))
      details.append(line)
    }
    card.append(details)
  }
  return card
}

function section(title: string, body: string): HTMLElement {
  return el('section', { class: 'summary-section' }, [
    el('h2', {}, [title]),
    el('p', {}, [body || '—']),
  ])
}

export function renderSummary(
  summary: FinalSummary,
  onLinkClick: (commentId: string) => void,
): HTMLElement {
  const wrap = el('div', { class: 'summary' })
  wrap.append(section('概要', summary.overview))
  wrap.append(section('親・関連', summary.parentAndLinks))
  wrap.append(section('全体の議論', summary.overallDiscussion))
  wrap.append(section('現状の進捗', summary.currentProgress))

  const clustersWrap = el('section', { class: 'summary-section' }, [
    el('h2', {}, [`議論のかたまり (${summary.clusters.length})`]),
  ])
  if (summary.clusters.length === 0) {
    clustersWrap.append(el('p', { class: 'muted' }, ['—']))
  }
  for (const c of summary.clusters) {
    clustersWrap.append(renderCluster(c, onLinkClick))
  }
  wrap.append(clustersWrap)
  return wrap
}
