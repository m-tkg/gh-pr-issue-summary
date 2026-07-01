import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest({
  manifest_version: 3,
  // 拡張 ID を固定するための公開鍵（対応する ID: fhffjimobojofadknfdoggjaiodnhadb）。
  // これにより Native Messaging ホストの allowed_origins を一定にできる。
  key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA6Mx9H0Wbchkk9b1HGhmU3MvZ+dQ43HfNOvUUdJOugedEcCD5OgrwUb4sSuu23WGFEmY6wUsYaHISYYEBVhkkPbnJcmxenlOLFuZFSyNSpLL1R54PUpklQYFhrKjZVzNA8RDSwjs/vGc/trIvrATjeoYY/kgZkof8X6G7CWrWSt+gTGTnYa10dNSmAiJxq00aE7jsa0C1XP/m50ijKaYSqWeknxPZFUn8wkWWtbqgcA/t8iYyRrKVjwk9nwdRALcKt3WM2jIfoz5Fqq/zzFKO1V2l+FfaZkbfSVN2iSQ8NnZ+WKwT5EDhOzsjSY560AK2lApCWQMmv4r+6ydkhYdC5QIDAQAB',
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
  icons: {
    16: 'icons/icon16.png',
    32: 'icons/icon32.png',
    48: 'icons/icon48.png',
    128: 'icons/icon128.png',
  },
  action: {
    default_title: 'コメント要約を開く',
    default_icon: {
      16: 'icons/icon16.png',
      32: 'icons/icon32.png',
      48: 'icons/icon48.png',
      128: 'icons/icon128.png',
    },
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
