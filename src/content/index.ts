// Content script: サイドパネルからの抽出要求に応答する。
import { extractPageData } from './extract'
import type { ExtractRequest, ExtractResponse } from '../shared/messages'

chrome.runtime.onMessage.addListener(
  (message: ExtractRequest, _sender, sendResponse) => {
    if (message?.kind !== 'extract-page-data') return
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
    // 同期で応答するため true は不要だが、将来の非同期化に備え明示。
    return true
  },
)
