// Prompt API の responseConstraint に渡す JSON Schema 定義。

export const NOTE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['gist', 'kind', 'importance'],
  properties: {
    gist: { type: 'string' },
    kind: {
      type: 'string',
      enum: ['question', 'proposal', 'decision', 'bug', 'nit', 'info', 'other'],
    },
    importance: { type: 'string', enum: ['high', 'medium', 'low'] },
    stance: { type: 'string' },
  },
}

// Gemini Nano 用。出力安定性への影響を避けるためフィールドを増やさない。
const CLUSTERS_SCHEMA: Record<string, unknown> = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'summary', 'importance', 'commentRefs'],
    properties: {
      title: { type: 'string' },
      summary: { type: 'string' },
      importance: { type: 'string', enum: ['high', 'medium', 'low'] },
      commentRefs: { type: 'array', items: { type: 'integer' } },
    },
  },
}

// CLI バックエンド用。status（決着状況）を任意項目として追加で持つ。
const CLUSTERS_SCHEMA_WITH_STATUS: Record<string, unknown> = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'summary', 'importance', 'commentRefs'],
    properties: {
      title: { type: 'string' },
      summary: { type: 'string' },
      importance: { type: 'string', enum: ['high', 'medium', 'low'] },
      status: { type: 'string', enum: ['resolved', 'open'] },
      commentRefs: { type: 'array', items: { type: 'integer' } },
    },
  },
}

export const FINAL_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['overview', 'overallDiscussion', 'currentProgress', 'clusters'],
  properties: {
    overview: { type: 'string' },
    overallDiscussion: { type: 'string' },
    currentProgress: { type: 'string' },
    clusters: CLUSTERS_SCHEMA,
  },
}

/**
 * FINAL_SCHEMA に加えて flowSteps（やろうとしている作業・提案内容の手順）を
 * 持つスキーマ。大コンテキストの CLI バックエンドの single-shot 要約でのみ使う。
 * Gemini Nano の出力安定性への影響を避けるため FINAL_SCHEMA とは別定数にしている。
 */
export const FINAL_SCHEMA_WITH_FLOW: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['overview', 'overallDiscussion', 'currentProgress', 'clusters'],
  properties: {
    overview: { type: 'string' },
    overallDiscussion: { type: 'string' },
    currentProgress: { type: 'string' },
    clusters: CLUSTERS_SCHEMA_WITH_STATUS,
    flowSteps: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'commentRefs'],
        properties: {
          label: { type: 'string' },
          kind: { type: 'string', enum: ['action', 'decision', 'outcome'] },
          commentRefs: { type: 'array', items: { type: 'integer' } },
        },
      },
    },
  },
}
