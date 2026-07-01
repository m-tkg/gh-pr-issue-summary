// ローカル CLI(claude-code / codex / gemini)を Native Messaging 経由で使う
// LlmClient 実装。拡張 → ネイティブホスト → CLI と中継する。

import type {
  Availability,
  CreateSessionOptions,
  LlmClient,
  LlmSession,
  PromptOptions,
} from './llmClient'

export const NATIVE_HOST_NAME = 'com.m_tkg.gh_summary_host'

export type CliKind = 'claude-code' | 'codex' | 'gemini'

export const CLI_LABELS: { value: CliKind; label: string }[] = [
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'codex', label: 'Codex' },
  { value: 'gemini', label: 'Gemini' },
]

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
  constructor(private readonly cli: CliKind) {}

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
    return {
      // CLI 側の実コンテキストは大きいが、ここでは未使用のため 0。
      contextWindow: 0,
      contextUsage: 0,
      async prompt(text: string, _o: PromptOptions = {}): Promise<string> {
        const res = await sendToHost({ cli, prompt: text })
        if (!res || res.ok === false || typeof res.text !== 'string') {
          throw new Error(res?.error || 'ネイティブホストからの応答が不正です。')
        }
        return res.text
      },
      destroy() {},
    }
  }
}
