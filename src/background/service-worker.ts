// Service worker:
// - ツールバーアイコンのクリックでサイドパネルを開く
// - GitHub 以外のタブではサイドパネルを無効化（=開いていれば閉じる）

const SIDE_PANEL_PATH = 'src/sidepanel/index.html'

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error('[gh-summary] setPanelBehavior failed', err))

function isGitHub(url: string | undefined): boolean {
  if (!url) return false
  try {
    return new URL(url).hostname === 'github.com'
  } catch {
    return false
  }
}

/** タブの URL に応じてサイドパネルの有効/無効を切り替える。 */
async function updateSidePanelForTab(tabId: number, url: string | undefined) {
  try {
    if (isGitHub(url)) {
      await chrome.sidePanel.setOptions({
        tabId,
        path: SIDE_PANEL_PATH,
        enabled: true,
      })
    } else {
      // 無効化すると、そのタブでサイドパネルが開いていれば閉じる。
      await chrome.sidePanel.setOptions({ tabId, enabled: false })
    }
  } catch (err) {
    console.error('[gh-summary] setOptions failed', err)
  }
}

// タブを切り替えたとき
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId)
    await updateSidePanelForTab(tabId, tab.url)
  } catch {
    /* タブが既に閉じている等は無視 */
  }
})

// タブ内で URL が変わったとき
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.url !== undefined || info.status === 'complete') {
    void updateSidePanelForTab(tabId, tab.url)
  }
})
