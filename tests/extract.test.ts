import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { parseGitHubUrl, extractPageData } from '../src/content/extract'

function loadFixture(name: string): Document {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
  const html = readFileSync(path, 'utf-8')
  return new JSDOM(html).window.document
}

describe('parseGitHubUrl', () => {
  it('issue の URL を解析する', () => {
    expect(parseGitHubUrl('https://github.com/cli/cli/issues/326')).toEqual({
      repo: 'cli/cli',
      type: 'issue',
      number: 326,
    })
  })

  it('PR の URL を解析する', () => {
    expect(parseGitHubUrl('https://github.com/cli/cli/pull/9')).toEqual({
      repo: 'cli/cli',
      type: 'pull',
      number: 9,
    })
  })

  it('issue/PR でない URL は null', () => {
    expect(parseGitHubUrl('https://github.com/cli/cli')).toBeNull()
    expect(parseGitHubUrl('https://example.com/a/b/issues/1')).toBeNull()
  })
})

describe('extractPageData: React Issue', () => {
  const doc = loadFixture('issue-react.html')
  const data = extractPageData(doc, 'https://github.com/cli/cli/issues/326')!

  it('基本メタを抽出する', () => {
    expect(data.type).toBe('issue')
    expect(data.number).toBe(326)
    expect(data.repo).toBe('cli/cli')
    expect(data.title).toBe('Allow multiple account credentials')
    expect(data.state).toBe('open')
  })

  it('本文を抽出する', () => {
    expect(data.body).toContain('two accounts on github')
  })

  it('canonical なコメントのみを抽出する（装飾 id は無視）', () => {
    expect(data.comments).toHaveLength(2)
    expect(data.comments[0]).toMatchObject({
      id: 'issuecomment-623227119',
      author: 'eXamadeus',
      timestampISO: '2020-05-04T02:06:39.000Z',
      permalink: '/cli/cli/issues/326#issuecomment-623227119',
    })
    expect(data.comments[0].text).toContain('work around this')
    expect(data.comments[1].author).toBe('mislav')
  })

  it('関連 PR / 関連 issue を抽出する', () => {
    expect(data.relationships.linkedPRs).toEqual([
      { url: 'https://github.com/cli/cli/pull/12853', title: 'feat: add --account flag' },
    ])
    expect(data.relationships.relatedIssues).toEqual([
      { url: 'https://github.com/cli/cli/issues/887', title: 'Support config profiles' },
    ])
  })
})

describe('extractPageData: 旧 PR timeline', () => {
  const doc = loadFixture('pr-timeline.html')
  const data = extractPageData(doc, 'https://github.com/cli/cli/pull/9')!

  it('基本メタを抽出する', () => {
    expect(data.type).toBe('pull')
    expect(data.number).toBe(9)
    expect(data.title).toBe('Gh pr')
    expect(data.state).toBe('merged')
  })

  it('本文（説明）を抽出する', () => {
    expect(data.body).toContain('deleted branch by mistake')
  })

  it('コメントを抽出する（説明は含めない）', () => {
    expect(data.comments).toHaveLength(2)
    expect(data.comments[0]).toMatchObject({
      id: 'issuecomment-540551969',
      author: 'mislav',
      role: 'Contributor',
      permalink: '/cli/cli/pull/9#issuecomment-540551969',
    })
    expect(data.comments[1].author).toBe('octocat')
  })
})
