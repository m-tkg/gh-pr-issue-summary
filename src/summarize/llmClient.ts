// Chrome 組み込み AI (LanguageModel / Prompt API) を抽象化するアダプタ。
//
// アプリ本体はグローバル `LanguageModel` に直接依存せず、この `LlmClient`
// インタフェース経由で推論する。これによりテストでモック差し替えが可能になり、
// 将来 API が変わってもこのファイルの吸収で済む。

/** モデルの利用可否。Prompt API の availability() に準拠。 */
export type Availability =
  | 'unavailable'
  | 'downloadable'
  | 'downloading'
  | 'available'

export interface PromptOptions {
  /** JSON Schema による構造化出力 (responseConstraint)。 */
  responseConstraint?: Record<string, unknown>
  signal?: AbortSignal
}

/** 1 回の要約タスクで使い回すセッション。 */
export interface LlmSession {
  prompt(text: string, opts?: PromptOptions): Promise<string>
  /** コンテキストウィンドウ全体のトークン数。 */
  readonly contextWindow: number
  /** 現在の消費トークン数。 */
  readonly contextUsage: number
  destroy(): void
}

export interface CreateSessionOptions {
  systemPrompt?: string
  /** 出力言語 (例: 'ja', 'en')。expectedOutputs に反映。 */
  outputLanguage?: string
  /** モデルダウンロードの進捗 (0〜1)。 */
  onDownloadProgress?: (loaded: number) => void
  signal?: AbortSignal
}

export interface LlmClient {
  availability(opts?: { outputLanguage?: string }): Promise<Availability>
  createSession(opts?: CreateSessionOptions): Promise<LlmSession>
}

// --- 純粋ヘルパ (テスト対象) ---

/** CreateSessionOptions を LanguageModel.create() のオプションへ変換する。 */
export function buildCreateOptions(
  opts: CreateSessionOptions,
): LanguageModelCreateOptions {
  const out: LanguageModelCreateOptions = {}
  if (opts.systemPrompt) {
    out.initialPrompts = [{ role: 'system', content: opts.systemPrompt }]
  }
  if (opts.outputLanguage) {
    out.expectedOutputs = [{ type: 'text', languages: [opts.outputLanguage] }]
  }
  return out
}

/** グローバルが Prompt API を備えているかを判定する。 */
export function isLanguageModelSupported(candidate: unknown): boolean {
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    typeof (candidate as { create?: unknown }).create === 'function'
  )
}

// --- Chrome 実装 ---

/** Chrome 組み込み AI を用いた LlmClient 実装。 */
export class ChromeLlmClient implements LlmClient {
  private get model(): typeof LanguageModel {
    const g = globalThis as { LanguageModel?: typeof LanguageModel }
    if (!isLanguageModelSupported(g.LanguageModel)) {
      throw new Error(
        'この環境では Chrome 組み込み AI (Prompt API) を利用できません。',
      )
    }
    return g.LanguageModel!
  }

  async availability(opts?: { outputLanguage?: string }): Promise<Availability> {
    const g = globalThis as { LanguageModel?: typeof LanguageModel }
    if (!isLanguageModelSupported(g.LanguageModel)) return 'unavailable'
    const expectedOutputs = opts?.outputLanguage
      ? [{ type: 'text' as const, languages: [opts.outputLanguage] }]
      : undefined
    return g.LanguageModel!.availability({ expectedOutputs })
  }

  async createSession(opts: CreateSessionOptions = {}): Promise<LlmSession> {
    const createOptions = buildCreateOptions(opts)
    if (opts.onDownloadProgress) {
      const cb = opts.onDownloadProgress
      createOptions.monitor = (m) => {
        m.addEventListener('downloadprogress', (e) =>
          cb((e as ProgressEvent).loaded),
        )
      }
    }
    if (opts.signal) createOptions.signal = opts.signal

    const session = await this.model.create(createOptions)
    return new ChromeLlmSession(session)
  }
}

class ChromeLlmSession implements LlmSession {
  constructor(private readonly session: LanguageModel) {}

  get contextWindow(): number {
    return this.session.contextWindow ?? 0
  }

  get contextUsage(): number {
    return this.session.contextUsage ?? 0
  }

  async prompt(text: string, opts: PromptOptions = {}): Promise<string> {
    return this.session.prompt(text, {
      responseConstraint: opts.responseConstraint,
      signal: opts.signal,
    })
  }

  destroy(): void {
    this.session.destroy()
  }
}
