# アプローチ2 軸1: 騎手コース別勝率 検証レポート

- 生成日時: 2026-04-23T15:10:17.647Z
- 総 R数: **3233**, jockey 付き R数: **0**

## 判定: ケースγ (データ不足で検証未実施)

**2026-04-24 以前に収集された verification JSON には騎手名が保存されていない**ため、
3233R のうち騎手集計可能レースは **0R** にとどまり、時系列 CV 3 セットに必要な 600R に到達していません。

### 原因
`scripts/collect-verification.ts` の `predictions[]` が horseId/horseName/score/ev/odds/waku のみを保存しており、
`jockey` (騎手名) をドロップしていた。components.jockey として保存されているのは正規化済み 0〜100 スコアで、騎手識別不能。

### 修正済み
- `scripts/collect-verification.ts` の predictions に `jockey: h.jockey` を追加 (2026-04-24)
- 以降の週次スクレイプ (毎週火曜 08:00 JST) で jockey 付きデータが蓄積される

### 出揃うまでのロードマップ
- 週 100-200R × 約6週間 → 600-1200R に到達、時系列 CV 3 セット可能に
- それまでは 軸1 単独モデルの真の効果は不明

### 並行して可能なアクション
1. 軸2 (脚質・展開予想) の検討に進む — こちらも既存データで集計可能か先に確認
2. 3233R 一括再スクレイプを手動実行 (~5h の netkeiba 負荷) して即座に軸1 検証を行う
3. 週次蓄積を待ちつつ Phase 3 戦略透明化や note 記事執筆など別タスクへ

### 完成している機能
- `scripts/build_jockey_course_stats.ts` — 騎手 × コース × 芝ダ の集計 (jockey 付き JSON 蓄積後に有効)
- `lib/newAxis/jockey-course-score.ts` — 3 段階フォールバック付き新軸スコア関数
- `scripts/verify_jockey_course_axis.ts` — 時系列 CV 3 セットで新軸 vs Phase 2G 比較
- いずれもコード完成、jockey データ蓄積後に `pnpm tsx ...` で即実行可能

---
*再実行: `pnpm tsx scripts/verify_jockey_course_axis.ts`*