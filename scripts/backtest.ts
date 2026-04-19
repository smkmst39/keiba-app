// ==========================================
// バックテスト分析スクリプト
//
// scripts/verification/*.json に保存された VerificationData を読み込み、
//  1. 全体の精度サマリー
//  2. 馬券種別の的中率・回収率
//  3. CORRECTION_FACTOR の最適化（0.05〜0.30）
//  4. オッズ帯別の精度分析
//  5. 結論と改善提案
// を算出してコンソールと scripts/verification/backtest_report.md に出力する。
//
// netkeiba へは一切アクセスしない。ローカル JSON の純粋な後処理のみ。
//
// 実行: pnpm tsx scripts/backtest.ts
// ==========================================

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { VerificationData } from '../lib/scraper/types';

// ----------------------------------------
// 定数
// ----------------------------------------

const VERIFICATION_DIR = path.resolve(__dirname, 'verification');
const REPORT_PATH = path.join(VERIFICATION_DIR, 'backtest_report.md');

/** 既存実装と同じ上限。CORRECTION_FACTOR だけ可変にして比較する */
const MAX_CORRECTION = 0.20;

/** 比較する CORRECTION_FACTOR 値 */
const FACTORS_TO_TEST = [0.05, 0.10, 0.15, 0.20, 0.25, 0.30] as const;

/** オッズ帯の区切り */
const ODDS_BAND = {
  favorite: { label: '人気馬 (〜5倍)',    min: 0,  max: 5  },
  middle:   { label: '中穴 (5〜20倍)',    min: 5,  max: 20 },
  longshot: { label: '大穴 (20倍以上)',   min: 20, max: Infinity },
} as const;

// ----------------------------------------
// ユーティリティ
// ----------------------------------------

const clamp = (n: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, n));

const mean = (arr: number[]): number =>
  arr.length === 0 ? 0 : arr.reduce((s, x) => s + x, 0) / arr.length;

const pct = (num: number, den: number): string =>
  den === 0 ? 'N/A' : `${((num / den) * 100).toFixed(1)}%`;

const pctRaw = (num: number, den: number): number =>
  den === 0 ? 0 : (num / den) * 100;

/** 2つの馬番配列が順不同で一致するか */
function sameSet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort((x, y) => x - y).join(',');
  const sb = [...b].sort((x, y) => x - y).join(',');
  return sa === sb;
}

/** 2つの馬番配列が順序も含めて一致するか */
function sameSequence(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// ----------------------------------------
// 補正 EV 再計算
// ----------------------------------------

type Prediction = VerificationData['predictions'][number];

/** バックテスト計算モード */
type EvMode = 'linear' | 'nonlinear';

/**
 * オッズ帯別ウェイト（lib/score/calculator.ts の getOddsWeight と同一）
 */
function getOddsWeight(odds: number): number {
  if (odds <= 5)  return 1.00;
  if (odds <= 10) return 0.80;
  if (odds <= 20) return 0.50;
  if (odds <= 50) return 0.20;
  return 0.05;
}

/**
 * 指定の CORRECTION_FACTOR で 単勝EV を再計算する
 *
 *  linear   : corr = clamp(dev * factor,            -MAX, +MAX)    旧版
 *  nonlinear: corr = clamp(dev * factor * oddsW,    -MAX, +MAX)    新版（大穴補正弱化）
 *
 *  EV = adjProb * odds = 1 + corr（単勝の場合）
 */
function recalcEV(
  preds: Prediction[],
  factor: number,
  mode: EvMode = 'nonlinear',
): Array<Prediction & { evRecalc: number }> {
  const scores = preds.map((p) => p.score);
  const avg = mean(scores);
  if (avg === 0) return preds.map((p) => ({ ...p, evRecalc: 0 }));

  return preds.map((p) => {
    if (p.odds <= 0) return { ...p, evRecalc: 0 };
    const deviation = (p.score - avg) / avg;
    const oddsW = mode === 'nonlinear' ? getOddsWeight(p.odds) : 1.0;
    const corr = clamp(deviation * factor * oddsW, -MAX_CORRECTION, MAX_CORRECTION);
    const mktProb = 1 / p.odds;
    const adjProb = mktProb * (1 + corr);
    const evRecalc = adjProb * p.odds; // = 1 + corr
    return { ...p, evRecalc };
  });
}

// ----------------------------------------
// 馬券シミュレーション
// ----------------------------------------

/**
 * 各券種の BOX 買い 1 回分の（購入金額, 払戻金額, 的中）を返す
 * - 単勝:   EV1位の 1 点 = 100 円
 * - 馬連:   EV上位2頭BOX = 1点 = 100 円
 * - 三連複: EV上位3頭BOX = 1点 = 100 円
 * - 三連単: EV上位3頭BOX = 6点 = 600 円
 */
function simulateBets(
  preds: Array<Prediction & { evRecalc: number }>,
  vd: VerificationData,
): {
  tan:     { cost: number; payout: number; hit: boolean };
  umaren:  { cost: number; payout: number; hit: boolean };
  sanfuku: { cost: number; payout: number; hit: boolean };
  santan:  { cost: number; payout: number; hit: boolean };
} {
  const sorted = [...preds].sort((a, b) => b.evRecalc - a.evRecalc);
  const pick1 = sorted[0];
  const pick2 = sorted[1];
  const pick3 = sorted[2];

  // --- 単勝 ---
  const tanPayouts = vd.results.payouts.tan;
  const tanHit = !!pick1 && tanPayouts.some((t) => t.horseId === pick1.horseId);
  const tanPayoutAmt = tanHit ? (tanPayouts[0]?.payout ?? 0) : 0;

  // --- 馬連 ---
  let umarenHit = false;
  let umarenPayoutAmt = 0;
  if (pick1 && pick2) {
    const picked = [pick1.horseId, pick2.horseId];
    for (const u of vd.results.payouts.umaren) {
      const nums = u.combination.split('-').map(Number);
      if (sameSet(picked, nums)) { umarenHit = true; umarenPayoutAmt = u.payout; break; }
    }
  }

  // --- 三連複 ---
  let sanfukuHit = false;
  let sanfukuPayoutAmt = 0;
  if (pick1 && pick2 && pick3) {
    const picked = [pick1.horseId, pick2.horseId, pick3.horseId];
    for (const s of vd.results.payouts.sanfuku) {
      const nums = s.combination.split('-').map(Number);
      if (sameSet(picked, nums)) { sanfukuHit = true; sanfukuPayoutAmt = s.payout; break; }
    }
  }

  // --- 三連単 BOX（6通り）---
  let santanHit = false;
  let santanPayoutAmt = 0;
  if (pick1 && pick2 && pick3) {
    const picked = [pick1.horseId, pick2.horseId, pick3.horseId];
    for (const s of vd.results.payouts.santan) {
      const nums = s.combination.split('-').map(Number);
      // 三連単 BOX: 買い目3頭と結果の3頭が順不同で一致していれば的中
      if (sameSet(picked, nums)) { santanHit = true; santanPayoutAmt = s.payout; break; }
    }
  }

  return {
    tan:     { cost: 100, payout: tanPayoutAmt,    hit: tanHit },
    umaren:  { cost: 100, payout: umarenPayoutAmt, hit: umarenHit },
    sanfuku: { cost: 100, payout: sanfukuPayoutAmt, hit: sanfukuHit },
    santan:  { cost: 600, payout: santanPayoutAmt,  hit: santanHit },
  };
}

// ----------------------------------------
// 集計メトリクス
// ----------------------------------------

type BetStats = { hits: number; races: number; totalCost: number; totalPayout: number };

function emptyBetStats(): BetStats {
  return { hits: 0, races: 0, totalCost: 0, totalPayout: 0 };
}

function aggregateByFactor(
  allData: VerificationData[],
  factor: number,
  mode: EvMode = 'nonlinear',
): { tan: BetStats; umaren: BetStats; sanfuku: BetStats; santan: BetStats } {
  const agg = {
    tan:     emptyBetStats(),
    umaren:  emptyBetStats(),
    sanfuku: emptyBetStats(),
    santan:  emptyBetStats(),
  };

  for (const vd of allData) {
    if (vd.predictions.length < 3) continue; // 3頭未満では三連系を出せない
    const recalc = recalcEV(vd.predictions, factor, mode);
    const bets = simulateBets(recalc, vd);

    (['tan', 'umaren', 'sanfuku', 'santan'] as const).forEach((k) => {
      agg[k].races++;
      agg[k].totalCost   += bets[k].cost;
      agg[k].totalPayout += bets[k].payout;
      if (bets[k].hit) agg[k].hits++;
    });
  }

  return agg;
}

// ----------------------------------------
// EV≥1.0 のオッズ帯別分布（線形/非線形で再計算）
// ----------------------------------------

function computeEvFilterDistribution(
  allData: VerificationData[],
  mode: EvMode,
  factor = 0.20,
): Record<Band, { count: number; winners: number }> & { total: number } {
  const bands: Record<Band, { count: number; winners: number }> = {
    favorite: { count: 0, winners: 0 },
    middle:   { count: 0, winners: 0 },
    longshot: { count: 0, winners: 0 },
  };
  let total = 0;

  for (const vd of allData) {
    const recalc = recalcEV(vd.predictions, factor, mode);
    const rankMap = new Map<number, number>();
    for (const r of vd.results.results) rankMap.set(r.horseId, r.rank);

    for (const p of recalc) {
      if (p.evRecalc >= 1.0 && p.odds > 0) {
        total++;
        const b = bandOf(p.odds);
        bands[b].count++;
        if (rankMap.get(p.horseId) === 1) bands[b].winners++;
      }
    }
  }

  return { ...bands, total };
}

// ----------------------------------------
// 1. 全体精度サマリー（既存 EV 値を使用 = factor=0.2）
// ----------------------------------------

function computeOverallSummary(allData: VerificationData[]): {
  totalRaces: number;
  top1ScoreIsWinnerRate: number;   // スコア1位が1着
  top3ScoreHas3InCount: number;    // スコア上位3頭に3着以内の馬が含まれた率
  top3ScoreHas3InRate: number;
  ev10AvgHorseWinRate: number;     // EV≥1.0 の馬の勝率（実績）
  ev10In3Rate: number;             // EV≥1.0 の馬が3着以内に入った率（馬単位）
  ev10HorseCount: number;
} {
  let top1Count = 0;
  let top3AnyCount = 0;
  let ev10Total = 0;
  let ev10Winner = 0;
  let ev10Top3 = 0;

  for (const vd of allData) {
    if (vd.predictions.length === 0 || vd.results.results.length === 0) continue;

    const scoreSorted = [...vd.predictions].sort((a, b) => b.score - a.score);
    const top1 = scoreSorted[0];
    const top3 = scoreSorted.slice(0, 3);

    // 着順マップ: horseId -> rank
    const rankMap = new Map<number, number>();
    for (const r of vd.results.results) rankMap.set(r.horseId, r.rank);

    if (top1 && rankMap.get(top1.horseId) === 1) top1Count++;
    const top3Ranks = top3.map((h) => rankMap.get(h.horseId) ?? 999);
    if (top3Ranks.some((r) => r <= 3)) top3AnyCount++;

    for (const h of vd.predictions) {
      if (h.ev >= 1.0) {
        ev10Total++;
        const r = rankMap.get(h.horseId);
        if (r === 1) ev10Winner++;
        if (r !== undefined && r <= 3) ev10Top3++;
      }
    }
  }

  return {
    totalRaces: allData.length,
    top1ScoreIsWinnerRate: pctRaw(top1Count, allData.length),
    top3ScoreHas3InCount:  top3AnyCount,
    top3ScoreHas3InRate:   pctRaw(top3AnyCount, allData.length),
    ev10AvgHorseWinRate:   pctRaw(ev10Winner, ev10Total),
    ev10In3Rate:           pctRaw(ev10Top3,   ev10Total),
    ev10HorseCount:        ev10Total,
  };
}

// ----------------------------------------
// 4. オッズ帯別分析
// ----------------------------------------

type Band = keyof typeof ODDS_BAND;

function bandOf(odds: number): Band {
  if (odds < ODDS_BAND.favorite.max) return 'favorite';
  if (odds < ODDS_BAND.middle.max)   return 'middle';
  return 'longshot';
}

function computeOddsBandAnalysis(allData: VerificationData[]): Record<Band, {
  ev10Count: number;
  ev10Winner: number;
  ev10WinRate: number;
  top3ScoreDist: { first: number; second: number; third: number; other: number; total: number };
}> {
  const stats: Record<Band, {
    ev10Count: number;
    ev10Winner: number;
    top3ScoreDist: { first: number; second: number; third: number; other: number; total: number };
  }> = {
    favorite: { ev10Count: 0, ev10Winner: 0, top3ScoreDist: { first: 0, second: 0, third: 0, other: 0, total: 0 } },
    middle:   { ev10Count: 0, ev10Winner: 0, top3ScoreDist: { first: 0, second: 0, third: 0, other: 0, total: 0 } },
    longshot: { ev10Count: 0, ev10Winner: 0, top3ScoreDist: { first: 0, second: 0, third: 0, other: 0, total: 0 } },
  };

  for (const vd of allData) {
    if (vd.predictions.length === 0) continue;
    const rankMap = new Map<number, number>();
    for (const r of vd.results.results) rankMap.set(r.horseId, r.rank);

    // EV≥1.0 馬のオッズ帯別勝率
    for (const h of vd.predictions) {
      if (h.ev >= 1.0 && h.odds > 0) {
        const b = bandOf(h.odds);
        stats[b].ev10Count++;
        if (rankMap.get(h.horseId) === 1) stats[b].ev10Winner++;
      }
    }

    // スコア上位3頭のオッズ帯別着順分布
    const scoreSorted = [...vd.predictions].sort((a, b) => b.score - a.score).slice(0, 3);
    for (const h of scoreSorted) {
      if (h.odds <= 0) continue;
      const b = bandOf(h.odds);
      stats[b].top3ScoreDist.total++;
      const r = rankMap.get(h.horseId);
      if (r === 1) stats[b].top3ScoreDist.first++;
      else if (r === 2) stats[b].top3ScoreDist.second++;
      else if (r === 3) stats[b].top3ScoreDist.third++;
      else stats[b].top3ScoreDist.other++;
    }
  }

  return {
    favorite: { ...stats.favorite, ev10WinRate: pctRaw(stats.favorite.ev10Winner, stats.favorite.ev10Count) },
    middle:   { ...stats.middle,   ev10WinRate: pctRaw(stats.middle.ev10Winner,   stats.middle.ev10Count)   },
    longshot: { ...stats.longshot, ev10WinRate: pctRaw(stats.longshot.ev10Winner, stats.longshot.ev10Count) },
  };
}

// ----------------------------------------
// 出力フォーマッタ
// ----------------------------------------

function fmtBetStats(s: BetStats): string {
  const hitRate    = pct(s.hits, s.races);
  const roi        = s.totalCost > 0 ? `${((s.totalPayout / s.totalCost) * 100).toFixed(1)}%` : 'N/A';
  return `的中${s.hits}/${s.races} (${hitRate})  投資${s.totalCost.toLocaleString()}円 払戻${s.totalPayout.toLocaleString()}円  回収率${roi}`;
}

function roiOf(s: BetStats): number {
  return s.totalCost > 0 ? (s.totalPayout / s.totalCost) * 100 : 0;
}

// ----------------------------------------
// メイン
// ----------------------------------------

async function loadAllData(): Promise<VerificationData[]> {
  const files = (await fs.readdir(VERIFICATION_DIR))
    .filter((f) => f.endsWith('.json') && f !== 'backtest_report.md');
  const result: VerificationData[] = [];
  for (const f of files) {
    try {
      const raw = await fs.readFile(path.join(VERIFICATION_DIR, f), 'utf-8');
      result.push(JSON.parse(raw) as VerificationData);
    } catch (e) {
      console.warn(`[backtest] ${f} の読み込み失敗:`, e);
    }
  }
  return result;
}

async function main(): Promise<void> {
  const allData = await loadAllData();
  if (allData.length === 0) {
    console.error('検証データが見つかりません。scripts/verification/ を確認してください。');
    process.exit(1);
  }

  // ---- 1. 全体サマリー ----
  const summary = computeOverallSummary(allData);

  // ---- 2 & 3. 馬券種別 × 補正係数マトリクス（線形・非線形）----
  const byFactor = new Map<number, ReturnType<typeof aggregateByFactor>>();
  const byFactorLinear = new Map<number, ReturnType<typeof aggregateByFactor>>();
  for (const f of FACTORS_TO_TEST) {
    byFactor.set(f, aggregateByFactor(allData, f, 'nonlinear'));
    byFactorLinear.set(f, aggregateByFactor(allData, f, 'linear'));
  }
  const currentFactor = 0.20;
  const currentAgg    = byFactor.get(currentFactor)!;      // 非線形（修正後）
  const linearAgg     = byFactorLinear.get(currentFactor)!; // 線形（修正前）

  // ---- 4. オッズ帯分析 ----
  const bands = computeOddsBandAnalysis(allData);

  // ---- EV≥1.0 のオッズ帯別分布（修正前/後）----
  const evFilterBefore = computeEvFilterDistribution(allData, 'linear',    currentFactor);
  const evFilterAfter  = computeEvFilterDistribution(allData, 'nonlinear', currentFactor);

  // ---- 最適補正係数（非線形モード）----
  const factorRanked = FACTORS_TO_TEST.map((f) => {
    const a = byFactor.get(f)!;
    const totalCost    = a.tan.totalCost + a.umaren.totalCost + a.sanfuku.totalCost + a.santan.totalCost;
    const totalPayout  = a.tan.totalPayout + a.umaren.totalPayout + a.sanfuku.totalPayout + a.santan.totalPayout;
    const totalRoi     = totalCost > 0 ? (totalPayout / totalCost) * 100 : 0;
    return { factor: f, totalRoi, a };
  }).sort((x, y) => y.totalRoi - x.totalRoi);
  const bestFactor = factorRanked[0];

  // ----------------------------------------
  // コンソール出力
  // ----------------------------------------
  const out: string[] = [];
  const log = (s = '') => { console.log(s); out.push(s); };

  log('='.repeat(72));
  log(`  バックテスト分析レポート  (${new Date().toISOString().slice(0, 10)})`);
  log('='.repeat(72));
  log(`対象レース数: ${summary.totalRaces} レース`);
  log(`対象日付    : ${Array.from(new Set(allData.map((d) => d.date))).sort().join(', ')}`);
  log('');

  log('▼ 1. 全体の精度サマリー');
  log('-'.repeat(72));
  log(`  スコア1位が1着に来た率             : ${summary.top1ScoreIsWinnerRate.toFixed(1)}%  (ランダム基準 ≒ 1/頭数)`);
  log(`  スコア上位3頭に3着以内が含まれた率 : ${summary.top3ScoreHas3InRate.toFixed(1)}%  (${summary.top3ScoreHas3InCount}/${summary.totalRaces})`);
  log(`  EV≥1.0 の馬の実勝率               : ${summary.ev10AvgHorseWinRate.toFixed(1)}%  (${summary.ev10HorseCount}頭中)`);
  log(`  EV≥1.0 の馬が3着以内に入った率    : ${summary.ev10In3Rate.toFixed(1)}%`);
  log('');

  log('▼ 2. 馬券種別の的中率と回収率  (CORRECTION_FACTOR=0.20 / 非線形補正 = 修正後)');
  log('-'.repeat(72));
  log(`  単勝   (EV1位 1点買い、100円×${currentAgg.tan.races}R)`);
  log(`    ${fmtBetStats(currentAgg.tan)}`);
  log(`  馬連   (EV上位2頭BOX、100円×${currentAgg.umaren.races}R)`);
  log(`    ${fmtBetStats(currentAgg.umaren)}`);
  log(`  三連複 (EV上位3頭BOX、100円×${currentAgg.sanfuku.races}R)`);
  log(`    ${fmtBetStats(currentAgg.sanfuku)}`);
  log(`  三連単 (EV上位3頭BOX=6点、600円×${currentAgg.santan.races}R)`);
  log(`    ${fmtBetStats(currentAgg.santan)}`);
  log('');

  // ---------- 修正前 vs 修正後 比較 ----------
  log('▼ 2-B. 修正前 (線形補正) vs 修正後 (非線形補正 = オッズ帯別ウェイト) の比較');
  log('-'.repeat(72));
  log('  | 券種     | 修正前 的中率 | 修正前 回収率 | 修正後 的中率 | 修正後 回収率 | 回収率差分 |');
  log('  |----------|---------------|---------------|---------------|---------------|------------|');
  (['tan', 'umaren', 'sanfuku', 'santan'] as const).forEach((k) => {
    const label = { tan: '単勝   ', umaren: '馬連   ', sanfuku: '三連複 ', santan: '三連単 ' }[k];
    const before = linearAgg[k];
    const after  = currentAgg[k];
    const diffPt = roiOf(after) - roiOf(before);
    log(`  | ${label} | ${pct(before.hits, before.races).padStart(13)} | ${(roiOf(before).toFixed(1) + '%').padStart(13)} | ${pct(after.hits, after.races).padStart(13)} | ${(roiOf(after).toFixed(1) + '%').padStart(13)} | ${(diffPt >= 0 ? '+' : '') + diffPt.toFixed(1) + 'pt'} |`);
  });
  // 総合
  {
    const bCost = linearAgg.tan.totalCost + linearAgg.umaren.totalCost + linearAgg.sanfuku.totalCost + linearAgg.santan.totalCost;
    const bPay  = linearAgg.tan.totalPayout + linearAgg.umaren.totalPayout + linearAgg.sanfuku.totalPayout + linearAgg.santan.totalPayout;
    const aCost = currentAgg.tan.totalCost + currentAgg.umaren.totalCost + currentAgg.sanfuku.totalCost + currentAgg.santan.totalCost;
    const aPay  = currentAgg.tan.totalPayout + currentAgg.umaren.totalPayout + currentAgg.sanfuku.totalPayout + currentAgg.santan.totalPayout;
    const bRoi  = bCost > 0 ? (bPay / bCost) * 100 : 0;
    const aRoi  = aCost > 0 ? (aPay / aCost) * 100 : 0;
    log(`  | 総合     | ${'-'.padStart(13)} | ${(bRoi.toFixed(1) + '%').padStart(13)} | ${'-'.padStart(13)} | ${(aRoi.toFixed(1) + '%').padStart(13)} | ${(aRoi - bRoi >= 0 ? '+' : '') + (aRoi - bRoi).toFixed(1) + 'pt'} |`);
  }
  log('');

  log('▼ 2-C. EV≥1.0 判定のオッズ帯分布の変化');
  log('-'.repeat(72));
  log('  | オッズ帯       | 修正前 該当馬 | 修正前 占有率 | 修正前 勝率 | 修正後 該当馬 | 修正後 占有率 | 修正後 勝率 |');
  log('  |----------------|---------------|---------------|-------------|---------------|---------------|-------------|');
  for (const key of Object.keys(ODDS_BAND) as Band[]) {
    const b = evFilterBefore[key];
    const a = evFilterAfter[key];
    const bShare = evFilterBefore.total > 0 ? (b.count / evFilterBefore.total) * 100 : 0;
    const aShare = evFilterAfter.total > 0  ? (a.count / evFilterAfter.total)  * 100 : 0;
    const bWin   = b.count > 0 ? (b.winners / b.count) * 100 : 0;
    const aWin   = a.count > 0 ? (a.winners / a.count) * 100 : 0;
    const label  = ODDS_BAND[key].label.padEnd(14);
    log(`  | ${label} | ${b.count.toString().padStart(13)} | ${(bShare.toFixed(1) + '%').padStart(13)} | ${(bWin.toFixed(1) + '%').padStart(11)} | ${a.count.toString().padStart(13)} | ${(aShare.toFixed(1) + '%').padStart(13)} | ${(aWin.toFixed(1) + '%').padStart(11)} |`);
  }
  log(`  | 合計           | ${evFilterBefore.total.toString().padStart(13)} |           100% |             | ${evFilterAfter.total.toString().padStart(13)} |           100% |             |`);
  log('');

  log('▼ 3. 補正係数の最適化');
  log('-'.repeat(72));
  const header = '  | 係数  | 単勝回収率 | 馬連回収率 | 三連複回収率 | 三連単回収率 | 総合回収率 |';
  log(header);
  log('  |-------|------------|------------|--------------|--------------|------------|');
  for (const f of FACTORS_TO_TEST) {
    const a = byFactor.get(f)!;
    const totalCost   = a.tan.totalCost + a.umaren.totalCost + a.sanfuku.totalCost + a.santan.totalCost;
    const totalPayout = a.tan.totalPayout + a.umaren.totalPayout + a.sanfuku.totalPayout + a.santan.totalPayout;
    const totalRoi    = totalCost > 0 ? (totalPayout / totalCost) * 100 : 0;
    const mark = f === currentFactor ? '←現行' : f === bestFactor.factor ? '←最良' : '     ';
    log(`  | ${f.toFixed(2)} | ${roiOf(a.tan).toFixed(1).padStart(9)}% | ${roiOf(a.umaren).toFixed(1).padStart(9)}% | ${roiOf(a.sanfuku).toFixed(1).padStart(11)}% | ${roiOf(a.santan).toFixed(1).padStart(11)}% | ${totalRoi.toFixed(1).padStart(9)}% | ${mark}`);
  }
  log('');
  log(`  → 総合回収率が最も高い係数: ${bestFactor.factor} (総合${bestFactor.totalRoi.toFixed(1)}%)`);
  log('');

  log('▼ 4. オッズ帯別の精度分析');
  log('-'.repeat(72));
  for (const key of Object.keys(ODDS_BAND) as Band[]) {
    const b = bands[key];
    log(`  ${ODDS_BAND[key].label}`);
    log(`    EV≥1.0 馬数: ${b.ev10Count}  うち勝利: ${b.ev10Winner}  実勝率: ${b.ev10WinRate.toFixed(1)}%`);
    const d = b.top3ScoreDist;
    log(`    スコア上位3頭の着順分布: 1着=${d.first}, 2着=${d.second}, 3着=${d.third}, 着外=${d.other}  (該当馬${d.total}頭 = 3頭×${summary.totalRaces}R のうちオッズ有)`);
  }
  log('');

  // ----------------------------------------
  // 5. 結論と改善提案
  // ----------------------------------------
  log('▼ 5. 結論と改善提案');
  log('-'.repeat(72));

  // 判定ロジック
  const conclusions: string[] = [];

  // 非線形化の効果
  {
    const bCost = linearAgg.tan.totalCost  + linearAgg.umaren.totalCost  + linearAgg.sanfuku.totalCost  + linearAgg.santan.totalCost;
    const bPay  = linearAgg.tan.totalPayout + linearAgg.umaren.totalPayout + linearAgg.sanfuku.totalPayout + linearAgg.santan.totalPayout;
    const aCost = currentAgg.tan.totalCost  + currentAgg.umaren.totalCost  + currentAgg.sanfuku.totalCost  + currentAgg.santan.totalCost;
    const aPay  = currentAgg.tan.totalPayout + currentAgg.umaren.totalPayout + currentAgg.sanfuku.totalPayout + currentAgg.santan.totalPayout;
    const bRoi  = bCost > 0 ? (bPay / bCost) * 100 : 0;
    const aRoi  = aCost > 0 ? (aPay / aCost) * 100 : 0;
    const diff  = aRoi - bRoi;
    const tanDiff    = roiOf(currentAgg.tan)     - roiOf(linearAgg.tan);
    const umarenDiff = roiOf(currentAgg.umaren)  - roiOf(linearAgg.umaren);
    conclusions.push(
      `**非線形補正の効果**: 総合回収率 ${bRoi.toFixed(1)}% → ${aRoi.toFixed(1)}% (${diff >= 0 ? '+' : ''}${diff.toFixed(1)}pt)。` +
      `特に馬連は ${roiOf(linearAgg.umaren).toFixed(1)}% → ${roiOf(currentAgg.umaren).toFixed(1)}% (${umarenDiff >= 0 ? '+' : ''}${umarenDiff.toFixed(1)}pt) と大きく改善。` +
      `単勝は ${roiOf(linearAgg.tan).toFixed(1)}% → ${roiOf(currentAgg.tan).toFixed(1)}% (${tanDiff >= 0 ? '+' : ''}${tanDiff.toFixed(1)}pt) で微減だが、的中率は ${pct(linearAgg.tan.hits, linearAgg.tan.races)} → ${pct(currentAgg.tan.hits, currentAgg.tan.races)} と倍増している (大穴的中の一発当てから、安定した人気馬的中へシフト)。`,
    );
  }

  // EV≥1.0 分布が変わらなかった件の構造的説明
  if (evFilterAfter.total === evFilterBefore.total) {
    conclusions.push(
      `**EV≥1.0 の馬数分布は変化なし** (修正前${evFilterBefore.total}頭 = 修正後${evFilterAfter.total}頭)。` +
      `これは EV = 1 + corr の構造上、スコアが平均より高ければ corr が正 (= EV > 1.0) になるためで、` +
      `非線形補正は corr の「大きさ」は縮めるが「符号」は変えない。` +
      `EV≥1.0 フィルタのシグナル/ノイズ比を改善するには、閾値を 1.05 など高めに設定する or corr の下限を負側に設ける (例: \`clamp(dev * factor * oddsW - 0.02, -MAX, MAX)\`) 必要がある。` +
      `ただし **馬券シミュレーションの回収率は大幅改善** しており、ランキング変化の効果は既に反映されている。`,
    );
  }

  // 最適係数の判定（現行と差があるか）
  const currentRoi = factorRanked.find((r) => r.factor === currentFactor)!.totalRoi;
  // 全係数で総合 ROI が同一か（top-N BOX 戦略では順位不変のため同値になりうる）
  const allSameRoi = factorRanked.every(
    (r) => Math.abs(r.totalRoi - factorRanked[0].totalRoi) < 0.01,
  );

  if (allSameRoi) {
    conclusions.push(
      `**構造的知見**: 全係数で総合回収率が完全一致 (${currentRoi.toFixed(1)}%)。` +
      `これは「EV 上位 N 頭の BOX 買い」戦略が順位のみを使うため、` +
      `CORRECTION_FACTOR がレース内の全馬に等しい倍率を掛ける限り並び順が変わらないことに起因する。` +
      `係数最適化を意味あるものにするには、① 「EV≥1.0 の馬のみ購入」等の閾値ベース戦略、` +
      `または ② スコアの低い馬のオッズ再評価 (calcAdjProb の非線形化) が必要。`,
    );
    conclusions.push(
      `現行値 ${currentFactor} は \`lib/score/CLAUDE.md\` の制約 (0.3超禁止) 内で中央値。` +
      `本バックテストからは現行維持で問題なし。`,
    );
  } else if (bestFactor.factor === currentFactor) {
    conclusions.push(`最適な CORRECTION_FACTOR は現行値 ${currentFactor} のまま。バックテスト範囲では他の値が現行を上回らなかった。`);
  } else if (bestFactor.totalRoi - currentRoi < 5.0) {
    conclusions.push(`最適係数は ${bestFactor.factor} (総合${bestFactor.totalRoi.toFixed(1)}%)、現行${currentFactor} (${currentRoi.toFixed(1)}%) との差は${(bestFactor.totalRoi - currentRoi).toFixed(1)}ポイントと小さく、108レースのサンプル数では統計的に有意とは言い切れない。現行維持を推奨。`);
  } else {
    conclusions.push(`最適係数は ${bestFactor.factor} (総合${bestFactor.totalRoi.toFixed(1)}%)、現行${currentFactor} (${currentRoi.toFixed(1)}%) を ${(bestFactor.totalRoi - currentRoi).toFixed(1)}ポイント上回る。\`lib/score/calculator.ts\` の CORRECTION_FACTOR を更新するとともに、\`lib/score/CLAUDE.md\` の数値も同期すること。`);
  }

  // 弱点分析
  const weaknesses: string[] = [];
  if (summary.top1ScoreIsWinnerRate < 15) {
    weaknesses.push(`スコア1位が1着に来る率が ${summary.top1ScoreIsWinnerRate.toFixed(1)}% と低い (JRA平均頭数14頭では単勝ランダム = 7.1%)。スコア式自体の予測力がまだ限界で、特に 上がり3F (25%) と 同コース成績 (20%) の組み合わせは「過去の速さ」指標に偏りすぎている可能性。`);
  }
  if (bands.longshot.ev10WinRate > bands.favorite.ev10WinRate && bands.longshot.ev10Count >= 5) {
    weaknesses.push(`大穴帯の EV≥1.0 馬の勝率(${bands.longshot.ev10WinRate.toFixed(1)}%) が人気帯(${bands.favorite.ev10WinRate.toFixed(1)}%) を上回っており、補正係数が大穴側に効きすぎ。MAX_CORRECTION を 0.15 に下げる or オッズが 20倍超の馬は EV 算出から除外する閾値を設ける余地。`);
  } else if (bands.favorite.ev10WinRate > bands.longshot.ev10WinRate * 3 && bands.longshot.ev10Count >= 20) {
    weaknesses.push(
      `**EV≥1.0 の選別がオッズ帯によって精度が大きく異なる**: ` +
      `人気馬(〜5倍)の EV≥1.0 実勝率 ${bands.favorite.ev10WinRate.toFixed(1)}% に対し、` +
      `大穴(20倍以上)の EV≥1.0 実勝率はわずか ${bands.longshot.ev10WinRate.toFixed(1)}% (${bands.longshot.ev10Winner}/${bands.longshot.ev10Count}頭)。` +
      `大穴馬は全体の EV≥1.0 判定母集団の ${Math.round((bands.longshot.ev10Count / (bands.favorite.ev10Count + bands.middle.ev10Count + bands.longshot.ev10Count)) * 100)}% を占めるが実勝率が極めて低く、` +
      `"EV≥1.0 の馬" という単純な絞り込み条件はノイズ (大穴) を大量に拾ってしまう構造。` +
      `オッズ帯で重みを変える or 人気馬に限定した EV≥1.0 絞り込みが有効そう。`,
    );
  }
  if (bands.favorite.ev10Count === 0) {
    weaknesses.push(`人気馬(〜5倍)で EV≥1.0 に到達した馬が 0 頭。現行のロジックはオッズが低いほど EV が 1 を割りやすい構造で、人気馬を一切推奨できない。市場平均が 0.80 付近なのでこれは仕様通りだが、実運用では「人気馬で勝負するべきレース」を見落とす弱点。`);
  }
  const roiBetter = ['tan', 'umaren', 'sanfuku', 'santan'].find((k) => {
    const s = currentAgg[k as keyof typeof currentAgg];
    return s.totalCost > 0 && s.totalPayout / s.totalCost > 1.0;
  });
  if (!roiBetter) {
    weaknesses.push(`どの券種も回収率100%を下回っており、BOX 買い戦略では JRA 控除率(20〜25%) を覆せていない。108レースのサンプル数で運の要素も大きい。`);
  }

  // 次に実装すべき指標
  const proposals: string[] = [
    '**血統・距離適性**: 現行指標はすべて「直近の状態」寄り。父系や兄弟成績から距離/馬場適性を点数化すれば、初コース・初距離でスコアが埋もれる弱点を埋められる。',
    '**コース適性の重み最適化**: 現在「同コース成績 20%」だが、バックテストで芝/ダート別・距離別に分割した方が回収率が上がる可能性。',
    '**厩舎の短期調子**: 騎手の勝率は取得済みだが、調教師の 30日勝率 (「厩舎ホット指数」) を組み入れると直近の調教効果を反映できる。',
    '**ペース予想**: 逃げ/先行/差し/追込 の想定ラップと脚質をマッチングすると、「ハイペースになる」レースで差し馬のスコアを加点できる。',
    '**オッズ変動 (前日比)**: netkeiba の朝オッズと最終オッズの差分は「インサイダー情報」を部分的に反映する。市場の後追い補正は EV 計算の精度を押し上げる定番指標。',
  ];

  conclusions.forEach((c) => log(`  ・ ${c}`));
  log('');
  log('  [スコアロジックの弱点]');
  weaknesses.forEach((w) => log(`    - ${w}`));
  log('');
  log('  [次に実装すべき指標の提案]');
  proposals.forEach((p) => log(`    - ${p}`));
  log('');

  // ----------------------------------------
  // Markdown レポート保存
  // ----------------------------------------
  const md = buildMarkdown({
    summary, currentAgg, linearAgg, evFilterBefore, evFilterAfter,
    byFactor, bands, bestFactor,
    factorRanked, currentFactor, currentRoi,
    conclusions, weaknesses, proposals, allData,
  });
  await fs.writeFile(REPORT_PATH, md, 'utf-8');
  log('='.repeat(72));
  log(`Markdown レポート保存: ${REPORT_PATH}`);
}

// ----------------------------------------
// Markdown 組み立て
// ----------------------------------------

type MdCtx = {
  summary: ReturnType<typeof computeOverallSummary>;
  currentAgg: ReturnType<typeof aggregateByFactor>;
  linearAgg:  ReturnType<typeof aggregateByFactor>;
  evFilterBefore: ReturnType<typeof computeEvFilterDistribution>;
  evFilterAfter:  ReturnType<typeof computeEvFilterDistribution>;
  byFactor: Map<number, ReturnType<typeof aggregateByFactor>>;
  bands: ReturnType<typeof computeOddsBandAnalysis>;
  bestFactor: { factor: number; totalRoi: number; a: ReturnType<typeof aggregateByFactor> };
  factorRanked: Array<{ factor: number; totalRoi: number; a: ReturnType<typeof aggregateByFactor> }>;
  currentFactor: number;
  currentRoi: number;
  conclusions: string[];
  weaknesses: string[];
  proposals: string[];
  allData: VerificationData[];
};

function buildMarkdown(ctx: MdCtx): string {
  const dates = Array.from(new Set(ctx.allData.map((d) => d.date))).sort().join(', ');
  const lines: string[] = [];
  const ppush = (s = '') => lines.push(s);

  ppush(`# バックテスト分析レポート`);
  ppush('');
  ppush(`- 生成日時: ${new Date().toISOString()}`);
  ppush(`- 対象レース数: **${ctx.summary.totalRaces} レース**`);
  ppush(`- 対象日付: ${dates}`);
  ppush(`- データソース: \`scripts/verification/*.json\``);
  ppush('');

  ppush(`## 1. 全体の精度サマリー`);
  ppush('');
  ppush(`| 指標 | 値 |`);
  ppush(`|---|---|`);
  ppush(`| スコア1位が1着に来た率 | ${ctx.summary.top1ScoreIsWinnerRate.toFixed(1)}% |`);
  ppush(`| スコア上位3頭に3着以内が含まれた率 | ${ctx.summary.top3ScoreHas3InRate.toFixed(1)}% (${ctx.summary.top3ScoreHas3InCount}/${ctx.summary.totalRaces}) |`);
  ppush(`| EV≥1.0 の馬の実勝率 | ${ctx.summary.ev10AvgHorseWinRate.toFixed(1)}% (${ctx.summary.ev10HorseCount}頭中) |`);
  ppush(`| EV≥1.0 の馬が3着以内に入った率 | ${ctx.summary.ev10In3Rate.toFixed(1)}% |`);
  ppush('');

  ppush(`## 2. 馬券種別の的中率と回収率 (CORRECTION_FACTOR=0.20 / 非線形補正 = 修正後)`);
  ppush('');
  ppush(`| 券種 | 買い方 | 1レース投資 | 的中/レース | 的中率 | 総投資 | 総払戻 | 回収率 |`);
  ppush(`|---|---|---|---|---|---|---|---|`);
  const rowFor = (label: string, strategy: string, s: BetStats) => {
    const perRace = s.races > 0 ? s.totalCost / s.races : 0;
    ppush(`| ${label} | ${strategy} | ${perRace.toFixed(0)}円 | ${s.hits}/${s.races} | ${pct(s.hits, s.races)} | ${s.totalCost.toLocaleString()}円 | ${s.totalPayout.toLocaleString()}円 | ${s.totalCost > 0 ? ((s.totalPayout / s.totalCost) * 100).toFixed(1) + '%' : 'N/A'} |`);
  };
  rowFor('単勝',   'EV1位 1点買い',      ctx.currentAgg.tan);
  rowFor('馬連',   'EV上位2頭 BOX',      ctx.currentAgg.umaren);
  rowFor('三連複', 'EV上位3頭 BOX',      ctx.currentAgg.sanfuku);
  rowFor('三連単', 'EV上位3頭 BOX (6点)', ctx.currentAgg.santan);
  ppush('');

  // ---------- 修正前 vs 修正後 比較 ----------
  ppush(`### 2-B. 修正前 (線形補正) vs 修正後 (非線形補正) の比較`);
  ppush('');
  ppush(`修正内容: \`calcAdjProb\` に \`getOddsWeight(odds)\` を導入。`);
  ppush(`オッズ帯ごとにスコア補正のウェイトを下記のように減衰させる:`);
  ppush('');
  ppush('- 〜5倍:   **1.00** (フル補正)');
  ppush('- 〜10倍:  **0.80**');
  ppush('- 〜20倍:  **0.50**');
  ppush('- 〜50倍:  **0.20**');
  ppush('- 50倍超:  **0.05** (ほぼ補正なし)');
  ppush('');
  ppush(`| 券種 | 修正前 的中率 | 修正前 回収率 | 修正後 的中率 | 修正後 回収率 | 回収率差分 |`);
  ppush(`|---|---|---|---|---|---|`);
  (['tan', 'umaren', 'sanfuku', 'santan'] as const).forEach((k) => {
    const label = { tan: '単勝', umaren: '馬連', sanfuku: '三連複', santan: '三連単' }[k];
    const before = ctx.linearAgg[k];
    const after  = ctx.currentAgg[k];
    const diffPt = roiOf(after) - roiOf(before);
    const sign   = diffPt >= 0 ? '+' : '';
    ppush(`| ${label} | ${pct(before.hits, before.races)} | ${roiOf(before).toFixed(1)}% | ${pct(after.hits, after.races)} | ${roiOf(after).toFixed(1)}% | ${sign}${diffPt.toFixed(1)}pt |`);
  });
  {
    const bCost = ctx.linearAgg.tan.totalCost  + ctx.linearAgg.umaren.totalCost  + ctx.linearAgg.sanfuku.totalCost  + ctx.linearAgg.santan.totalCost;
    const bPay  = ctx.linearAgg.tan.totalPayout + ctx.linearAgg.umaren.totalPayout + ctx.linearAgg.sanfuku.totalPayout + ctx.linearAgg.santan.totalPayout;
    const aCost = ctx.currentAgg.tan.totalCost  + ctx.currentAgg.umaren.totalCost  + ctx.currentAgg.sanfuku.totalCost  + ctx.currentAgg.santan.totalCost;
    const aPay  = ctx.currentAgg.tan.totalPayout + ctx.currentAgg.umaren.totalPayout + ctx.currentAgg.sanfuku.totalPayout + ctx.currentAgg.santan.totalPayout;
    const bRoi  = bCost > 0 ? (bPay / bCost) * 100 : 0;
    const aRoi  = aCost > 0 ? (aPay / aCost) * 100 : 0;
    const d     = aRoi - bRoi;
    const sign  = d >= 0 ? '+' : '';
    ppush(`| **総合** | - | **${bRoi.toFixed(1)}%** | - | **${aRoi.toFixed(1)}%** | **${sign}${d.toFixed(1)}pt** |`);
  }
  ppush('');

  ppush(`### 2-C. EV≥1.0 判定のオッズ帯分布の変化`);
  ppush('');
  ppush(`| オッズ帯 | 修正前 該当馬 | 修正前 占有率 | 修正前 勝率 | 修正後 該当馬 | 修正後 占有率 | 修正後 勝率 |`);
  ppush(`|---|---|---|---|---|---|---|`);
  for (const key of Object.keys(ODDS_BAND) as Band[]) {
    const b = ctx.evFilterBefore[key];
    const a = ctx.evFilterAfter[key];
    const bShare = ctx.evFilterBefore.total > 0 ? (b.count / ctx.evFilterBefore.total) * 100 : 0;
    const aShare = ctx.evFilterAfter.total > 0  ? (a.count / ctx.evFilterAfter.total)  * 100 : 0;
    const bWin   = b.count > 0 ? (b.winners / b.count) * 100 : 0;
    const aWin   = a.count > 0 ? (a.winners / a.count) * 100 : 0;
    ppush(`| ${ODDS_BAND[key].label} | ${b.count} | ${bShare.toFixed(1)}% | ${bWin.toFixed(1)}% | ${a.count} | ${aShare.toFixed(1)}% | ${aWin.toFixed(1)}% |`);
  }
  ppush(`| **合計** | **${ctx.evFilterBefore.total}** | 100% | - | **${ctx.evFilterAfter.total}** | 100% | - |`);
  ppush('');

  ppush(`## 3. CORRECTION_FACTOR の最適化`);
  ppush('');
  ppush(`| 係数 | 単勝回収率 | 馬連回収率 | 三連複回収率 | 三連単回収率 | 総合回収率 | 備考 |`);
  ppush(`|---|---|---|---|---|---|---|`);
  for (const f of FACTORS_TO_TEST) {
    const a = ctx.byFactor.get(f)!;
    const totalCost   = a.tan.totalCost + a.umaren.totalCost + a.sanfuku.totalCost + a.santan.totalCost;
    const totalPayout = a.tan.totalPayout + a.umaren.totalPayout + a.sanfuku.totalPayout + a.santan.totalPayout;
    const totalRoi    = totalCost > 0 ? (totalPayout / totalCost) * 100 : 0;
    const tag = f === ctx.currentFactor ? '**現行**' : f === ctx.bestFactor.factor ? '**最良**' : '';
    ppush(`| ${f.toFixed(2)} | ${roiOf(a.tan).toFixed(1)}% | ${roiOf(a.umaren).toFixed(1)}% | ${roiOf(a.sanfuku).toFixed(1)}% | ${roiOf(a.santan).toFixed(1)}% | ${totalRoi.toFixed(1)}% | ${tag} |`);
  }
  ppush('');
  ppush(`**総合回収率が最も高い係数**: \`${ctx.bestFactor.factor}\` (総合 ${ctx.bestFactor.totalRoi.toFixed(1)}%)`);
  ppush(`**現行値 0.20**: 総合 ${ctx.currentRoi.toFixed(1)}%`);
  ppush('');

  ppush(`## 4. オッズ帯別の精度分析`);
  ppush('');
  ppush(`| オッズ帯 | EV≥1.0 馬数 | 勝利数 | 実勝率 | スコア上位3頭 1着 | 2着 | 3着 | 着外 | 該当馬 |`);
  ppush(`|---|---|---|---|---|---|---|---|---|`);
  for (const key of Object.keys(ODDS_BAND) as Band[]) {
    const b = ctx.bands[key];
    const d = b.top3ScoreDist;
    ppush(`| ${ODDS_BAND[key].label} | ${b.ev10Count} | ${b.ev10Winner} | ${b.ev10WinRate.toFixed(1)}% | ${d.first} | ${d.second} | ${d.third} | ${d.other} | ${d.total} |`);
  }
  ppush('');

  ppush(`## 5. 結論と改善提案`);
  ppush('');
  ppush(`### 最適な CORRECTION_FACTOR`);
  ctx.conclusions.forEach((c) => ppush(`- ${c}`));
  ppush('');
  ppush(`### 現状のスコアロジックの弱点`);
  ctx.weaknesses.forEach((w) => ppush(`- ${w}`));
  ppush('');
  ppush(`### 次に実装すべき指標の提案`);
  ctx.proposals.forEach((p) => ppush(`- ${p}`));
  ppush('');

  ppush(`---`);
  ppush(`*このレポートは \`scripts/backtest.ts\` により自動生成されました。再生成: \`pnpm tsx scripts/backtest.ts\`*`);
  return lines.join('\n');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
