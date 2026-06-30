// content script ↔ サイドパネル間のメッセージ型。
import type { PageData } from '../content/extract'

export interface ExtractRequest {
  kind: 'extract-page-data'
}

export interface ScrollToCommentRequest {
  kind: 'scroll-to-comment'
  commentId: string
}

export type ContentRequest = ExtractRequest | ScrollToCommentRequest

export type ExtractResponse =
  | { ok: true; data: PageData | null }
  | { ok: false; error: string }
