// サイドパネルのエントリポイント（最小実装。要約フローは後続ステップで結線）。
const statusEl = document.getElementById('status')
if (statusEl) {
  statusEl.textContent =
    'GitHub の issue / PR ページを開くと、コメントの要約を実行できます。'
}
