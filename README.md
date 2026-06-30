# GitHub Issue/PR コメント要約 Chrome 拡張

GitHub の issue / PR を開くと、コメント群を **Chrome 組み込み AI（Gemini Nano / Prompt API）** で
オンデバイス要約し、サイドパネルに表示します。すべてローカル推論で完結します。

## 機能

- **概要** — どのような issue / PR か
- **親・関連** — 関連 PR・関連 issue（サイドバーから抽出）
- **全体の議論** — 重要度に強弱をつけた議論の流れ
- **現状の進捗** — 結論・進行状況
- **議論のかたまり（クラスタ）** — 論点ごとにまとめ、各クラスタから該当コメントへリンク
- **要約言語の切替**（既定: 日本語）
- **長いスレッドの分割可視化** — コメントを範囲（例「コメント 1〜18」）に分割表示し、
  **任意の開始位置から要約**を開始可能
- **map 結果のキャッシュ**で再要約を高速化
- **"Load more" の自動展開**（可能な範囲）

## 仕組み（map-reduce）

Gemini Nano のコンテキストは入出力共有で約 9,216 トークンと小さいため、長いスレッドを
一括投入できません。そこで:

1. **map**: コメント 1 件ずつを圧縮メモ（要点 / 種別 / 重要度 / 立場）に変換
2. **reduce**: メモ列を集約し、概要・全体議論・進捗・クラスタを構造化出力（`responseConstraint`）
3. メモが多くコンテキストを超える場合は **階層 reduce**（バッチ部分要約 → 統合）

## 必要環境

- Chrome 138 以上
- 組み込み AI（Gemini Nano）が有効であること
  - 必要に応じて `chrome://flags/#prompt-api-for-gemini-nano` を有効化し、モデルをダウンロード
  - サイドパネルで `availability` を確認し、未準備時は案内を表示します

## 開発

```bash
npm install
npm test         # Vitest（抽出・分割・パイプライン・描画のユニットテスト）
npm run typecheck
npm run build    # dist/ に MV3 拡張を出力
npm run dev      # CRXJS の開発サーバ（HMR）
```

### 拡張の読み込み

1. `npm run build`（または `npm run dev`）
2. `chrome://extensions` を開き「デベロッパーモード」を ON
3. 「パッケージ化されていない拡張機能を読み込む」で `dist/` を選択
4. GitHub の issue / PR ページを開き、ツールバーの拡張アイコンをクリックしてサイドパネルを表示

## 構成

| パス | 役割 |
| --- | --- |
| `src/content/extract.ts` | issue/PR ページ DOM からの抽出（React/旧 timeline 両対応） |
| `src/content/expand.ts` | "Load more" の展開 |
| `src/content/index.ts` | サイドパネルからの要求に応答 |
| `src/summarize/llmClient.ts` | Chrome 組み込み AI のアダプタ（テストでモック可能） |
| `src/summarize/segment.ts` | コメント範囲（セグメント）への分割 |
| `src/summarize/pipeline.ts` | map-reduce 要約パイプライン |
| `src/summarize/{schema,prompts,types}.ts` | JSON Schema / プロンプト / 型 |
| `src/sidepanel/` | サイドパネル UI（描画・状態・storage） |
| `src/background/index.ts` | サイドパネルを開く service worker |
