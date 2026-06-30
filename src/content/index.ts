// Content script: サイドパネルからの抽出要求・スクロール要求に応答する。
import { extractPageData } from './extract'
import type {
  ContentRequest,
  ExtractResponse,
} from '../shared/messages'

chrome.runtime.onMessage.addListener(
  (message: ContentRequest, _sender, sendResponse) => {
    if (message?.kind === 'extract-page-data') {
      try {
        const data = extractPageData(document, location.href)
        const response: ExtractResponse = { ok: true, data }
        sendResponse(response)
      } catch (err) {
        const response: ExtractResponse = {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }
        sendResponse(response)
      }
      return true
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
