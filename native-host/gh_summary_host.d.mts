// テスト/型チェック用の型宣言（ホスト本体は純粋な .mjs）。
export function parseCodexOutput(raw: string): string
export function cliSpec(
  cliKey: string,
  paths?: Record<string, string>,
  model?: string,
):
  | {
      bin: string
      args: (prompt: string) => string[]
      useStdin: boolean
      parse: (raw: string) => string
    }
  | null
