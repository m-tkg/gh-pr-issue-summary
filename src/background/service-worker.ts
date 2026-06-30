// Service worker: ツールバーアイコンのクリックでサイドパネルを開く。
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error('[gh-summary] setPanelBehavior failed', err))
