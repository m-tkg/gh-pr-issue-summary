#!/usr/bin/env bash
# gh-pr-issue-summary の Native Messaging ホストをインストールする（macOS / Chrome）。
# 使い方: ./install.sh            (拡張IDは manifest の key で固定済み)
#         ./install.sh <拡張ID>   (別IDで上書きしたい場合のみ)
set -euo pipefail

HOST_NAME="com.m_tkg.gh_summary_host"
# manifest の key で固定された拡張ID（既定）。
DEFAULT_EXT_ID="fhffjimobojofadknfdoggjaiodnhadb"
EXT_ID="${1:-$DEFAULT_EXT_ID}"

DIR="$(cd "$(dirname "$0")" && pwd)"
HOST_JS="$DIR/gh_summary_host.mjs"
WRAPPER="$DIR/run-host.sh"

NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  echo "エラー: node が見つかりません。Node.js を導入してください。"
  exit 1
fi

# --- CLI の絶対パスを解決 ---
resolve() { command -v "$1" 2>/dev/null || true; }

CLAUDE="$(resolve claude)"
# claude はシェル関数のことがあるため既知の実体パスを優先
if [ -x "$HOME/.local/bin/claude" ]; then CLAUDE="$HOME/.local/bin/claude"; fi
CODEX="$(resolve codex)"
ANTIGRAVITY="$(resolve agy)"
if [ -x "$HOME/.local/bin/agy" ]; then ANTIGRAVITY="$HOME/.local/bin/agy"; fi
CURSOR="$(resolve agent)"
if [ -x "$HOME/.local/bin/agent" ]; then CURSOR="$HOME/.local/bin/agent"; fi
if [ -z "$CURSOR" ] && [ -x "$HOME/.local/bin/cursor-agent" ]; then CURSOR="$HOME/.local/bin/cursor-agent"; fi

cat > "$DIR/cli-paths.json" <<EOF
{
  "claude": "${CLAUDE}",
  "codex": "${CODEX}",
  "antigravity": "${ANTIGRAVITY}",
  "cursor": "${CURSOR}"
}
EOF
echo "解決した CLI パス:"
echo "  claude     : ${CLAUDE:-(未検出)}"
echo "  codex      : ${CODEX:-(未検出)}"
echo "  antigravity: ${ANTIGRAVITY:-(未検出)}"
echo "  cursor     : ${CURSOR:-(未検出)}"

# --- node ラッパ（Chrome の最小 PATH でも動くよう絶対パスで node を呼ぶ） ---
cat > "$WRAPPER" <<EOF
#!/bin/bash
exec "${NODE_BIN}" "${HOST_JS}" "\$@"
EOF
chmod +x "$WRAPPER" "$HOST_JS"

# --- Native Messaging ホスト manifest を配置 ---
TARGET_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
mkdir -p "$TARGET_DIR"
cat > "$TARGET_DIR/$HOST_NAME.json" <<EOF
{
  "name": "$HOST_NAME",
  "description": "gh-pr-issue-summary native host",
  "path": "$WRAPPER",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
EOF

echo "インストール完了: $TARGET_DIR/$HOST_NAME.json"
echo "拡張ID: $EXT_ID を許可しました。Chrome を再起動すると確実です。"
