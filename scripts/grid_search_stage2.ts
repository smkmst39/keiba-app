// ==========================================
// グリッドサーチ Stage 2: 券種別参加条件の最適化
//
// Stage 1 で選ばれた EV パラメータを固定し、券種ごとに独立して最適な
// 参加条件 (EV 閾値 / BOX 頭数) を探索する。
//
// - 単勝: EV ≥ threshold (1.00 〜 1.20, 刻み 0.01) → Top-1 1点買い
// - 複勝: EV ≥ threshold (0.80 〜 1.10, 刻み 0.01) → Top-1 1点買い
// - 馬連: EV 上位 N 頭 BOX (N ∈ {2,3,4,5})  cost = C(N,2) × 100
// - 馬単: EV 上位 N 頭 BOX (N ∈ {2,3,4,5})  cost = P(N,2) × 100
// - ワイド: EV 上位 N 頭 BOX (N ∈ {2,3,4,5}) cost = C(N,2) × 100
// - 三連複: EV 上位 N 頭 BOX (N ∈ {3,4,5,6}) cost = C(N,3) × 100
// - 三連単: EV 上位 N 頭 BOX (N ∈ {3,4,5,6}) cost = P(N,3) × 100
//
// クロスバリデーション: 前半/後半で独立に評価して安定性を報告。
//
// 実行: pnpm tsx scripts/grid_search_stage2.ts
// 出力: scripts/verification/grid_search_stage2_report.md
// ==========================================

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { VerificationData } from '../lib/scraper/types';

const DIR = path.resolve(__dirname, 'verification');
const REPORT = path.join(DIR, 'grid_search_stage2_report.md');

/** Stage 1 で採択している EV パラメータ (現行・本番値) */
const PARAMS = { cf: 0.20, offset: -0.02, max: 0.20 };

// ----------------------------------------
// ユーティリティ
// ----------------------------------------

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const mean  = (a: number[]): number => a.length === 0 ? 0 : a.reduce((s, x) => s + x, 0) / a.length;

function range(from: number, to: number, step: number): number[] {
  const r: number[] = [];
  for (let v = from; v <= to + step / 2; v += step) r.push(Math.round(v * 10000) / 10000);
  return r;
}

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

// ----------------------------------------
// EV 再計算 (Stage 1 と同じ式)
// ----------------------------------------

function getOddsWeight(odds: number): number {
  if (odds <= 5)  return 1.00;
  if (odds <= 10) return 0.80;
  if (odds <= 20) return 0.50;
  if (odds <= 50) return 0.20;
  return 0.05;
}

type Prediction = VerificationData['predictions'][number] & { evNew: number };

function recomputeEV(preds: VerificationData['predictions']): Prediction[] {
  const scores = preds.map((x) => x.score);
  const avg = mean(scores);
  if (avg === 0) return preds.map((x) => ({ ...x, evNew: 0 }));

  return preds.map((x) => {
    if (x.odds <= 0) return { ...x, evNew: 0 };
    const dev  = (x.score - avg) / avg;
    const oddsW = getOddsWeight(x.odds);
    const corr = clamp(dev * PARAMS.cf * oddsW + PARAMS.offset, -PARAMS.max, PARAMS.max);
    return { ...x, evNew: 1 + corr };
  });
}

// ----------------------------------------
// 1 レース × 戦略 の損益計算
// ----------------------------------------

type Result = { cost: number; payout: number; hit: boolean; participated: boolean };

/** 単勝/複勝: Top-1 by EV、EV >= threshold なら参加 */
function betSingle(
  preds: Prediction[],
  vd: VerificationData,
  threshold: number,
  type: 'tan' | 'fuku',
): Result {
  const sorted = preds.filter((h) => h.odds > 0).sort((a, b) => b.evNew - a.evNew);
  const pick = sorted[0];
  if (!pick || pick.evNew < threshold) return { cost: 0, payout: 0, hit: false, participated: false };

  let payout = 0;
  let hit = false;
  if (type === 'tan') {
    const w = vd.results.payouts.tan.find((t) => t.horseId === pick.horseId);
    if (w) { hit = true; payout = w.payout; }
  } else {
    const w = (vd.results.payouts.fuku ?? []).find((f) => f.horseId === pick.horseId);
    if (w) { hit = true; payout = w.payout; }
  }
  return { cost: 100, payout, hit, participated: true };
}

/** 馬連/ワイド: Top-N BOX (unordered pairs) */
function betPairBox(
  preds: Prediction[],
  vd: VerificationData,
  n: number,
  type: 'umaren' | 'wide',
): Result {
  const sorted = preds.filter((h) => h.odds > 0).sort((a, b) => b.evNew - a.evNew).slice(0, n);
  if (sorted.length < 2) return { cost: 0, payout: 0, hit: false, participated: false };

  const pairs = combinations(sorted.map((h) => h.horseId), 2);
  const cost = pairs.length * 100;

  let payout = 0;
  let hit = false;
  const arr = type === 'umaren' ? vd.results.payouts.umaren : (vd.results.payouts.wide ?? []);
  for (const pair of pairs) {
    for (const w of arr) {
      if (sameSet(pair, w.combination.split('-').map(Number))) {
        payout += w.payout;
        hit = true;
        break;
      }
    }
  }
  return { cost, payout, hit, participated: true };
}

/** 馬単: Top-N BOX (ordered pairs) */
function betUmatan(preds: Prediction[], vd: VerificationData, n: number): Result {
  const sorted = preds.filter((h) => h.odds > 0).sort((a, b) => b.evNew - a.evNew).slice(0, n);
  if (sorted.length < 2) return { cost: 0, payout: 0, hit: false, participated: false };

  const perms = permutations(sorted.map((h) => h.horseId), 2);
  const cost = perms.length * 100;

  let payout = 0;
  let hit = false;
  const arr = vd.results.payouts.umatan ?? [];
  for (const perm of perms) {
    for (const u of arr) {
      if (sameSeq(perm, u.combination.split('-').map(Number))) {
        payout += u.payout;
        hit = true;
        break;
      }
    }
  }
  return { cost, payout, hit, participated: true };
}

/** 三連複: Top-N BOX (unordered triples) */
function betSanfuku(preds: Prediction[], vd: VerificationData, n: number): Result {
  const sorted = preds.filter((h) => h.odds > 0).sort((a, b) => b.evNew - a.evNew).slice(0, n);
  if (sorted.length < 3) return { cost: 0, payout: 0, hit: false, participated: false };

  const triples = combinations(sorted.map((h) => h.horseId), 3);
  const cost = triples.length * 100;

  let payout = 0;
  let hit = false;
  for (const triple of triples) {
    for (const s of vd.results.payouts.sanfuku) {
      if (sameSet(triple, s.combination.split('-').map(Number))) {
        payout += s.payout;
        hit = true;
        break;
      }
    }
  }
  return { cost, payout, hit, participated: true };
}

/** 三連単: Top-N BOX (ordered triples) */
function betSantan(preds: Prediction[], vd: VerificationData, n: number): Result {
  const sorted = preds.filter((h) => h.odds > 0).sort((a, b) => b.evNew - a.evNew).slice(0, n);
  if (sorted.length < 3) return { cost: 0, payout: 0, hit: false, participated: false };

  const perms = permutations(sorted.map((h) => h.horseId), 3);
  const cost = perms.length * 100;

  let payout = 0;
  let hit = false;
  for (const perm of perms) {
    for (const s of vd.results.payouts.santan) {
      if (sameSeq(perm, s.combination.split('-').map(Number))) {
        payout += s.payout;
        hit = true;
        break;
      }
    }
  }
  return { cost, payout, hit, participated: true };
}

// ----------------------------------------
// 集計
// ----------------------------------------

type Agg = {
  cost: number; payout: number; hits: number; participated: number; races: number;
};
const roi = (a: Agg): number => a.cost > 0 ? (a.payout / a.cost) * 100 : 0;
const pct = (n: number, d: number): string => d === 0 ? 'N/A' : `${((n / d) * 100).toFixed(1)}%`;

function aggregate(data: VerificationData[], betFn: (p: Prediction[], v: VerificationData) => Result): Agg {
  const agg: Agg = { cost: 0, payout: 0, hits: 0, participated: 0, races: 0 };
  for (const vd of data) {
    if (vd.predictions.length < 2 || vd.results.results.length === 0) continue;
    agg.races++;
    const preds = recomputeEV(vd.predictions);
    const r = betFn(preds, vd);
    if (r.participated) {
      agg.participated++;
      agg.cost += r.cost;
      agg.payout += r.payout;
      if (r.hit) agg.hits++;
    }
  }
  return agg;
}

// ----------------------------------------
// 券種別最適化
// ----------------------------------------

type Trial<P> = { param: P; all: Agg; first: Agg; second: Agg };

function optimize<P>(
  data: VerificationData[], firstHalf: VerificationData[], secondHalf: VerificationData[],
  params: P[], makeBetFn: (p: P) => (preds: Prediction[], vd: VerificationData) => Result,
): Trial<P>[] {
  return params.map((p) => {
    const fn = makeBetFn(p);
    return { param: p, all: aggregate(data, fn), first: aggregate(firstHalf, fn), second: aggregate(secondHalf, fn) };
  });
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
  const sorted = [...all].sort((a, b) => a.date.localeCompare(b.date));
  const mid = Math.floor(sorted.length / 2);
  const first = sorted.slice(0, mid);
  const second = sorted.slice(mid);

  console.log(`対象: ${all.length}R (前半${first.length} / 後半${second.length})`);
  console.log(`EV パラメータ: CF=${PARAMS.cf}, offset=${PARAMS.offset}, MAX=${PARAMS.max}`);
  console.log('');

  // ---- 単勝 ----
  const tanThresholds = range(1.00, 1.20, 0.01);
  const tanResults = optimize(all, first, second, tanThresholds, (th) => (p, v) => betSingle(p, v, th, 'tan'));

  // ---- 複勝 ----
  const fukuThresholds = range(0.80, 1.10, 0.01);
  const fukuResults = optimize(all, first, second, fukuThresholds, (th) => (p, v) => betSingle(p, v, th, 'fuku'));

  // ---- 馬連 / ワイド ----
  const pairNs = [2, 3, 4, 5];
  const umarenResults = optimize(all, first, second, pairNs, (n) => (p, v) => betPairBox(p, v, n, 'umaren'));
  const wideResults   = optimize(all, first, second, pairNs, (n) => (p, v) => betPairBox(p, v, n, 'wide'));

  // ---- 馬単 ----
  const umatanResults = optimize(all, first, second, pairNs, (n) => (p, v) => betUmatan(p, v, n));

  // ---- 三連複 / 三連単 ----
  const tripleNs = [3, 4, 5, 6];
  const sanfukuResults = optimize(all, first, second, tripleNs, (n) => (p, v) => betSanfuku(p, v, n));
  const santanResults  = optimize(all, first, second, tripleNs, (n) => (p, v) => betSantan(p, v, n));

  const best = <P>(rs: Trial<P>[]): Trial<P> => [...rs].sort((a, b) => roi(b.all) - roi(a.all))[0];
  const bestParticipating = <P>(rs: Trial<P>[], minParticipation = 0.10): Trial<P> => {
    const filtered = rs.filter((r) => r.all.races > 0 && r.all.participated / r.all.races >= minParticipation);
    return filtered.length > 0 ? [...filtered].sort((a, b) => roi(b.all) - roi(a.all))[0] : best(rs);
  };

  // ---- 出力 ----
  const out: string[] = [];
  const log = (s = ''): void => { console.log(s); out.push(s); };

  log('='.repeat(80));
  log('  グリッドサーチ Stage 2: 券種別参加条件の最適化');
  log('='.repeat(80));
  log('');

  const section = <P>(name: string, rs: Trial<P>[], fmtParam: (p: P) => string, currentParam?: P, participationFloor = 0.0): void => {
    log(`▼ ${name}`);
    log('-'.repeat(80));
    log('| param        | 参加    | 参加率 | 的中   | 的中率 | 投資       | 払戻       | 回収率  | 前後半差 |');
    log('|--------------|---------|--------|--------|--------|------------|------------|---------|----------|');
    const sorted = [...rs].sort((a, b) => roi(b.all) - roi(a.all));
    for (const r of sorted) {
      const stability = Math.abs(roi(r.first) - roi(r.second));
      const isCurrent = currentParam !== undefined && fmtParam(r.param) === fmtParam(currentParam);
      const tag = isCurrent ? ' ←現行' : '';
      log(`| ${fmtParam(r.param).padEnd(12)} | ${r.all.participated.toString().padStart(4)}/${r.all.races.toString().padEnd(4)} | ${pct(r.all.participated, r.all.races).padStart(6)} | ${r.all.hits.toString().padStart(6)} | ${pct(r.all.hits, r.all.participated).padStart(6)} | ${r.all.cost.toLocaleString().padStart(10)} | ${r.all.payout.toLocaleString().padStart(10)} | ${(roi(r.all).toFixed(1) + '%').padStart(7)} | ${stability.toFixed(1).padStart(6)}pt |${tag}`);
    }
    const pick = bestParticipating(rs, participationFloor);
    const stab = Math.abs(roi(pick.first) - roi(pick.second));
    log(`  → 推奨 (参加率≥${Math.round(participationFloor * 100)}%): param=${fmtParam(pick.param)}, ROI=${roi(pick.all).toFixed(1)}%, 前後半差=${stab.toFixed(1)}pt`);
    log('');
  };

  // 現行: 単勝=EV>=1.05, 複勝=top-1 (F1), 馬連=2, 馬単=2, ワイド=3, 三連複=3, 三連単=3
  section('単勝 (EV閾値 ≥ threshold)',    tanResults,   (th) => `EV≥${th.toFixed(2)}`,  1.05, 0.10);
  section('複勝 (EV閾値 ≥ threshold)',    fukuResults,  (th) => `EV≥${th.toFixed(2)}`,  undefined, 0.10);
  section('馬連 (EV 上位 N 頭 BOX)',       umarenResults, (n) => `top-${n}`,            2,    0.50);
  section('馬単 (EV 上位 N 頭 BOX)',       umatanResults, (n) => `top-${n}`,            2,    0.50);
  section('ワイド (EV 上位 N 頭 BOX)',     wideResults,   (n) => `top-${n}`,            3,    0.50);
  section('三連複 (EV 上位 N 頭 BOX)',     sanfukuResults, (n) => `top-${n}`,           3,    0.50);
  section('三連単 (EV 上位 N 頭 BOX)',     santanResults,  (n) => `top-${n}`,           3,    0.50);

  // ---- サマリー (推奨構成での合成回収率) ----
  const picks = {
    tan:     bestParticipating(tanResults,   0.10),
    fuku:    bestParticipating(fukuResults,  0.10),
    umaren:  bestParticipating(umarenResults, 0.50),
    umatan:  bestParticipating(umatanResults, 0.50),
    wide:    bestParticipating(wideResults,   0.50),
    sanfuku: bestParticipating(sanfukuResults, 0.50),
    santan:  bestParticipating(santanResults,  0.50),
  };

  log('▼ 推奨構成 サマリー');
  log('-'.repeat(80));
  log('| 券種    | 推奨 param  | 回収率 | 参加率 | 前後半差 |');
  log('|---------|-------------|--------|--------|----------|');
  const fmt = (label: string, p: string, a: Agg, first: Agg, second: Agg): void => {
    const stab = Math.abs(roi(first) - roi(second));
    log(`| ${label.padEnd(7)} | ${p.padEnd(11)} | ${(roi(a).toFixed(1) + '%').padStart(6)} | ${pct(a.participated, a.races).padStart(6)} | ${stab.toFixed(1).padStart(6)}pt |`);
  };
  fmt('単勝',   `EV≥${(picks.tan.param as number).toFixed(2)}`,   picks.tan.all,    picks.tan.first,    picks.tan.second);
  fmt('複勝',   `EV≥${(picks.fuku.param as number).toFixed(2)}`,  picks.fuku.all,   picks.fuku.first,   picks.fuku.second);
  fmt('馬連',   `top-${picks.umaren.param}`,                      picks.umaren.all, picks.umaren.first, picks.umaren.second);
  fmt('馬単',   `top-${picks.umatan.param}`,                      picks.umatan.all, picks.umatan.first, picks.umatan.second);
  fmt('ワイド', `top-${picks.wide.param}`,                        picks.wide.all,   picks.wide.first,   picks.wide.second);
  fmt('三連複', `top-${picks.sanfuku.param}`,                     picks.sanfuku.all, picks.sanfuku.first, picks.sanfuku.second);
  fmt('三連単', `top-${picks.santan.param}`,                      picks.santan.all, picks.santan.first, picks.santan.second);
  log('');

  // ---- Markdown ----
  const md: string[] = [];
  const mp = (s = ''): void => { md.push(s); };
  mp(`# グリッドサーチ Stage 2: 券種別参加条件の最適化`);
  mp('');
  mp(`- 生成日時: ${new Date().toISOString()}`);
  mp(`- 対象: **${all.length} レース** (前半 ${first.length}R / 後半 ${second.length}R)`);
  mp(`- EV パラメータ (固定): CF=${PARAMS.cf}, offset=${PARAMS.offset}, MAX=${PARAMS.max}`);
  mp('');

  mp(`## 推奨構成`);
  mp('');
  mp(`各券種を独立に最適化した結果 (参加率フロア適用済み):`);
  mp('');
  mp(`| 券種 | 推奨 param | 回収率 | 参加率 | 前後半差 |`);
  mp(`|---|---|---|---|---|`);
  const fmtMd = (label: string, p: string, a: Agg, first: Agg, second: Agg): void => {
    const stab = Math.abs(roi(first) - roi(second));
    mp(`| ${label} | ${p} | **${roi(a).toFixed(1)}%** | ${pct(a.participated, a.races)} | ${stab.toFixed(1)}pt |`);
  };
  fmtMd('単勝', `EV≥${(picks.tan.param as number).toFixed(2)}`,   picks.tan.all,    picks.tan.first,    picks.tan.second);
  fmtMd('複勝', `EV≥${(picks.fuku.param as number).toFixed(2)}`,  picks.fuku.all,   picks.fuku.first,   picks.fuku.second);
  fmtMd('馬連', `top-${picks.umaren.param}`,                      picks.umaren.all, picks.umaren.first, picks.umaren.second);
  fmtMd('馬単', `top-${picks.umatan.param}`,                      picks.umatan.all, picks.umatan.first, picks.umatan.second);
  fmtMd('ワイド', `top-${picks.wide.param}`,                      picks.wide.all,   picks.wide.first,   picks.wide.second);
  fmtMd('三連複', `top-${picks.sanfuku.param}`,                   picks.sanfuku.all, picks.sanfuku.first, picks.sanfuku.second);
  fmtMd('三連単', `top-${picks.santan.param}`,                    picks.santan.all, picks.santan.first, picks.santan.second);
  mp('');

  // 詳細テーブル
  const appendDetail = <P>(title: string, rs: Trial<P>[], fmtP: (p: P) => string): void => {
    mp(`## ${title}`);
    mp('');
    mp(`| param | 参加 | 参加率 | 的中 | 的中率 | 投資 | 払戻 | 回収率 | 前後半差 |`);
    mp(`|---|---|---|---|---|---|---|---|---|`);
    [...rs].sort((a, b) => roi(b.all) - roi(a.all)).forEach((r) => {
      const stab = Math.abs(roi(r.first) - roi(r.second));
      mp(`| ${fmtP(r.param)} | ${r.all.participated}/${r.all.races} | ${pct(r.all.participated, r.all.races)} | ${r.all.hits} | ${pct(r.all.hits, r.all.participated)} | ${r.all.cost.toLocaleString()}円 | ${r.all.payout.toLocaleString()}円 | **${roi(r.all).toFixed(1)}%** | ${stab.toFixed(1)}pt |`);
    });
    mp('');
  };
  appendDetail('単勝: EV閾値別',   tanResults,   (th) => `EV≥${(th as number).toFixed(2)}`);
  appendDetail('複勝: EV閾値別',   fukuResults,  (th) => `EV≥${(th as number).toFixed(2)}`);
  appendDetail('馬連: 上位N頭BOX', umarenResults, (n) => `top-${n}`);
  appendDetail('馬単: 上位N頭BOX', umatanResults, (n) => `top-${n}`);
  appendDetail('ワイド: 上位N頭BOX', wideResults, (n) => `top-${n}`);
  appendDetail('三連複: 上位N頭BOX', sanfukuResults, (n) => `top-${n}`);
  appendDetail('三連単: 上位N頭BOX', santanResults,  (n) => `top-${n}`);

  mp(`---`);
  mp(`*再実行: \`pnpm tsx scripts/grid_search_stage2.ts\`*`);

  await fs.writeFile(REPORT, md.join('\n'), 'utf-8');
  log('='.repeat(80));
  log(`Markdown: ${REPORT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
