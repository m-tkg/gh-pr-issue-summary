import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest({
  manifest_version: 3,
  name: 'GitHub Issue/PR コメント要約',
  description:
    'GitHub の issue/PR コメントを Chrome 組み込み AI (Gemini Nano) でオンデバイス要約し、サイドパネルに表示します。',
  version: '0.1.0',
  minimum_chrome_version: '138',
  permissions: [
    'sidePanel',
    'storage',
    'scripting',
    'activeTab',
    'nativeMessaging',
  ],
  host_permissions: ['https://github.com/*'],
  background: {
    service_worker: 'src/background/service-worker.ts',
    type: 'module',
  },
  action: {
    default_title: 'コメント要約を開く',
  },
  side_panel: {
    default_path: 'src/sidepanel/index.html',
  },
  content_scripts: [
    {
      matches: ['https://github.com/*'],
      js: ['src/content/content-script.ts'],
      run_at: 'document_idle',
    },
  ],
})
