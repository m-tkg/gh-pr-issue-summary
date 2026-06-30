// content script ↔ サイドパネル間のメッセージ型。
import type { PageData } from '../content/extract'
import type { Palette } from '../content/theme'

/** テーマ(配色)だけを軽量に取得する要求。重い抽出を待たずに即応答する。 */
export interface ThemeRequest {
  kind: 'extract-theme'
}

export interface ExtractRequest {
  kind: 'extract-page-data'
}

export interface ScrollToCommentRequest {
  kind: 'scroll-to-comment'
  commentId: string
}

export type ContentRequest =
  | ThemeRequest
  | ExtractRequest
  | ScrollToCommentRequest

export type ThemeResponse =
  | { ok: true; theme: Palette }
  | { ok: false; error: string }

export type ExtractResponse =
  | { ok: true; data: PageData | null }
  | { ok: false; error: string }
