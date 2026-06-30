// Content script: サイドパネルからの抽出要求・スクロール要求に応答する。
import { extractPageData } from './extract'
import { expandHiddenComments } from './expand'
import type {
  ContentRequest,
  ExtractResponse,
} from '../shared/messages'

chrome.runtime.onMessage.addListener(
  (message: ContentRequest, _sender, sendResponse) => {
    if (message?.kind === 'extract-page-data') {
      // 遅延ロード("Load more")を展開してから抽出する。
      expandHiddenComments()
        .catch(() => {})
        .finally(() => {
          try {
            const data = extractPageData(document, location.href)
            sendResponse({ ok: true, data } satisfies ExtractResponse)
          } catch (err) {
            sendResponse({
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            } satisfies ExtractResponse)
          }
        })
      return true // 非同期応答
    }

    if (message?.kind === 'scroll-to-comment') {
      const el = document.getElementById(message.commentId)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        // 一時的にハイライト。
        el.style.transition = 'background-color 0.5s'
        const prev = el.style.backgroundColor
        el.style.backgroundColor = 'rgba(255, 212, 0, 0.35)'
        setTimeout(() => {
          el.style.backgroundColor = prev
        }, 1500)
      }
      sendResponse({ ok: true })
      return true
    }

    return undefined
  },
)
