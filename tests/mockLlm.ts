import type {
  LlmClient,
  LlmSession,
  CreateSessionOptions,
  PromptOptions,
} from '../src/summarize/llmClient'

/** プロンプト文字列に応じて応答を返すモック LLM。テスト用。 */
export class MockLlmClient implements LlmClient {
  public prompts: string[] = []
  public createdSessions = 0

  constructor(
    /** プロンプトを受け取り JSON 文字列を返す関数。 */
    private readonly responder: (prompt: string, callIndex: number) => string,
  ) {}

  async availability() {
    return 'available' as const
  }

  async createSession(_opts?: CreateSessionOptions): Promise<LlmSession> {
    this.createdSessions++
    const self = this
    return {
      contextWindow: 6000,
      contextUsage: 0,
      async prompt(text: string, _o?: PromptOptions): Promise<string> {
        const idx = self.prompts.length
        self.prompts.push(text)
        return self.responder(text, idx)
      },
      destroy() {},
    }
  }
}
