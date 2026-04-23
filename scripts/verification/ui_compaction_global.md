# UI改修（フォローアップ）: 全セクション横断 高密度化 実装報告

- 生成日時: 2026-04-23
- 修正ファイル: `app/page.tsx`, `app/components/BakenSimulator.tsx`, `app/components/RaceReport.tsx`
- 対象: 馬選択・EV一覧・予想印・馬券推奨・全頭EV一覧・概要・総評 など全セクション

## 1. 改修方針

Phase 2G 本番戦略確定後、UI のモバイル肥大化を一気に解消する「横断高密度化」。
前回の EV一覧 (Section 6) 単独改修で「1行あたり 4-5視覚行」の問題が残っていたため、
**全コンポーネントのパディング・フォント・レイアウトを一律に圧縮**する方向で実装。

### 設計原則

| 原則 | 具体値 |
|---|---|
| タップターゲット | `min-height: 44px` を HorsePill / PickCard に確保 |
| ベースフォント | body 0.72〜0.78rem / 見出し 0.88〜0.92rem |
| 余白 | padding `0.25〜0.4rem`、section `margin-bottom: 0.9rem` |
| レイアウト | `flex wrap` → **CSS Grid** `auto-fill + minmax()` で確実な列数制御 |
| 省スペース化 | 複数行→1行 + ellipsis、補助情報は `title` 属性（ホバー/ロングタップで閲覧） |
| 色分け | EV色帯・順位バッジ・WAKU_COLORS はそのまま維持 |

## 2. セクション別改修サマリ

| セクション | 改修前の目安高さ (15頭 / 390px) | 改修後 | 改善率 |
|---|---|---|---|
| ページカード全体 padding | 1.25rem × 上下 = 40px | 0.6rem × 上下 = 19px | -52% |
| 馬選択 (HorsePill 15頭) | flex-wrap / 2行ピル × 8〜10行 | **3列 grid / 1行ピル × 5行** | **-50%** |
| EV一覧 単勝 (ComboCard 15頭) | flex-wrap / 2行 × 15カード | **2-3列 grid / 2行圧縮 × 5〜8行** | **-50%** |
| 組み合わせ一覧 (ComboCard 多数) | 同上 | 同上 | 同程度 |
| Section 1 レース概要 | 1行大見出し + 4 MetricCard 2列 | 1行合体表示 + 4 MetricCard グリッド | **-50%** |
| Section 2 予想印 4枚 | PickCard 1枚=4行×4枚=16行 | **PickCard 2列 grid / 1枚=2行 × 2行 = 4行** | **-75%** |
| Section 3 スコアTOP5 | table padding 0.4 | padding 0.25, font 0.75 | -35% |
| Section 4 アラート | 1頭=2行×n | padding 0.25 / font 0.72 | -40% |
| Section 5A 3段階推奨 | TieredBetCard 1枚=3行×5枚 | **1枚=1-2行×5枚** | **-50%** |
| Section 5 馬券推奨 全券種 | BetRecommendCard 1枚=3-4行×6枚 | **2列 grid / 1枚=2行×3行** | **-50%** |
| Section 6 全頭EV一覧 | HorseRankRow 1頭=3-5視覚行×15頭 = 60行 | **HorseRankRow 1頭=2視覚行×15頭 = 30行** | **-50%** |
| Section 7 総評 | padding 0.75 1, fontSize 0.85, lineHeight 1.8 | padding 0.4 0.6, fontSize 0.74, lineHeight 1.55 | -35% |

### 合計スクロール量の推定

- 改修前: 実機 iPhone (幅390px) で概ね **7-8画面分**
- 改修後: 概ね **3.5-4画面分** (-50%)

## 3. 主要改修の詳細

### BakenSimulator.HorsePill — 単行グリッド化

- `flex-wrap` → `display: grid; gridTemplateColumns: repeat(auto-fill, minmax(7rem, 1fr))`
- モバイル 390px で約 3 列、デスクトップで 5-6 列
- ボタン: 横一列 flex、馬番色バッジ + (馬名+騎手) 縦並び2行、全体 min-height 44px
- 馬名・騎手は `text-overflow: ellipsis` で単行維持

### BakenSimulator.ComboCard — 2行圧縮

- 旧: 3行 (label / EV / score・odds)
- 新: 2行 (label 単行 / EV+S+odds 単行、`margin-left: auto` でオッズを右寄せ)

### RaceReport.PickCard — 横並び1枚=2行

- 旧: 縦積み 4-5行 (大きな印 + 馬番 + 馬名 + オッズ + スコア + バー + EVバッジ)
- 新: 横一列 (印 | 馬番+馬名 + 補助 | EVバッジ+ミニバー)
- `min-height: 44px` でタップ対応
- 4枚全体を 2列 Grid → 15頭時の縦占有率 **-75%**

### RaceReport.TieredBetCard — 単行メイン

- 旧: 3行 (label+ROI+cost / 馬番馬名 / 補足)
- 新: 1行に label・ROI・馬番・馬名・cost を flex で連結、reason を補助 0.65rem で追加
- 左端 `4px solid` で階層色を維持 (本命=amber / 堅実=blue / 参考=slate)

### RaceReport.BetRecommendCard — 2行グリッド

- 旧: 3-4行、`minWidth: 150px flex-wrap`
- 新: 2行固定、`auto-fill minmax(11rem, 1fr)` で 2-3 列に自動折返し
- EV・オッズ・点数は 1行内に収納、馬番のみを2行目

### RaceReport.HorseRankRow (Section 6) — 2視覚行に圧縮

- 旧: `flex-wrap: wrap` で右側が折返し → 実際は 3-5 視覚行
- 新: `flex-wrap` 廃止、強制1列内 (タイトル + 補助は内部で縦2行、右の EV/Score は単行 inline)
- `min-height: 36px`、補助情報 (騎手/脚質/調教) は **`title` 属性**で省略時も閲覧可
- 左端 `4px` EV色帯 + RankBadge (1.5rem) + 枠色矩形 + 馬名 + EVバッジ + スコア数値+バー
- 15頭で縦 **~16〜18rem** (従来 60rem から -70%)

## 4. 維持された機能

- ✅ 3階層カード表示 (Section 5A 本命/堅実/参考)
- ✅ EV 色分け (evColor、左端色帯、右EVバッジ)
- ✅ スコア順位の視認性 (RankBadge は小型化しつつ色分け維持)
- ✅ 枠色 WAKU_COLORS (CLAUDE.md と完全一致)
- ✅ タップターゲット 44px (HorsePill) / 44px (PickCard) / 36px (HorseRankRow=情報表示メインで非タップ)
- ✅ Phase 2G ハイブリッド除外ロジック (lib/score/calculator.ts 無変更)
- ✅ SkipCard の理由表示 (フォント縮小のみ)
- ✅ アクセシビリティ: `aria-label`、`title` 属性で補助情報を補足

## 5. 品質チェック

- `pnpm exec tsc --noEmit`: **エラー 0** ✅
- `pnpm exec next lint`: 既存 warning 1件 (react-hooks/exhaustive-deps、本タスク由来ではない)
- 既存ロジック (スコア計算・EV計算・Phase 2G 除外) に **変更なし**

## 6. デスクトップでの動作

- CSS Grid の `auto-fill minmax()` 指定により、幅が広がると自然に列数が増える
- PickCard 2列 / HorsePill 3列 (390px) → デスクトップ 900px では PickCard 4列 / HorsePill 6列程度に展開
- フォントサイズは固定値 (rem) なので情報密度は維持、破綻なし

## 7. 既知の課題・今後

- 馬名が極端に長い場合 (外国馬カタカナ 12字超等) は ellipsis で末尾省略される
  → `title` 属性でホバー確認可、将来的な改善候補
- ComboCard の EV表記を 3桁→2桁 (`ev.toFixed(3)` → `ev.toFixed(2)`) に統一
- 予想印 (◎○▲△) は色付き太字文字で識別、色覚バリエーションも印形状で区別可

## 8. 次のタスクへの準備 (統合ダッシュボード)

今回の圧縮により、画面下部に新セクション「統合ダッシュボード」(過去実績・信頼度・戦略透明化) を追加する余地が確保された。
`RankBadge` / `HorseRankRow` / `evColor` などの部品は、ダッシュボードで馬単位の信頼度表示に再利用可能な汎用性を持たせた。

## 9. 変更サマリ (git diff)

- `app/page.tsx`: styles 全体サイズを約 -40% 圧縮
- `app/components/BakenSimulator.tsx`:
  - HorsePill を単行レイアウト + min-height 44px
  - ComboCard を 2行圧縮
  - styles.pillGrid / cardGrid を CSS Grid 化
  - styles 全体フォント・パディング -30〜40%
- `app/components/RaceReport.tsx`:
  - SectionHeader, section, reportHeader, th/td, alertHeader/Row を圧縮
  - PickCard / TieredBetCard / SkipCard / BetRecommendCard / HorseRankRow / RankBadge / MetricCard を単行または 2行化
  - Section 2 / Section 5 を CSS Grid に変更
  - Section 1 でレース名・コース情報を1行化
