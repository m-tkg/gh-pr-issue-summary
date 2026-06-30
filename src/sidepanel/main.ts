// サイドパネルのオーケストレーション。
import type { PageData } from '../content/extract'
import type {
  ContentRequest,
  ExtractResponse,
} from '../shared/messages'
import { ChromeLlmClient } from '../summarize/llmClient'
import {
  planSegments,
  DEFAULT_SEGMENT_BUDGET,
  type Segment,
} from '../summarize/segment'
import { summarize, type NoteCache } from '../summarize/pipeline'
import {
  getLanguage,
  setLanguage,
  SUPPORTED_LANGUAGES,
  getCachedNote,
  setCachedNote,
} from './storage'
import {
  el,
  renderHeader,
  renderSegments,
  renderSummary,
  type SegmentViewState,
} from './render'

const app = document.getElementById('app')!
const llm = new ChromeLlmClient()
const noteCache: NoteCache = { get: getCachedNote, set: setCachedNote }

let lang = 'ja'
let pageData: PageData | null = null
let segments: Segment[] = []
let activeTabId: number | null = null
const segmentStates = new Map<number, SegmentViewState>()
let running = false

function clear(node: HTMLElement) {
  node.replaceChildren()
}

function setStatus(text: string, cls = 'muted') {
  const s = el('p', { class: cls }, [text])
  s.id = 'status'
  const old = document.getElementById('status')
  if (old) old.replaceWith(s)
  else app.append(s)
}

async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab ?? null
}

function sendToTab<T>(tabId: number, message: ContentRequest): Promise<T> {
  return chrome.tabs.sendMessage(tabId, message)
}

function scrollToComment(commentId: string) {
  if (activeTabId == null) return
  sendToTab(activeTabId, { kind: 'scroll-to-comment', commentId }).catch(
    () => {},
  )
}

// --- 言語セレクタ ---
function buildLanguageSelector(): HTMLElement {
  const wrap = el('div', { class: 'lang-selector' }, [
    el('label', { for: 'lang' }, ['要約言語: ']),
  ])
  const select = el('select', { id: 'lang' }) as HTMLSelectElement
  for (const { code, label } of SUPPORTED_LANGUAGES) {
    const opt = el('option', { value: code }, [label]) as HTMLOptionElement
    if (code === lang) opt.selected = true
    select.append(opt)
  }
  select.addEventListener('change', async () => {
    lang = select.value
    await setLanguage(lang)
  })
  wrap.append(select)
  return wrap
}

// --- メイン描画 ---
const resultsRoot = el('div', { id: 'results' })

function renderShell() {
  clear(app)
  if (pageData) app.append(renderHeader(pageData))
  app.append(buildLanguageSelector())
  app.append(resultsRoot)
}

function renderSegmentList() {
  const existing = document.getElementById('segment-list')
  const node = renderSegments(segments, segmentStates, {
    onSummarizeAll: () => void onSummarize('all'),
    onSummarizeRange: (i) => void onSummarize(i),
  })
  node.id = 'segment-list'
  if (existing) existing.replaceWith(node)
  else resultsRoot.append(node)
}

async function loadPage() {
  setStatus('ページを読み込み中…')
  const tab = await getActiveTab()
  activeTabId = tab?.id ?? null
  if (!tab?.id || !tab.url || !/^https:\/\/github\.com\//.test(tab.url)) {
    pageData = null
    renderShell()
    setStatus('GitHub の issue / PR ページを開いてください。')
    return
  }
  let res: ExtractResponse
  try {
    res = await sendToTab<ExtractResponse>(tab.id, { kind: 'extract-page-data' })
  } catch {
    renderShell()
    setStatus(
      'ページと通信できませんでした。GitHub ページを再読み込みしてから、もう一度お試しください。',
      'error',
    )
    return
  }
  if (!res.ok) {
    renderShell()
    setStatus(`抽出に失敗しました: ${res.error}`, 'error')
    return
  }
  if (!res.data) {
    pageData = null
    renderShell()
    setStatus('これは issue / PR ページではありません。')
    return
  }
  pageData = res.data
  segments = planSegments(pageData.comments, DEFAULT_SEGMENT_BUDGET)
  segmentStates.clear()
  clear(resultsRoot)
  renderShell()
  renderSegmentList()
  await checkModel()
}

async function checkModel() {
  const status = await llm.availability({ outputLanguage: lang })
  if (status === 'unavailable') {
    setStatus(
      'この Chrome では組み込み AI (Gemini Nano) を利用できません。Chrome 138+ と、chrome://flags の Prompt API 有効化が必要です。',
      'error',
    )
  } else if (status === 'downloadable' || status === 'downloading') {
    setStatus(
      'モデルの準備が必要です。要約を開始すると初回ダウンロードが行われます（時間がかかる場合があります）。',
    )
  } else {
    setStatus(`コメント ${pageData?.comments.length ?? 0} 件。範囲を選んで要約を開始してください。`)
  }
}

/**
 * 要約を実行する。target='all' なら全体、数値ならそのセグメントのみ。
 */
async function onSummarize(target: 'all' | number) {
  if (running || !pageData || activeTabId == null) return
  running = true
  try {
    const isAll = target === 'all'
    const targetSegments = isAll
      ? segments
      : [segments[target as number]]
    const startOrdinal = targetSegments[0].startOrdinal
    const endOrdinal = targetSegments[targetSegments.length - 1].endOrdinal
    const targetComments = pageData.comments.slice(startOrdinal - 1, endOrdinal)

    for (const seg of targetSegments) {
      segmentStates.set(seg.index, { status: 'running' })
    }
    renderSegmentList()

    const total = targetComments.length
    const rangeLabel =
      startOrdinal === endOrdinal
        ? `コメント ${startOrdinal}`
        : `コメント ${startOrdinal}〜${endOrdinal}`
    setStatus(`要約を準備中…（${rangeLabel}, 全 ${total} 件）`)

    const { summary } = await summarize(
      llm,
      pageData,
      targetComments,
      startOrdinal,
      {
        lang,
        noteCache,
        onProgress: (done, t, phase) => {
          if (phase === 'map') {
            setStatus(`コメント解析中… ${done}/${t}（${rangeLabel}）`)
          } else {
            setStatus(`集約中… (${done}/${t})`)
          }
        },
      },
    )

    for (const seg of targetSegments) {
      segmentStates.set(seg.index, { status: 'done' })
    }
    renderSegmentList()
    setStatus(`要約完了（${rangeLabel} を対象）。`, 'muted')

    const old = document.getElementById('summary-root')
    const node = renderSummary(summary, scrollToComment)
    node.id = 'summary-root'
    if (old) old.replaceWith(node)
    else resultsRoot.append(node)
  } catch (err) {
    setStatus(
      `要約中にエラーが発生しました: ${err instanceof Error ? err.message : String(err)}`,
      'error',
    )
    for (const seg of segments) {
      if (segmentStates.get(seg.index)?.status === 'running') {
        segmentStates.set(seg.index, { status: 'pending' })
      }
    }
    renderSegmentList()
  } finally {
    running = false
  }
}

// 初期化
async function init() {
  lang = await getLanguage()
  renderShell()
  await loadPage()
}

// タブ切替・URL 変更で再読み込み
chrome.tabs.onActivated.addListener(() => {
  if (!running) void loadPage()
})
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'complete' && tabId === activeTabId && !running) {
    void loadPage()
  }
})

void init()
