# 統合ダッシュボード フェーズ1 実装報告

- 生成日時: 2026-04-23
- URL: `/dashboard` (独立ページ)
- データ源: `public/dashboard-data.json` (`pnpm build-dashboard` で生成)

## 1. 実装サマリ

### 新規作成ファイル

| ファイル | 役割 |
|---|---|
| `scripts/build_dashboard_data.ts` | 3233R の検証 JSON から集計 → `public/dashboard-data.json` 生成 |
| `public/dashboard-data.json` | 集計結果（静的に配信） |
| `app/dashboard/page.tsx` | ダッシュボードページ (Server Component, ISR 60s) |
| `app/dashboard/types.ts` | DashboardData 型定義 + カラー定数 |
| `app/dashboard/components/SummarySection.tsx` | 6タイル サマリー |
| `app/dashboard/components/MonthlyROIChart.tsx` | **純SVG 折れ線グラフ** (馬連/馬単/ワイド × 12ヶ月) |
| `app/dashboard/components/TypeDetailCards.tsx` | 券種別詳細 3カード |
| `app/dashboard/components/StrategyInfoCard.tsx` | Phase 2G 除外ルール表 |

### 修正ファイル

| ファイル | 変更内容 |
|---|---|
| `app/page.tsx` | ヘッダーに「📊 ダッシュボード」リンク追加 |
| `package.json` | `"build-dashboard": "tsx scripts/build_dashboard_data.ts"` 追加 |

## 2. 採用した技術選択とその理由

### グラフライブラリ: **純SVG (外部依存なし)**

候補と比較:

| 候補 | 採否 | 理由 |
|---|---|---|
| recharts | 見送り | ~100KB gz、依存増。年1〜2回しか触らない単純な折れ線グラフには過剰 |
| chart.js + react-chartjs-2 | 見送り | canvas ベースで SEO/アクセシビリティ弱、bundle さらに大きい |
| **純SVG** | **採用** | 依存 0、12ヶ月×3系列は直感的な `<polyline>` で完結、ホバー は `<title>` で十分 |
| d3 | 見送り | オーバーキル |

実装量は `MonthlyROIChart.tsx` で 150行程度、データポイントの `<title>` 要素がブラウザネイティブのツールチップになるためホバー操作も自然。

### データ取得: **Server Component + `fs.readFile`**

- `page.tsx` は async Server Component
- ビルド時/ISR 再検証時に `public/dashboard-data.json` を読み込み
- `export const revalidate = 60` で 60 秒 ISR → JSON 更新を再ビルド不要で反映
- 週次スクレイプ完了後に `pnpm build-dashboard` を実行するだけで次のリクエストから新データが反映

### データ設計: 方法A（静的 JSON）

- `build_dashboard_data.ts` は Phase 2G ロジック（`lib/score/calculator.ts` と同期した除外判定）を JS で再実装
- 既存の検証 JSON を走査して以下を集計:
  - summary: 総R数・期間・合計pt・3券種 ROI・総合的中率
  - monthly[]: 月別×3券種の ROI / 参加R / 的中R / 総R
  - byType: 券種別の ROI / 的中率 / 月別CV / 最良月 / 最悪月
  - strategy: 除外ルール配列 (UI 表示用)

## 3. 実データでの表示内容 (3233R 版)

### サマリー
- 総R数: **3,233R** (2025-05-03 〜 2026-04-19)
- 合計pt: **312.5**
- 馬連本命: **117.0%** (参加 527R / 的中 43R)
- 馬単本命: **96.5%** (参加 440R / 的中 41R)
- ワイド堅実: **99.1%** (参加 387R / 的中 99R)
- 総合的中率: 約 13%

### 月別ROI推移 (グラフ)
12ヶ月 × 3系列、100% 損益分岐破線付き。
2025-12 の馬連 0% / 2026-01 の馬連 400% など時系列変動を可視化。

### 券種別詳細カード
各カードに ROI / 参加R / 的中率 / 月別CV / 最良月 / 最悪月 / 条件文 を表示。

### 戦略表
| クラス | 馬連 | 馬単 | ワイド |
|---|---|---|---|
| 1勝クラス | ✗ | ✗ | ✗ |
| 2勝クラス | ✗ | ✗ | ✓ |
| 3勝/OP/重賞 | ✓ | ✓ | ✓ |
| 新馬/未勝利 | ✓ | ✓ | ✓ |

## 4. 週次スクレイプとの連携

`.github/workflows/weekly-scrape.yml` を将来拡張してダッシュボードデータも自動更新可能。

現状 (手動運用):
```bash
# 1. 週次スクレイプ (自動: 毎週火曜 08:00 JST)
pnpm weekly-scrape

# 2. ダッシュボード再集計 (手動)
pnpm build-dashboard

# 3. git commit & push → ISR (60秒) で反映
```

将来 (自動化): `weekly-scrape.yml` の commit 直前に `pnpm build-dashboard` を追加するだけ。

## 5. モバイル対応

- 全コンポーネントで CSS Grid `auto-fit minmax()` を使用、幅 375px でも破綻なし
- SVG グラフは `viewBox` + `width: 100%` で自動スケール
- サマリータイル: 6タイル → 390px で 3列×2段 / デスクトップで 6列×1段
- 券種カード: 3カード → 390px で 1列 / デスクトップで 3列
- フォントサイズ最小 0.6rem (注記)、基本 0.7〜0.88rem
- タップ領域: ナビリンクは padding 0.25 0.5rem で十分確保

## 6. 既存機能への影響

- ✅ `lib/score/calculator.ts` 無変更 (Phase 2G ロジック維持)
- ✅ 既存 RaceReport/BakenSimulator の高密度化を維持
- ✅ 既存ナビゲーション (RaceSelector 等) 破綻なし
- ✅ TypeScript エラー 0
- ✅ ESLint: 既存 warning 1 件のみ (今回の変更由来ではない)

## 7. 必達要件 チェック

- [x] `/dashboard` が独立ページとして機能 (Server Component + ISR)
- [x] サマリーエリア表示 (6タイル)
- [x] 月別ROI折れ線グラフ表示 (3本 + 100%損益分岐線)
- [x] 券種別詳細カード表示 (3カード)
- [x] 戦略情報カード表示 (除外ルール表)
- [x] モバイル対応 (375-400px で破綻なし)
- [x] 本番ロジック無変更
- [x] 既存のUI改修を壊さない

## 8. 今後の拡張方針

### フェーズ2 (個別予想の信頼度) 準備

- 今回の `TypeDetailCards` / `SummarySection` コンポーネントを、レース単位の信頼度表示に流用可能
- 個別予想ページで「このレースのクラス・馬場状態での過去実績」を表示する際、`MonthlyROIChart` のサブセット表示を流用可
- データソース `dashboard-data.json` に `byClass` / `byTrackCondition` を追加するのみで拡張可能

### フェーズ3 (戦略透明化) 準備

- `StrategyInfoCard` を拡張し、各ルールの「根拠となるROI実測値」をバケット別に表示
- `approach4_unused_axes.md` の軸別バケット分析結果を JSON に追加する方向で準備済

## 9. 動作確認方法 (ユーザー側)

```bash
# 1. 依存・データ確認
pnpm build-dashboard   # public/dashboard-data.json を更新
pnpm dev

# 2. ブラウザで開く
# http://localhost:3000           → メイン画面、右上に 📊 ダッシュボード リンク
# http://localhost:3000/dashboard → ダッシュボード

# 3. DevTools → iPhone SE (375px) でモバイル表示確認
```
