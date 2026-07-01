// chrome.storage.local による設定・キャッシュの薄いラッパ。

import type { CommentNote, FinalSummary } from '../summarize/types'
import type { Palette } from '../content/theme'
import type { CliKind } from '../summarize/nativeCliClient'

const LANG_KEY = 'outputLanguage'
const PALETTE_KEY = 'lastPalette'
const BACKEND_KEY = 'backend'
const CLI_KEY = 'cli'

export type Backend = 'chrome' | 'cli'

export async function getBackend(): Promise<Backend> {
  const v = await chrome.storage.local.get(BACKEND_KEY)
  return v[BACKEND_KEY] === 'cli' ? 'cli' : 'chrome'
}

export async function setBackend(backend: Backend): Promise<void> {
  await chrome.storage.local.set({ [BACKEND_KEY]: backend })
}

export async function getCli(): Promise<CliKind> {
  const v = await chrome.storage.local.get(CLI_KEY)
  const val = v[CLI_KEY]
  return val === 'codex' || val === 'gemini' ? val : 'claude-code'
}

export async function setCli(cli: CliKind): Promise<void> {
  await chrome.storage.local.set({ [CLI_KEY]: cli })
}

export const SUPPORTED_LANGUAGES: { code: string; label: string }[] = [
  { code: 'ja', label: '日本語' },
  { code: 'en', label: 'English' },
]

export async function getLanguage(): Promise<string> {
  const v = await chrome.storage.local.get(LANG_KEY)
  return typeof v[LANG_KEY] === 'string' ? v[LANG_KEY] : 'ja'
}

export async function setLanguage(lang: string): Promise<void> {
  await chrome.storage.local.set({ [LANG_KEY]: lang })
}

// --- 直近の配色（初回描画のちらつき防止に使用） ---

export async function getCachedPalette(): Promise<Palette | null> {
  const v = await chrome.storage.local.get(PALETTE_KEY)
  return (v[PALETTE_KEY] as Palette) ?? null
}

export async function setCachedPalette(palette: Palette): Promise<void> {
  await chrome.storage.local.set({ [PALETTE_KEY]: palette })
}

// --- map 結果（コメント単位メモ）のキャッシュ ---
// コメント本文は基本不変なので id+言語 をキーに再利用する。
// メモの構造（フィールド追加など）を変えたら版を上げて旧キャッシュを無効化する。
const NOTE_CACHE_VERSION = 'v2' // v2: timestampISO を保持

function noteKey(commentId: string, lang: string): string {
  return `note:${NOTE_CACHE_VERSION}:${lang}:${commentId}`
}

export async function getCachedNote(
  commentId: string,
  lang: string,
): Promise<CommentNote | null> {
  const k = noteKey(commentId, lang)
  const v = await chrome.storage.local.get(k)
  return (v[k] as CommentNote) ?? null
}

export async function setCachedNote(
  note: CommentNote,
  lang: string,
): Promise<void> {
  await chrome.storage.local.set({ [noteKey(note.id, lang)]: note })
}

// --- 最終要約のキャッシュ（ページ単位。再訪時に前回結果を表示） ---

export interface CachedSummary {
  summary: FinalSummary
  /** 要約時点のコメント件数（古さの判定に使う）。 */
  commentCount: number
  /** 保存時刻(epoch ms)。 */
  savedAt: number
}

function summaryKey(pageKey: string, lang: string): string {
  return `summary:v1:${lang}:${pageKey}`
}

export async function getCachedSummary(
  pageKey: string,
  lang: string,
): Promise<CachedSummary | null> {
  const k = summaryKey(pageKey, lang)
  const v = await chrome.storage.local.get(k)
  return (v[k] as CachedSummary) ?? null
}

export async function setCachedSummary(
  pageKey: string,
  lang: string,
  value: CachedSummary,
): Promise<void> {
  await chrome.storage.local.set({ [summaryKey(pageKey, lang)]: value })
}
