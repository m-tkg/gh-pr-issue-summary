// Gemini Nano へ渡すプロンプトの組み立て。出力言語は引数で切替可能。

import type { CommentData, PageData } from '../content/extract'
import type { CommentNote } from './types'
import { truncateToTokens } from './tokens'

/** 出力言語コード → 指示文中の言語名。 */
const LANG_NAME: Record<string, string> = {
  ja: '日本語',
  en: 'English',
}

function langName(lang: string): string {
  return LANG_NAME[lang] ?? lang
}

/** コメント本文の map 入力トークン上限。長すぎる場合は切り詰める。 */
export const MAP_INPUT_TOKEN_BUDGET = 1200

export function systemPrompt(lang: string): string {
  return [
    'あなたは GitHub の issue / PR の議論を要約するアシスタントです。',
    `出力は必ず ${langName(lang)} で記述してください。`,
    '重要度に応じて強弱をつけ、重要な点は具体的に、些末な点は簡潔にまとめます。',
    '事実に忠実に、推測を断定として書かないでください。',
  ].join('\n')
}

/** コメント 1 件を圧縮メモ化する map プロンプト。 */
export function mapPrompt(comment: CommentData, lang: string): string {
  const body = truncateToTokens(comment.text, MAP_INPUT_TOKEN_BUDGET)
  return [
    `次の GitHub コメントを分析し、${langName(lang)} で要点を JSON で返してください。`,
    `- gist: 1〜2 文の要点`,
    `- kind: question / proposal / decision / bug / nit / info / other のいずれか`,
    `- importance: high / medium / low`,
    `- stance: 賛成・反対・中立など立場（あれば）`,
    '',
    `投稿者: ${comment.author}`,
    `本文:`,
    body,
  ].join('\n')
}

/** 圧縮メモ列を 1 つの参照付きリスト文字列にする。 */
export function formatNotesForReduce(notes: CommentNote[]): string {
  return notes
    .map(
      (n) =>
        `[${n.ordinal}] (${n.author}, ${n.kind}, ${n.importance}) ${n.gist}` +
        (n.stance ? ` / 立場: ${n.stance}` : ''),
    )
    .join('\n')
}

/** 最終要約（クラスタ化を含む）の reduce プロンプト。 */
export function reducePrompt(
  notes: CommentNote[],
  page: PageData,
  lang: string,
): string {
  return [
    `GitHub の ${page.type === 'pull' ? 'PR' : 'issue'} 「${page.title}」の議論を要約します。`,
    `以下は各コメントの要点リストです（[番号] は元コメントの参照）。`,
    '',
    formatNotesForReduce(notes),
    '',
    `これらを踏まえ、${langName(lang)} で次を JSON で返してください。`,
    `- overview: どのような issue/PR か（本文の主旨）`,
    `- overallDiscussion: 全体を通した議論の流れ（重要点は厚く、些末は薄く）`,
    `- currentProgress: 現状の進捗・結論の状態`,
    `- clusters: 議論のかたまり（複数の論点があればまとまりごとに分割）。`,
    `  各 cluster は title / summary / importance / commentRefs を持つ。`,
    `  commentRefs には、その論点に関係するコメントの [番号] を整数配列で列挙する。`,
    `  importance は high / medium / low で各 cluster の重要度を示す。`,
    '',
    `参考（issue/PR 本文の冒頭）:`,
    truncateToTokens(page.body, 400),
  ].join('\n')
}

/** 部分要約（クラスタ候補のテキスト）をさらに統合する階層 reduce 用プロンプト。 */
export function mergeReducePrompt(
  partialSummaries: string[],
  page: PageData,
  lang: string,
): string {
  return [
    `GitHub の ${page.type === 'pull' ? 'PR' : 'issue'} 「${page.title}」について、`,
    `スレッドを分割して要約した部分結果が複数あります。これらを統合します。`,
    '',
    partialSummaries.map((s, i) => `=== 部分要約 ${i + 1} ===\n${s}`).join('\n\n'),
    '',
    `${langName(lang)} で、重複を排除し統合した最終結果を JSON で返してください。`,
    `commentRefs は各部分要約に含まれる [番号] をそのまま引き継いでください。`,
  ].join('\n')
}
