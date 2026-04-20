// ==========================================
// グリッドサーチ Stage 3: スコア重み配分の最適化
//
// 各 prediction に components (lastThreeF, training, courseRecord, prevClass,
// breeding, weightChange, jockey) が保存されている必要がある。
//
// アルゴリズム: ランダムサンプリング 500通り
//   1. 制約を満たす重み配分をランダム生成
//   2. 全 930R × 全馬 のスコアを線形和で再計算
//   3. 再計算した score から EV を計算 (Stage 1 の EV パラメータで)
//   4. 現行採択戦略 (Stage 2 結果) で全券種の ROI を集計
//   5. 前半/後半で独立に評価して安定性をチェック
//
// 評価指標:
//   券種別重み付き回収率 = 単勝25% + 複勝15% + 馬連25% + 馬単25% + ワイド10%
//   (三連系は Stage 2 で過学習懸念のため除外)
//   前後半差 10pt 以下のみ候補に採用
//
// 実行: pnpm tsx scripts/grid_search_stage3.ts
// 出力: scripts/verification/grid_search_stage3_report.md
// ==========================================

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { VerificationData } from '../lib/scraper/types';

const DIR = path.resolve(__dirname, 'verification');
const REPORT = path.join(DIR, 'grid_search_stage3_report.md');

// ----------------------------------------
// 定数
// ----------------------------------------

/** Stage 1 の本番値 (EV パラメータを固定) */
const EV_PARAMS = { cf: 0.20, offset: -0.02, max: 0.20 };

/** Stage 2 で採択した最適戦略 */
const FUKU_THRESHOLD    = 1.07;
const TAN_THRESHOLD     = 1.00;
const UMAREN_TOP_N      = 2;
const UMATAN_TOP_N      = 2;
const WIDE_TOP_N        = 2;

/** Stage 3 のサンプリング数 */
const NUM_SAMPLES = 500;

/** 目的関数の券種別重み (三連系は過学習懸念のため除外) */
const OBJECTIVE_WEIGHTS = { tan: 0.25, fuku: 0.15, umaren: 0.25, umatan: 0.25, wide: 0.10 } as const;

/** 安定性基準 (前後半差の上限) */
const STABILITY_THRESHOLD = 10;

/** 現行重み配分 */
const CURRENT_WEIGHTS = {
  lastThreeF:   0.22,
  training:     0.18,
  courseRecord: 0.18,
  prevClass:    0.13,
  breeding:     0.12,
  weightChange: 0.09,
  jockey:       0.08,
};

/** 各重みの探索範囲 */
const WEIGHT_RANGES = {
  lastThreeF:   [0.15, 0.30],
  training:     [0.12, 0.25],
  courseRecord: [0.10, 0.25],
  prevClass:    [0.08, 0.20],
  breeding:     [0.05, 0.18],
  weightChange: [0.05, 0.15],
  jockey:       [0.05, 0.15],
} as const;

type WeightKey = keyof typeof CURRENT_WEIGHTS;
type Weights = Record<WeightKey, number>;

// ----------------------------------------
// predictions に components が含まれるか確認するための型
// ----------------------------------------

type Components = {
  lastThreeF:   number;
  training:     number;
  courseRecord: number;
  prevClass:    number;
  breeding:     number;
  weightChange: number;
  jockey:       number;
};

type ExtendedPrediction = VerificationData['predictions'][number] & { components?: Components | null };

// ----------------------------------------
// ユーティリティ
// ----------------------------------------

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const mean  = (a: number[]): number => a.length === 0 ? 0 : a.reduce((s, x) => s + x, 0) / a.length;
const roi   = (c: number, p: number): number => c > 0 ? (p / c) * 100 : 0;
const pct   = (n: number, d: number): string => d === 0 ? 'N/A' : `${((n / d) * 100).toFixed(1)}%`;

function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [h, ...rest] = arr;
  return [...combinations(rest, k - 1).map((c) => [h, ...c]), ...combinations(rest, k)];
}
function permutations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  const r: T[][] = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const p of permutations(rest, k - 1)) r.push([arr[i], ...p]);
  }
  return r;
}
const sameSet = (a: number[], b: number[]): boolean =>
  a.length === b.length && [...a].sort((x, y) => x - y).join(',') === [...b].sort((x, y) => x - y).join(',');
const sameSeq = (a: number[], b: number[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

function getOddsWeight(odds: number): number {
  if (odds <= 5)  return 1.00;
  if (odds <= 10) return 0.80;
  if (odds <= 20) return 0.50;
  if (odds <= 50) return 0.20;
  return 0.05;
}

// ----------------------------------------
// 制約を満たす重みをランダム生成
// ----------------------------------------

function sampleWeights(): Weights | null {
  // 各重みをランダムに範囲内で選ぶ → 正規化
  const raw: Weights = {
    lastThreeF:   rand(WEIGHT_RANGES.lastThreeF),
    training:     rand(WEIGHT_RANGES.training),
    courseRecord: rand(WEIGHT_RANGES.courseRecord),
    prevClass:    rand(WEIGHT_RANGES.prevClass),
    breeding:     rand(WEIGHT_RANGES.breeding),
    weightChange: rand(WEIGHT_RANGES.weightChange),
    jockey:       rand(WEIGHT_RANGES.jockey),
  };
  const sum = Object.values(raw).reduce((s, v) => s + v, 0);
  // 正規化
  const normalized: Weights = {} as Weights;
  for (const k of Object.keys(raw) as WeightKey[]) normalized[k] = raw[k] / sum;
  // 正規化後に範囲外なら拒否
  for (const k of Object.keys(normalized) as WeightKey[]) {
    const [lo, hi] = WEIGHT_RANGES[k];
    if (normalized[k] < lo || normalized[k] > hi) return null;
  }
  return normalized;
}

function rand([lo, hi]: readonly [number, number]): number {
  return lo + Math.random() * (hi - lo);
}

// ----------------------------------------
// スコア再計算 & EV 再計算
// ----------------------------------------

function computeScore(c: Components, w: Weights): number {
  return clamp(
    c.lastThreeF   * w.lastThreeF   +
    c.training     * w.training     +
    c.courseRecord * w.courseRecord +
    c.prevClass    * w.prevClass    +
    c.breeding     * w.breeding     +
    c.weightChange * w.weightChange +
    c.jockey       * w.jockey,
    0, 100,
  );
}

type RecomputedPrediction = ExtendedPrediction & { newScore: number; newEV: number };

function recomputeRace(preds: ExtendedPrediction[], w: Weights): RecomputedPrediction[] {
  // まず新 score を計算
  const withScore = preds.map((p) => {
    const newScore = p.components ? computeScore(p.components, w) : p.score;
    return { ...p, newScore };
  });
  // EV 再計算: avgScore, deviation, corr, 1 + corr
  const validScores = withScore.filter((p) => p.odds > 0).map((p) => p.newScore);
  const avg = mean(validScores);
  if (avg === 0) return withScore.map((p) => ({ ...p, newEV: 0 }));

  return withScore.map((p) => {
    if (p.odds <= 0) return { ...p, newEV: 0 };
    const dev   = (p.newScore - avg) / avg;
    const oddsW = getOddsWeight(p.odds);
    const corr  = clamp(
      dev * EV_PARAMS.cf * oddsW + EV_PARAMS.offset,
      -EV_PARAMS.max, EV_PARAMS.max,
    );
    return { ...p, newEV: 1 + corr };
  });
}

// ----------------------------------------
// 戦略シミュレーション (Stage 2 最適戦略で固定)
// ----------------------------------------

type BetResult = { cost: number; payout: number; hit: boolean };

function simulate(vd: VerificationData, recalc: RecomputedPrediction[]): {
  tan: BetResult; fuku: BetResult; umaren: BetResult; umatan: BetResult; wide: BetResult;
} {
  const sorted = recalc.filter((p) => p.odds > 0).sort((a, b) => b.newEV - a.newEV);

  // 単勝: EV上位1頭、EV≥1.00 で参加
  const top1 = sorted[0];
  let tanCost = 0, tanPay = 0, tanHit = false;
  if (top1 && top1.newEV >= TAN_THRESHOLD) {
    tanCost = 100;
    const win = vd.results.payouts.tan.find((t) => t.horseId === top1.horseId);
    if (win) { tanHit = true; tanPay = win.payout; }
  }

  // 複勝: EV ≥ 1.07 のEV最上位、該当なしなら参加しない
  const fukuCand = sorted.find((p) => p.newEV >= FUKU_THRESHOLD);
  let fukuCost = 0, fukuPay = 0, fukuHit = false;
  if (fukuCand) {
    fukuCost = 100;
    const win = (vd.results.payouts.fuku ?? []).find((f) => f.horseId === fukuCand.horseId);
    if (win) { fukuHit = true; fukuPay = win.payout; }
  }

  // 馬連: EV 上位2頭 BOX
  const umarenPicks = sorted.slice(0, UMAREN_TOP_N);
  let umarenCost = 0, umarenPay = 0, umarenHit = false;
  if (umarenPicks.length >= 2) {
    const pairs = combinations(umarenPicks.map((p) => p.horseId), 2);
    umarenCost = pairs.length * 100;
    for (const pair of pairs) {
      for (const u of vd.results.payouts.umaren) {
        if (sameSet(pair, u.combination.split('-').map(Number))) { umarenHit = true; umarenPay += u.payout; break; }
      }
    }
  }

  // 馬単: EV 上位2頭 BOX (順列)
  const umatanPicks = sorted.slice(0, UMATAN_TOP_N);
  let umatanCost = 0, umatanPay = 0, umatanHit = false;
  if (umatanPicks.length >= 2) {
    const perms = permutations(umatanPicks.map((p) => p.horseId), 2);
    umatanCost = perms.length * 100;
    for (const perm of perms) {
      for (const u of vd.results.payouts.umatan ?? []) {
        if (sameSeq(perm, u.combination.split('-').map(Number))) { umatanHit = true; umatanPay += u.payout; break; }
      }
    }
  }

  // ワイド: EV 上位2頭 BOX
  const widePicks = sorted.slice(0, WIDE_TOP_N);
  let wideCost = 0, widePay = 0, wideHit = false;
  if (widePicks.length >= 2) {
    const pairs = combinations(widePicks.map((p) => p.horseId), 2);
    wideCost = pairs.length * 100;
    for (const pair of pairs) {
      for (const w of vd.results.payouts.wide ?? []) {
        if (sameSet(pair, w.combination.split('-').map(Number))) { wideHit = true; widePay += w.payout; break; }
      }
    }
  }

  return {
    tan:    { cost: tanCost, payout: tanPay, hit: tanHit },
    fuku:   { cost: fukuCost, payout: fukuPay, hit: fukuHit },
    umaren: { cost: umarenCost, payout: umarenPay, hit: umarenHit },
    umatan: { cost: umatanCost, payout: umatanPay, hit: umatanHit },
    wide:   { cost: wideCost, payout: widePay, hit: wideHit },
  };
}

type Totals = Record<keyof typeof OBJECTIVE_WEIGHTS, { cost: number; payout: number; hits: number; races: number }>;
const empty = (): Totals => ({
  tan:    { cost: 0, payout: 0, hits: 0, races: 0 },
  fuku:   { cost: 0, payout: 0, hits: 0, races: 0 },
  umaren: { cost: 0, payout: 0, hits: 0, races: 0 },
  umatan: { cost: 0, payout: 0, hits: 0, races: 0 },
  wide:   { cost: 0, payout: 0, hits: 0, races: 0 },
});

function aggregate(data: VerificationData[], w: Weights): Totals {
  const t = empty();
  for (const vd of data) {
    if (vd.predictions.length < 2 || vd.results.results.length === 0) continue;
    const recalc = recomputeRace(vd.predictions as ExtendedPrediction[], w);
    const o = simulate(vd, recalc);
    for (const k of Object.keys(t) as (keyof Totals)[]) {
      const b = o[k];
      if (b.cost > 0) {
        t[k].races++;
        t[k].cost += b.cost;
        t[k].payout += b.payout;
        if (b.hit) t[k].hits++;
      }
    }
  }
  return t;
}

function weightedReturn(t: Totals): number {
  let num = 0, den = 0;
  for (const [k, w] of Object.entries(OBJECTIVE_WEIGHTS)) {
    const s = t[k as keyof Totals];
    if (s.cost > 0) {
      num += roi(s.cost, s.payout) * w;
      den += w;
    }
  }
  return den > 0 ? num / den : 0;
}

// ----------------------------------------
// メイン
// ----------------------------------------

async function loadData(): Promise<VerificationData[]> {
  const files = (await fs.readdir(DIR)).filter((f) => f.endsWith('.json'));
  const out: VerificationData[] = [];
  for (const f of files) {
    try { out.push(JSON.parse(await fs.readFile(path.join(DIR, f), 'utf-8'))); } catch {}
  }
  return out;
}

async function main(): Promise<void> {
  const all = await loadData();
  if (all.length === 0) { console.error('no data'); process.exit(1); }

  // components が含まれているか確認
  const sampleP = all[0]?.predictions[0] as ExtendedPrediction | undefined;
  const hasComponents = sampleP && sampleP.components !== undefined && sampleP.components !== null;
  if (!hasComponents) {
    console.error('⚠️  predictions に components フィールドがありません');
    console.error('   Stage 3 実行には components 保存済みの再収集 JSON が必要です');
    console.error('   (collect-verification.ts 拡張後の再収集で自動生成される)');
    process.exit(1);
  }

  const sorted = [...all].sort((a, b) => a.date.localeCompare(b.date));
  const mid = Math.floor(sorted.length / 2);
  const first  = sorted.slice(0, mid);
  const second = sorted.slice(mid);

  console.log(`対象: ${all.length}R (前半${first.length} / 後半${second.length})`);
  console.log(`サンプリング: ${NUM_SAMPLES} 通り`);
  console.log(`EV パラメータ (固定): CF=${EV_PARAMS.cf}, offset=${EV_PARAMS.offset}, MAX=${EV_PARAMS.max}`);
  console.log(`戦略 (Stage 2 最適): 単勝 EV≥${TAN_THRESHOLD} / 複勝 EV≥${FUKU_THRESHOLD} / 馬連 top-${UMAREN_TOP_N} / 馬単 top-${UMATAN_TOP_N} / ワイド top-${WIDE_TOP_N}`);
  console.log('');

  // ---- 現行値の評価 (ベンチマーク) ----
  const currentTotals = aggregate(all, CURRENT_WEIGHTS);
  const currentFirst  = aggregate(first, CURRENT_WEIGHTS);
  const currentSecond = aggregate(second, CURRENT_WEIGHTS);
  const currentRoi    = weightedReturn(currentTotals);
  console.log(`現行重み配分: 重み付き回収率 ${currentRoi.toFixed(2)}%`);
  console.log(`  前半: ${weightedReturn(currentFirst).toFixed(2)}%  後半: ${weightedReturn(currentSecond).toFixed(2)}%`);
  console.log('');

  // ---- ランダムサンプリング ----
  const tStart = Date.now();
  type Result = { weights: Weights; all: Totals; first: Totals; second: Totals; roi: number; stability: number };
  const results: Result[] = [];

  let lastLogTime = Date.now();
  let triedCount = 0;
  while (results.length < NUM_SAMPLES) {
    triedCount++;
    const w = sampleWeights();
    if (!w) continue; // 制約違反

    const tAll    = aggregate(all, w);
    const tFirst  = aggregate(first, w);
    const tSecond = aggregate(second, w);
    const r       = weightedReturn(tAll);
    const stab    = Math.abs(weightedReturn(tFirst) - weightedReturn(tSecond));

    results.push({ weights: w, all: tAll, first: tFirst, second: tSecond, roi: r, stability: stab });

    if (Date.now() - lastLogTime > 60_000) {
      const elapsed = Math.round((Date.now() - tStart) / 1000);
      const eta = Math.round((elapsed / results.length) * (NUM_SAMPLES - results.length));
      console.log(`  [${results.length}/${NUM_SAMPLES}] 経過${elapsed}s / 残り${eta}s / 試行${triedCount}`);
      lastLogTime = Date.now();
    }
  }
  const totalSec = Math.round((Date.now() - tStart) / 1000);
  console.log(`\nサンプリング完了 ${totalSec}s (試行 ${triedCount} 回で ${NUM_SAMPLES} 有効)`);
  console.log('');

  // ---- ランキング ----
  const stable = results.filter((r) => r.stability <= STABILITY_THRESHOLD);
  const byRoi = [...stable].sort((a, b) => b.roi - a.roi);
  console.log(`安定性条件 (前後半差≤${STABILITY_THRESHOLD}pt) を満たす候補: ${stable.length}/${NUM_SAMPLES}`);

  const log = (s = ''): void => console.log(s);
  const md: string[] = [];
  const mp = (s = ''): void => { md.push(s); };

  log('='.repeat(84));
  log('  Stage 3 結果: スコア重み配分の最適化');
  log('='.repeat(84));

  log('\n▼ Top 10 (安定性条件クリアの中から)');
  log('-'.repeat(84));
  log('| rank | 上3F  | 調教  | 同コス| 前走  | 血統  | 体重  | 騎手  | 重み付き| 前後半差 |');
  log('|------|-------|-------|-------|-------|-------|-------|-------|---------|----------|');
  byRoi.slice(0, 10).forEach((r, i) => {
    const w = r.weights;
    log(
      `| ${(i + 1).toString().padStart(4)} | ` +
      `${w.lastThreeF.toFixed(3)} | ${w.training.toFixed(3)} | ${w.courseRecord.toFixed(3)} | ` +
      `${w.prevClass.toFixed(3)} | ${w.breeding.toFixed(3)} | ${w.weightChange.toFixed(3)} | ${w.jockey.toFixed(3)} | ` +
      `${(r.roi.toFixed(1) + '%').padStart(7)} | ${r.stability.toFixed(1).padStart(6)}pt |`,
    );
  });

  const best = byRoi[0];
  if (best) {
    log('');
    log('▼ 推奨重み配分 (ROI最高 + 安定性クリア)');
    log('-'.repeat(84));
    log(`  上がり3F    : ${best.weights.lastThreeF.toFixed(3)} (現行 ${CURRENT_WEIGHTS.lastThreeF.toFixed(3)})`);
    log(`  調教ラスト1F: ${best.weights.training.toFixed(3)} (現行 ${CURRENT_WEIGHTS.training.toFixed(3)})`);
    log(`  同コース成績: ${best.weights.courseRecord.toFixed(3)} (現行 ${CURRENT_WEIGHTS.courseRecord.toFixed(3)})`);
    log(`  前走クラス  : ${best.weights.prevClass.toFixed(3)} (現行 ${CURRENT_WEIGHTS.prevClass.toFixed(3)})`);
    log(`  血統適性    : ${best.weights.breeding.toFixed(3)} (現行 ${CURRENT_WEIGHTS.breeding.toFixed(3)})`);
    log(`  馬体重増減  : ${best.weights.weightChange.toFixed(3)} (現行 ${CURRENT_WEIGHTS.weightChange.toFixed(3)})`);
    log(`  騎手評価    : ${best.weights.jockey.toFixed(3)} (現行 ${CURRENT_WEIGHTS.jockey.toFixed(3)})`);
    log(`  重み付き回収率: 全体 ${best.roi.toFixed(2)}%`);
    log(`  前後半差: ${best.stability.toFixed(2)}pt`);
    log(`  現行との差: ${(best.roi - currentRoi).toFixed(2)}pt`);
  }

  // ---- Markdown ----
  mp(`# Stage 3: スコア重み配分の最適化`);
  mp('');
  mp(`- 生成日時: ${new Date().toISOString()}`);
  mp(`- 対象: **${all.length}R** (前半 ${first.length} / 後半 ${second.length})`);
  mp(`- サンプリング: ${NUM_SAMPLES}通り / 試行 ${triedCount}回 / 所要 ${totalSec}秒`);
  mp(`- EV パラメータ (固定): CF=${EV_PARAMS.cf}, offset=${EV_PARAMS.offset}, MAX=${EV_PARAMS.max}`);
  mp(`- 戦略 (Stage 2 最適): 単勝 EV≥${TAN_THRESHOLD} / 複勝 EV≥${FUKU_THRESHOLD} / 馬連 top-${UMAREN_TOP_N} / 馬単 top-${UMATAN_TOP_N} / ワイド top-${WIDE_TOP_N}`);
  mp(`- 目的関数重み: 単勝25% + 複勝15% + 馬連25% + 馬単25% + ワイド10% (三連系は過学習懸念で除外)`);
  mp(`- 安定性条件: 前後半差 ≤ ${STABILITY_THRESHOLD}pt`);
  mp('');
  mp(`## 現行重み配分のベンチマーク`);
  mp('');
  mp(`| 指標 | 値 |`);
  mp(`|---|---|`);
  mp(`| 重み付き回収率 (全体) | **${currentRoi.toFixed(2)}%** |`);
  mp(`| 前半 | ${weightedReturn(currentFirst).toFixed(2)}% |`);
  mp(`| 後半 | ${weightedReturn(currentSecond).toFixed(2)}% |`);
  mp('');
  mp(`## Top 10 候補 (安定性条件クリア, ${stable.length}件中)`);
  mp('');
  mp(`| rank | 上3F | 調教 | 同コース | 前走 | 血統 | 馬体重 | 騎手 | 重み付き回収率 | 前後半差 |`);
  mp(`|---|---|---|---|---|---|---|---|---|---|`);
  byRoi.slice(0, 10).forEach((r, i) => {
    const w = r.weights;
    mp(
      `| ${i + 1} | ${w.lastThreeF.toFixed(3)} | ${w.training.toFixed(3)} | ${w.courseRecord.toFixed(3)} | ${w.prevClass.toFixed(3)} | ${w.breeding.toFixed(3)} | ${w.weightChange.toFixed(3)} | ${w.jockey.toFixed(3)} | **${r.roi.toFixed(1)}%** | ${r.stability.toFixed(1)}pt |`,
    );
  });
  mp('');
  if (best) {
    mp(`## 推奨重み配分`);
    mp('');
    mp(`| 指標 | 現行 | 推奨 | 差分 |`);
    mp(`|---|---|---|---|`);
    for (const k of Object.keys(CURRENT_WEIGHTS) as WeightKey[]) {
      const diff = best.weights[k] - CURRENT_WEIGHTS[k];
      mp(`| ${k} | ${CURRENT_WEIGHTS[k].toFixed(3)} | **${best.weights[k].toFixed(3)}** | ${(diff >= 0 ? '+' : '') + diff.toFixed(3)} |`);
    }
    mp('');
    mp(`- 重み付き回収率 (全体): **${best.roi.toFixed(2)}%** (現行比 ${(best.roi - currentRoi >= 0 ? '+' : '') + (best.roi - currentRoi).toFixed(2)}pt)`);
    mp(`- 前後半差: ${best.stability.toFixed(2)}pt`);
    mp('');
  }
  mp(`## 注意事項`);
  mp('');
  mp(`- ランダムサンプリング ${NUM_SAMPLES}通りは全探索と比べてカバレッジが限られる`);
  mp(`- 現行値との差が 1pt 以下なら本番反映は要検討 (誤差範囲)`);
  mp(`- 過学習検出のため **前後半差 ≤ ${STABILITY_THRESHOLD}pt** を採用基準としている`);
  mp('');
  mp(`---`);
  mp(`*再実行: \`pnpm tsx scripts/grid_search_stage3.ts\`*`);

  await fs.writeFile(REPORT, md.join('\n'), 'utf-8');
  log('');
  log('='.repeat(84));
  log(`Markdown: ${REPORT}`);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
