// ==========================================
// スコア・期待値計算ロジック
// 設計思想・健全性チェック仕様は lib/score/CLAUDE.md を参照
// ==========================================

import type { Horse, Race, BetType } from '../scraper/types';

// ==========================================
// 定数
// ==========================================

/** 各指標の重み（合計が必ず 1.0 になること） */
const WEIGHTS = {
  lastThreeF:   0.25,  // 上がり3F（前走または調教）
  training:     0.20,  // 調教ラスト1F
  courseRecord: 0.20,  // 同コース成績（Phase 1-C では暫定値）
  prevClass:    0.15,  // 前走クラス（Phase 1-C では暫定値）
  weightChange: 0.10,  // 馬体重増減
  jockey:       0.10,  // 騎手評価（Phase 1-C では暫定値）
} as const;

// 重みの合計チェック（ビルド時に検出できるよう即時評価）
const _WEIGHTS_SUM = Object.values(WEIGHTS).reduce((s, v) => s + v, 0);
if (Math.abs(_WEIGHTS_SUM - 1.0) > 1e-9) {
  throw new Error(`[calculator] WEIGHTSの合計が1.0ではありません: ${_WEIGHTS_SUM}`);
}

/** 期待値補正係数（lib/score/CLAUDE.md の制約: 0.3超禁止） */
const CORRECTION_FACTOR = 0.2;
const MAX_CORRECTION = 0.20;

// ==========================================
// ユーティリティ
// ==========================================

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * 値の配列を受け取り、各要素を「レース内順位に基づく 0〜100 スコア」に変換する
 * @param values 各馬の指標値（小さいほど高得点 = ascending=true）
 * @param ascending true のとき値が小さいほど高得点（タイム系）
 */
function rankScore(values: number[], ascending: boolean): number[] {
  const n = values.length;
  if (n === 1) return [100];

  // インデックス付きでソート
  const indexed = values.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => (ascending ? a.v - b.v : b.v - a.v));

  const scores = new Array<number>(n);
  indexed.forEach(({ i }, rank) => {
    // rank 0（最良）= 100、rank n-1（最下位）= 0
    scores[i] = clamp(((n - 1 - rank) / (n - 1)) * 100, 0, 100);
  });
  return scores;
}

// ==========================================
// 各指標スコア計算
// ==========================================

/**
 * 上がり3F スコア（0〜100）
 * lastThreeF を使用。値が小さいほど高得点（速いほど良い）。
 * Phase 1-C では前走上がり3F と調教ラスト1F が同一フィールドのため兼用。
 */
function scoreLastThreeF(allHorses: Horse[]): number[] {
  const values = allHorses.map((h) => (h.lastThreeF > 0 ? h.lastThreeF : 99));
  return rankScore(values, true);
}

/**
 * 調教ラスト1F スコア（0〜100）
 * Phase 1-C では lastThreeF をそのまま使用（同フィールド）。
 * Phase 1-B 以降で調教専用フィールドが追加されたら差し替える。
 */
function scoreTraining(allHorses: Horse[]): number[] {
  return scoreLastThreeF(allHorses);
}

/**
 * 馬体重増減スコア（0〜100）
 * 増減が少ないほど高得点（±0 = 100）
 */
function scoreWeightChange(horse: Horse): number {
  const abs = Math.abs(horse.weightDiff);
  if (abs === 0) return 100;
  if (abs <= 2) return 95;
  if (abs <= 4) return 85;
  if (abs <= 6) return 70;
  if (abs <= 8) return 50;
  return 30;
}

/**
 * 同コース成績スコア（0〜100）
 * Phase 1-C: 未実装のため中立値 50 を返す。
 * Phase 1-D 以降で Horse 型に courseWinRate / coursePlaceRate が追加されたら実装。
 */
function scoreCourseRecord(_horse: Horse): number {
  // TODO: Phase 1-D で実装
  // return horse.courseWinRate * 50 + horse.coursePlaceRate * 50;
  return 50;
}

/**
 * 前走クラススコア（0〜100）
 * Phase 1-C: 未実装のため中立値 50 を返す。
 * Phase 1-D 以降で Horse 型に prevClass が追加されたら実装。
 */
function scorePrevClass(_horse: Horse): number {
  // TODO: Phase 1-D で実装
  // const map = { G1: 100, G2: 85, G3: 70, OP: 55, '1勝': 40, '未勝利': 20 };
  // return map[horse.prevClass] ?? 50;
  return 50;
}

/**
 * 騎手評価スコア（0〜100）
 * jockeyRates（騎手名→当年勝率）をレース内で正規化して返す。
 * jockeyRates が空の場合は中立値 50 を返す（データ未取得時のフォールバック）。
 *
 * 正規化: レース内最低勝率=0, 最高勝率=100 として線形補間（normalizeWithinRace）
 */
function scoreJockeyFromRates(allHorses: Horse[], jockeyRates: Map<string, number>): number[] {
  if (jockeyRates.size === 0) return allHorses.map(() => 50);

  // 0%除外した勝率でレース内平均を計算（外国人・短期免許騎手のフォールバック用）
  const knownRates = allHorses
    .map((h) => jockeyRates.get(h.jockey) ?? 0)
    .filter((r) => r > 0);
  const raceAvgRate = knownRates.length > 0 ? mean(knownRates) : 0;

  // 勝率が取得できなかった騎手（0%）はレース内平均で代替する
  const values = allHorses.map((h) => {
    const rate = jockeyRates.get(h.jockey) ?? 0;
    if (rate === 0 && raceAvgRate > 0) {
      console.log(
        `[score] 騎手 ${h.jockey}: 勝率 0% → 平均値 ${(raceAvgRate * 100).toFixed(1)}% で代替`
      );
      return raceAvgRate;
    }
    return rate;
  });

  const scores = normalizeWithinRace(values);

  // 騎手ごとの勝率とスコアをログ出力（確定モードのデバッグ用）
  allHorses.forEach((h, i) => {
    const rate = values[i];
    console.log(
      `[score] 騎手 ${h.jockey}: 勝率 ${(rate * 100).toFixed(1)}% → 騎手スコア ${scores[i].toFixed(0)}`
    );
  });

  return scores;
}

// ==========================================
// スコア計算（メイン）
// ==========================================

/**
 * 1頭分の総合スコアを計算して返す（0〜100）
 * @param horse 対象馬
 * @param allHorses 全出走馬（相対評価のために必要）
 * @param threeFScores 上がり3F の事前計算済みスコア配列（インデックス = allHorses の順）
 * @param trainingScores 調教の事前計算済みスコア配列
 * @param jockeyScores 騎手評価の事前計算済みスコア配列（normalizeWithinRace 済み）
 */
function calcScoreInternal(
  horse: Horse,
  allHorses: Horse[],
  threeFScores: number[],
  trainingScores: number[],
  jockeyScores: number[],
): number {
  const idx = allHorses.findIndex((h) => h.id === horse.id);

  const s = {
    lastThreeF:   idx >= 0 ? threeFScores[idx] : 50,
    training:     idx >= 0 ? trainingScores[idx] : 50,
    courseRecord: scoreCourseRecord(horse),
    prevClass:    scorePrevClass(horse),
    weightChange: scoreWeightChange(horse),
    jockey:       idx >= 0 ? jockeyScores[idx] : 50,
  };

  const total =
    s.lastThreeF   * WEIGHTS.lastThreeF   +
    s.training     * WEIGHTS.training     +
    s.courseRecord * WEIGHTS.courseRecord +
    s.prevClass    * WEIGHTS.prevClass    +
    s.weightChange * WEIGHTS.weightChange +
    s.jockey       * WEIGHTS.jockey;

  return clamp(total, 0, 100);
}

/**
 * 1頭分のスコアを計算して返す（0〜100）
 * @param horse 対象馬
 * @param allHorses 全出走馬（相対評価のために必要）
 * @param jockeyRates 騎手名 → 当年勝率（省略時は全馬50の中立値）
 */
export function calcScore(
  horse: Horse,
  allHorses: Horse[],
  jockeyRates: Map<string, number> = new Map(),
): number {
  const threeFScores   = scoreLastThreeF(allHorses);
  const trainingScores = scoreTraining(allHorses);
  const jockeyScores   = scoreJockeyFromRates(allHorses, jockeyRates);
  return calcScoreInternal(horse, allHorses, threeFScores, trainingScores, jockeyScores);
}

/**
 * 全馬のスコアと単勝EVを計算して Race オブジェクトに付与して返す
 * @param race スコア未計算の Race オブジェクト
 * @param jockeyRates 騎手名 → 当年勝率（route.ts で fetchRacePersonStats から取得）
 */
export function calcAllScores(race: Race, jockeyRates: Map<string, number> = new Map()): Race {
  const allHorses = race.horses;

  // 相対評価スコアは全馬まとめて計算（ループ内で毎回計算しないよう最適化）
  const threeFScores   = scoreLastThreeF(allHorses);
  const trainingScores = scoreTraining(allHorses);
  const jockeyScores   = scoreJockeyFromRates(allHorses, jockeyRates);

  const scored = allHorses.map((horse) => {
    const score = calcScoreInternal(horse, allHorses, threeFScores, trainingScores, jockeyScores);
    return { ...horse, score };
  });

  // EV計算には全馬のスコアが必要なため2パス目で計算
  const horses: Horse[] = scored.map((horse) => {
    const ev = calcEV(horse, horse.odds, 'tan', scored);
    return { ...horse, ev };
  });

  return { ...race, horses };
}

// ==========================================
// 期待値計算
// ==========================================

/**
 * 市場確率を補正した調整確率を返す
 *
 * mktProb = 1 / horse.odds（正規化なし）
 * スコアの偏差で ±MAX_CORRECTION の範囲内で補正する。
 * → 市場が完全効率的なとき単勝EV中央値 ≈ 1.0 前後になる。
 *
 * @param horse 対象馬（score が付与済みであること）
 * @param allHorses 全出走馬（score 付与済み・AVG_SCORE 計算に使用）
 */
/**
 * オッズ帯別の補正ウェイト
 *
 * 大穴馬ほどスコア補正の効果を弱め、EV が過大評価されないようにする。
 *   人気馬(〜5倍)    : 1.00  フル補正
 *   中人気(〜10倍)   : 0.80
 *   中穴 (〜20倍)    : 0.50
 *   穴 (〜50倍)      : 0.20
 *   大穴 (50倍超)    : 0.05  ほぼ補正なし
 *
 * 背景: 108レースのバックテストで EV≥1.0 判定の 51% が大穴(20倍〜)だが
 *       実勝率は 1.6% しかなく、「EV≥1.0」フィルタが機能していなかった。
 *       市場確率 1/200 (=0.5%) をスコア補正で +20% しても 0.6% にしかならないのに
 *       0.6% × 200 = 1.2 と見かけ上高EVになる構造を緩和する。
 */
function getOddsWeight(odds: number): number {
  if (odds <= 5)  return 1.00;
  if (odds <= 10) return 0.80;
  if (odds <= 20) return 0.50;
  if (odds <= 50) return 0.20;
  return 0.05;
}

export function calcAdjProb(horse: Horse, allHorses: Horse[]): number {
  if (horse.odds <= 0) return 0;

  const mktProb = 1 / horse.odds; // 市場確率（スペック通り正規化なし）

  const scores = allHorses.map((h) => h.score ?? 50);
  const avg    = mean(scores);

  if (avg === 0) return mktProb;

  const deviation  = ((horse.score ?? 50) - avg) / avg;
  const oddsWeight = getOddsWeight(horse.odds);
  const corr       = clamp(
    deviation * CORRECTION_FACTOR * oddsWeight,
    -MAX_CORRECTION,
    MAX_CORRECTION,
  );
  return mktProb * (1 + corr);
}

/**
 * 券種別の長期期待値を返す（単馬用）
 * @param horse 対象馬（score 付与済み）
 * @param oddsForType その券種のオッズ
 * @param type 券種
 * @param allHorses 全出走馬（score 付与済み）
 */
export function calcEV(
  horse: Horse,
  oddsForType: number,
  type: BetType,
  allHorses: Horse[],
): number {
  if (oddsForType <= 0) return 0;

  const adjProb = calcAdjProb(horse, allHorses);

  // 複勝のみ確率を 3倍補正（3着以内に来る確率 ≈ 単勝確率×3 の近似）
  if (type === 'fuku') {
    return Math.min(adjProb * 3, 0.95) * oddsForType;
  }

  return adjProb * oddsForType;
}

/**
 * 馬単の条件付き確率を計算する
 * P(h1が1着 → h2が2着)
 *
 * = P(h1が1着)
 * × P(h2が2着 | h1が1着)  ← h1を除いた残り馬での確率
 *
 * これにより同じ2頭でも着順が異なればEVが変わる（スコア上位が1着に来やすい前提）
 */
function calcUmatanProb(
  h1: Horse,
  h2: Horse,
  allHorses: Horse[],
): number {
  const probMap = new Map(allHorses.map((h) => [h.id, calcAdjProb(h, allHorses)]));

  const p1 = probMap.get(h1.id) ?? 0;

  // h1が抜けた後の残り確率の合計で正規化
  const sumWithout1 = allHorses
    .filter((h) => h.id !== h1.id)
    .reduce((s, h) => s + (probMap.get(h.id) ?? 0), 0);
  const p2given1 = sumWithout1 > 0 ? (probMap.get(h2.id) ?? 0) / sumWithout1 : 0;

  return p1 * p2given1;
}

/**
 * 三連単の条件付き確率を計算する
 * P(h1が1着 → h2が2着 → h3が3着)
 *
 * = P(h1が1着)
 * × P(h2が2着 | h1が1着)   ← h1を除いた残り馬での確率
 * × P(h3が3着 | h1,h2確定)  ← h1,h2を除いた残り馬での確率
 *
 * これにより同じ3頭でも着順が異なればEVが変わる（スコア上位が上位着順に来やすい前提）
 */
function calcSantanProb(
  h1: Horse,
  h2: Horse,
  h3: Horse,
  allHorses: Horse[],
): number {
  const probMap = new Map(allHorses.map((h) => [h.id, calcAdjProb(h, allHorses)]));

  const p1 = probMap.get(h1.id) ?? 0;

  // h1が抜けた後の残り確率の合計で正規化
  const sumWithout1 = allHorses
    .filter((h) => h.id !== h1.id)
    .reduce((s, h) => s + (probMap.get(h.id) ?? 0), 0);
  const p2given1 = sumWithout1 > 0 ? (probMap.get(h2.id) ?? 0) / sumWithout1 : 0;

  // h1・h2が抜けた後の残り確率の合計で正規化
  const sumWithout12 = allHorses
    .filter((h) => h.id !== h1.id && h.id !== h2.id)
    .reduce((s, h) => s + (probMap.get(h.id) ?? 0), 0);
  const p3given12 = sumWithout12 > 0 ? (probMap.get(h3.id) ?? 0) / sumWithout12 : 0;

  return p1 * p2given1 * p3given12;
}

/**
 * 複数馬の組み合わせ期待値を返す
 * @param horses 対象馬リスト（score 付与済み）
 * @param oddsVal その組み合わせのオッズ
 * @param type 券種
 * @param allHorses 全出走馬（score 付与済み）
 */
export function calcComboEV(
  horses: Horse[],
  oddsVal: number,
  type: BetType,
  allHorses: Horse[],
): number {
  if (oddsVal <= 0 || horses.length === 0) return 0;

  const probs = horses.map((h) => calcAdjProb(h, allHorses));

  let combinedProb: number;
  switch (type) {
    case 'umaren':
    case 'wide':
      // 2頭・順不同
      combinedProb = probs[0] * (probs[1] ?? 0) * 2;
      break;
    case 'umatan':
      // 条件付き確率: P(h1→h2) = P(h1) × P(h2|h1)
      // 同じ2頭でも着順によってEVが異なる
      if (horses[0] && horses[1]) {
        combinedProb = calcUmatanProb(horses[0], horses[1], allHorses);
      } else {
        combinedProb = 0;
      }
      break;
    case 'sanfuku':
      // 3頭・順不同
      combinedProb = probs[0] * (probs[1] ?? 0) * (probs[2] ?? 0) * 6;
      break;
    case 'santan':
      // 条件付き確率: P(h1→h2→h3) = P(h1) × P(h2|h1) × P(h3|h1,h2)
      // 同じ3頭でも着順によってEVが異なる
      if (horses[0] && horses[1] && horses[2]) {
        combinedProb = calcSantanProb(horses[0], horses[1], horses[2], allHorses);
      } else {
        combinedProb = 0;
      }
      break;
    case 'waku':
      // 枠連は馬連と同じ扱い
      combinedProb = probs[0] * (probs[1] ?? 0) * 2;
      break;
    default:
      // 単勝・複勝は1頭のみ
      combinedProb = probs[0];
  }

  return combinedProb * oddsVal;
}

// ==========================================
// 仮予想モード専用スコア計算
// ==========================================

/**
 * 値の配列をレース内の最小・最大で 0〜100 に正規化する
 * 全馬が同値のときは一律 50 を返す
 */
function normalizeWithinRace(values: number[]): number[] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return values.map(() => 50);
  return values.map((v) => ((v - min) / (max - min)) * 100);
}

/**
 * 仮予想モード（pre-entry）専用のスコア計算
 *
 * 仮予想モードでは馬体重・調教・上がり3Fが取得できないため、
 * 騎手勝率50% + 調教師勝率50% のシンプルな構成でスコアを算出する。
 * オッズはスコアに使わず、EV計算のみに使用する（有無両対応）。
 *
 * @param race         fetchPreEntry が返した Race（mode='pre-entry'）
 * @param jockeyRates  騎手名 → 当年勝率（0.0〜1.0）
 * @param trainerRates 調教師名 → 当年勝率（0.0〜1.0）
 */
export function calcPreEntryScores(
  race: Race,
  jockeyRates: Map<string, number>,
  trainerRates: Map<string, number>,
): Race {
  const horses = race.horses;

  // 騎手・調教師の勝率を取得（未取得は 0 → 正規化後は最低スコア）
  const jockeyValues  = horses.map((h) => jockeyRates.get(h.jockey)  ?? 0);
  const trainerValues = horses.map((h) => trainerRates.get(h.trainer) ?? 0);

  // レース内で 0〜100 に正規化
  const jockeyScores  = normalizeWithinRace(jockeyValues);
  const trainerScores = normalizeWithinRace(trainerValues);

  // 騎手50% + 調教師50% = 総合スコア（重みの合計 = 1.0）
  const scoredHorses = horses.map((horse, i) => {
    const score = clamp(jockeyScores[i] * 0.5 + trainerScores[i] * 0.5, 0, 100);
    console.log(
      `[pre-entry score] ${horse.name}: 騎手 ${horse.jockey} 勝率 ${(jockeyValues[i] * 100).toFixed(1)}% / ` +
      `調教師 ${horse.trainer} 勝率 ${(trainerValues[i] * 100).toFixed(1)}% → スコア ${score.toFixed(0)}`
    );
    return { ...horse, score };
  });

  // EV計算（オッズがある馬のみ有効、ない馬は 0）
  const finalHorses: Horse[] = scoredHorses.map((horse) => ({
    ...horse,
    ev: calcEV(horse, horse.odds, 'tan', scoredHorses),
  }));

  return { ...race, horses: finalHorses };
}

// ==========================================
// 健全性チェック
// ==========================================

/**
 * 計算結果が合理的な範囲に収まっているか検証する
 * 問題がある場合はコンソールにエラーを出力する
 * @returns 全チェックを通過したら true
 */
export function validateScores(horses: Horse[]): boolean {
  let ok = true;

  // 1. 全馬スコアが 0〜100 に収まる
  const outOfRange = horses.filter(
    (h) => (h.score ?? -1) < 0 || (h.score ?? 101) > 100
  );
  if (outOfRange.length > 0) {
    console.error(
      `[calculator] スコア範囲外: ${outOfRange.map((h) => `${h.id}番(${h.score})`).join(', ')}`
    );
    ok = false;
  } else {
    console.log('[calculator] ✓ 全馬のスコアが 0〜100 の範囲に収まっています');
  }

  // 2. EVの中央値が 0.85〜1.10（正規化なし・市場効率性の妥当性）
  const evList = horses.map((h) => h.ev ?? 0).filter((v) => v > 0);
  if (evList.length > 0) {
    const med = median(evList);
    if (med < 0.85 || med > 1.10) {
      console.error(`[calculator] EV中央値が想定外: ${med.toFixed(3)}（期待値: 0.85〜1.10）`);
      ok = false;
    } else {
      console.log(`[calculator] ✓ EV中央値: ${med.toFixed(3)}（正常範囲 0.85〜1.10）`);
    }
  }

  // 3. 人気薄（30倍超）のEV平均が 0.9 を超えない
  const longshots = horses.filter((h) => h.odds > 30 && (h.ev ?? 0) > 0);
  if (longshots.length > 0) {
    const avgEV = mean(longshots.map((h) => h.ev ?? 0));
    if (avgEV >= 0.9) {
      console.error(
        `[calculator] 人気薄のEV平均が高すぎます: ${avgEV.toFixed(3)}（上限: 0.90）`
      );
      ok = false;
    } else {
      console.log(`[calculator] ✓ 人気薄（30倍超）平均EV: ${avgEV.toFixed(3)}（0.90未満）`);
    }
  }

  return ok;
}

// ==========================================
// 後方互換ラッパー（route.ts から呼ばれる）
// ==========================================

/**
 * 全馬のスコアを計算して付与した馬リストを返す（route.ts との互換）
 * 注意: Race 全体のコンテキストがないため EV は計算できない。
 *       Route 側で calcAllScores を使うことを推奨。
 */
export function calculateScores(horses: Horse[]): Horse[] {
  const threeFScores   = scoreLastThreeF(horses);
  const trainingScores = scoreTraining(horses);
  const jockeyScores   = scoreJockeyFromRates(horses, new Map()); // jockeyRates なし → 全馬50
  return horses.map((horse) => ({
    ...horse,
    score: calcScoreInternal(horse, horses, threeFScores, trainingScores, jockeyScores),
  }));
}

// ==========================================
// 統計ユーティリティ（テストスクリプト等で使用）
// ==========================================
export { mean, median };
