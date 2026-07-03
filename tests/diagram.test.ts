import { describe, it, expect } from 'vitest'
import {
  escapeLabel,
  truncateLabel,
  buildStructureDiagram,
  buildTimelineDiagram,
  buildContentFlowDiagram,
  type DiagramTheme,
} from '../src/sidepanel/diagram'
import type {
  Cluster,
  ClusterComment,
  FinalSummary,
  FlowStep,
} from '../src/summarize/types'

const THEME: DiagramTheme = {
  high: '#e11d48',
  medium: '#d97706',
  low: '#6b7280',
}

function cluster(overrides: Partial<Cluster> = {}): Cluster {
  return {
    title: 'クラスタ',
    summary: '要約',
    importance: 'medium',
    comments: [],
    ...overrides,
  }
}

function flowStep(overrides: Partial<FlowStep> = {}): FlowStep {
  return { label: '手順', comments: [], ...overrides }
}

function comment(ordinal: number): ClusterComment {
  return {
    url: `https://example.com/issue#issuecomment-${ordinal}`,
    ordinal,
    author: 'someone',
  }
}

function summary(overrides: Partial<FinalSummary> = {}): FinalSummary {
  return {
    overview: '概要テキスト',
    parentAndLinks: '',
    overallDiscussion: '',
    currentProgress: '進捗テキスト',
    clusters: [],
    ...overrides,
  }
}

describe('escapeLabel', () => {
  it('# を最初にエスケープする（後続のエンティティ挿入を壊さない）', () => {
    // 先に " を #quot; に変換してから # を処理すると #quot; の # まで
    // 二重にエスケープされてしまうため、# が最初に処理される必要がある。
    expect(escapeLabel('#')).toBe('#35;')
  })

  it('ダブルクオートをエスケープし、生の " が残らない', () => {
    const out = escapeLabel('foo"bar')
    expect(out).not.toContain('"')
    expect(out).toContain('#quot;')
  })

  it('山括弧とアンパサンドをエスケープする', () => {
    const out = escapeLabel('<script>&alert</script>')
    expect(out).not.toContain('<')
    expect(out).not.toContain('>')
    expect(out).toContain('#lt;')
    expect(out).toContain('#gt;')
    expect(out).toContain('#38;')
  })

  it('改行や制御文字を空白に置換する', () => {
    expect(escapeLabel('line1\nline2\r\ttab')).toBe('line1 line2  tab')
  })

  it('バッククォートを除去する（mermaid の markdown 文字列モード起動を防ぐ）', () => {
    expect(escapeLabel('`code`')).not.toContain('`')
  })

  it('mermaid 構文の注入を試みるラベルが構文として脱出できない', () => {
    const malicious = '"] click ov href "javascript:alert(1)"'
    const out = escapeLabel(malicious)
    expect(out).not.toContain('"')
  })

  it('ディレクティブ風の文字列も " が除去され二重引用符ラベルから脱出できない', () => {
    // %%{init}%% はソース内で行頭に置かれて初めて解釈されるディレクティブであり、
    // ラベルは常に "..." の内側（行の途中）に配置されるため文字列として無害化されれば十分。
    const malicious = '%%{init: {"theme":"dark"}}%%'
    const out = escapeLabel(malicious)
    expect(out).not.toContain('"')
  })
})

describe('truncateLabel', () => {
  it('デフォルト 40 文字以内ならそのまま返す', () => {
    expect(truncateLabel('short label')).toBe('short label')
  })

  it('40 文字を超える場合は 40 文字に切って … を付与する', () => {
    const long = 'あ'.repeat(50)
    const out = truncateLabel(long)
    expect(out).toBe('あ'.repeat(40) + '…')
    expect(out.length).toBe(41)
  })

  it('max を指定できる', () => {
    expect(truncateLabel('abcdefghij', 5)).toBe('abcde…')
  })

  it('ちょうど max の長さなら省略しない', () => {
    expect(truncateLabel('abcde', 5)).toBe('abcde')
  })
})

describe('buildStructureDiagram', () => {
  it('flowchart TD で始まる', () => {
    const out = buildStructureDiagram(summary(), THEME)
    expect(out.startsWith('flowchart TD')).toBe(true)
  })

  it('概要ノードと進捗ノードにそれぞれのテキストが入る', () => {
    const out = buildStructureDiagram(
      summary({ overview: '概要OV', currentProgress: '進捗PG' }),
      THEME,
    )
    expect(out).toContain('概要OV')
    expect(out).toContain('進捗PG')
  })

  it('クラスタが 0 件なら概要ノードから進捗ノードへ直結する', () => {
    const out = buildStructureDiagram(summary({ clusters: [] }), THEME)
    expect(out).toContain('ov --> pg')
    expect(out).not.toContain('c0')
  })

  it('各クラスタについてノードとエッジと重要度クラスが出る', () => {
    const out = buildStructureDiagram(
      summary({
        clusters: [
          cluster({ title: 'A論点', importance: 'high' }),
          cluster({ title: 'B論点', importance: 'low' }),
        ],
      }),
      THEME,
    )
    expect(out).toContain('A論点')
    expect(out).toContain('B論点')
    expect(out).toContain('ov --> c0')
    expect(out).toContain('c0 --> pg')
    expect(out).toContain('ov --> c1')
    expect(out).toContain('c1 --> pg')
    expect(out).toContain('class c0 high')
    expect(out).toContain('class c1 low')
  })

  it('classDef に theme 引数の色がそのまま出る', () => {
    const out = buildStructureDiagram(
      summary({ clusters: [cluster({ importance: 'high' })] }),
      THEME,
    )
    expect(out).toContain(THEME.high)
    expect(out).toContain(THEME.medium)
    expect(out).toContain(THEME.low)
  })

  it('悪意あるタイトルのラベルはエスケープされ、生の " や改行が出力に残らない', () => {
    const malicious = '"] click ov href "javascript:alert(1)"\n%%{init}%%'
    const out = buildStructureDiagram(
      summary({ clusters: [cluster({ title: malicious })] }),
      THEME,
    )
    expect(out).not.toContain('"] click')
    expect(out).not.toContain('\n%%{init}%%')
  })

  it('クラスタが 12 件を超える場合は先頭 12 件のみノード化し、残りを集約ノードにする', () => {
    const clusters = Array.from({ length: 15 }, (_, i) =>
      cluster({ title: `論点${i}` }),
    )
    const out = buildStructureDiagram(summary({ clusters }), THEME)
    expect(out).toContain('c11')
    expect(out).not.toContain('c12')
    expect(out).toContain('他 3 件')
    expect(out).toContain('ov --> cmore')
    expect(out).toContain('cmore --> pg')
  })
})

describe('buildTimelineDiagram', () => {
  it('クラスタが 0 件なら null を返す', () => {
    expect(buildTimelineDiagram(summary({ clusters: [] }), THEME)).toBeNull()
  })

  it('クラスタが 1 件なら null を返す', () => {
    const out = buildTimelineDiagram(
      summary({ clusters: [cluster({ comments: [comment(1)] })] }),
      THEME,
    )
    expect(out).toBeNull()
  })

  it('flowchart LR で始まり、既ソート順に鎖状接続する', () => {
    const out = buildTimelineDiagram(
      summary({
        clusters: [
          cluster({ title: '最初の論点', comments: [comment(1), comment(3)] }),
          cluster({ title: '次の論点', comments: [comment(5)] }),
        ],
      }),
      THEME,
    )
    expect(out).not.toBeNull()
    expect((out as string).startsWith('flowchart LR')).toBe(true)
    expect(out).toContain('c0 --> c1')
  })

  it('複数コメントを持つクラスタは #最小〜#最大 の範囲をラベルに含む', () => {
    // comments は pipeline 側 (refsToComments) で常に序数昇順ソート済みという
    // 不変条件を前提にしている。
    const out = buildTimelineDiagram(
      summary({
        clusters: [
          cluster({ title: 'A', comments: [comment(1), comment(3), comment(7)] }),
          cluster({ title: 'B', comments: [comment(9)] }),
        ],
      }),
      THEME,
    )
    expect(out).toContain('#1〜#7')
  })

  it('単一コメントのクラスタは範囲でなく単一の # 番号のみ', () => {
    const out = buildTimelineDiagram(
      summary({
        clusters: [
          cluster({ title: 'A', comments: [comment(9)] }),
          cluster({ title: 'B', comments: [comment(1), comment(2)] }),
        ],
      }),
      THEME,
    )
    expect(out).toContain('#9')
    expect(out).not.toContain('#9〜')
  })

  it('該当コメントが無いクラスタは番号なしでラベルに出る', () => {
    const out = buildTimelineDiagram(
      summary({
        clusters: [
          cluster({ title: 'A', comments: [] }),
          cluster({ title: 'B', comments: [comment(1), comment(2)] }),
        ],
      }),
      THEME,
    )
    expect(out).toContain('"A"')
  })

  it('悪意あるタイトルはエスケープされる', () => {
    const malicious = '"] click c0 "javascript:alert(1)"'
    const out = buildTimelineDiagram(
      summary({
        clusters: [
          cluster({ title: malicious, comments: [comment(1)] }),
          cluster({ title: 'B', comments: [comment(2)] }),
        ],
      }),
      THEME,
    )
    expect(out).not.toContain('"] click')
  })
})

describe('buildContentFlowDiagram', () => {
  it('ステップが 0 件なら null を返す', () => {
    expect(buildContentFlowDiagram([], THEME)).toBeNull()
  })

  it('ステップが 1 件なら null を返す', () => {
    expect(buildContentFlowDiagram([flowStep()], THEME)).toBeNull()
  })

  it('flowchart LR で始まり、順番に鎖状接続する', () => {
    const out = buildContentFlowDiagram(
      [flowStep({ label: '調査する' }), flowStep({ label: 'PRを作る' })],
      THEME,
    )
    expect(out).not.toBeNull()
    expect((out as string).startsWith('flowchart LR')).toBe(true)
    expect(out).toContain('調査する')
    expect(out).toContain('PRを作る')
    expect(out).toContain('s0 --> s1')
  })

  it('3 件以上でも順番どおりに鎖状接続する', () => {
    const out = buildContentFlowDiagram(
      [flowStep({ label: 'A' }), flowStep({ label: 'B' }), flowStep({ label: 'C' })],
      THEME,
    )
    expect(out).toContain('s0 --> s1')
    expect(out).toContain('s1 --> s2')
  })

  it('悪意あるラベルはエスケープされ、生の " が残らない', () => {
    const malicious = '"] click s0 "javascript:alert(1)"'
    const out = buildContentFlowDiagram(
      [flowStep({ label: malicious }), flowStep({ label: 'B' })],
      THEME,
    )
    expect(out).not.toContain('"] click')
  })

  it('長いラベルは省略される', () => {
    const long = 'あ'.repeat(50)
    const out = buildContentFlowDiagram(
      [flowStep({ label: long }), flowStep({ label: 'B' })],
      THEME,
    )
    expect(out).toContain('あ'.repeat(40) + '…')
  })
})
