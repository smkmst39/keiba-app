# 統合ダッシュボード フェーズ2 実装報告: 個別予想の信頼度表示

- 生成日時: 2026-04-23
- 配置: Section 5A「馬券推奨」冒頭に 2-3 行の控えめな信頼度カード
- データ源: `public/dashboard-data.json` の `byCategory` セクション

## 1. 実装サマリ

### 新規ファイル

| ファイル | 役割 |
|---|---|
| `lib/reliability/race-category.ts` | `classifyClassKey` / `distanceBandKey` (集計 × 判定で共有) |
| `lib/reliability/calculator.ts` | Race + byCategory → ReliabilityInfo 生成 (ピュア関数) |
| `app/components/ReliabilityCard.tsx` | `/dashboard-data.json` を fetch + キャッシュし、計算結果を描画 |

### 修正ファイル

| ファイル | 変更内容 |
|---|---|
| `scripts/build_dashboard_data.ts` | `byCategory: { tight, medium, classOnly }` を追加、race-category 共有 |
| `public/dashboard-data.json` | 再生成 (byCategory 追加) |
| `app/components/RaceReport.tsx` | Section 5A 冒頭に `<ReliabilityCard race={race} />` 追加 |

## 2. 類似レース条件の設計

### 採用した 3 条件 (推奨スタート準拠)

| 条件 | 分類粒度 |
|---|---|
| クラス | G1/G2/G3/L/C3/C2/C1/UW/NW/OP/SP の 11 区分 |
| 芝/ダート | turf / dirt |
| 距離帯 | ≤1200 / 1201-1599 / 1600-1899 / 1900-2199 / ≥2200 の 5 バンド |

理論最大: 11 × 2 × 5 = 110 バケット。3233R なら 1 バケット平均 ~30R。

### フォールバック戦略

細粒度ほど意味ある類似度、粗粒度ほどサンプル確保という緊張を解消:

```
tight (class|surface|band) → 推奨R ≥ 20 なら採用
  ↓
medium (class|surface)     → 推奨R ≥ 20 なら採用
  ↓
classOnly (class)           → 最終フォールバック (小サンプルでも採用)
```

`ReliabilityInfo.granularity` で UI 上どの粒度が採用されたか (細/中/粗) を明示。

### 特殊処理: Phase 2G 除外クラス (C1/C2)

C1/C2 は戦略上 `umarenParticipated = 0` が確定 (除外対象) なので、fallback せず **直接 classOnly を採用 → レベル `excluded`** で「🚫 対象外」と表示。

## 3. 信頼度レベル判定

| レベル | 条件 | ラベル | 色テーマ |
|---|---|---|---|
| 🟢 高 | ROI≥120% & 推奨R≥50 & CV≤0.5 | 🟢 高 | 緑 |
| 🟡 中 | ROI≥100% & 推奨R≥20 & CV≤1.0 | 🟡 中 | 黄 |
| 🟠 注意 | ROI≥100% (但しサンプル/CV 弱) | 🟠 注意 | 橙 |
| 🔴 低 | ROI<100% | 🔴 低 | 赤 |
| 🚫 対象外 | Phase 2G 除外クラス (C1/C2) | 🚫 対象外 | 灰 |
| — 参考情報なし | 全階層で推奨R=0 | — 参考情報なし | 極薄灰 |

優先順位: excluded → low → high → mid → caution → unknown

## 4. 3233R データでの実ケース

### 代表バケット (byCategory.tight)

| クラス | 芝ダ | 距離帯 | 総R | 推奨R | ROI | CV | 判定 |
|---|---|---|---|---|---|---|---|
| UW | dirt | 1600-1899 | 308 | 77 | 144.2% | 2.486 | 🟠 注意 (CV高) |
| UW | turf | 1600-1899 | 191 | 59 | 197.3% | 1.646 | 🟠 注意 (CV高) |
| UW | dirt | ≤1200 | 151 | 28 | 118.9% | 0.617 | 🟡 中 |
| UW | turf | 1900-2199 | 125 | 34 | 250.6% | 1.286 | 🟠 注意 |
| NW | turf | 1600-1899 | 94 | 38 | 54.7% | 1.467 | 🔴 低 |

### classOnly レベル (フォールバック最終段)

| クラス | 総R | 推奨R | ROI | CV | 判定 |
|---|---|---|---|---|---|
| UW | 1163 | 281 | 138.3% | 1.077 | 🟠 注意 (CV>1.0) |
| C1 | 857 | 0 | 0% | 0 | 🚫 対象外 |
| C2 | 434 | 0 | 0% | 0 | 🚫 対象外 |
| NW | 291 | 118 | 70.3% | 1.298 | 🔴 低 |
| G3 | 65 | 19 | 0% | 0 | — 参考情報なし |

## 5. UI デザイン (控えめ配置)

### 配置場所
Section 5A「馬券推奨」の SectionHeader 直下。Section 5A のタイトルは「バックテスト検証済み戦略」なので、**信頼度＝このレースへの戦略の当てはまり具合**として自然に読める位置。

### 視覚階層 (抑制的)
- フォント: 0.64rem 〜 0.75rem (他セクション 0.7〜0.88 より小)
- padding 0.3 0.45rem (他セクション 0.35〜0.5 より狭い)
- 色: レベル別の極淡背景 + 4px 左 border で色分け (他の色帯 UI と統一)
- 3行構成:
  1. 信頼度レベル + 類似条件 + 粒度 (細/中/粗)
  2. 類似R / 推奨R / ROI / CV
  3. コメント (自動生成、例: 「ROI≥100%だが 推奨R少 のため参考程度に」)

### モバイル対応
- `flex-wrap: wrap` で 375px 幅でも破綻なし
- 既存 UI (SkipCard, TieredBetCard) と同じ `border-left: 4px` デザイン言語で視覚的馴染み

## 6. 実装上の設計判断

### データ取得: 動的 fetch + モジュールキャッシュ
- Server Component の RaceReport 親で loader を書くと cascading 制約が増える → **Client Component + useEffect fetch** を採用
- モジュール内 `cachedByCategory` で再フェッチ抑制 (タブ内 1 回のみ)
- `cache: 'force-cache'` で Next.js のデフォルト HTTP キャッシュを併用

### 計算ロジックの純粋性
- `calculateReliability(race, byCat)` はピュア関数
- フェーズ3 (戦略透明化) で同じ関数を詳細表示用にも使い回せる
- テスト容易、副作用なし

### 共有モジュール `lib/reliability/race-category.ts`
- 集計スクリプト (Node) と UI (browser) 両方から import
- `classifyClassKey` / `distanceBandKey` の**単一の真実源**を確保
- これで集計側と判定側のルール乖離を構造的に防ぐ

## 7. graceful degrade

- `/dashboard-data.json` が取得できない場合: カードを**一切描画しない** (既存UI を邪魔しない)
- `byCategory` が欠損 (旧バージョン data) の場合: 同上
- race が特殊クラスで bucket が見つからない: `unknown` レベルで「参考情報なし」

## 8. 必達要件 チェック

- [x] 予想画面に信頼度情報が表示される
- [x] 3指標 (類似R数/ROI/CV) が表示される
- [x] レベル判定 (高/中/注意/低/対象外/参考情報なし) が適切
- [x] 既存UIの高密度化を壊さない (他セクションと同じ線幅・フォント方針)
- [x] モバイル対応 (flex-wrap + 小フォント)
- [x] `lib/score/calculator.ts` 無変更
- [x] フェーズ1 (ダッシュボード) を壊さない (byCategory 追加のみ)
- [x] サンプル不足対応 (3段フォールバック + unknown fallback)
- [x] 類似レース 0件でもエラーにならない (unknown 分岐)

## 9. 品質

- `pnpm exec tsc --noEmit`: エラー 0
- `pnpm exec next lint`: 既存 warning 1件のみ (今回変更由来ではない)

## 10. フェーズ3 (戦略透明化) への準備

- `calculateReliability` の戻り値 `conditions` / `granularity` を活用し、ダッシュボードの `StrategyInfoCard` を拡張して「このクラス除外の根拠 ROI」を表示可能
- `byCategory.tight` キーに対して 券種別 ROI (umatan/wide) も追加すれば、戦略透明化で完全な情報セットに
- `ReliabilityCard` を拡張モード (詳細ボタンで展開) にすれば、フェーズ3 が同じファイル内で完結可

## 11. 動作確認方法 (ユーザー側)

```bash
pnpm build-dashboard  # public/dashboard-data.json 再生成
pnpm dev
# ブラウザで任意のレースを開く
# Section 5A「馬券推奨」の冒頭に 🟢/🟡/🟠/🔴/🚫 のバッジ付き信頼度カードが 3行で表示される
# iPhone SE (375px) でも破綻しないこと
```
