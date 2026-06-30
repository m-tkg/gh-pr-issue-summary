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

export const FINAL_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['overview', 'overallDiscussion', 'currentProgress', 'clusters'],
  properties: {
    overview: { type: 'string' },
    overallDiscussion: { type: 'string' },
    currentProgress: { type: 'string' },
    clusters: {
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
    },
  },
}
