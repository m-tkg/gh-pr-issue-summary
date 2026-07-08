import { describe, it, expect } from 'vitest'
import { MockLlmClient } from './mockLlm'
import {
  mapComment,
  reduceNotes,
  summarize,
  summarizeSingleShot,
  buildParentAndLinks,
  assembleFinalSummary,
} from '../src/summarize/pipeline'
import { truncateToTokens } from '../src/summarize/tokens'
import { FINAL_SCHEMA, FINAL_SCHEMA_WITH_FLOW } from '../src/summarize/schema'
import type { CommentData, PageData } from '../src/content/extract'
import { DEFAULT_PALETTE } from '../src/content/theme'
import type { ClusterComment, CommentNote } from '../src/summarize/types'

function comment(id: number, text: string, author = 'alice'): CommentData {
  return {
    id: `issuecomment-${id}`,
    author,
    permalink: `/r/r/issues/1#issuecomment-${id}`,
    text,
  }
}

const page: PageData = {
  type: 'issue',
  number: 1,
  repo: 'r/r',
  title: 'テスト issue',
  state: 'open',
  body: '本文です',
  relationships: { linkedPRs: [], relatedIssues: [] },
  comments: [],
  theme: DEFAULT_PALETTE,
}

describe('truncateToTokens', () => {
  it('上限内ならそのまま', () => {
    expect(truncateToTokens('abc', 100)).toBe('abc')
  })
  it('上限超過なら切り詰めて省略記号を付す', () => {
    const r = truncateToTokens('あ'.repeat(100), 10)
    expect(r.length).toBeLessThan(100)
    expect(r).toContain('省略')
  })
})

describe('mapComment', () => {
  it('モデル出力を CommentNote に変換し id/url/author を決定的に付与する', async () => {
    const llm = new MockLlmClient(() =>
      JSON.stringify({
        gist: '要点です',
        kind: 'proposal',
        importance: 'high',
        stance: '賛成',
      }),
    )
    const note = await mapComment(llm, comment(10, 'こんにちは', 'bob'), 3, 'ja')
    expect(note).toEqual({
      ordinal: 3,
      id: 'issuecomment-10',
      url: '/r/r/issues/1#issuecomment-10',
      author: 'bob',
      gist: '要点です',
      kind: 'proposal',
      importance: 'high',
      stance: '賛成',
    })
  })

  it('不正な kind/importance は安全な既定値に矯正する', async () => {
    const llm = new MockLlmClient(() =>
      JSON.stringify({ gist: 'x', kind: 'unknown', importance: 'urgent' }),
    )
    const note = await mapComment(llm, comment(1, 'x'), 1, 'ja')
    expect(note.kind).toBe('other')
    expect(note.importance).toBe('medium')
  })
})

describe('reduceNotes', () => {
  const notes: CommentNote[] = [
    {
      ordinal: 1,
      id: 'issuecomment-1',
      url: '/r/r/issues/1#issuecomment-1',
      author: 'a',
      gist: 'A',
      kind: 'question',
      importance: 'high',
    },
    {
      ordinal: 2,
      id: 'issuecomment-2',
      url: '/r/r/issues/1#issuecomment-2',
      author: 'b',
      gist: 'B',
      kind: 'proposal',
      importance: 'low',
    },
  ]

  it('clusters の commentRefs を permalink に変換し時系列(最早序数)順に並べる', async () => {
    const llm = new MockLlmClient(() =>
      JSON.stringify({
        overview: '概要',
        overallDiscussion: '議論',
        currentProgress: '進行中',
        clusters: [
          { title: '低', summary: 's1', importance: 'low', commentRefs: [2] },
          {
            title: '高',
            summary: 's2',
            importance: 'high',
            commentRefs: [1, 2, 999],
          },
        ],
      }),
    )
    const result = await reduceNotes(llm, notes, page, { lang: 'ja' })
    expect(result.overview).toBe('概要')
    // 時系列(最早序数) → 高(最早=1) が先頭、低(最早=2) が後
    expect(result.clusters[0].title).toBe('高')
    expect(result.clusters[0].comments.map((c) => c.url)).toEqual([
      '/r/r/issues/1#issuecomment-1',
      '/r/r/issues/1#issuecomment-2',
    ])
    // 序数・投稿者も保持
    expect(result.clusters[0].comments[0]).toMatchObject({
      ordinal: 1,
      author: 'a',
    })
    // 存在しない参照 999 は無視される
    expect(result.clusters[1].comments.map((c) => c.url)).toEqual([
      '/r/r/issues/1#issuecomment-2',
    ])
  })

  it('importance より時系列を優先（高重要でも後のコメントなら後ろ）', async () => {
    const llm = new MockLlmClient(() =>
      JSON.stringify({
        overview: 'o',
        overallDiscussion: 'd',
        currentProgress: 'p',
        clusters: [
          // 高重要だが参照は後のコメント(2)
          { title: '高・後', summary: 's', importance: 'high', commentRefs: [2] },
          // 低重要だが参照は先のコメント(1)
          { title: '低・先', summary: 's', importance: 'low', commentRefs: [1] },
        ],
      }),
    )
    const result = await reduceNotes(llm, notes, page, { lang: 'ja' })
    expect(result.clusters.map((c) => c.title)).toEqual(['低・先', '高・後'])
  })

  it('parentAndLinks は関連情報から決定的に生成される', async () => {
    const llm = new MockLlmClient(() =>
      JSON.stringify({
        overview: 'o',
        overallDiscussion: 'd',
        currentProgress: 'p',
        clusters: [],
      }),
    )
    const pageWithLinks: PageData = {
      ...page,
      relationships: {
        linkedPRs: [{ url: 'https://github.com/r/r/pull/9', title: 'PR9' }],
        relatedIssues: [],
      },
    }
    const result = await reduceNotes(llm, notes, pageWithLinks, { lang: 'ja' })
    expect(result.parentAndLinks).toContain('PR9')
    expect(result.parentAndLinks).toContain('pull/9')
  })
})

describe('reduceNotes 階層 reduce', () => {
  it('メモが予算超過のときバッチ部分要約→統合を行う', async () => {
    // 長い gist を持つメモを大量に用意し、reduce 入力を予算超過させる。
    const many: CommentNote[] = Array.from({ length: 40 }, (_, i) => ({
      ordinal: i + 1,
      id: `issuecomment-${i + 1}`,
      url: `/r/r/issues/1#issuecomment-${i + 1}`,
      author: `u${i}`,
      gist: 'これは十分に長い要点の文章です。'.repeat(8),
      kind: 'info' as const,
      importance: 'medium' as const,
    }))
    let batchReduces = 0
    let merges = 0
    const llm = new MockLlmClient((prompt) => {
      if (prompt.includes('部分要約')) {
        merges++
        return JSON.stringify({
          overview: '統合概要',
          overallDiscussion: '統合議論',
          currentProgress: '統合進捗',
          clusters: [
            { title: '統合', summary: 's', importance: 'high', commentRefs: [1, 5] },
          ],
        })
      }
      batchReduces++
      return JSON.stringify({
        overview: 'o',
        overallDiscussion: 'd',
        currentProgress: 'p',
        clusters: [
          { title: 't', summary: 's', importance: 'medium', commentRefs: [1] },
        ],
      })
    })
    const result = await reduceNotes(llm, many, page, { lang: 'ja' })
    expect(batchReduces).toBeGreaterThan(1) // 複数バッチに分割された
    expect(merges).toBe(1) // 統合が 1 回
    expect(result.overview).toBe('統合概要')
    expect(result.clusters[0].comments.map((c) => c.url)).toEqual([
      '/r/r/issues/1#issuecomment-1',
      '/r/r/issues/1#issuecomment-5',
    ])
  })
})

describe('assembleFinalSummary の flowSteps 解析 (optional, CLI 限定)', () => {
  function byOrdinal(...ordinals: number[]): Map<number, ClusterComment> {
    return new Map(
      ordinals.map((o) => [
        o,
        { url: `/r/r/issues/1#issuecomment-${o}`, ordinal: o, author: 'a' },
      ]),
    )
  }
  const baseObj = {
    overview: 'ov',
    overallDiscussion: 'od',
    currentProgress: 'cp',
    clusters: [],
  }

  it('flowSteps が無ければ summary.flowSteps は undefined', () => {
    const summary = assembleFinalSummary(baseObj, page, 'ja', byOrdinal(1))
    expect(summary.flowSteps).toBeUndefined()
  })

  it('flowSteps が配列でなければ undefined', () => {
    const summary = assembleFinalSummary(
      { ...baseObj, flowSteps: '不正' },
      page,
      'ja',
      byOrdinal(1),
    )
    expect(summary.flowSteps).toBeUndefined()
  })

  it('正常な flowSteps を label・comments に解決する', () => {
    const summary = assembleFinalSummary(
      {
        ...baseObj,
        flowSteps: [
          { label: '調査する', commentRefs: [1, 2] },
          { label: '修正PRを作る', commentRefs: [3] },
        ],
      },
      page,
      'ja',
      byOrdinal(1, 2, 3),
    )
    expect(summary.flowSteps).toHaveLength(2)
    expect(summary.flowSteps?.[0].label).toBe('調査する')
    expect(summary.flowSteps?.[0].comments.map((c) => c.ordinal)).toEqual([
      1, 2,
    ])
    expect(summary.flowSteps?.[1].label).toBe('修正PRを作る')
  })

  it('label が 60 字を超える場合は 60 字に切り詰める', () => {
    const summary = assembleFinalSummary(
      { ...baseObj, flowSteps: [{ label: 'あ'.repeat(80), commentRefs: [] }] },
      page,
      'ja',
      byOrdinal(1),
    )
    expect(summary.flowSteps?.[0].label).toBe('あ'.repeat(60))
  })

  it('label が空・非文字列のステップは除外する', () => {
    const summary = assembleFinalSummary(
      {
        ...baseObj,
        flowSteps: [
          { label: '', commentRefs: [1] },
          { label: 123, commentRefs: [1] },
          { label: '有効なラベル', commentRefs: [1] },
        ],
      },
      page,
      'ja',
      byOrdinal(1),
    )
    expect(summary.flowSteps).toHaveLength(1)
    expect(summary.flowSteps?.[0].label).toBe('有効なラベル')
  })

  it('全ステップが不正なら flowSteps は undefined', () => {
    const summary = assembleFinalSummary(
      { ...baseObj, flowSteps: [{ label: '', commentRefs: [] }] },
      page,
      'ja',
      byOrdinal(1),
    )
    expect(summary.flowSteps).toBeUndefined()
  })

  it('10 件を超えるステップは先頭 10 件に足切りする', () => {
    const steps = Array.from({ length: 15 }, (_, i) => ({
      label: `手順${i}`,
      commentRefs: [],
    }))
    const summary = assembleFinalSummary(
      { ...baseObj, flowSteps: steps },
      page,
      'ja',
      byOrdinal(1),
    )
    expect(summary.flowSteps).toHaveLength(10)
    expect(summary.flowSteps?.[9].label).toBe('手順9')
  })

  it('存在しない commentRefs は無視される（refsToComments と同じ規則）', () => {
    const summary = assembleFinalSummary(
      { ...baseObj, flowSteps: [{ label: 'X', commentRefs: [999] }] },
      page,
      'ja',
      byOrdinal(1),
    )
    expect(summary.flowSteps?.[0].comments).toEqual([])
  })

  it('kind(action/decision/outcome) は採用され、不正値・欠落は undefined', () => {
    const summary = assembleFinalSummary(
      {
        ...baseObj,
        flowSteps: [
          { label: 'A', kind: 'action', commentRefs: [] },
          { label: 'B', kind: 'decision', commentRefs: [] },
          { label: 'C', kind: 'outcome', commentRefs: [] },
          { label: 'D', kind: 'unknown', commentRefs: [] },
          { label: 'E', commentRefs: [] },
        ],
      },
      page,
      'ja',
      byOrdinal(1),
    )
    expect(summary.flowSteps?.map((s) => s.kind)).toEqual([
      'action',
      'decision',
      'outcome',
      undefined,
      undefined,
    ])
  })
})

describe('cluster.status の防御的パース (optional, CLI 限定)', () => {
  function byOrdinal(...ordinals: number[]): Map<number, ClusterComment> {
    return new Map(
      ordinals.map((o) => [
        o,
        { url: `/r/r/issues/1#issuecomment-${o}`, ordinal: o, author: 'a' },
      ]),
    )
  }
  const base = {
    overview: 'ov',
    overallDiscussion: 'od',
    currentProgress: 'cp',
  }
  function clusterWith(status?: unknown) {
    return {
      title: 't',
      summary: 's',
      importance: 'high',
      commentRefs: [1],
      ...(status !== undefined ? { status } : {}),
    }
  }

  it('"resolved" / "open" は採用される', () => {
    const summary = assembleFinalSummary(
      { ...base, clusters: [clusterWith('resolved'), clusterWith('open')] },
      page,
      'ja',
      byOrdinal(1),
    )
    expect(summary.clusters[0].status).toBe('resolved')
    expect(summary.clusters[1].status).toBe('open')
  })

  it('不正値は undefined にフォールバック', () => {
    const summary = assembleFinalSummary(
      { ...base, clusters: [clusterWith('done')] },
      page,
      'ja',
      byOrdinal(1),
    )
    expect(summary.clusters[0].status).toBeUndefined()
  })

  it('キー無し（Nano 出力・旧キャッシュ）は undefined のまま', () => {
    const summary = assembleFinalSummary(
      { ...base, clusters: [clusterWith()] },
      page,
      'ja',
      byOrdinal(1),
    )
    expect(summary.clusters[0].status).toBeUndefined()
  })
})

describe('assembleFinalSummary の problemStructure 解析 (optional, CLI 限定)', () => {
  function byOrdinal(...ordinals: number[]): Map<number, ClusterComment> {
    return new Map(
      ordinals.map((o) => [
        o,
        { url: `/r/r/issues/1#issuecomment-${o}`, ordinal: o, author: 'a' },
      ]),
    )
  }
  const base = {
    overview: 'ov',
    overallDiscussion: 'od',
    currentProgress: 'cp',
    clusters: [],
  }

  it('無ければ undefined', () => {
    const summary = assembleFinalSummary(base, page, 'ja', byOrdinal(1))
    expect(summary.problemStructure).toBeUndefined()
  })

  it('オブジェクトでなければ undefined', () => {
    const summary = assembleFinalSummary(
      { ...base, problemStructure: '不正' },
      page,
      'ja',
      byOrdinal(1),
    )
    expect(summary.problemStructure).toBeUndefined()
  })

  it('正常系: problem/causes/impacts/goal を解決する', () => {
    const summary = assembleFinalSummary(
      {
        ...base,
        problemStructure: {
          problem: 'ビルドが遅い',
          causes: [{ label: '依存が多い', commentRefs: [1] }],
          impacts: [{ label: 'CI が 30 分かかる', commentRefs: [2] }],
          goal: 'CI を 10 分以内にする',
        },
      },
      page,
      'ja',
      byOrdinal(1, 2),
    )
    const ps = summary.problemStructure
    expect(ps?.problem).toBe('ビルドが遅い')
    expect(ps?.causes[0].label).toBe('依存が多い')
    expect(ps?.causes[0].comments.map((c) => c.ordinal)).toEqual([1])
    expect(ps?.impacts[0].label).toBe('CI が 30 分かかる')
    expect(ps?.goal).toBe('CI を 10 分以内にする')
  })

  it('problem が空なら undefined', () => {
    const summary = assembleFinalSummary(
      {
        ...base,
        problemStructure: {
          problem: ' ',
          causes: [{ label: 'x', commentRefs: [] }],
          impacts: [],
        },
      },
      page,
      'ja',
      byOrdinal(1),
    )
    expect(summary.problemStructure).toBeUndefined()
  })

  it('causes/impacts/goal がすべて空なら undefined（図にならない）', () => {
    const summary = assembleFinalSummary(
      {
        ...base,
        problemStructure: { problem: 'P', causes: [], impacts: [] },
      },
      page,
      'ja',
      byOrdinal(1),
    )
    expect(summary.problemStructure).toBeUndefined()
  })

  it('goal だけあれば成立する（problem → goal の 2 ノード）', () => {
    const summary = assembleFinalSummary(
      {
        ...base,
        problemStructure: { problem: 'P', causes: [], impacts: [], goal: 'G' },
      },
      page,
      'ja',
      byOrdinal(1),
    )
    expect(summary.problemStructure?.goal).toBe('G')
  })

  it('causes は 4 件に足切りされ、空ラベルは除外される', () => {
    const causes = Array.from({ length: 6 }, (_, i) => ({
      label: `原因${i}`,
      commentRefs: [],
    }))
    const summary = assembleFinalSummary(
      {
        ...base,
        problemStructure: {
          problem: 'P',
          causes: [{ label: ' ', commentRefs: [] }, ...causes],
          impacts: [],
        },
      },
      page,
      'ja',
      byOrdinal(1),
    )
    expect(summary.problemStructure?.causes.map((c) => c.label)).toEqual([
      '原因0',
      '原因1',
      '原因2',
      '原因3',
    ])
  })
})

describe('assembleFinalSummary の prSummary 解析 (optional, CLI 限定・PR のみ)', () => {
  function byOrdinal(...ordinals: number[]): Map<number, ClusterComment> {
    return new Map(
      ordinals.map((o) => [
        o,
        { url: `/r/r/issues/1#issuecomment-${o}`, ordinal: o, author: 'a' },
      ]),
    )
  }
  const base = {
    overview: 'ov',
    overallDiscussion: 'od',
    currentProgress: 'cp',
    clusters: [],
  }

  it('無ければ undefined', () => {
    const summary = assembleFinalSummary(base, page, 'ja', byOrdinal(1))
    expect(summary.prSummary).toBeUndefined()
  })

  it('正常系: problem / solution を採用する', () => {
    const summary = assembleFinalSummary(
      {
        ...base,
        prSummary: {
          problem: 'ビルドが遅く CI が 30 分かかる',
          solution: '依存を整理しキャッシュを有効化する',
        },
      },
      page,
      'ja',
      byOrdinal(1),
    )
    expect(summary.prSummary?.problem).toBe('ビルドが遅く CI が 30 分かかる')
    expect(summary.prSummary?.solution).toBe('依存を整理しキャッシュを有効化する')
  })

  it('オブジェクトでない・どちらかが空なら undefined（片方だけの表示はしない）', () => {
    const cases = [
      '不正',
      { problem: 'P', solution: ' ' },
      { problem: '', solution: 'S' },
      { problem: 'P' },
    ]
    for (const prSummary of cases) {
      const summary = assembleFinalSummary(
        { ...base, prSummary },
        page,
        'ja',
        byOrdinal(1),
      )
      expect(summary.prSummary).toBeUndefined()
    }
  })

  it('長すぎる文は 300 字に切り詰める', () => {
    const summary = assembleFinalSummary(
      {
        ...base,
        prSummary: { problem: 'あ'.repeat(400), solution: 'S' },
      },
      page,
      'ja',
      byOrdinal(1),
    )
    expect(summary.prSummary?.problem).toBe('あ'.repeat(300))
  })
})

describe('スキーマの status フィールド (Nano 安定性の保護)', () => {
  function clusterItems(schema: Record<string, unknown>): {
    required: string[]
    properties: Record<string, unknown>
  } {
    const props = schema.properties as Record<string, { items: unknown }>
    return props.clusters.items as {
      required: string[]
      properties: Record<string, unknown>
    }
  }

  it('FINAL_SCHEMA (Nano 用) の clusters に status は無い', () => {
    expect(clusterItems(FINAL_SCHEMA).properties).not.toHaveProperty('status')
  })

  it('FINAL_SCHEMA_WITH_FLOW の clusters に status enum があり required ではない', () => {
    const items = clusterItems(FINAL_SCHEMA_WITH_FLOW)
    expect(items.properties.status).toEqual({
      type: 'string',
      enum: ['resolved', 'open'],
    })
    expect(items.required).not.toContain('status')
  })

  it('FINAL_SCHEMA に problemStructure は無く、WITH_FLOW にはあり required ではない', () => {
    const props = FINAL_SCHEMA.properties as Record<string, unknown>
    expect(props).not.toHaveProperty('problemStructure')
    const flowProps = FINAL_SCHEMA_WITH_FLOW.properties as Record<
      string,
      unknown
    >
    expect(flowProps).toHaveProperty('problemStructure')
    expect(FINAL_SCHEMA_WITH_FLOW.required).not.toContain('problemStructure')
  })

  it('FINAL_SCHEMA に prSummary は無く、WITH_FLOW にはあり required ではない', () => {
    const props = FINAL_SCHEMA.properties as Record<string, unknown>
    expect(props).not.toHaveProperty('prSummary')
    const flowProps = FINAL_SCHEMA_WITH_FLOW.properties as Record<
      string,
      unknown
    >
    expect(flowProps).toHaveProperty('prSummary')
    expect(FINAL_SCHEMA_WITH_FLOW.required).not.toContain('prSummary')
  })

  it('FINAL_SCHEMA_WITH_FLOW の flowSteps に kind enum があり required ではない', () => {
    const props = FINAL_SCHEMA_WITH_FLOW.properties as Record<
      string,
      { items: { required: string[]; properties: Record<string, unknown> } }
    >
    const items = props.flowSteps.items
    expect(items.properties.kind).toEqual({
      type: 'string',
      enum: ['action', 'decision', 'outcome'],
    })
    expect(items.required).not.toContain('kind')
  })
})

describe('buildParentAndLinks', () => {
  it('関連が無ければその旨を返す', () => {
    expect(buildParentAndLinks(page, 'ja')).toContain('見つかりません')
    expect(buildParentAndLinks(page, 'en')).toContain('No parent')
  })
})

describe('summarize (map→reduce 結合)', () => {
  it('コメントを map し reduce して最終結果を返す', async () => {
    const llm = new MockLlmClient((prompt) => {
      // map と reduce をプロンプト内容で判別
      if (prompt.includes('要点を JSON')) {
        return JSON.stringify({
          gist: 'g',
          kind: 'info',
          importance: 'medium',
        })
      }
      return JSON.stringify({
        overview: '概要',
        overallDiscussion: '議論',
        currentProgress: '進捗',
        clusters: [
          { title: 'T', summary: 'S', importance: 'high', commentRefs: [1, 2] },
        ],
      })
    })
    const comments = [comment(1, 'x'), comment(2, 'y')]
    let mapDone = 0
    const { notes, summary } = await summarize(llm, page, comments, 1, {
      lang: 'ja',
      onProgress: (done, _total, phase) => {
        if (phase === 'map') mapDone = done
      },
    })
    expect(notes).toHaveLength(2)
    expect(mapDone).toBe(2)
    expect(summary.clusters[0].comments).toHaveLength(2)
    // map は 1 コメント 1 セッション
    expect(llm.createdSessions).toBe(3) // map×2 + reduce×1
  })
})

describe('summarizeSingleShot (大コンテキスト/CLI 向け 1 回要約)', () => {
  it('1 回の呼び出しで最終要約を返し、commentRefs を permalink に解決する', async () => {
    const llm = new MockLlmClient(() =>
      JSON.stringify({
        overview: '概要',
        overallDiscussion: '議論',
        currentProgress: '進捗',
        clusters: [
          { title: 'T', summary: 'S', importance: 'high', commentRefs: [1, 2] },
        ],
      }),
    )
    const comments = [comment(11, 'a'), comment(22, 'b')]
    const { summary } = await summarizeSingleShot(llm, page, comments, {
      lang: 'ja',
    })
    // LLM 呼び出しは 1 回（1 セッション）
    expect(llm.createdSessions).toBe(1)
    expect(llm.prompts).toHaveLength(1)
    expect(summary.overview).toBe('概要')
    expect(summary.clusters[0].comments.map((c) => c.url)).toEqual([
      '/r/r/issues/1#issuecomment-11',
      '/r/r/issues/1#issuecomment-22',
    ])
  })

  it('includeExtendedFields: true のとき FINAL_SCHEMA_WITH_FLOW を使い、プロンプトに flowSteps 指示を含む', async () => {
    const llm = new MockLlmClient(() =>
      JSON.stringify({
        overview: '概要',
        overallDiscussion: '議論',
        currentProgress: '進捗',
        clusters: [],
        flowSteps: [{ label: '調査する', commentRefs: [1] }],
      }),
    )
    const comments = [comment(11, 'a')]
    const { summary } = await summarizeSingleShot(llm, page, comments, {
      lang: 'ja',
      includeExtendedFields: true,
    })
    expect(llm.prompts[0]).toContain('flowSteps')
    expect(llm.promptOptions[0]?.responseConstraint).toBe(
      FINAL_SCHEMA_WITH_FLOW,
    )
    expect(summary.flowSteps?.[0].label).toBe('調査する')
  })

  it('includeExtendedFields 省略時は FINAL_SCHEMA を使い、プロンプトに flowSteps 指示を含まない', async () => {
    const llm = new MockLlmClient(() =>
      JSON.stringify({
        overview: '概要',
        overallDiscussion: '議論',
        currentProgress: '進捗',
        clusters: [],
      }),
    )
    await summarizeSingleShot(llm, page, [comment(11, 'a')], { lang: 'ja' })
    expect(llm.prompts[0]).not.toContain('flowSteps')
    expect(llm.promptOptions[0]?.responseConstraint).toBe(FINAL_SCHEMA)
  })
})
