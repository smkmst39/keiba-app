# レース選択画面「購入推奨馬券」ハイライト 実装報告

- 生成日時: 2026-04-23
- 配置: `app/components/RaceSchedule.tsx` の RaceItem
- データ源: `public/dashboard-data.json` の `byCategory.classOnly`

## 1. 実装内容

各レース行に以下を追加:
- **推奨レベル背景色**: 本命級=金 / 堅実級=水色 / 対象外=薄灰 / なし=通常
- **左 4px border** で推奨レベルを強調
- **先頭ラベル**: `本命級` / `堅実級` / `対象外` の極小バッジ
- **信頼度絵文字**: 🟢 🟡 🟠 🔴 🚫 ⚪ を右端に
- **凡例**: 一覧上部に色とバッジの意味を表示

## 2. 重要な設計判断: **クラス別過去実績による近似判定**

### 当初検討した per-race リアルタイム計算の問題

スケジュール行には raceName / grade / headCount しか無く、per-race 推奨判定には**全レースの出馬表を事前 fetch** する必要がある:

- 1日最大 36R (3会場 × 12R) × 2秒の scrape 間隔 = **約72秒** の待ち時間
- netkeiba のレート制限 / HTTP 400 ブロックリスク
- ユーザーが会場タブを切り替えるたびに再 fetch
- 月2000分の GitHub Actions 制約とは別に、ローカル/本番での実行コストが高い

### 採用したアプローチ: クラス別過去実績ベース

`scripts/build_dashboard_data.ts` で 3233R を **クラス単位で集計済み** の `byCategory.classOnly` を利用:

1. レース行の `raceName` + `grade` からクラス (G1/G2/G3/L/C1/C2/C3/UW/NW/OP/SP) を判定
2. `classOnly[classKey]` を引いて過去 ROI / 推奨R / CV を取得
3. 閾値判定でレベル決定

**トレードオフ**:
- ✅ 全レース瞬時 (追加 netkeiba アクセス 0)
- ✅ レート制限リスクなし
- ✅ モバイルで待ち時間なし
- ❌ per-race ではなく class 単位の「そのクラスで推奨が出やすいか」のヒント
  - 真の per-race 判定は、レース選択後の RaceReport で (フェーズ2 信頼度カード + Phase 2F 推奨判定) により実施

## 3. 推奨レベル判定ロジック

| 条件 | level | 背景色 | border | ラベル |
|---|---|---|---|---|
| classKey = C1 or C2 (Phase 2G 除外) | `excluded` | `#f8fafc` | `#94a3b8` | 対象外 |
| 過去 ROI ≥ 120% & 推奨R ≥ 50 | `honmei` | `#fffbeb` (金) | `#d97706` | 本命級 |
| 過去 ROI ≥ 100% & 推奨R ≥ 20 | `kenjitsu` | `#eff6ff` (水色) | `#2563eb` | 堅実級 |
| ROI<100% or R<20 | `none` | 透明 | 透明 | — |
| バケット欠損 | `unknown` | 透明 | 透明 | — |

## 4. 信頼度バッジ判定 (フェーズ2 と整合)

| 条件 | バッジ |
|---|---|
| excluded (C1/C2) | 🚫 |
| ROI≥120 & R≥50 & CV≤0.5 | 🟢 高 |
| ROI≥100 & R≥20 & CV≤1.0 | 🟡 中 |
| ROI≥100 (他条件弱) | 🟠 注意 |
| ROI<100 | 🔴 低 |
| データなし | ⚪ 不明 |

## 5. 3233R データでの判定結果予測

| クラス | 過去ROI | 推奨R | CV | 予想 level | バッジ |
|---|---|---|---|---|---|
| UW (未勝利) | 138.3% | 281 | 1.08 | honmei | 🟠 注意 (CV>1.0) |
| NW (新馬) | 70.3% | 118 | 1.30 | none | 🔴 |
| C1 | 0% | 0 | - | excluded | 🚫 |
| C2 | 0% | 0 | - | excluded | 🚫 |
| C3 | 85.4% | 48 | 1.88 | none | 🔴 |
| OP | 494.8% | 21 | - | honmei | 🟠 (CVデータ不足) |
| L | 0% | 26 | - | excluded? | 🚫/🔴 |
| G1 | 0% | 9 | - | unknown | ⚪ |
| G2 | 0% | 5 | - | unknown | ⚪ |
| G3 | 0% | 19 | - | unknown | ⚪ |

**実運用イメージ**: 未勝利・OP が金背景、C1/C2 が対象外薄灰、新馬/3勝が通常、G1-G3 は信頼度⚪ で強調なし。

## 6. UI 抑制設計

- 背景色は全て `*-50` 系の極薄
- 推奨ラベルは 0.58rem、padding 0.08 × 0.3
- 信頼度絵文字は 0.78rem
- 凡例は 0.62rem、目立たせないよう 1 行レイアウト
- 行全体のフォント・パディングを前回より更に圧縮 (font 0.88→0.82, padding 0.55→0.45)

## 7. データフロー

```
public/dashboard-data.json (byCategory.classOnly)
  ↓ fetch (RaceSchedule 初回マウント時のみ、以後モジュールキャッシュ)
classOnly state (Record<string, Bucket>)
  ↓ detectRaceListHint(raceName, grade, classOnly)
hint: RaceListHint
  ↓ RaceItem に渡す
背景色・左border・ラベル・絵文字を適用
```

## 8. 必達要件 チェック

- [x] レース選択画面で推奨レースが視覚的に強調される
- [x] 本命級・堅実級の2レベルで色分け (金/水色)
- [x] 信頼度バッジが別軸で絵文字表示
- [x] Phase 2G 除外クラス (C1/C2) が 🚫 対象外
- [x] 既存UIの高密度化を維持 (更にフォント圧縮)
- [x] モバイル対応 (flex-wrap + ellipsis)
- [x] `lib/score/calculator.ts` 無変更
- [x] フェーズ1/2 を壊さない (byCategory.classOnly は既に存在)
- [x] tsc エラー 0
- [x] 並行処理の複雑さなし (軽量 O(1) lookup)

## 9. 既存の per-race 判定との関係

| 画面 | 判定粒度 | 使用データ |
|---|---|---|
| **レース選択画面** (今回) | クラス単位の近似 | byCategory.classOnly |
| **RaceReport Section 5A** (フェーズ2) | 類似条件 (class×surface×band) | byCategory tight→medium→classOnly |
| **RaceReport Section 5A Phase 2F 推奨** (既存) | 実馬の EV/score で判定 | race.horses (実データ) |

階層化されているため、ユーザーは以下の流れで運用可能:
1. レース選択画面で「本命級・堅実級」バッジのあるレースを一次スクリーニング
2. 選択してレース詳細を開き、ReliabilityCard で類似条件別の信頼度確認
3. Section 5A で実際の馬券推奨 (Phase 2F 参加条件) を確認

## 10. 今後の拡張候補

- **オプトイン per-race 精密判定**: 「この開催日を事前判定」ボタンで全12R を順次 fetch + 真の EV 判定
  - concurrency=1、2秒 interval、venue 切替でキャンセル
  - 結果は localStorage に 1 日キャッシュ
- **頭数 × クラス** の 2 軸で細かく分類
- **馬場状態** が分かるタイミング (当日朝) では `byCategory.tight` を直接参照

## 11. 動作確認方法

```bash
pnpm build-dashboard   # 念のため再生成
pnpm dev
# http://localhost:3000 → レース選択
# 会場タブ切替で凡例と推奨ラベル/絵文字が表示される
# iPhone SE (375px) でも破綻しない
```
