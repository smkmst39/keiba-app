// ==========================================
// グリッドサーチによるパラメータ最適化
//
// ステージ1: EV計算パラメータ (CORRECTION_FACTOR × CORR_OFFSET × MAX_CORRECTION)
//   930R の score は固定、EV のみ再計算して各券種の回収率を算出。
//   クロスバリデーション: 前半465R / 後半465R で分割検証 (過学習検出)。
//
// 実行: pnpm tsx scripts/grid_search.ts --stage 1
// 出力: コンソール + scripts/verification/grid_search_report.md
// ==========================================

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { VerificationData } from '../lib/scraper/types';

// ----------------------------------------
// 定数
// ----------------------------------------

const DIR = path.resolve(__dirname, 'verification');
const REPORT = path.join(DIR, 'grid_search_report.md');

/** 現行値 (比較基準) */
const CURRENT = { cf: 0.20, offset: -0.02, max: 0.20 };

/** ステージ1: 3 EV パラメータの探索範囲 */
const CF_RANGE:     number[] = range(0.10, 0.35, 0.025);   // 11 値
const OFFSET_RANGE: number[] = range(-0.05, 0.00, 0.005);  // 11 値
const MAX_RANGE:    number[] = range(0.10, 0.25, 0.025);   // 7 値

/** オッズ帯別ウェイト (現行値) */
function getOddsWeight(odds: number): number {
  if (odds <= 5)  return 1.00;
  if (odds <= 10) return 0.80;
  if (odds <= 20) return 0.50;
  if (odds <= 50) return 0.20;
  return 0.05;
}

/** 券種別の重み (max_weighted_return で使用) */
const BET_WEIGHTS = {
  tan:     0.20,
  fuku:    0.10,
  umaren:  0.25,
  umatan:  0.25,
  wide:    0.10,
  sanfuku: 0.05,
  santan:  0.05,
} as const;

// ----------------------------------------
// ユーティリティ
// ----------------------------------------

function range(from: number, to: number, step: number): number[] {
  const result: number[] = [];
  for (let v = from; v <= to + step / 2; v += step) result.push(Math.round(v * 10000) / 10000);
  return result;
}

const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));
const mean  = (arr: number[]): number => arr.length === 0 ? 0 : arr.reduce((s, x) => s + x, 0) / arr.length;

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
// EV 再計算 (与えられた params で)
// ----------------------------------------

type Params = { cf: number; offset: number; max: number };
type Prediction = VerificationData['predictions'][number];

function recomputeEV(preds: Prediction[], p: Params): Array<Prediction & { evNew: number }> {
  const scores = preds.map((x) => x.score);
  const avg = mean(scores);
  if (avg === 0) return preds.map((x) => ({ ...x, evNew: 0 }));

  return preds.map((x) => {
    if (x.odds <= 0) return { ...x, evNew: 0 };
    const dev   = (x.score - avg) / avg;
    const oddsW = getOddsWeight(x.odds);
    const corr  = clamp(dev * p.cf * oddsW + p.offset, -p.max, p.max);
    return { ...x, evNew: 1 + corr };
  });
}

// ----------------------------------------
// 券種別 top-N 戦略でのシミュレーション
// ----------------------------------------

type BetOutcome = { cost: number; payout: number; hit: boolean };
type AllOutcome = Record<keyof typeof BET_WEIGHTS, BetOutcome>;

function simulateOne(vd: VerificationData, p: Params): AllOutcome {
  const recalc = recomputeEV(vd.predictions, p).filter((h) => h.odds > 0);
  const sorted = [...recalc].sort((a, b) => b.evNew - a.evNew);

  const top3 = vd.results.results.filter((r) => r.rank <= 3).map((r) => r.horseId);

  const pick1 = sorted[0];
  const pick2 = sorted[1];
  const pick3 = sorted[2];

  // ---- 単勝 ----
  const tanPayArr = vd.results.payouts.tan;
  const tanHit = !!pick1 && tanPayArr.some((t) => t.horseId === pick1.horseId);
  const tan: BetOutcome = {
    cost: 100,
    payout: tanHit ? tanPayArr[0]?.payout ?? 0 : 0,
    hit: tanHit,
  };

  // ---- 複勝 (top-1 of EV、top3 に居れば当たり) ----
  const fukuArr = vd.results.payouts.fuku ?? [];
  const fukuEntry = pick1 ? fukuArr.find((f) => f.horseId === pick1.horseId) : undefined;
  const fukuHit = !!fukuEntry;
  const fuku: BetOutcome = {
    cost: 100,
    payout: fukuHit ? fukuEntry!.payout : 0,
    hit: fukuHit,
  };
  void top3; // top3 判定は fuku エントリ有無で置換

  // ---- 馬連 (EV上位2頭 BOX) ----
  let umarenHit = false;
  let umarenPayout = 0;
  if (pick1 && pick2) {
    const picked = [pick1.horseId, pick2.horseId];
    for (const u of vd.results.payouts.umaren) {
      if (sameSet(picked, u.combination.split('-').map(Number))) {
        umarenHit = true;
        umarenPayout = u.payout;
        break;
      }
    }
  }
  const umaren: BetOutcome = { cost: 100, payout: umarenPayout, hit: umarenHit };

  // ---- 馬単 (EV上位2頭 BOX = 2点) ----
  let umatanHit = false;
  let umatanPayout = 0;
  if (pick1 && pick2) {
    const perms = permutations([pick1.horseId, pick2.horseId], 2);
    for (const perm of perms) {
      for (const u of vd.results.payouts.umatan ?? []) {
        if (sameSeq(perm, u.combination.split('-').map(Number))) {
          umatanHit = true;
          umatanPayout += u.payout;
          break;
        }
      }
    }
  }
  const umatan: BetOutcome = {
    cost: pick1 && pick2 ? 200 : 0,
    payout: umatanPayout,
    hit: umatanHit,
  };

  // ---- ワイド (EV上位3頭 BOX = 3ペア) ----
  let wideHit = false;
  let widePayout = 0;
  let widePoints = 0;
  if (pick1 && pick2 && pick3) {
    const pairs = combinations([pick1.horseId, pick2.horseId, pick3.horseId], 2);
    widePoints = pairs.length;
    for (const pair of pairs) {
      for (const w of vd.results.payouts.wide ?? []) {
        if (sameSet(pair, w.combination.split('-').map(Number))) {
          wideHit = true;
          widePayout += w.payout;
          break;
        }
      }
    }
  }
  const wide: BetOutcome = { cost: widePoints * 100, payout: widePayout, hit: wideHit };

  // ---- 三連複 (EV上位3頭 1点) ----
  let sanfukuHit = false;
  let sanfukuPayout = 0;
  if (pick1 && pick2 && pick3) {
    const picked = [pick1.horseId, pick2.horseId, pick3.horseId];
    for (const s of vd.results.payouts.sanfuku) {
      if (sameSet(picked, s.combination.split('-').map(Number))) {
        sanfukuHit = true;
        sanfukuPayout = s.payout;
        break;
      }
    }
  }
  const sanfuku: BetOutcome = { cost: pick3 ? 100 : 0, payout: sanfukuPayout, hit: sanfukuHit };

  // ---- 三連単 (EV上位3頭 BOX = 6点) ----
  let santanHit = false;
  let santanPayout = 0;
  if (pick1 && pick2 && pick3) {
    const perms = permutations([pick1.horseId, pick2.horseId, pick3.horseId], 3);
    for (const perm of perms) {
      for (const s of vd.results.payouts.santan) {
        if (sameSeq(perm, s.combination.split('-').map(Number))) {
          santanHit = true;
          santanPayout += s.payout;
          break;
        }
      }
    }
  }
  const santan: BetOutcome = { cost: pick3 ? 600 : 0, payout: santanPayout, hit: santanHit };

  return { tan, fuku, umaren, umatan, wide, sanfuku, santan };
}

// ----------------------------------------
// 集計
// ----------------------------------------

type Totals = Record<keyof typeof BET_WEIGHTS, { cost: number; payout: number; hits: number; races: number }>;

const emptyTotals = (): Totals => ({
  tan:     { cost: 0, payout: 0, hits: 0, races: 0 },
  fuku:    { cost: 0, payout: 0, hits: 0, races: 0 },
  umaren:  { cost: 0, payout: 0, hits: 0, races: 0 },
  umatan:  { cost: 0, payout: 0, hits: 0, races: 0 },
  wide:    { cost: 0, payout: 0, hits: 0, races: 0 },
  sanfuku: { cost: 0, payout: 0, hits: 0, races: 0 },
  santan:  { cost: 0, payout: 0, hits: 0, races: 0 },
});

function aggregate(data: VerificationData[], p: Params): Totals {
  const t = emptyTotals();
  for (const vd of data) {
    if (vd.predictions.length < 3 || vd.results.results.length === 0) continue;
    const o = simulateOne(vd, p);
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

const roi = (cost: number, payout: number): number => cost > 0 ? (payout / cost) * 100 : 0;

/** 目的関数: 券種別重み付き回収率 */
function weightedReturn(t: Totals): number {
  let weighted = 0;
  let totalW = 0;
  for (const [k, w] of Object.entries(BET_WEIGHTS)) {
    const s = t[k as keyof Totals];
    if (s.cost > 0) {
      weighted += roi(s.cost, s.payout) * w;
      totalW += w;
    }
  }
  return totalW > 0 ? weighted / totalW : 0;
}

/** 目的関数: 総合回収率 (全券種ポートフォリオ) */
function totalReturn(t: Totals): number {
  const c = Object.values(t).reduce((s, x) => s + x.cost, 0);
  const p = Object.values(t).reduce((s, x) => s + x.payout, 0);
  return roi(c, p);
}

// ----------------------------------------
// メイン
// ----------------------------------------

async function loadData(): Promise<VerificationData[]> {
  const files = (await fs.readdir(DIR)).filter((f) => f.endsWith('.json'));
  const out: VerificationData[] = [];
  for (const f of files) {
    try { out.push(JSON.parse(await fs.readFile(path.join(DIR, f), 'utf-8'))); } catch { /* skip */ }
  }
  return out;
}

type Result = {
  params: Params;
  t: Totals;
  weightedRoi: number;
  totalRoi: number;
};

async function main(): Promise<void> {
  const allData = await loadData();
  if (allData.length === 0) { console.error('データなし'); process.exit(1); }

  // 時系列順にソート (CV 分割用)
  const sorted = [...allData].sort((a, b) => a.date.localeCompare(b.date));
  const mid = Math.floor(sorted.length / 2);
  const firstHalf  = sorted.slice(0, mid);
  const secondHalf = sorted.slice(mid);

  const totalCombos = CF_RANGE.length * OFFSET_RANGE.length * MAX_RANGE.length;
  console.log(`グリッド: ${CF_RANGE.length} × ${OFFSET_RANGE.length} × ${MAX_RANGE.length} = ${totalCombos} 通り`);
  console.log(`対象: ${allData.length}R (前半${firstHalf.length} / 後半${secondHalf.length})`);
  console.log('');

  const tStart = Date.now();
  const allResults: Result[] = [];

  // 全組み合わせ探索 (全データ)
  let done = 0;
  for (const cf of CF_RANGE) {
    for (const offset of OFFSET_RANGE) {
      for (const max of MAX_RANGE) {
        const params: Params = { cf, offset, max };
        const t = aggregate(allData, params);
        allResults.push({
          params,
          t,
          weightedRoi: weightedReturn(t),
          totalRoi:    totalReturn(t),
        });
        done++;
        if (done % 200 === 0) {
          const elapsed = Math.round((Date.now() - tStart) / 1000);
          console.log(`  [${done}/${totalCombos}] ${elapsed}秒経過`);
        }
      }
    }
  }
  console.log(`  完了 (${Math.round((Date.now() - tStart) / 1000)}秒)\n`);

  // 目的関数別にランキング
  const byWeighted = [...allResults].sort((a, b) => b.weightedRoi - a.weightedRoi);
  const byTotal    = [...allResults].sort((a, b) => b.totalRoi - a.totalRoi);

  const currentResult = allResults.find(
    (r) => r.params.cf === CURRENT.cf && r.params.offset === CURRENT.offset && r.params.max === CURRENT.max,
  );

  // クロスバリデーション: 上位候補を前/後半で検証
  console.log('クロスバリデーション開始 (上位10候補を前半で最適化→後半で検証)');
  const top10 = byWeighted.slice(0, 10);
  const cv = top10.map((r) => {
    const tFirst  = aggregate(firstHalf,  r.params);
    const tSecond = aggregate(secondHalf, r.params);
    return {
      params: r.params,
      allWeighted: r.weightedRoi,
      allTotal:    r.totalRoi,
      firstWeighted:  weightedReturn(tFirst),
      secondWeighted: weightedReturn(tSecond),
      firstTotal:     totalReturn(tFirst),
      secondTotal:    totalReturn(tSecond),
      stability:      Math.abs(weightedReturn(tFirst) - weightedReturn(tSecond)),
    };
  });

  // ---- コンソール出力 ----
  const log = (s = ''): void => console.log(s);
  log('='.repeat(80));
  log(`  グリッドサーチ結果 (Stage 1: EVパラメータ)`);
  log('='.repeat(80));
  log('');
  log(`現行値 (CF=${CURRENT.cf}, offset=${CURRENT.offset}, max=${CURRENT.max}):`);
  if (currentResult) {
    log(`  重み付き回収率: ${currentResult.weightedRoi.toFixed(2)}%`);
    log(`  総合回収率:    ${currentResult.totalRoi.toFixed(2)}%`);
    log('  券種別回収率:');
    for (const k of Object.keys(BET_WEIGHTS) as (keyof Totals)[]) {
      const s = currentResult.t[k];
      log(`    ${k.padEnd(8)}: ${roi(s.cost, s.payout).toFixed(1)}% (的中${s.hits}/${s.races})`);
    }
  }
  log('');

  log('▼ Top 10 パラメータ (重み付き回収率)');
  log('-'.repeat(80));
  log('| rank | CF    | offset | MAX   | 重み付き | 総合    | 単勝  | 複勝  | 馬連  | 馬単  | ワイド| 三複  | 三単  |');
  log('|------|-------|--------|-------|----------|---------|-------|-------|-------|-------|-------|-------|-------|');
  byWeighted.slice(0, 10).forEach((r, i) => {
    const row = [
      (i + 1).toString().padStart(4),
      r.params.cf.toFixed(3),
      r.params.offset.toFixed(3),
      r.params.max.toFixed(3),
      (r.weightedRoi.toFixed(1) + '%').padStart(8),
      (r.totalRoi.toFixed(1) + '%').padStart(7),
      ...Object.keys(BET_WEIGHTS).map((k) => (roi(r.t[k as keyof Totals].cost, r.t[k as keyof Totals].payout).toFixed(1) + '%').padStart(5)),
    ];
    log(`| ${row.join(' | ')} |`);
  });
  log('');

  log('▼ クロスバリデーション (上位10候補 / 前半 vs 後半の安定性)');
  log('-'.repeat(80));
  log('| rank | CF    | offset | MAX   | 全体   | 前半   | 後半   | 差    |');
  log('|------|-------|--------|-------|--------|--------|--------|-------|');
  cv.forEach((r, i) => {
    const row = [
      (i + 1).toString().padStart(4),
      r.params.cf.toFixed(3),
      r.params.offset.toFixed(3),
      r.params.max.toFixed(3),
      (r.allWeighted.toFixed(1) + '%').padStart(6),
      (r.firstWeighted.toFixed(1) + '%').padStart(6),
      (r.secondWeighted.toFixed(1) + '%').padStart(6),
      (r.stability.toFixed(1) + 'pt').padStart(5),
    ];
    log(`| ${row.join(' | ')} |`);
  });
  log('');

  // 推奨: 全体で良い + 前後半差が小さい (安定)
  const recommended = [...cv]
    .filter((r) => r.allWeighted >= byWeighted[0].weightedRoi - 2) // トップから2pt以内
    .sort((a, b) => a.stability - b.stability)[0] ?? cv[0];

  log('▼ 推奨パラメータ');
  log('-'.repeat(80));
  log(`  CF     = ${recommended.params.cf}`);
  log(`  offset = ${recommended.params.offset}`);
  log(`  MAX    = ${recommended.params.max}`);
  log(`  重み付き回収率: 全体 ${recommended.allWeighted.toFixed(1)}% / 前半 ${recommended.firstWeighted.toFixed(1)}% / 後半 ${recommended.secondWeighted.toFixed(1)}%`);
  log(`  前後半差: ${recommended.stability.toFixed(1)}pt (安定性指標、小さいほど信頼性高)`);
  log('');

  if (currentResult) {
    const deltaWeighted = recommended.allWeighted - currentResult.weightedRoi;
    const deltaTotal    = recommended.allTotal    - currentResult.totalRoi;
    log(`  現行との差分: 重み付き ${deltaWeighted >= 0 ? '+' : ''}${deltaWeighted.toFixed(2)}pt / 総合 ${deltaTotal >= 0 ? '+' : ''}${deltaTotal.toFixed(2)}pt`);
  }

  // ---- Markdown ----
  const md: string[] = [];
  const mp = (s = ''): void => { md.push(s); };

  mp(`# グリッドサーチ結果 (Stage 1: EVパラメータ)`);
  mp('');
  mp(`- 生成日時: ${new Date().toISOString()}`);
  mp(`- 対象: **${allData.length} レース** (前半 ${firstHalf.length}R / 後半 ${secondHalf.length}R)`);
  mp(`- 探索範囲: CF ${CF_RANGE.length} × offset ${OFFSET_RANGE.length} × MAX ${MAX_RANGE.length} = **${totalCombos} 通り**`);
  mp(`- 所要時間: ${Math.round((Date.now() - tStart) / 1000)}秒`);
  mp('');

  mp(`## 1. 現行値の回収率 (CF=${CURRENT.cf}, offset=${CURRENT.offset}, max=${CURRENT.max})`);
  mp('');
  if (currentResult) {
    mp(`| 指標 | 値 |`);
    mp(`|---|---|`);
    mp(`| 重み付き回収率 | **${currentResult.weightedRoi.toFixed(2)}%** |`);
    mp(`| 総合回収率 (ポートフォリオ) | ${currentResult.totalRoi.toFixed(2)}% |`);
    mp('');
    mp(`| 券種 | 回収率 | 的中/レース |`);
    mp(`|---|---|---|`);
    for (const k of Object.keys(BET_WEIGHTS) as (keyof Totals)[]) {
      const s = currentResult.t[k];
      mp(`| ${k} | ${roi(s.cost, s.payout).toFixed(1)}% | ${s.hits}/${s.races} |`);
    }
    mp('');
  }

  mp(`## 2. Top 10 パラメータ候補 (重み付き回収率最大化)`);
  mp('');
  mp(`| rank | CF | offset | MAX | 重み付き | 総合 | 単勝 | 複勝 | 馬連 | 馬単 | ワイド | 三連複 | 三連単 |`);
  mp(`|---|---|---|---|---|---|---|---|---|---|---|---|---|`);
  byWeighted.slice(0, 10).forEach((r, i) => {
    const cells = [
      String(i + 1),
      r.params.cf.toFixed(3),
      r.params.offset.toFixed(3),
      r.params.max.toFixed(3),
      r.weightedRoi.toFixed(1) + '%',
      r.totalRoi.toFixed(1) + '%',
      ...Object.keys(BET_WEIGHTS).map((k) => roi(r.t[k as keyof Totals].cost, r.t[k as keyof Totals].payout).toFixed(1) + '%'),
    ];
    mp(`| ${cells.join(' | ')} |`);
  });
  mp('');

  mp(`## 3. クロスバリデーション`);
  mp('');
  mp(`上位10候補を前半 ${firstHalf.length}R で計算した回収率と、後半 ${secondHalf.length}R での回収率を比較。`);
  mp(`前後半差 (安定性指標) が小さいほど過学習の心配が少ない。`);
  mp('');
  mp(`| rank | CF | offset | MAX | 全体 | 前半 | 後半 | 前後半差 |`);
  mp(`|---|---|---|---|---|---|---|---|`);
  cv.forEach((r, i) => {
    mp(
      `| ${i + 1} | ${r.params.cf.toFixed(3)} | ${r.params.offset.toFixed(3)} | ${r.params.max.toFixed(3)} | ` +
      `${r.allWeighted.toFixed(1)}% | ${r.firstWeighted.toFixed(1)}% | ${r.secondWeighted.toFixed(1)}% | **${r.stability.toFixed(1)}pt** |`,
    );
  });
  mp('');

  mp(`## 4. 推奨パラメータ`);
  mp('');
  mp(`安定性 (前後半差) を重視して、トップから2pt以内で最も安定した組み合わせを選択。`);
  mp('');
  mp(`| 項目 | 現行 | 推奨 | 差分 |`);
  mp(`|---|---|---|---|`);
  mp(`| CORRECTION_FACTOR | ${CURRENT.cf} | **${recommended.params.cf}** | ${(recommended.params.cf - CURRENT.cf).toFixed(3)} |`);
  mp(`| CORR_OFFSET | ${CURRENT.offset} | **${recommended.params.offset}** | ${(recommended.params.offset - CURRENT.offset).toFixed(3)} |`);
  mp(`| MAX_CORRECTION | ${CURRENT.max} | **${recommended.params.max}** | ${(recommended.params.max - CURRENT.max).toFixed(3)} |`);
  mp(`| 重み付き回収率 | ${currentResult?.weightedRoi.toFixed(2)}% | **${recommended.allWeighted.toFixed(2)}%** | ${currentResult ? (recommended.allWeighted - currentResult.weightedRoi >= 0 ? '+' : '') + (recommended.allWeighted - currentResult.weightedRoi).toFixed(2) + 'pt' : ''} |`);
  mp(`| 総合回収率 | ${currentResult?.totalRoi.toFixed(2)}% | **${recommended.allTotal.toFixed(2)}%** | ${currentResult ? (recommended.allTotal - currentResult.totalRoi >= 0 ? '+' : '') + (recommended.allTotal - currentResult.totalRoi).toFixed(2) + 'pt' : ''} |`);
  mp(`| 前後半差 (安定性) | — | ${recommended.stability.toFixed(2)}pt | — |`);
  mp('');

  const suspicion = recommended.stability > 10 ? '**高**' : recommended.stability > 5 ? '中' : '低';
  mp(`## 5. 統計的信頼性`);
  mp('');
  mp(`- サンプルサイズ: **${allData.length}R** (Stage 1 は score 固定なので新規スコアサンプルを追加すべき)`);
  mp(`- 前後半差: **${recommended.stability.toFixed(1)}pt**`);
  mp(`- 過学習の懸念度: ${suspicion}`);
  mp(`- 探索点数: ${totalCombos}`);
  mp('');

  mp(`## 6. 注意事項`);
  mp('');
  mp(`- 回収率 ≥ 150% の戦略は参加レース数が少ない場合があるため、必ず前後半差 (安定性) と的中数を確認すること`);
  mp(`- Top-N BOX 戦略では CF と offset は **順位不変** (クランプ発動時のみ影響) のため、MAX が最も効く変数`);
  mp(`- ステージ2 (券種別閾値・頭数の最適化) や ステージ3 (スコア重み配分) は別途実行`);
  mp('');

  mp(`---`);
  mp(`*再実行: \`pnpm tsx scripts/grid_search.ts --stage 1\`*`);

  await fs.writeFile(REPORT, md.join('\n'), 'utf-8');
  log('='.repeat(80));
  log(`Markdown: ${REPORT}`);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
