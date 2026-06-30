import { describe, it, expect } from 'vitest'
import { MockLlmClient } from './mockLlm'
import {
  mapComment,
  reduceNotes,
  summarize,
  buildParentAndLinks,
} from '../src/summarize/pipeline'
import { truncateToTokens } from '../src/summarize/tokens'
import type { CommentData, PageData } from '../src/content/extract'
import type { CommentNote } from '../src/summarize/types'

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

  it('clusters の commentRefs を permalink に変換し importance 降順で並べる', async () => {
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
    // importance 降順 → 高 が先頭
    expect(result.clusters[0].title).toBe('高')
    expect(result.clusters[0].commentUrls).toEqual([
      '/r/r/issues/1#issuecomment-1',
      '/r/r/issues/1#issuecomment-2',
    ])
    // 存在しない参照 999 は無視される
    expect(result.clusters[1].commentUrls).toEqual([
      '/r/r/issues/1#issuecomment-2',
    ])
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
    expect(result.clusters[0].commentUrls).toEqual([
      '/r/r/issues/1#issuecomment-1',
      '/r/r/issues/1#issuecomment-5',
    ])
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
    expect(summary.clusters[0].commentUrls).toHaveLength(2)
    // map は 1 コメント 1 セッション
    expect(llm.createdSessions).toBe(3) // map×2 + reduce×1
  })
})
