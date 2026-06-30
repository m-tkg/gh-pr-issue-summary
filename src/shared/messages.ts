// content script ↔ サイドパネル間のメッセージ型。
import type { PageData } from '../content/extract'

export interface ExtractRequest {
  kind: 'extract-page-data'
}

export type ExtractResponse =
  | { ok: true; data: PageData | null }
  | { ok: false; error: string }
