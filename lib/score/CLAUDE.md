# スコア・期待値計算仕様

## 設計思想

このモジュールの中心思想:
**スコアはオッズを全否定せず、市場が見落としている優位性だけを補正する。**

オッズ自体がすでに市場参加者の集合知による確率推定を内包している。
スコアはその確率を小さく上方・下方修正するためだけに使う。

---

## スコア計算式

### 各指標の重みと計算方法

| 指標           | 重み | 計算方法                                              |
|----------------|------|-------------------------------------------------------|
| 上がり3F       | 25%  | レース内順位を線形スケール（1位=100、最下位=0）       |
| 調教ラスト1F   | 20%  | レース内順位を線形スケール（速いほど高得点）          |
| 同コース成績   | 20%  | 勝率×50 + 連対率×50                                  |
| 前走クラス     | 15%  | G1=100, G2=85, G3=70, OP=55, 1勝=40, 未勝利=20      |
| 馬体重増減     | 10%  | ±0=100, ±2=95, ±4=85, ±6=70, ±8=50, それ以上=30   |
| 騎手評価       | 10%  | レース内リーディング順位を線形スケール                |

**重みの合計は必ず1.0にすること。変更時はここを更新する。**

### 総合スコア
```typescript
const WEIGHTS = {
  lastThreeF:    0.25,
  training:      0.20,
  courseRecord:  0.20,
  prevClass:     0.15,
  weightChange:  0.10,
  jockey:        0.10,
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
