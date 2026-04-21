// ==========================================
// 参加条件グリッドサーチ (目標: 回収率 110% 以上)
//
// 各券種に対して以下の5軸を変化させて参加条件を最適化:
//   - evMin:    軸馬の EV 閾値  (10 値)
//   - scoreMin: 軸馬のスコア下限 (7 値: 0=なし + 50/55/60/65/70/75)
//   - oddsMax:  軸馬のオッズ上限 (7 値: Inf=なし + 50/30/20/15/10/7)
//   - scoreGap: スコア1位-2位差 (3 値: 0/5/10)
//   - evGap:    EV1位-2位差    (3 値: 0/0.05/0.10)
// 合計 10 × 7 × 7 × 3 × 3 = 4410 通り × 7 券種
//
// 採用基準 (優先順位):
//   1. 回収率 >= 110% 最優先 (達成できない券種は 100% 超を採用)
//   2. 参加率 >= 5% (最低 40R)
//   3. 的中数 >= 10
//   4. 前半/後半差 <= 15pt
//
// 実行: pnpm tsx scripts/grid_search_participation.ts
// 出力: scripts/verification/participation_optimization_report.md
// ==========================================

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { VerificationData } from '../lib/scraper/types';

const DIR = path.resolve(__dirname, 'verification');
const REPORT = path.join(DIR, 'participation_optimization_report.md');

// ----------------------------------------
// 探索範囲
// ----------------------------------------

const EV_MINS     = [1.00, 1.02, 1.05, 1.08, 1.10, 1.13, 1.15, 1.18, 1.20, 1.25];
const SCORE_MINS  = [0, 50, 55, 60, 65, 70, 75];
const ODDS_MAXES  = [Infinity, 50, 30, 20, 15, 10, 7];
const SCORE_GAPS  = [0, 5, 10];
const EV_GAPS     = [0, 0.05, 0.10];

// ----------------------------------------
// 採用基準
// ----------------------------------------

const TARGET_ROI        = 110;
const FALLBACK_ROI      = 100;
const MIN_PARTICIPATION = 0.05; // 5%
const MIN_RACE_COUNT    = 40;
const MIN_HIT_COUNT     = 10;
const MAX_STABILITY_GAP = 15;   // 前後半差の許容

// ----------------------------------------
// ユーティリティ
// ----------------------------------------

const roi = (c: number, p: number): number => c > 0 ? (p / c) * 100 : 0;
const pct = (n: number, d: number): string => d === 0 ? 'N/A' : `${((n / d) * 100).toFixed(1)}%`;

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
// 事前計算: 各レースで sorted-by-EV 配列を保持
// ----------------------------------------

type Prediction = VerificationData['predictions'][number];

type RaceContext = {
  vd: VerificationData;
  sortedByEV: Prediction[];    // odds>0 のみ、EV 降順
  evGap01: number;             // EV1位 - EV2位
  scoreGap01: number;          // スコア1位 - スコア2位
};

function prepareRaces(data: VerificationData[]): RaceContext[] {
  const out: RaceContext[] = [];
  for (const vd of data) {
    if (vd.predictions.length < 2 || vd.results.results.length === 0) continue;
    const sortedByEV = [...vd.predictions].filter((p) => p.odds > 0).sort((a, b) => b.ev - a.ev);
    if (sortedByEV.length < 1) continue;
    const sortedByScore = [...vd.predictions].filter((p) => p.odds > 0).sort((a, b) => b.score - a.score);
    const evGap01    = sortedByEV.length >= 2 ? sortedByEV[0].ev - sortedByEV[1].ev : 0;
    const scoreGap01 = sortedByScore.length >= 2 ? sortedByScore[0].score - sortedByScore[1].score : 0;
    out.push({ vd, sortedByEV, evGap01, scoreGap01 });
  }
  return out;
}

// ----------------------------------------
// 条件チェック & 戦略
// ----------------------------------------

type Condition = {
  evMin: number;
  scoreMin: number;
  oddsMax: number;
  scoreGap: number;
  evGap: number;
};

type BetOutcome = { cost: number; payout: number; hit: boolean };

/** N頭の上位馬が全員 evMin/scoreMin/oddsMax を満たすか */
function topNPass(sorted: Prediction[], n: number, c: Condition): boolean {
  if (sorted.length < n) return false;
  for (let i = 0; i < n; i++) {
    if (sorted[i].ev < c.evMin) return false;
    if (sorted[i].score < c.scoreMin) return false;
    if (sorted[i].odds > c.oddsMax) return false;
  }
  return true;
}

/** レース全体のギャップ条件 (scoreGap01 / evGap01) */
function gapPass(ctx: RaceContext, c: Condition): boolean {
  return ctx.scoreGap01 >= c.scoreGap && ctx.evGap01 >= c.evGap;
}

// ---- 券種別 betting ----

function betTan(ctx: RaceContext, c: Condition): BetOutcome {
  if (!gapPass(ctx, c) || !topNPass(ctx.sortedByEV, 1, c)) return { cost: 0, payout: 0, hit: false };
  const pick = ctx.sortedByEV[0];
  const win = ctx.vd.results.payouts.tan.find((t) => t.horseId === pick.horseId);
  return { cost: 100, payout: win?.payout ?? 0, hit: !!win };
}

function betFuku(ctx: RaceContext, c: Condition): BetOutcome {
  if (!gapPass(ctx, c) || !topNPass(ctx.sortedByEV, 1, c)) return { cost: 0, payout: 0, hit: false };
  const pick = ctx.sortedByEV[0];
  const win = (ctx.vd.results.payouts.fuku ?? []).find((f) => f.horseId === pick.horseId);
  return { cost: 100, payout: win?.payout ?? 0, hit: !!win };
}

function betUmaren(ctx: RaceContext, c: Condition): BetOutcome {
  if (!gapPass(ctx, c) || !topNPass(ctx.sortedByEV, 2, c)) return { cost: 0, payout: 0, hit: false };
  const ids = [ctx.sortedByEV[0].horseId, ctx.sortedByEV[1].horseId];
  let hit = false, payout = 0;
  for (const u of ctx.vd.results.payouts.umaren) {
    if (sameSet(ids, u.combination.split('-').map(Number))) { hit = true; payout = u.payout; break; }
  }
  return { cost: 100, payout, hit };
}

function betUmatan(ctx: RaceContext, c: Condition): BetOutcome {
  // 軸(EV1位)→相手(EV2位) の1点 + 逆順も買う = 2点 (BOX)
  if (!gapPass(ctx, c) || !topNPass(ctx.sortedByEV, 2, c)) return { cost: 0, payout: 0, hit: false };
  const ids = [ctx.sortedByEV[0].horseId, ctx.sortedByEV[1].horseId];
  const perms = permutations(ids, 2);
  let hit = false, payout = 0;
  for (const perm of perms) {
    for (const u of ctx.vd.results.payouts.umatan ?? []) {
      if (sameSeq(perm, u.combination.split('-').map(Number))) { hit = true; payout += u.payout; break; }
    }
  }
  return { cost: 200, payout, hit };
}

function betWide(ctx: RaceContext, c: Condition): BetOutcome {
  if (!gapPass(ctx, c) || !topNPass(ctx.sortedByEV, 2, c)) return { cost: 0, payout: 0, hit: false };
  const ids = [ctx.sortedByEV[0].horseId, ctx.sortedByEV[1].horseId];
  let hit = false, payout = 0;
  for (const w of ctx.vd.results.payouts.wide ?? []) {
    if (sameSet(ids, w.combination.split('-').map(Number))) { hit = true; payout = w.payout; break; }
  }
  return { cost: 100, payout, hit };
}

function betSanfuku(ctx: RaceContext, c: Condition): BetOutcome {
  if (!gapPass(ctx, c) || !topNPass(ctx.sortedByEV, 3, c)) return { cost: 0, payout: 0, hit: false };
  const ids = [ctx.sortedByEV[0].horseId, ctx.sortedByEV[1].horseId, ctx.sortedByEV[2].horseId];
  let hit = false, payout = 0;
  for (const s of ctx.vd.results.payouts.sanfuku) {
    if (sameSet(ids, s.combination.split('-').map(Number))) { hit = true; payout = s.payout; break; }
  }
  return { cost: 100, payout, hit };
}

function betSantan(ctx: RaceContext, c: Condition): BetOutcome {
  // 軸1頭 × 相手2頭マルチ = 軸を1着に固定 × 相手の2-3着順列 (2点)
  // 実装簡略化: top-3 BOX (6点)
  if (!gapPass(ctx, c) || !topNPass(ctx.sortedByEV, 3, c)) return { cost: 0, payout: 0, hit: false };
  const ids = [ctx.sortedByEV[0].horseId, ctx.sortedByEV[1].horseId, ctx.sortedByEV[2].horseId];
  const perms = permutations(ids, 3);
  let hit = false, payout = 0;
  for (const perm of perms) {
    for (const s of ctx.vd.results.payouts.santan) {
      if (sameSeq(perm, s.combination.split('-').map(Number))) { hit = true; payout += s.payout; break; }
    }
  }
  return { cost: 600, payout, hit };
}

const BET_FNS = {
  tan:     betTan,
  fuku:    betFuku,
  umaren:  betUmaren,
  umatan:  betUmatan,
  wide:    betWide,
  sanfuku: betSanfuku,
  santan:  betSantan,
};

// ----------------------------------------
// 集計
// ----------------------------------------

type Stats = {
  participated: number;
  total: number;
  hits: number;
  cost: number;
  payout: number;
};

function simulate(
  races: RaceContext[],
  betFn: (ctx: RaceContext, c: Condition) => BetOutcome,
  c: Condition,
): Stats {
  const s: Stats = { participated: 0, total: races.length, hits: 0, cost: 0, payout: 0 };
  for (const ctx of races) {
    const r = betFn(ctx, c);
    if (r.cost > 0) {
      s.participated++;
      s.cost += r.cost;
      s.payout += r.payout;
      if (r.hit) s.hits++;
    }
  }
  return s;
}

// ----------------------------------------
// 全条件の探索
// ----------------------------------------

type Trial = {
  betType: keyof typeof BET_FNS;
  cond: Condition;
  all: Stats;
  first: Stats;
  second: Stats;
  stability: number;
  roi: number;
};

function enumConditions(): Condition[] {
  const out: Condition[] = [];
  for (const evMin of EV_MINS) {
    for (const scoreMin of SCORE_MINS) {
      for (const oddsMax of ODDS_MAXES) {
        for (const scoreGap of SCORE_GAPS) {
          for (const evGap of EV_GAPS) {
            out.push({ evMin, scoreMin, oddsMax, scoreGap, evGap });
          }
        }
      }
    }
  }
  return out;
}

function optimizeBetType(
  allRaces: RaceContext[],
  firstRaces: RaceContext[],
  secondRaces: RaceContext[],
  betType: keyof typeof BET_FNS,
  conditions: Condition[],
): Trial[] {
  const fn = BET_FNS[betType];
  const results: Trial[] = [];
  for (const cond of conditions) {
    const all    = simulate(allRaces,    fn, cond);
    const first  = simulate(firstRaces,  fn, cond);
    const second = simulate(secondRaces, fn, cond);
    const stability = Math.abs(roi(first.cost, first.payout) - roi(second.cost, second.payout));
    results.push({ betType, cond, all, first, second, stability, roi: roi(all.cost, all.payout) });
  }
  return results;
}

// ----------------------------------------
// 採用基準で選別
// ----------------------------------------

function selectQualified(trials: Trial[]): {
  best: Trial | null;
  all110: Trial[];
  all100: Trial[];
} {
  // 基本フィルタ: 参加率・的中数・安定性
  const baseFilter = (t: Trial): boolean =>
    t.all.participated >= MIN_RACE_COUNT &&
    (t.all.participated / t.all.total) >= MIN_PARTICIPATION &&
    t.all.hits >= MIN_HIT_COUNT &&
    t.stability <= MAX_STABILITY_GAP;

  const qualified = trials.filter(baseFilter);
  const all110 = qualified.filter((t) => t.roi >= TARGET_ROI).sort((a, b) => b.roi - a.roi);
  const all100 = qualified.filter((t) => t.roi >= FALLBACK_ROI && t.roi < TARGET_ROI).sort((a, b) => b.roi - a.roi);
  const best =
    all110.length > 0 ? all110[0] :
    all100.length > 0 ? all100[0] :
    qualified.length > 0 ? [...qualified].sort((a, b) => b.roi - a.roi)[0] : null;
  return { best, all110, all100 };
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
  const allData = await loadData();
  if (allData.length === 0) { console.error('no data'); process.exit(1); }

  const sorted = [...allData].sort((a, b) => a.date.localeCompare(b.date));
  const mid = Math.floor(sorted.length / 2);
  const allRaces    = prepareRaces(allData);
  const firstRaces  = prepareRaces(sorted.slice(0, mid));
  const secondRaces = prepareRaces(sorted.slice(mid));

  const conditions = enumConditions();
  console.log(`対象: ${allData.length}R (前半${firstRaces.length} / 後半${secondRaces.length})`);
  console.log(`探索条件数: ${conditions.length} × 7 券種 = ${conditions.length * 7} 試行`);
  console.log('');

  const tStart = Date.now();
  const results: Record<string, Trial[]> = {};
  for (const betType of Object.keys(BET_FNS) as (keyof typeof BET_FNS)[]) {
    const t0 = Date.now();
    results[betType] = optimizeBetType(allRaces, firstRaces, secondRaces, betType, conditions);
    console.log(`  [${betType}] ${Math.round((Date.now() - t0) / 1000)}秒 / ${results[betType].length} 試行`);
  }
  console.log(`\n全探索完了: ${Math.round((Date.now() - tStart) / 1000)}秒`);
  console.log('');

  // ---- 券種別に選別・出力 ----
  const log = (s = ''): void => console.log(s);
  const md: string[] = [];
  const mp = (s = ''): void => { md.push(s); };

  log('='.repeat(84));
  log('  参加条件グリッドサーチ結果 (目標: 回収率 110%+)');
  log('='.repeat(84));
  log('');

  mp(`# 参加条件グリッドサーチ (目標: 回収率 110%+)`);
  mp('');
  mp(`- 生成日時: ${new Date().toISOString()}`);
  mp(`- 対象: **${allData.length} レース** (前半 ${firstRaces.length} / 後半 ${secondRaces.length})`);
  mp(`- 探索: EV×Score×Odds×ScoreGap×EVGap = **${conditions.length} 条件** × 7 券種 = **${conditions.length * 7}** 試行`);
  mp(`- 所要: ${Math.round((Date.now() - tStart) / 1000)} 秒`);
  mp(`- 採用基準: 参加率≥${Math.round(MIN_PARTICIPATION * 100)}% (${MIN_RACE_COUNT}R 以上) / 的中≥${MIN_HIT_COUNT} / 前後半差≤${MAX_STABILITY_GAP}pt`);
  mp('');

  const picks: Record<string, Trial | null> = {};
  const label110 = (count: number): string => count > 0 ? `⭐ **${count} 件 110% 達成!**` : '';

  for (const betType of Object.keys(BET_FNS) as (keyof typeof BET_FNS)[]) {
    const { best, all110, all100 } = selectQualified(results[betType]);
    picks[betType] = best;

    const jpName = ({ tan:'単勝', fuku:'複勝', umaren:'馬連', umatan:'馬単', wide:'ワイド', sanfuku:'三連複', santan:'三連単' } as const)[betType];

    log(`▼ ${jpName}  ${label110(all110.length)}`);
    log('-'.repeat(84));
    const header = '| rank | evMin | scoreMin | oddsMax | sGap | evGap | 参加 | 的中 | ROI    | 前後半差 |';
    log(header);
    log('|------|-------|----------|---------|------|-------|------|------|--------|----------|');
    const top = all110.length > 0 ? all110.slice(0, 10) : [...all100.slice(0, 5), ...(all110.length === 0 && all100.length === 0 ? [...results[betType]].sort((a, b) => b.roi - a.roi).filter((t) => t.all.participated >= MIN_RACE_COUNT).slice(0, 5) : [])];
    top.forEach((t, i) => {
      const c = t.cond;
      log(
        `| ${(i + 1).toString().padStart(4)} | ` +
        `${c.evMin.toFixed(2)}  | ` +
        `${(c.scoreMin === 0 ? '  -  ' : c.scoreMin.toString().padStart(3) + '   ')} | ` +
        `${(c.oddsMax === Infinity ? '  -  ' : c.oddsMax.toString().padStart(3) + '  ')}   | ` +
        `${c.scoreGap.toString().padStart(2)}  | ` +
        `${c.evGap.toFixed(2)} | ` +
        `${t.all.participated.toString().padStart(4)} | ` +
        `${t.all.hits.toString().padStart(4)} | ` +
        `${(t.roi.toFixed(1) + '%').padStart(6)} | ` +
        `${t.stability.toFixed(1).padStart(6)}pt |`
      );
    });
    if (best) {
      log(`  → 推奨: evMin=${best.cond.evMin}, scoreMin=${best.cond.scoreMin || 'なし'}, oddsMax=${best.cond.oddsMax === Infinity ? 'なし' : best.cond.oddsMax}, sGap=${best.cond.scoreGap}, evGap=${best.cond.evGap}`);
      log(`     ROI=${best.roi.toFixed(1)}% (参加${best.all.participated}R / 的中${best.all.hits} / 前後半差${best.stability.toFixed(1)}pt)`);
    } else {
      log('  → 採用基準をクリアする戦略なし');
    }
    log('');

    // Markdown 詳細
    mp(`## ${jpName} ${label110(all110.length)}`);
    mp('');
    if (all110.length > 0) {
      mp(`**⭐ 110% 以上の戦略: ${all110.length} 件**`);
      mp('');
    } else if (all100.length > 0) {
      mp(`**100〜110% の戦略: ${all100.length} 件**`);
      mp('');
    }
    mp(`| rank | evMin | scoreMin | oddsMax | sGap | evGap | 参加R | 参加率 | 的中 | 的中率 | 投資 | 払戻 | ROI | 前後半差 |`);
    mp(`|---|---|---|---|---|---|---|---|---|---|---|---|---|---|`);
    top.forEach((t, i) => {
      const c = t.cond;
      mp(
        `| ${i + 1} | ${c.evMin.toFixed(2)} | ${c.scoreMin === 0 ? '-' : c.scoreMin} | ${c.oddsMax === Infinity ? '-' : c.oddsMax} | ${c.scoreGap} | ${c.evGap.toFixed(2)} | ${t.all.participated}/${t.all.total} | ${pct(t.all.participated, t.all.total)} | ${t.all.hits} | ${pct(t.all.hits, t.all.participated)} | ${t.all.cost.toLocaleString()} | ${t.all.payout.toLocaleString()} | **${t.roi.toFixed(1)}%** | ${t.stability.toFixed(1)}pt |`
      );
    });
    mp('');
    if (best) {
      mp(`**推奨戦略**: evMin=${best.cond.evMin}, scoreMin=${best.cond.scoreMin || 'なし'}, oddsMax=${best.cond.oddsMax === Infinity ? 'なし' : best.cond.oddsMax + '倍'}, scoreGap=${best.cond.scoreGap}pt, evGap=${best.cond.evGap.toFixed(2)}`);
      mp(`ROI **${best.roi.toFixed(1)}%** / 参加 ${best.all.participated}/${best.all.total}R (${pct(best.all.participated, best.all.total)}) / 的中 ${best.all.hits} / 前後半差 ${best.stability.toFixed(1)}pt`);
      mp('');
    }
  }

  // ---- サマリー ----
  log('▼ 推奨構成サマリー');
  log('-'.repeat(84));
  log('| 券種    | 推奨条件                                                      | ROI    | 参加率  |');
  log('|---------|----------------------------------------------------------------|--------|---------|');
  let countOver110 = 0, countOver100 = 0;
  for (const betType of Object.keys(BET_FNS) as (keyof typeof BET_FNS)[]) {
    const pick = picks[betType];
    const jpName = ({ tan:'単勝', fuku:'複勝', umaren:'馬連', umatan:'馬単', wide:'ワイド', sanfuku:'三連複', santan:'三連単' } as const)[betType];
    if (pick) {
      if (pick.roi >= TARGET_ROI) countOver110++;
      else if (pick.roi >= FALLBACK_ROI) countOver100++;
      const c = pick.cond;
      const cond = `EV≥${c.evMin.toFixed(2)} / sMin=${c.scoreMin||'-'} / oddsMax=${c.oddsMax===Infinity?'-':c.oddsMax} / sGap=${c.scoreGap} / evGap=${c.evGap.toFixed(2)}`;
      log(`| ${jpName.padEnd(6)} | ${cond.padEnd(62)} | ${(pick.roi.toFixed(1)+'%').padStart(6)} | ${pct(pick.all.participated, pick.all.total).padStart(7)} |`);
    } else {
      log(`| ${jpName.padEnd(6)} | 採用基準クリア戦略なし                                                              | -      | -       |`);
    }
  }
  log('');
  log(`✅ 110% 達成: ${countOver110} 券種`);
  log(`✅ 100-109%: ${countOver100} 券種`);
  log('');

  // Markdown サマリー
  mp(`## 推奨構成サマリー`);
  mp('');
  mp(`| 券種 | 推奨条件 | ROI | 参加率 | 的中数 | 前後半差 |`);
  mp(`|---|---|---|---|---|---|`);
  for (const betType of Object.keys(BET_FNS) as (keyof typeof BET_FNS)[]) {
    const pick = picks[betType];
    const jpName = ({ tan:'単勝', fuku:'複勝', umaren:'馬連', umatan:'馬単', wide:'ワイド', sanfuku:'三連複', santan:'三連単' } as const)[betType];
    if (pick) {
      const c = pick.cond;
      const cond = `EV≥${c.evMin.toFixed(2)} / sMin=${c.scoreMin||'-'} / oddsMax=${c.oddsMax===Infinity?'-':c.oddsMax} / sGap=${c.scoreGap} / evGap=${c.evGap.toFixed(2)}`;
      mp(`| ${jpName} | ${cond} | **${pick.roi.toFixed(1)}%** | ${pct(pick.all.participated, pick.all.total)} | ${pick.all.hits} | ${pick.stability.toFixed(1)}pt |`);
    } else {
      mp(`| ${jpName} | 採用基準クリア戦略なし | - | - | - | - |`);
    }
  }
  mp('');
  mp(`**集計**: 110%達成 ${countOver110} 券種、100-109% ${countOver100} 券種`);
  mp('');

  mp(`## 採用基準`);
  mp('');
  mp(`- 参加率 ≥ ${Math.round(MIN_PARTICIPATION * 100)}% (最低 ${MIN_RACE_COUNT} レース)`);
  mp(`- 的中数 ≥ ${MIN_HIT_COUNT} 件`);
  mp(`- 前後半差 ≤ ${MAX_STABILITY_GAP}pt`);
  mp('');
  mp(`---`);
  mp(`*再実行: \`pnpm tsx scripts/grid_search_participation.ts\`*`);

  await fs.writeFile(REPORT, md.join('\n'), 'utf-8');
  log('='.repeat(84));
  log(`Markdown: ${REPORT}`);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
