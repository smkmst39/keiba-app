# スコア・期待値計算仕様

## 設計思想

このモジュールの中心思想:
**スコアはオッズを全否定せず、市場が見落としている優位性だけを補正する。**

オッズ自体がすでに市場参加者の集合知による確率推定を内包している。
スコアはその確率を小さく上方・下方修正するためだけに使う。

---

## スコア計算式

### 各指標の重みと計算方法

| 指標           | 重み  | 計算方法                                              |
|----------------|-------|-------------------------------------------------------|
| 上がり3F       | 24.4% | レース内順位を線形スケール（1位=100、最下位=0）       |
| 調教ラスト1F   | 12.5% | レース内順位を線形スケール（速いほど高得点）          |
| 同コース成績   | 19.8% | 勝率×50 + 連対率×50                                  |
| 前走クラス     | 14.6% | G1=100, G2=85, G3=70, OP=55, 1勝=40, 未勝利=20      |
| 血統適性       | 15.8% | 父馬の「当該コース×距離帯」連対率をレース内で正規化   |
| 馬体重増減     |  7.1% | ±0=100, ±2=95, ±4=85, ±6=70, ±8=50, それ以上=30   |
| 騎手評価       |  5.8% | レース内リーディング順位を線形スケール                |

**重みの合計は必ず1.0にすること。変更時はここを更新する。**

Phase 2E Stage 3 (930R × ランダムサンプリング500) の結果を反映した配分。
重み付き回収率 88.82% → **93.05%** (+4.23pt)、前後半差 6.3pt → 3.9pt (安定性も改善)。

### 総合スコア
```typescript
const WEIGHTS = {
  lastThreeF:    0.244,
  training:      0.125,
  courseRecord:  0.198,
  prevClass:     0.146,
  breeding:      0.158,
  weightChange:  0.071,
  jockey:        0.058,
} as const;
// Σweights === 1.0 を保証する

export function calcScore(horse: Horse, allHorses: Horse[]): number {
  // 各指標を0〜100に正規化してからweightを掛けて合計
  // 最終値を clamp(0, 100) する
}
```

---

## 期待値計算式（重要）

### 基本方針
前バージョンの問題:
- スコアをそのまま確率として使っていた → 大穴馬のEVが異常に高くなった
- 例: 2番マダックス（スコア22、単勝304.9倍）→ EV=8.2 という異常値

### 正しい計算式
```typescript
// ステップ1: 市場確率（オッズが確率推定の出発点）
const mktProb = 1 / horse.odds;

// ステップ2: スコア偏差で補正（±20%上限）
const avgScore = mean(allHorses.map(h => h.score));
const deviation = (horse.score - avgScore) / avgScore;
const CORRECTION_FACTOR = 0.2;  // ← この値を変えるときは必ずバックテストで検証
const MAX_CORRECTION = 0.20;
const corr = clamp(deviation * CORRECTION_FACTOR, -MAX_CORRECTION, MAX_CORRECTION);
const adjProb = mktProb * (1 + corr);

// ステップ3: 期待値
const ev = adjProb * horse.odds;
// JRA控除率はオッズに既に織り込まれているため別途計算不要
// 市場が完全効率的な場合、EVの理論値は0.72〜0.80になる
```

### 補正係数（CORRECTION_FACTOR）の根拠
- 現在値: 0.2
- 意味: スコアが平均より10%高い馬は確率を2%上方修正する
- 上限制約: 0.3超にすると大穴馬のEVが再び異常値になる
- 変更時: `scripts/backtest.ts` で過去50レース以上を検証してから変更する

### 組み合わせ馬券の確率
```typescript
// 馬連・ワイド（順不同2頭）
pCombo = adjProb(h1) * adjProb(h2) * 2

// 馬単（順あり2頭）
pCombo = adjProb(h1) * adjProb(h2)

// 三連複（順不同3頭）
pCombo = adjProb(h1) * adjProb(h2) * adjProb(h3) * 6

// 三連単（順あり3頭）
pCombo = adjProb(h1) * adjProb(h2) * adjProb(h3)
```

---

## 健全性チェック（毎回実行）

スコア・期待値を計算したあと、以下の条件を満たすか確認する:

```typescript
// 1. 全馬のスコアが 0〜100 に収まる
assert(horses.every(h => h.score >= 0 && h.score <= 100));

// 2. EVの中央値が 0.65〜0.85 の範囲（JRA控除率の妥当性）
assert(median(evList) >= 0.65 && median(evList) <= 0.85);

// 3. 人気薄（30倍超）のEV平均が 0.9 を超えない
assert(mean(longshots.map(h => h.ev)) < 0.9);
```

条件を満たさない場合は計算を止めてエラーログを出す。

---

## Phase 2H 暫定変更履歴

### 2026-05-09: lastThreeF / training の独立化

**変更前**: `scoreTraining` が `scoreLastThreeF` を素通しで呼ぶだけの実装で、
両関数が完全同一値を返していた。重み合計 `0.244 + 0.125 = 0.369` が
事実上1指標 (調教近似秒) に集中していた。

**変更後**:
- `scoreLastThreeF` は `horse.pastRaces[0].lastThreeF` (実走の前走上がり3F、
  典型値 33.0〜37.0 秒) を使う。courseRecord 実装で取得基盤が整ったため移行。
- `scoreTraining` は `Horse.lastThreeF` (調教ラスト1F の近似秒、11.0〜12.5)
  を直接 rankScore する独立関数になった。

両者は独立データソース (前走実走 vs 調教評価) を持つため、重み 0.244 と
0.125 が真に別指標として機能するようになった。

WEIGHTS 値は据え置き (0.244 / 0.125)。Phase 2E Stage 3 の最適配分は旧実装
前提で導出されたため、courseRecord と合わせて Phase 2H 本格チューニングで
再最適化する。

### 既知の負債: フィールド名と実態の乖離

`Horse.lastThreeF` というフィールド名は「前走上がり3F」を連想させるが、
実体は `fetchTraining` (oikiri.html) が `CRITIC_TO_SEC` テーブルで生成した
**調教ラスト1F の近似秒**。一方 `PastRace.lastThreeF` は
`/horse/result/{id}/` 由来の**実走上がり3F**で、こちらが本来の意味。

リネーム (`Horse.lastThreeF` → `Horse.trainingLastOneF` 等) は影響範囲が
広いため Phase 2H 範囲外。コード読解時は **どちらの lastThreeF を見ているか
コメントで明示する** ことで誤読を防ぐ。

### Phase 2H 本格チューニングのスコープ (TODO)

- WEIGHTS の再最適化 (courseRecord 実装後 + lastThreeF 独立化後の最適配分)
- `Horse.lastThreeF` のリネーム検討
- 健全性チェック基準の見直し (現在「人気薄EV平均 < 0.9」が pre-phase1 から
  常時 NG 出している既存問題)
