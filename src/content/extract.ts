// GitHub issue/PR ページの DOM からデータを抽出する（隔離モジュール）。
//
// GitHub の DOM は React 版 Issue ビューと旧 timeline 版（主に PR）で構造が
// 異なるため、両方に効く安定したセレクタ（data-testid / relative-time /
// a.author / canonical な issuecomment-<数字> id）に依存する。
// セレクタが将来壊れた場合の修正範囲をこのファイルに閉じ込める。

import { extractTheme, type Palette } from './theme'

export type IssueType = 'issue' | 'pull'
export type IssueState = 'open' | 'closed' | 'merged' | 'draft'

export interface CommentData {
  /** canonical な要素 id（例: issuecomment-123）。 */
  id: string
  author: string
  /** OWNER/MEMBER/CONTRIBUTOR 等（取得できれば）。 */
  role?: string
  /** ISO8601 のタイムスタンプ（取得できれば）。 */
  timestampISO?: string
  /** 同一ページ内アンカーへの相対パーマリンク。 */
  permalink: string
  text: string
}

export interface LinkRef {
  url: string
  title: string
}

export interface Relationships {
  /** Development セクション等の関連 PR。 */
  linkedPRs: LinkRef[]
  /** Relationships セクション等の関連 issue。 */
  relatedIssues: LinkRef[]
}

export interface PageData {
  type: IssueType
  number: number
  repo: string
  title: string
  state: IssueState
  body: string
  relationships: Relationships
  comments: CommentData[]
  /** 表示中の GitHub ページの配色。 */
  theme: Palette
}

export interface ParsedUrl {
  repo: string
  type: IssueType
  number: number
}

const URL_RE =
  /^https?:\/\/github\.com\/([^/]+\/[^/]+)\/(issues|pull)\/(\d+)(?:[/?#]|$)/

/** GitHub の issue/PR URL を解析する。対象外なら null。 */
export function parseGitHubUrl(url: string): ParsedUrl | null {
  const m = URL_RE.exec(url)
  if (!m) return null
  return {
    repo: m[1],
    type: m[2] === 'pull' ? 'pull' : 'issue',
    number: Number(m[3]),
  }
}

function text(el: Element | null | undefined): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
}

function extractTitle(doc: Document): string {
  // 旧 timeline(主に PR) は bdi.js-issue-title が正確。
  // React Issue は同要素が無いため document.title から取る。
  // ※ PR の document.title は "<title> by <author> · ..." と著者が混ざるため bdi を優先。
  const bdi = text(doc.querySelector('bdi.js-issue-title'))
  if (bdi) return bdi
  const docTitle = doc.title
  if (docTitle) {
    const head = docTitle.split(' · ')[0]?.trim()
    if (head) return head
  }
  return text(doc.querySelector('.gh-header-title bdi'))
}

function extractState(doc: Document, type: IssueType): IssueState {
  const labels = [
    ...doc.querySelectorAll('[class*="StateLabel"], .State'),
  ].map((e) => text(e).toLowerCase())
  for (const key of ['merged', 'draft', 'closed', 'open'] as const) {
    if (labels.some((l) => l.includes(key))) return key
  }
  return type === 'pull' ? 'open' : 'open'
}

function extractBody(doc: Document): string {
  const reactBody = doc.querySelector(
    '[data-testid="issue-body"] [data-testid="markdown-body"]',
  )
  if (reactBody) return text(reactBody)
  // 旧 timeline: 最初の comment-body が説明文。
  const first = doc.querySelector('.comment-body')
  return text(first)
}

function extractAuthor(root: Element): string {
  const old = root.querySelector('a.author')
  if (old && text(old)) return text(old)
  const header = root.querySelector('[data-testid="comment-header"]') ?? root
  const link = header.querySelector('a[href^="/"]')
  const href = link?.getAttribute('href') ?? ''
  const seg = href.split('/').filter(Boolean)[0]
  return seg || 'unknown'
}

function extractRole(root: Element): string | undefined {
  const t = text(root.querySelector('.author-association, .Label'))
  return t || undefined
}

function extractCommentText(root: Element): string {
  const md = root.querySelector('[data-testid="markdown-body"], .comment-body')
  return text(md)
}

const CANONICAL_COMMENT_ID = /^issuecomment-\d+$/

function commentRoot(el: Element): Element {
  return (
    el.closest('.react-issue-comment, .js-comment-container, .timeline-comment') ??
    el
  )
}

function extractComments(doc: Document, pathname: string): CommentData[] {
  const anchors = [...doc.querySelectorAll('[id^="issuecomment-"]')].filter(
    (el) => CANONICAL_COMMENT_ID.test(el.id),
  )
  const seen = new Set<string>()
  const comments: CommentData[] = []
  for (const el of anchors) {
    if (seen.has(el.id)) continue
    seen.add(el.id)
    const root = commentRoot(el)
    comments.push({
      id: el.id,
      author: extractAuthor(root),
      role: extractRole(root),
      timestampISO:
        root.querySelector('relative-time')?.getAttribute('datetime') ??
        undefined,
      permalink: `${pathname}#${el.id}`,
      text: extractCommentText(root),
    })
  }
  return comments
}

function extractLinksFrom(
  doc: Document,
  selector: string,
  kind: 'issues' | 'pull',
): LinkRef[] {
  const section = doc.querySelector(selector)
  if (!section) return []
  const re = new RegExp(`/${kind}/\\d+`)
  const seen = new Set<string>()
  const refs: LinkRef[] = []
  for (const a of section.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href') ?? ''
    if (!re.test(href)) continue
    const url = href.startsWith('http') ? href : `https://github.com${href}`
    if (seen.has(url)) continue
    seen.add(url)
    refs.push({ url, title: text(a) })
  }
  return refs
}

function extractRelationships(doc: Document): Relationships {
  return {
    linkedPRs: extractLinksFrom(
      doc,
      '[data-testid="sidebar-development-section"]',
      'pull',
    ),
    relatedIssues: extractLinksFrom(
      doc,
      '[data-testid="sidebar-relationships-section"]',
      'issues',
    ),
  }
}

/**
 * issue/PR ページの Document から構造化データを抽出する。
 * issue/PR ページでなければ null。
 */
export function extractPageData(doc: Document, url: string): PageData | null {
  const parsed = parseGitHubUrl(url)
  if (!parsed) return null
  const pathname = new URL(url).pathname
  return {
    type: parsed.type,
    number: parsed.number,
    repo: parsed.repo,
    title: extractTitle(doc),
    state: extractState(doc, parsed.type),
    body: extractBody(doc),
    relationships: extractRelationships(doc),
    comments: extractComments(doc, pathname),
    theme: extractTheme(doc),
  }
}
