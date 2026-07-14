// ローカル CLI(claude-code / codex / antigravity / cursor)を Native Messaging 経由で使う
// LlmClient 実装。拡張 → ネイティブホスト → CLI と中継する。

import type {
  Availability,
  CreateSessionOptions,
  LlmClient,
  LlmSession,
  PromptOptions,
} from './llmClient'

export const NATIVE_HOST_NAME = 'com.m_tkg.gh_summary_host'

export type CliKind = 'claude-code' | 'codex' | 'antigravity' | 'cursor'

export const CLI_LABELS: { value: CliKind; label: string }[] = [
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'codex', label: 'Codex' },
  { value: 'antigravity', label: 'Antigravity' },
  { value: 'cursor', label: 'Cursor Agent' },
]

/**
 * CLI ごとのモデル選択肢。value が空文字なら CLI の既定モデル（フラグ無し）。
 * モデルは各 CLI 側で更新されうるため、既定 + 代表的なものを用意する。
 */
export const MODEL_PRESETS: Record<
  CliKind,
  { value: string; label: string }[]
> = {
  'claude-code': [
    { value: '', label: 'デフォルト' },
    { value: 'opus', label: 'Opus' },
    { value: 'sonnet', label: 'Sonnet' },
    { value: 'haiku', label: 'Haiku' },
  ],
  codex: [
    { value: '', label: 'デフォルト' },
    { value: 'gpt-5-codex', label: 'gpt-5-codex' },
    { value: 'gpt-5', label: 'gpt-5' },
    { value: 'o3', label: 'o3' },
  ],
  // agy の `agy models` の表示名がそのまま --model の値になる。
  antigravity: [
    { value: '', label: 'デフォルト' },
    { value: 'Gemini 3.1 Pro (High)', label: 'Gemini 3.1 Pro (High)' },
    { value: 'Gemini 3.1 Pro (Low)', label: 'Gemini 3.1 Pro (Low)' },
    { value: 'Gemini 3.5 Flash (High)', label: 'Gemini 3.5 Flash (High)' },
    { value: 'Gemini 3.5 Flash (Medium)', label: 'Gemini 3.5 Flash (Medium)' },
    { value: 'Claude Opus 4.6 (Thinking)', label: 'Claude Opus 4.6 (Thinking)' },
    { value: 'Claude Sonnet 4.6 (Thinking)', label: 'Claude Sonnet 4.6 (Thinking)' },
    { value: 'GPT-OSS 120B (Medium)', label: 'GPT-OSS 120B (Medium)' },
  ],
  cursor: [
    { value: '', label: 'デフォルト' },
    { value: 'gpt-5', label: 'gpt-5' },
    { value: 'sonnet-4-thinking', label: 'sonnet-4-thinking' },
  ],
}

interface HostResponse {
  ok: boolean
  text?: string
  pong?: boolean
  error?: string
}

/** ネイティブホストへ 1 メッセージ送って応答を得る。 */
async function sendToHost(message: unknown): Promise<HostResponse> {
  return (await chrome.runtime.sendNativeMessage(
    NATIVE_HOST_NAME,
    message as object,
  )) as HostResponse
}

export class NativeCliLlmClient implements LlmClient {
  constructor(
    private readonly cli: CliKind,
    /** 空文字なら CLI の既定モデル。 */
    private readonly model: string = '',
  ) {}

  async availability(): Promise<Availability> {
    try {
      const res = await sendToHost({ ping: true })
      return res?.pong ? 'available' : 'unavailable'
    } catch {
      // ホスト未インストール等。
      return 'unavailable'
    }
  }

  async createSession(_opts: CreateSessionOptions = {}): Promise<LlmSession> {
    const cli = this.cli
    const model = this.model
    return {
      // CLI 側の実コンテキストは大きいが、ここでは未使用のため 0。
      contextWindow: 0,
      contextUsage: 0,
      async prompt(text: string, _o: PromptOptions = {}): Promise<string> {
        const res = await sendToHost({ cli, prompt: text, model })
        if (!res || res.ok === false || typeof res.text !== 'string') {
          throw new Error(res?.error || 'ネイティブホストからの応答が不正です。')
        }
        return res.text
      },
      destroy() {},
    }
  }
}
