// サイドパネルのオーケストレーション。
import type { PageData } from '../content/extract'
import type {
  ContentRequest,
  ExtractResponse,
  ThemeResponse,
} from '../shared/messages'
import { ChromeLlmClient, type LlmClient } from '../summarize/llmClient'
import {
  NativeCliLlmClient,
  CLI_LABELS,
  MODEL_PRESETS,
  type CliKind,
} from '../summarize/nativeCliClient'
import {
  planSegments,
  DEFAULT_SEGMENT_BUDGET,
  type Segment,
} from '../summarize/segment'
import {
  summarize,
  summarizeSingleShot,
  type NoteCache,
} from '../summarize/pipeline'
import {
  getLanguage,
  setLanguage,
  SUPPORTED_LANGUAGES,
  getCachedNote,
  setCachedNote,
  getCachedPalette,
  setCachedPalette,
  getBackend,
  setBackend,
  getCli,
  setCli,
  getModel,
  setModel,
  getCachedSummary,
  setCachedSummary,
  type Backend,
} from './storage'
import type { FinalSummary } from '../summarize/types'
import { isIssueOrPrUrl } from '../shared/url'
import { DEFAULT_PALETTE, type Palette } from '../content/theme'
import type { DiagramTheme } from './diagram'
import { renderDiagram } from './mermaidRenderer'
import {
  el,
  applyPalette,
  renderHeader,
  renderSegments,
  renderSummary,
  type SegmentViewState,
} from './render'

const app = document.getElementById('app')!
const noteCache: NoteCache = { get: getCachedNote, set: setCachedNote }

let lang = 'ja'
let backend: Backend = 'chrome'
let cli: CliKind = 'claude-code'
let model = '' // 現在の CLI の選択モデル（空文字 = 既定）
let llm: LlmClient = new ChromeLlmClient()

function rebuildLlm() {
  llm =
    backend === 'cli'
      ? new NativeCliLlmClient(cli, model)
      : new ChromeLlmClient()
}

let currentPalette: Palette = DEFAULT_PALETTE

/** 重要度別の図の色を GitHub テーマの色から決める。 */
function diagramThemeFrom(palette: Palette): DiagramTheme {
  return { high: palette.closed, medium: palette.accent, low: palette.fgMuted }
}

let pageData: PageData | null = null
let segments: Segment[] = []
let activeTabId: number | null = null
const segmentStates = new Map<number, SegmentViewState>()
let running = false

function clear(node: HTMLElement) {
  node.replaceChildren()
}

function setStatus(text: string, cls = 'muted') {
  const s = el('p', { class: `status ${cls}` }, [text])
  s.id = 'status'
  const old = document.getElementById('status')
  if (old) {
    old.replaceWith(s)
    return
  }
  // 「全体を要約」ボタン（segment-list）の直下に表示する。
  const segList = document.getElementById('segment-list')
  if (segList) segList.after(s)
  else app.append(s)
}

async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab ?? null
}

function sendToTab<T>(tabId: number, message: ContentRequest): Promise<T> {
  return chrome.tabs.sendMessage(tabId, message)
}

/** content script を対象タブへ動的に注入する（既存タブでも再読み込み不要にする）。 */
async function ensureContentScript(tabId: number): Promise<void> {
  const files = chrome.runtime.getManifest().content_scripts?.[0]?.js ?? []
  if (files.length === 0) return
  await chrome.scripting.executeScript({ target: { tabId }, files })
}

/**
 * content script へ送信。未注入で失敗したら注入して 1 度だけ再試行する。
 * これにより「ページと通信できませんでした」を、ページ再読み込みなしで自動復旧する。
 */
async function sendToTabResilient<T>(
  tabId: number,
  message: ContentRequest,
): Promise<T> {
  try {
    return await sendToTab<T>(tabId, message)
  } catch {
    await ensureContentScript(tabId)
    return await sendToTab<T>(tabId, message)
  }
}

function scrollToComment(commentId: string) {
  if (activeTabId == null) return
  sendToTab(activeTabId, { kind: 'scroll-to-comment', commentId }).catch(
    () => {},
  )
}

// --- 設定（言語 / バックエンド / CLI） ---
function buildSelect(
  id: string,
  labelText: string,
  options: { value: string; label: string }[],
  current: string,
  onChange: (value: string) => void,
): HTMLElement {
  const wrap = el('div', { class: 'setting-row' }, [
    el('label', { for: id }, [labelText]),
  ])
  const select = el('select', { id }) as HTMLSelectElement
  for (const { value, label } of options) {
    const opt = el('option', { value }, [label]) as HTMLOptionElement
    if (value === current) opt.selected = true
    select.append(opt)
  }
  select.addEventListener('change', () => onChange(select.value))
  wrap.append(select)
  return wrap
}

function buildSettings(): HTMLElement {
  const wrap = el('div', { class: 'settings' })
  wrap.append(
    buildSelect(
      'lang',
      '要約言語: ',
      SUPPORTED_LANGUAGES.map((l) => ({ value: l.code, label: l.label })),
      lang,
      (v) => {
        lang = v
        void setLanguage(lang)
      },
    ),
  )
  wrap.append(
    buildSelect(
      'backend',
      '推論: ',
      [
        { value: 'chrome', label: 'Chrome 組み込み (Gemini Nano)' },
        { value: 'cli', label: 'CLI' },
      ],
      backend,
      (v) => {
        backend = v === 'cli' ? 'cli' : 'chrome'
        void setBackend(backend)
        rebuildLlm()
        renderShell()
        renderSegmentList()
        void checkModel()
      },
    ),
  )
  if (backend === 'cli') {
    wrap.append(
      buildSelect(
        'cli',
        'CLI: ',
        CLI_LABELS.map((c) => ({ value: c.value, label: c.label })),
        cli,
        async (v) => {
          cli = v as CliKind
          await setCli(cli)
          // 選択 CLI に紐づくモデルを読み直す。
          model = await getModel(cli)
          rebuildLlm()
          renderShell() // モデル選択肢を CLI に合わせて更新
          renderSegmentList()
          void checkModel()
        },
      ),
    )
    wrap.append(
      buildSelect(
        'model',
        'モデル: ',
        MODEL_PRESETS[cli],
        model,
        (v) => {
          model = v
          void setModel(cli, model)
          rebuildLlm()
          void checkModel()
        },
      ),
    )
  }
  return wrap
}

// --- メイン描画 ---
const resultsRoot = el('div', { id: 'results' })

function renderShell() {
  clear(app)
  if (pageData) app.append(renderHeader(pageData))
  app.append(buildSettings())
  app.append(resultsRoot)
}

function renderSegmentList() {
  const existing = document.getElementById('segment-list')
  const node = renderSegments(
    segments,
    segmentStates,
    { onSummarizeAll: () => void onSummarize() },
    // 分割注記は Gemini Nano のときだけ（CLI は 1 回で要約するため分割しない）。
    backend === 'chrome',
  )
  node.id = 'segment-list'
  if (existing) existing.replaceWith(node)
  else resultsRoot.append(node)
}

/** テーマだけを軽量に取得して即適用・キャッシュする。 */
async function applyThemeFast(tabId: number) {
  try {
    const res = await sendToTabResilient<ThemeResponse>(tabId, {
      kind: 'extract-theme',
    })
    if (res.ok) {
      applyPalette(res.theme)
      currentPalette = res.theme
      void setCachedPalette(res.theme)
    }
  } catch {
    // content script 未準備等は無視（キャッシュ済みパレットのまま）。
  }
}

async function loadPage() {
  setStatus('ページを読み込み中…')
  const tab = await getActiveTab()
  activeTabId = tab?.id ?? null
  if (!tab?.id || !isIssueOrPrUrl(tab.url)) {
    // issue/PR 詳細ページ以外（一覧ページや GitHub 以外）ならサイドパネルを閉じる。
    window.close()
    return
  }

  // テーマ(配色)は重い抽出を待たず先に取得して即適用する。
  await applyThemeFast(tab.id)

  let res: ExtractResponse
  try {
    // content script 未注入でも自動注入して再試行する（再読み込み不要）。
    res = await sendToTabResilient<ExtractResponse>(tab.id, {
      kind: 'extract-page-data',
    })
  } catch {
    renderShell()
    setStatus(
      'ページと通信できませんでした。ツールバーから拡張を一度開き直すか、GitHub ページを再読み込みしてお試しください。',
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
  await showCachedSummary()
}

function pageKey(p: PageData): string {
  return `${p.repo}/${p.type}/${p.number}`
}

function renderSummaryInto(summary: FinalSummary) {
  const old = document.getElementById('summary-root')
  const node = renderSummary(summary, scrollToComment, {
    theme: diagramThemeFrom(currentPalette),
    render: (src, el) => renderDiagram(src, el, currentPalette),
  })
  node.id = 'summary-root'
  if (old) old.replaceWith(node)
  else resultsRoot.append(node)
}

/** 前回の要約がキャッシュにあれば表示する。 */
async function showCachedSummary() {
  if (!pageData) return
  const cached = await getCachedSummary(pageKey(pageData), lang)
  if (!cached) return
  renderSummaryInto(cached.summary)
  const now = pageData.comments.length
  const stale =
    cached.commentCount !== now
      ? `（前回時点 ${cached.commentCount} 件 → 現在 ${now} 件。最新化するには再度要約）`
      : ''
  setStatus(`前回の要約を表示中${stale}`, 'muted')
}

async function checkModel() {
  const status = await llm.availability({ outputLanguage: lang })
  if (status === 'unavailable') {
    if (backend === 'cli') {
      setStatus(
        `CLI に接続できません。ネイティブホストが未インストールの可能性があります（native-host/install.sh を実行）。選択中の CLI: ${cli}`,
        'error',
      )
    } else {
      setStatus(
        'この Chrome では組み込み AI (Gemini Nano) を利用できません。Chrome 138+ と、chrome://flags の Prompt API 有効化が必要です。',
        'error',
      )
    }
  } else if (status === 'downloadable' || status === 'downloading') {
    setStatus(
      'モデルの準備が必要です。要約を開始すると初回ダウンロードが行われます（時間がかかる場合があります）。',
    )
  } else {
    setStatus('要約を開始してください。')
  }
}

/** スレッド全体を要約する。バックエンドにより方式を切り替える。 */
async function onSummarize() {
  if (running || !pageData || activeTabId == null) return
  running = true
  try {
    const targetComments = pageData.comments

    for (const seg of segments) {
      segmentStates.set(seg.index, { status: 'running' })
    }
    renderSegmentList()

    setStatus('要約を準備中…')

    let summary
    if (backend === 'cli') {
      // 大コンテキストの CLI は 1 回で要約。
      setStatus(
        `CLI (${cli}${model ? ` / ${model}` : ''}) で要約中…（しばらくお待ちください）`,
      )
      ;({ summary } = await summarizeSingleShot(llm, pageData, targetComments, {
        lang,
        onProgress: () => {},
      }))
    } else {
      ;({ summary } = await summarize(llm, pageData, targetComments, 1, {
        lang,
        noteCache,
        onProgress: (done, t, phase) => {
          if (phase === 'map') {
            setStatus(`コメント解析中… ${done}/${t}`)
          } else {
            setStatus(`集約中… (${done}/${t})`)
          }
        },
      }))
    }

    for (const seg of segments) {
      segmentStates.set(seg.index, { status: 'done' })
    }
    renderSegmentList()
    setStatus('要約完了。', 'muted')

    renderSummaryInto(summary)
    // ページ単位でキャッシュ（再訪時に前回結果を表示）。
    await setCachedSummary(pageKey(pageData), lang, {
      summary,
      commentCount: targetComments.length,
      savedAt: Date.now(),
    })
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
  // 直近の配色を先に適用してライトのちらつきを防ぐ。
  const cached = await getCachedPalette()
  if (cached) {
    applyPalette(cached)
    currentPalette = cached
  }
  lang = await getLanguage()
  backend = await getBackend()
  cli = await getCli()
  model = await getModel(cli)
  rebuildLlm()
  renderShell()
  await loadPage()
}

/** アクティブタブが issue/PR 詳細以外ならサイドパネルを閉じる（要約中でも）。 */
async function closeIfNotTarget(tabId: number) {
  try {
    const tab = await chrome.tabs.get(tabId)
    if (!isIssueOrPrUrl(tab.url)) window.close()
  } catch {
    /* タブ取得失敗は無視 */
  }
}

// タブ切替・URL 変更で再読み込み（issue/PR 詳細以外へ移動したら閉じる）
chrome.tabs.onActivated.addListener(({ tabId }) => {
  void closeIfNotTarget(tabId)
  if (!running) void loadPage()
})
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.url !== undefined && tabId === activeTabId) {
    void closeIfNotTarget(tabId)
  }
  if (info.status === 'complete' && tabId === activeTabId && !running) {
    void loadPage()
  }
})

void init()
