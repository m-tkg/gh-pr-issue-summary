// 現在表示中の GitHub ページの配色（Primer の CSS 変数）を読み取る。
// サイドパネルは別ページのため自動継承できないので、明示的に取得して渡す。

export interface Palette {
  bg: string
  bgMuted: string
  fg: string
  fgMuted: string
  border: string
  accent: string
  /** 状態ラベル色（open=緑 / merged=紫 / closed=赤 / draft=灰）。 */
  open: string
  merged: string
  closed: string
  draft: string
}

/** ライトテーマの既定値（変数が取れない場合のフォールバック）。 */
export const DEFAULT_PALETTE: Palette = {
  bg: '#ffffff',
  bgMuted: '#f6f8fa',
  fg: '#1f2328',
  fgMuted: '#656d76',
  border: '#d0d7de',
  accent: '#0969da',
  open: '#1a7f37',
  merged: '#8250df',
  closed: '#cf222e',
  draft: '#656d76',
}

/** 新旧の変数名を順に試し、最初に見つかった値を返す。 */
function pick(
  cs: CSSStyleDeclaration,
  names: string[],
  fallback: string,
): string {
  for (const n of names) {
    const v = cs.getPropertyValue(n).trim()
    if (v) return v
  }
  return fallback
}

export function extractTheme(doc: Document): Palette {
  const root = doc.documentElement
  // jsdom 等で getComputedStyle が使えない場合はフォールバック。
  const view = doc.defaultView
  if (!view || typeof view.getComputedStyle !== 'function') {
    return DEFAULT_PALETTE
  }
  const cs = view.getComputedStyle(root)
  const d = DEFAULT_PALETTE
  return {
    bg: pick(cs, ['--bgColor-default', '--color-canvas-default'], d.bg),
    bgMuted: pick(
      cs,
      ['--bgColor-muted', '--color-canvas-subtle', '--bgColor-inset'],
      d.bgMuted,
    ),
    fg: pick(cs, ['--fgColor-default', '--color-fg-default'], d.fg),
    fgMuted: pick(cs, ['--fgColor-muted', '--color-fg-muted'], d.fgMuted),
    border: pick(
      cs,
      ['--borderColor-default', '--color-border-default'],
      d.border,
    ),
    accent: pick(cs, ['--fgColor-accent', '--color-accent-fg'], d.accent),
    open: pick(
      cs,
      ['--bgColor-success-emphasis', '--color-success-emphasis'],
      d.open,
    ),
    merged: pick(
      cs,
      ['--bgColor-done-emphasis', '--color-done-emphasis'],
      d.merged,
    ),
    closed: pick(
      cs,
      ['--bgColor-danger-emphasis', '--color-danger-emphasis'],
      d.closed,
    ),
    draft: pick(
      cs,
      ['--bgColor-neutral-emphasis', '--color-neutral-emphasis'],
      d.draft,
    ),
  }
}
