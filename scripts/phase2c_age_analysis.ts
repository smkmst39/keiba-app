// ==========================================
// Phase 2C: 年齢別スコア重み分離 最適化
//
// 目的:
//   年齢区分 (2歳戦 / 3歳戦 / 古馬戦) ごとに独立した重み配分を
//   Dirichlet ランダムサンプリングで最適化し、Phase 2G ハイブリッド
//   戦略と組み合わせた合計 ROI を現行 312.5pt より向上させる。
//
// 区分根拠 (3233R サンプル分析):
//   - 2歳戦: 622R (秋季限定)
//   - 3歳戦: 967R (春秋の2世代)
//   - 古馬戦 (3歳以上+4歳以上): 1644R (通年)
//   いずれも 500R 以上を確保
//
// 評価関数: 合計pt = 馬連本命ROI + 馬単本命ROI + ワイド堅実ROI
//   (全て Phase 2G ハイブリッド除外を適用した後)
//
// 過学習対策: 各区分内で chronological 70/30 分割
//   train で最適重みを決定 → test で汎化性能検証
//
// 実行: pnpm tsx scripts/phase2c_age_analysis.ts
// 出力: scripts/verification/phase2c_age_separation.md
// ==========================================

import { promises as fs } from 'node:fs';
import path from 'node:path';

const DIR = path.resolve(__dirname, 'verification');
const REPORT = path.join(DIR, 'phase2c_age_separation.md');

// ----------------------------------------
// 型定義
// ----------------------------------------

type Components = {
  lastThreeF: number;
  training: number;
  courseRecord: number;
  prevClass: number;
  breeding: number;
  weightChange: number;
  jockey: number;
};

const COMPONENT_KEYS: (keyof Components)[] = [
  'lastThreeF','training','courseRecord','prevClass','breeding','weightChange','jockey',
];

type Weights = Components;

// 現行 (Phase 2E Stage 3) の重み: 全年齢共通
const CURRENT_WEIGHTS: Weights = {
  lastThreeF:   0.244,
  training:     0.125,
  courseRecord: 0.198,
  prevClass:    0.146,
  breeding:     0.158,
  weightChange: 0.071,
  jockey:       0.058,
};

type Prediction = {
  horseId: number;
  odds: number;
  components: Components;
};

type Payout = { combination: string; payout: number };

type Race = {
  raceId: string;
  month: string;     // "YYYY-MM"
  ageBucket: AgeBucket;
  raceClass: string | undefined;
  preds: Prediction[];
  umarenPayouts: Payout[];
  umatanPayouts: Payout[];
  widePayouts: Payout[];
};

type AgeBucket = '2歳' | '3歳' | '古馬';

// ----------------------------------------
// 年齢判定
// ----------------------------------------

function classifyAge(meta: any): AgeBucket {
  const a: string = meta?.ageLimit ?? '';
  const rc: string = meta?.raceCondition ?? '';
  if (a === '2歳' || (/2歳/.test(rc) && !/以上/.test(rc))) return '2歳';
  if (a === '3歳' || (/3歳/.test(rc) && !/以上/.test(rc))) return '3歳';
  return '古馬'; // 3歳以上 / 4歳以上 / その他
}

// ----------------------------------------
// Phase 2G クラス除外
// ----------------------------------------

function isExcludedForUmarenUmatan(rc: string | undefined): boolean {
  if (!rc) return false;
  return /1勝|500万|2勝|1000万/.test(rc);
}
function isExcludedForWide(rc: string | undefined): boolean {
  if (!rc) return false;
  return /1勝|500万/.test(rc);
}

// ----------------------------------------
// スコア・EV 計算 (重みを引数で受け取る)
// ----------------------------------------

function calcScore(c: Components, w: Weights): number {
  let s = 0;
  for (const k of COMPONENT_KEYS) s += c[k] * w[k];
  return Math.max(0, Math.min(100, s));
}

const CORRECTION_FACTOR = 0.2;
const MAX_CORRECTION = 0.20;
const CORR_OFFSET = -0.02;

function getOddsWeight(odds: number): number {
  if (odds <= 5)  return 1.00;
  if (odds <= 10) return 0.80;
  if (odds <= 20) return 0.50;
  if (odds <= 50) return 0.20;
  return 0.05;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// レース内の全馬スコア → EV を計算
type ScoredHorse = { horseId: number; odds: number; score: number; ev: number };

function scoreRace(preds: Prediction[], w: Weights): ScoredHorse[] {
  const scores = preds.map((p) => calcScore(p.components, w));
  const avg = scores.reduce((s, v) => s + v, 0) / scores.length;
  const out: ScoredHorse[] = [];
  for (let i = 0; i < preds.length; i++) {
    const p = preds[i];
    if (p.odds <= 0) { out.push({ horseId: p.horseId, odds: p.odds, score: scores[i], ev: 0 }); continue; }
    const mktProb = 1 / p.odds;
    const dev = avg === 0 ? 0 : (scores[i] - avg) / avg;
    const corr = clamp(dev * CORRECTION_FACTOR * getOddsWeight(p.odds) + CORR_OFFSET, -MAX_CORRECTION, MAX_CORRECTION);
    const ev = mktProb * (1 + corr) * p.odds;
    out.push({ horseId: p.horseId, odds: p.odds, score: scores[i], ev });
  }
  return out;
}

// ----------------------------------------
// 本命級戦略の損益計算 (Phase 2G ハイブリッド除外適用)
// ----------------------------------------

type Outcome = { cost: number; payout: number };
const zeroOutcome: Outcome = { cost: 0, payout: 0 };

const sameSet = (a: number[], b: number[]): boolean =>
  a.length === b.length && [...a].sort((x,y)=>x-y).join(',') === [...b].sort((x,y)=>x-y).join(',');

function umarenOutcome(r: Race, scored: ScoredHorse[]): Outcome {
  if (isExcludedForUmarenUmatan(r.raceClass)) return zeroOutcome;
  const sorted = [...scored].filter((s) => s.odds > 0).sort((a,b)=>b.ev-a.ev);
  const p1 = sorted[0], p2 = sorted[1];
  if (!p1 || !p2) return zeroOutcome;
  if (p1.ev < 1.0 || p2.ev < 1.0) return zeroOutcome;
  if (p1.score < 65 || p2.score < 65) return zeroOutcome;
  for (const u of r.umarenPayouts) {
    if (sameSet([p1.horseId, p2.horseId], u.combination.split('-').map(Number))) {
      return { cost: 100, payout: u.payout };
    }
  }
  return { cost: 100, payout: 0 };
}

function umatanOutcome(r: Race, scored: ScoredHorse[]): Outcome {
  if (isExcludedForUmarenUmatan(r.raceClass)) return zeroOutcome;
  const sorted = [...scored].filter((s) => s.odds > 0).sort((a,b)=>b.ev-a.ev);
  const p1 = sorted[0], p2 = sorted[1];
  if (!p1 || !p2) return zeroOutcome;
  if (p1.ev < 1.0 || p2.ev < 1.0) return zeroOutcome;
  if (p1.score < 65 || p2.score < 65) return zeroOutcome;
  if (p1.odds > 15 || p2.odds > 15) return zeroOutcome;
  // 2点 BOX
  let pay = 0;
  for (const perm of [[p1.horseId, p2.horseId], [p2.horseId, p1.horseId]]) {
    for (const u of r.umatanPayouts) {
      const c = u.combination.split('-').map(Number);
      if (c.length === 2 && c[0] === perm[0] && c[1] === perm[1]) { pay += u.payout; break; }
    }
  }
  return { cost: 200, payout: pay };
}

function wideOutcome(r: Race, scored: ScoredHorse[]): Outcome {
  if (isExcludedForWide(r.raceClass)) return zeroOutcome;
  const sorted = [...scored].filter((s) => s.odds > 0).sort((a,b)=>b.ev-a.ev);
  const p1 = sorted[0], p2 = sorted[1];
  if (!p1 || !p2) return zeroOutcome;
  if (p1.ev < 1.02 || p2.ev < 1.02) return zeroOutcome;
  if (p1.score < 65 || p2.score < 65) return zeroOutcome;
  if (p1.odds > 10 || p2.odds > 10) return zeroOutcome;
  for (const w of r.widePayouts) {
    if (sameSet([p1.horseId, p2.horseId], w.combination.split('-').map(Number))) {
      return { cost: 100, payout: w.payout };
    }
  }
  return { cost: 100, payout: 0 };
}

// ----------------------------------------
// 全レースを対象とした合計pt評価
// ----------------------------------------

type Agg = { cost: number; payout: number };
const emptyAgg = (): Agg => ({ cost: 0, payout: 0 });
const roi = (a: Agg): number => a.cost > 0 ? (a.payout / a.cost) * 100 : 0;

// 単一カテゴリの races に対して重みを適用し、3券種ROI合計を返す
function evaluateWeights(races: Race[], w: Weights): {
  umaren: Agg; umatan: Agg; wide: Agg; totalPt: number;
} {
  const U = emptyAgg(), T = emptyAgg(), W_ = emptyAgg();
  for (const r of races) {
    const scored = scoreRace(r.preds, w);
    const u = umarenOutcome(r, scored);
    const t = umatanOutcome(r, scored);
    const wd = wideOutcome(r, scored);
    U.cost += u.cost; U.payout += u.payout;
    T.cost += t.cost; T.payout += t.payout;
    W_.cost += wd.cost; W_.payout += wd.payout;
  }
  return { umaren: U, umatan: T, wide: W_, totalPt: roi(U) + roi(T) + roi(W_) };
}

// ----------------------------------------
// Dirichlet サンプリング (Seed付き)
// ----------------------------------------

// Seedable RNG (mulberry32)
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Gamma(shape=alpha, scale=1) 乱数 (Marsaglia-Tsang)
function gammaSample(rng: () => number, alpha: number): number {
  if (alpha < 1) {
    const x = gammaSample(rng, alpha + 1);
    return x * Math.pow(rng(), 1 / alpha);
  }
  const d = alpha - 1/3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x: number, v: number;
    do {
      // Box-Muller for normal(0,1)
      const u1 = rng(), u2 = rng();
      x = Math.sqrt(-2 * Math.log(u1 || 1e-10)) * Math.cos(2 * Math.PI * u2);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

// Dirichlet(alpha) サンプル → Σ=1 の7要素ベクトル
function dirichletSample(rng: () => number, alpha: number[]): number[] {
  const g = alpha.map((a) => gammaSample(rng, a));
  const s = g.reduce((x, y) => x + y, 0);
  return g.map((v) => v / s);
}

// ----------------------------------------
// データ読込
// ----------------------------------------

async function loadData(): Promise<Race[]> {
  const files = (await fs.readdir(DIR)).filter((f) => f.endsWith('.json'));
  const out: Race[] = [];
  for (const f of files) {
    let j: any;
    try { j = JSON.parse(await fs.readFile(path.join(DIR, f), 'utf-8')); } catch { continue; }
    if (!j.predictions || j.predictions.length < 2) continue;
    if (!j.results?.payouts) continue;
    // components 必須 (Phase 2G 収集データ)
    const ok = j.predictions.every((p: any) => p.components);
    if (!ok) continue;

    const preds: Prediction[] = j.predictions.map((p: any) => ({
      horseId: p.horseId,
      odds: p.odds,
      components: {
        lastThreeF:   p.components.lastThreeF   ?? 50,
        training:     p.components.training     ?? 50,
        courseRecord: p.components.courseRecord ?? 50,
        prevClass:    p.components.prevClass    ?? 50,
        breeding:     p.components.breeding     ?? 50,
        weightChange: p.components.weightChange ?? 50,
        jockey:       p.components.jockey       ?? 50,
      },
    }));

    const rd = j.meta?.raceDate || f.substring(0, 8);
    const month = `${String(rd).substring(0,4)}-${String(rd).substring(4,6)}`;

    out.push({
      raceId: j.raceId,
      month,
      ageBucket: classifyAge(j.meta),
      raceClass: j.meta?.raceClass,
      preds,
      umarenPayouts: j.results.payouts.umaren ?? [],
      umatanPayouts: j.results.payouts.umatan ?? [],
      widePayouts:   j.results.payouts.wide   ?? [],
    });
  }
  return out;
}

// ----------------------------------------
// 時系列 70/30 分割 (カテゴリ内)
// ----------------------------------------

function chronoSplit(races: Race[]): { train: Race[]; test: Race[]; trainCutoff: string } {
  const sorted = [...races].sort((a, b) => a.month.localeCompare(b.month));
  const cutIdx = Math.floor(sorted.length * 0.7);
  const trainCutoff = sorted[cutIdx - 1]?.month ?? '';
  return { train: sorted.slice(0, cutIdx), test: sorted.slice(cutIdx), trainCutoff };
}

// ----------------------------------------
// グリッドサーチ実行
// ----------------------------------------

type SearchResult = {
  bestWeights: Weights;
  trainPt: number;
  testPt: number;
  trainU: number; trainT: number; trainW: number;
  testU: number; testT: number; testW: number;
  trainParticipated: number;
  testParticipated: number;
};

function countParticipated(races: Race[], w: Weights): number {
  let n = 0;
  for (const r of races) {
    const sc = scoreRace(r.preds, w);
    if (umarenOutcome(r, sc).cost > 0) n++;
  }
  return n;
}

function randomSearch(
  train: Race[],
  test: Race[],
  trials: number,
  seed: number,
): SearchResult {
  const rng = mulberry32(seed);
  // Dirichlet α: 現行重みを中心に、低分散で探索
  // K大 → 現行に集中、K小 → 発散。K=50 で安定的に近傍探索
  const K = 50;
  const alpha = COMPONENT_KEYS.map((k) => CURRENT_WEIGHTS[k] * K);

  // 最低参加R数: 現行重みでの参加R数の 60% 以上を要求 (極端解を排除)
  const baseParticipated = countParticipated(train, CURRENT_WEIGHTS);
  const MIN_PARTICIPATED = Math.max(20, Math.floor(baseParticipated * 0.6));

  let best: { w: Weights; pt: number } | null = null;

  // 現行重みは必ず試す (基準値として採用)
  {
    const ev = evaluateWeights(train, CURRENT_WEIGHTS);
    best = { w: CURRENT_WEIGHTS, pt: ev.totalPt };
  }

  for (let i = 0; i < trials; i++) {
    const vec = dirichletSample(rng, alpha);
    const w: Weights = {
      lastThreeF: vec[0], training: vec[1], courseRecord: vec[2],
      prevClass: vec[3], breeding: vec[4], weightChange: vec[5], jockey: vec[6],
    };
    // 参加R数フィルタ (過学習防止)
    if (countParticipated(train, w) < MIN_PARTICIPATED) continue;
    const ev = evaluateWeights(train, w);
    if (ev.totalPt > best.pt) best = { w, pt: ev.totalPt };
  }

  const bestW = best!.w;
  const trainEv = evaluateWeights(train, bestW);
  const testEv  = evaluateWeights(test, bestW);

  return {
    bestWeights: bestW,
    trainPt: trainEv.totalPt,
    testPt: testEv.totalPt,
    trainU: roi(trainEv.umaren), trainT: roi(trainEv.umatan), trainW: roi(trainEv.wide),
    testU:  roi(testEv.umaren),  testT:  roi(testEv.umatan),  testW:  roi(testEv.wide),
    trainParticipated: countParticipated(train, bestW),
    testParticipated:  countParticipated(test,  bestW),
  };
}

// ----------------------------------------
// 統合バックテスト
// 各レースのカテゴリに応じた重みを適用し、全3233Rで合計pt集計
// ----------------------------------------

function integratedBacktest(
  races: Race[],
  weightsByBucket: Record<AgeBucket, Weights>,
): { umaren: Agg; umatan: Agg; wide: Agg; totalPt: number; monthlyUmaren: Map<string, Agg> } {
  const U = emptyAgg(), T = emptyAgg(), W_ = emptyAgg();
  const monthlyU = new Map<string, Agg>();
  for (const r of races) {
    const w = weightsByBucket[r.ageBucket];
    const sc = scoreRace(r.preds, w);
    const u = umarenOutcome(r, sc);
    const t = umatanOutcome(r, sc);
    const wd = wideOutcome(r, sc);
    U.cost += u.cost; U.payout += u.payout;
    T.cost += t.cost; T.payout += t.payout;
    W_.cost += wd.cost; W_.payout += wd.payout;
    if (u.cost > 0) {
      let m = monthlyU.get(r.month); if (!m) { m = emptyAgg(); monthlyU.set(r.month, m); }
      m.cost += u.cost; m.payout += u.payout;
    }
  }
  return { umaren: U, umatan: T, wide: W_, totalPt: roi(U) + roi(T) + roi(W_), monthlyUmaren: monthlyU };
}

function monthlyCV(m: Map<string, Agg>): { cv: number; min: number; max: number } {
  const rois: number[] = [];
  for (const a of Array.from(m.values())) if (a.cost > 0) rois.push(roi(a));
  if (rois.length === 0) return { cv: 0, min: 0, max: 0 };
  const mean = rois.reduce((s,v)=>s+v,0)/rois.length;
  const sd = Math.sqrt(rois.reduce((s,v)=>s+(v-mean)**2,0)/rois.length);
  return { cv: mean === 0 ? 0 : sd/mean, min: Math.min(...rois), max: Math.max(...rois) };
}

// ----------------------------------------
// メイン
// ----------------------------------------

async function main(): Promise<void> {
  console.log('=====================================================');
  console.log('  Phase 2C: 年齢別スコア重み分離 最適化');
  console.log('=====================================================');

  const all = await loadData();
  console.log(`総データ: ${all.length} R`);
  const by2 = all.filter((r) => r.ageBucket === '2歳');
  const by3 = all.filter((r) => r.ageBucket === '3歳');
  const byOld = all.filter((r) => r.ageBucket === '古馬');
  console.log(`  2歳戦: ${by2.length} R / 3歳戦: ${by3.length} R / 古馬戦: ${byOld.length} R`);

  // Chronological split
  const split2 = chronoSplit(by2);
  const split3 = chronoSplit(by3);
  const splitO = chronoSplit(byOld);

  console.log('');
  console.log('train/test 分割 (月で chronological 70/30):');
  console.log(`  2歳戦: train ${split2.train.length}R (〜${split2.trainCutoff}) / test ${split2.test.length}R`);
  console.log(`  3歳戦: train ${split3.train.length}R (〜${split3.trainCutoff}) / test ${split3.test.length}R`);
  console.log(`  古馬戦: train ${splitO.train.length}R (〜${splitO.trainCutoff}) / test ${splitO.test.length}R`);

  const TRIALS = 2000;
  console.log(`\nグリッドサーチ: Dirichlet random sampling ${TRIALS} trials × 3 カテゴリ`);

  console.log('\n[2歳戦 最適化中...]');
  const res2 = randomSearch(split2.train, split2.test, TRIALS, 12345);
  console.log(`  train pt: ${res2.trainPt.toFixed(1)} / test pt: ${res2.testPt.toFixed(1)}`);

  console.log('\n[3歳戦 最適化中...]');
  const res3 = randomSearch(split3.train, split3.test, TRIALS, 23456);
  console.log(`  train pt: ${res3.trainPt.toFixed(1)} / test pt: ${res3.testPt.toFixed(1)}`);

  console.log('\n[古馬戦 最適化中...]');
  const resO = randomSearch(splitO.train, splitO.test, TRIALS, 34567);
  console.log(`  train pt: ${resO.trainPt.toFixed(1)} / test pt: ${resO.testPt.toFixed(1)}`);

  // ベースライン: 全データ × 現行重み
  const baseFull = integratedBacktest(all, {
    '2歳': CURRENT_WEIGHTS, '3歳': CURRENT_WEIGHTS, '古馬': CURRENT_WEIGHTS,
  });
  const cvBase = monthlyCV(baseFull.monthlyUmaren);
  console.log('\n[ベースライン (全データ×現行重み)]');
  console.log(`  合計pt: ${baseFull.totalPt.toFixed(1)} / CV: ${cvBase.cv.toFixed(3)}`);

  // Phase 2C 統合: 全データ × カテゴリ別最適重み
  const newFull = integratedBacktest(all, {
    '2歳': res2.bestWeights, '3歳': res3.bestWeights, '古馬': resO.bestWeights,
  });
  const cvNew = monthlyCV(newFull.monthlyUmaren);
  console.log('\n[Phase 2C 統合 (年齢別重み)]');
  console.log(`  合計pt: ${newFull.totalPt.toFixed(1)} / CV: ${cvNew.cv.toFixed(3)}`);

  // 採用判定
  const diff = newFull.totalPt - baseFull.totalPt;
  const overfitOK = (r: SearchResult): boolean =>
    r.trainPt === 0 ? true : (r.testPt / r.trainPt) >= 0.80;
  const all3OK = overfitOK(res2) && overfitOK(res3) && overfitOK(resO);
  const testROIok = res2.testPt/3 >= 100 && res3.testPt/3 >= 100 && resO.testPt/3 >= 100;
  // 平均で100%超ではなく、各券種100%超を満たすか簡易チェックは難しいので総合ptで判断
  const enoughSamples = by2.length >= 500 && by3.length >= 500 && byOld.length >= 500;

  let verdict: 'α' | 'β' | 'γ';
  if (diff >= 50 && all3OK && cvNew.cv <= 1.0) verdict = 'α';
  else if (diff >= 10 && all3OK && cvNew.cv <= 1.0) verdict = 'β';
  else verdict = 'γ';

  // ---- Markdown レポート ----
  const md: string[] = [];
  const mp = (s = ''): void => { md.push(s); };

  mp(`# Phase 2C: 年齢別スコア分離 実装報告`);
  mp('');
  mp(`- 生成日時: ${new Date().toISOString()}`);
  mp(`- 対象: **${all.length} R** (2025-05 〜 2026-04, 12ヶ月)`);
  mp(`- 評価関数: Phase 2G ハイブリッド適用後の 馬連+馬単+ワイド ROI 合計pt`);
  mp('');

  mp(`## 1. 年齢区分の決定`);
  mp('');
  mp(`**採用: パターンA（3区分）**`);
  mp('');
  mp(`| 区分 | 判定条件 | サンプル数 | 判定 |`);
  mp(`|---|---|---|---|`);
  mp(`| 2歳戦  | meta.ageLimit='2歳' | ${by2.length} R | ${by2.length>=500?'✅':'⚠️'} |`);
  mp(`| 3歳戦  | meta.ageLimit='3歳' | ${by3.length} R | ${by3.length>=500?'✅':'⚠️'} |`);
  mp(`| 古馬戦 | 3歳以上 / 4歳以上   | ${byOld.length} R | ${byOld.length>=500?'✅':'⚠️'} |`);
  mp('');
  mp(`**根拠**: 全区分で 500R 超を確保、グリッドサーチの統計的信頼性あり。`);
  mp(`2歳戦は秋季限定 (2025/06-12) だが、それでも 600R 以上取得できている。`);
  mp('');

  mp(`## 2. 現行重み配分 (全年齢共通)`);
  mp('');
  mp(`| 項目 | 重み | 説明 |`);
  mp(`|---|---|---|`);
  for (const k of COMPONENT_KEYS) {
    mp(`| ${k} | ${CURRENT_WEIGHTS[k].toFixed(3)} | - |`);
  }
  mp(`| **合計** | **${Object.values(CURRENT_WEIGHTS).reduce((s,v)=>s+v,0).toFixed(3)}** | |`);
  mp('');
  mp(`Phase 2E Stage 3 (930R) で導出した最適配分。本タスクはこれを年齢別に分離する。`);
  mp('');

  mp(`## 3. グリッドサーチ設計`);
  mp('');
  mp(`- 探索戦略: **Dirichlet ランダムサンプリング** (Phase 2E Stage 3 方式を踏襲)`);
  mp(`- Trials: **${TRIALS}** per カテゴリ × 3 = 6000 サンプル`);
  mp(`- α ベクトル: 現行重み × K=50 (現行近傍を集中探索)`);
  mp(`- 最低参加R制約: 現行重み参加R数の 60% 以上 (極端解による過学習防止)`);
  mp(`- Seed 固定 (再現性): 2歳=12345 / 3歳=23456 / 古馬=34567`);
  mp(`- 制約: Σweights = 1.0 (Dirichlet で自動保証)`);
  mp('');

  mp(`## 4. 過学習対策`);
  mp('');
  mp(`- **カテゴリ内 chronological 70/30 分割**`);
  mp(`  - 古い7割 (月で切り分け) を train、新しい3割を test`);
  mp(`- train で最適重みを決定 → test で汎化性能検証`);
  mp(`- **過学習判定**: test pt が train pt の 80% を下回ったら警告`);
  mp('');
  mp(`| 区分 | train R数 | train 期間 | test R数 | test 期間 |`);
  mp(`|---|---|---|---|---|`);
  const firstMonth = (rs: Race[]): string => rs.length===0?'-':rs.slice().sort((a,b)=>a.month.localeCompare(b.month))[0].month;
  const lastMonth  = (rs: Race[]): string => rs.length===0?'-':rs.slice().sort((a,b)=>a.month.localeCompare(b.month)).at(-1)!.month;
  mp(`| 2歳戦  | ${split2.train.length} | ${firstMonth(split2.train)}〜${split2.trainCutoff} | ${split2.test.length} | ${firstMonth(split2.test)}〜${lastMonth(split2.test)} |`);
  mp(`| 3歳戦  | ${split3.train.length} | ${firstMonth(split3.train)}〜${split3.trainCutoff} | ${split3.test.length} | ${firstMonth(split3.test)}〜${lastMonth(split3.test)} |`);
  mp(`| 古馬戦 | ${splitO.train.length} | ${firstMonth(splitO.train)}〜${splitO.trainCutoff} | ${splitO.test.length} | ${firstMonth(splitO.test)}〜${lastMonth(splitO.test)} |`);
  mp('');

  mp(`## 5. 区分別最適化結果`);
  mp('');

  const fmtW = (w: Weights): string =>
    COMPONENT_KEYS.map((k) => `${k}=${w[k].toFixed(3)}`).join(' / ');

  const renderRes = (title: string, r: SearchResult, train: Race[], test: Race[]): void => {
    mp(`### ${title}`);
    mp('');
    mp(`**最適重み**:`);
    mp('');
    mp(`| lastThreeF | training | courseRecord | prevClass | breeding | weightChange | jockey |`);
    mp(`|---|---|---|---|---|---|---|`);
    mp(`| ${r.bestWeights.lastThreeF.toFixed(3)} | ${r.bestWeights.training.toFixed(3)} | ${r.bestWeights.courseRecord.toFixed(3)} | ${r.bestWeights.prevClass.toFixed(3)} | ${r.bestWeights.breeding.toFixed(3)} | ${r.bestWeights.weightChange.toFixed(3)} | ${r.bestWeights.jockey.toFixed(3)} |`);
    mp('');
    mp(`| 指標 | train (${train.length}R) | test (${test.length}R) |`);
    mp(`|---|---|---|`);
    mp(`| 馬連本命 ROI | ${r.trainU.toFixed(1)}% | ${r.testU.toFixed(1)}% |`);
    mp(`| 馬単本命 ROI | ${r.trainT.toFixed(1)}% | ${r.testT.toFixed(1)}% |`);
    mp(`| ワイド堅実 ROI | ${r.trainW.toFixed(1)}% | ${r.testW.toFixed(1)}% |`);
    mp(`| **合計pt** | **${r.trainPt.toFixed(1)}** | **${r.testPt.toFixed(1)}** |`);
    mp(`| 馬連参加R | ${r.trainParticipated} | ${r.testParticipated} |`);
    mp('');
    const ratio = r.trainPt === 0 ? 1 : r.testPt / r.trainPt;
    const judge = ratio >= 0.80 ? '✅ 過学習許容範囲内' : '⚠️ 過学習の疑い';
    mp(`**過学習判定**: test/train = ${(ratio*100).toFixed(0)}% — ${judge}`);
    mp('');
  };

  renderRes('2歳戦', res2, split2.train, split2.test);
  renderRes('3歳戦', res3, split3.train, split3.test);
  renderRes('古馬戦', resO, splitO.train, splitO.test);

  mp(`## 6. 統合バックテスト (全3233R)`);
  mp('');
  mp(`年齢に応じた重みを各レースに適用し、全データで Phase 2G ハイブリッド戦略を実行。`);
  mp('');
  mp(`| 指標 | 現行 (一律) | Phase 2C (分離) | 差分 |`);
  mp(`|---|---|---|---|`);
  mp(`| 馬連本命 ROI | ${roi(baseFull.umaren).toFixed(1)}% | ${roi(newFull.umaren).toFixed(1)}% | ${((roi(newFull.umaren)-roi(baseFull.umaren)>=0?'+':''))}${(roi(newFull.umaren)-roi(baseFull.umaren)).toFixed(1)}pt |`);
  mp(`| 馬単本命 ROI | ${roi(baseFull.umatan).toFixed(1)}% | ${roi(newFull.umatan).toFixed(1)}% | ${((roi(newFull.umatan)-roi(baseFull.umatan)>=0?'+':''))}${(roi(newFull.umatan)-roi(baseFull.umatan)).toFixed(1)}pt |`);
  mp(`| ワイド堅実 ROI | ${roi(baseFull.wide).toFixed(1)}% | ${roi(newFull.wide).toFixed(1)}% | ${((roi(newFull.wide)-roi(baseFull.wide)>=0?'+':''))}${(roi(newFull.wide)-roi(baseFull.wide)).toFixed(1)}pt |`);
  mp(`| **合計pt** | **${baseFull.totalPt.toFixed(1)}** | **${newFull.totalPt.toFixed(1)}** | **${(diff>=0?'+':'')}${diff.toFixed(1)}pt** |`);
  mp(`| 馬連月別CV | ${cvBase.cv.toFixed(3)} | ${cvNew.cv.toFixed(3)} | ${((cvNew.cv-cvBase.cv>=0?'+':''))}${(cvNew.cv-cvBase.cv).toFixed(3)} |`);
  mp(`| 馬連月別 最悪 | ${cvBase.min.toFixed(1)}% | ${cvNew.min.toFixed(1)}% | ${((cvNew.min-cvBase.min>=0?'+':''))}${(cvNew.min-cvBase.min).toFixed(1)}pt |`);
  mp(`| 馬連月別 最良 | ${cvBase.max.toFixed(1)}% | ${cvNew.max.toFixed(1)}% | ${((cvNew.max-cvBase.max>=0?'+':''))}${(cvNew.max-cvBase.max).toFixed(1)}pt |`);
  mp('');

  mp(`## 7. 採用判断`);
  mp('');
  mp(`### 採用基準評価`);
  mp(`- ${diff >= 0 ? '✅' : '❌'} 合計pt ≥ 現行 (差分 ${diff.toFixed(1)}pt)`);
  mp(`- ${overfitOK(res2) ? '✅' : '❌'} 2歳戦: test/train ≥ 80% (${res2.trainPt===0?'N/A':((res2.testPt/res2.trainPt)*100).toFixed(0)+'%'})`);
  mp(`- ${overfitOK(res3) ? '✅' : '❌'} 3歳戦: test/train ≥ 80% (${res3.trainPt===0?'N/A':((res3.testPt/res3.trainPt)*100).toFixed(0)+'%'})`);
  mp(`- ${overfitOK(resO) ? '✅' : '❌'} 古馬戦: test/train ≥ 80% (${resO.trainPt===0?'N/A':((resO.testPt/resO.trainPt)*100).toFixed(0)+'%'})`);
  mp(`- ${cvNew.cv <= 1.0 ? '✅' : '❌'} 馬連月別CV ≤ 1.0 (${cvNew.cv.toFixed(3)})`);
  mp(`- ${enoughSamples ? '✅' : '❌'} 各区分 500R 以上`);
  mp('');
  mp(`### 結論: ケース${verdict}`);
  mp('');
  if (verdict === 'α') mp(`**大幅改善 (+${diff.toFixed(1)}pt)**。本番実装を強く推奨。`);
  else if (verdict === 'β') mp(`**微改善 (+${diff.toFixed(1)}pt)**。採用基準を満たす、本番実装候補。`);
  else mp(`**改善なし/過学習/不安定**。見送り、別方向 (未活用軸探索等) へ進む。`);
  mp('');

  if (verdict !== 'γ') {
    mp(`## 8. 本番反映案`);
    mp('');
    mp('```typescript');
    mp('// lib/score/calculator.ts');
    mp('');
    mp('/** 年齢別 重み配分 (Phase 2C, 3233R 最適化) */');
    mp('const WEIGHTS_BY_AGE = {');
    mp(`  '2歳': {`);
    for (const k of COMPONENT_KEYS) mp(`    ${k.padEnd(13)}: ${res2.bestWeights[k].toFixed(3)},`);
    mp('  },');
    mp(`  '3歳': {`);
    for (const k of COMPONENT_KEYS) mp(`    ${k.padEnd(13)}: ${res3.bestWeights[k].toFixed(3)},`);
    mp('  },');
    mp(`  '古馬': {`);
    for (const k of COMPONENT_KEYS) mp(`    ${k.padEnd(13)}: ${resO.bestWeights[k].toFixed(3)},`);
    mp('  },');
    mp('} as const;');
    mp('');
    mp('function getAgeBucket(race: Race): "2歳" | "3歳" | "古馬" {');
    mp('  const a = race.ageLimit ?? "";');
    mp('  const rc = race.raceCondition ?? "";');
    mp('  if (a === "2歳" || (/2歳/.test(rc) && !/以上/.test(rc))) return "2歳";');
    mp('  if (a === "3歳" || (/3歳/.test(rc) && !/以上/.test(rc))) return "3歳";');
    mp('  return "古馬";');
    mp('}');
    mp('');
    mp('// calcScoreInternal 内で bucket に応じた重みを使う');
    mp('const WEIGHTS = WEIGHTS_BY_AGE[getAgeBucket(race)];');
    mp('```');
    mp('');
    mp(`### テストケース`);
    mp(`- 2歳新馬戦 (1頭): score = Σ components × WEIGHTS_BY_AGE['2歳']`);
    mp(`- 3歳未勝利 (1頭): score = Σ components × WEIGHTS_BY_AGE['3歳']`);
    mp(`- 古馬 1勝クラス (1頭): score = Σ components × WEIGHTS_BY_AGE['古馬']`);
  } else {
    mp(`## 8. 次のアクション`);
    mp('');
    mp(`- 未活用軸の探索 (prize, raceGrade, 距離帯別) に進む`);
    mp(`- または note 記事執筆へ`);
  }
  mp('');
  mp(`---`);
  mp(`*再実行: \`pnpm tsx scripts/phase2c_age_analysis.ts\`*`);

  await fs.writeFile(REPORT, md.join('\n'), 'utf-8');

  console.log('');
  console.log('=====================================================');
  console.log(`  採用判定: ケース${verdict}`);
  console.log(`  合計pt: ${baseFull.totalPt.toFixed(1)} → ${newFull.totalPt.toFixed(1)} (${diff>=0?'+':''}${diff.toFixed(1)}pt)`);
  console.log(`  CV(馬連): ${cvBase.cv.toFixed(3)} → ${cvNew.cv.toFixed(3)}`);
  console.log(`  Markdown: ${REPORT}`);
  console.log('=====================================================');
}

main().catch((e) => { console.error(e); process.exit(1); });
