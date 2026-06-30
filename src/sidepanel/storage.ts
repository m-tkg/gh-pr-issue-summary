// chrome.storage.local による設定・キャッシュの薄いラッパ。

import type { CommentNote } from '../summarize/types'
import type { Palette } from '../content/theme'

const LANG_KEY = 'outputLanguage'
const PALETTE_KEY = 'lastPalette'

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
