// ==========================================
// ダッシュボード用データ集計スクリプト
//
// scripts/verification/ 配下の検証 JSON から、
// Phase 2G ハイブリッド戦略のバックテスト結果を集計して
// public/dashboard-data.json に出力する。
//
// 出力内容:
//   - summary: 全体サマリー (総R数, 期間, 合計pt, 各券種 ROI, 的中率)
//   - monthly: 月別 ROI (馬連本命・馬単本命・ワイド堅実)
//   - byType:  券種別詳細 (ROI, 参加R, 的中率, 月別CV, 最良/最悪月)
//   - strategy: Phase 2G 除外ルール情報
//   - generatedAt: 生成日時 (ISO 8601)
//
// 実行: pnpm tsx scripts/build_dashboard_data.ts
// 想定用途: 週次スクレイプ完了後に実行し、ダッシュボードデータを更新
// ==========================================

import { promises as fs } from 'node:fs';
import path from 'node:path';

const DIR = path.resolve(__dirname, 'verification');
const OUT = path.resolve(__dirname, '..', 'public', 'dashboard-data.json');

// ----------------------------------------
// 型
// ----------------------------------------

type Prediction = { horseId: number; score: number; ev: number; odds: number };
type Payout     = { combination: string; payout: number };

type VD = {
  raceId: string;
  predictions: Prediction[];
  results: {
    payouts: { umaren?: Payout[]; umatan?: Payout[]; wide?: Payout[] };
  };
  meta?: {
    raceClass?: string;
    raceGrade?: string;
    raceDate?: string;
    surface?: string;
    distance?: number;
  };
};

// ----------------------------------------
// 信頼度用カテゴリ判定 (lib/reliability/race-category と共有)
// ----------------------------------------

import { classifyClassKey, distanceBandKey } from '../lib/reliability/race-category';

/** surface キー (turf/dirt) */
function surfaceKey(s?: string): string {
  if (s === 'turf') return 'turf';
  if (s === 'dirt') return 'dirt';
  return 'unknown';
}

type BetKind = 'umarenHonmei' | 'umatanHonmei' | 'wideKenjitsu';

// ----------------------------------------
// Phase 2G 本命級戦略 + クラス除外 (lib/score/calculator.ts と同期)
// ----------------------------------------

const sameSet = (a: number[], b: number[]): boolean =>
  a.length === b.length && [...a].sort((x,y)=>x-y).join(',') === [...b].sort((x,y)=>x-y).join(',');

function isExcludedUU(rc?: string): boolean {
  if (!rc) return false;
  return /1勝|500万|2勝|1000万/.test(rc);
}
function isExcludedW(rc?: string): boolean {
  if (!rc) return false;
  return /1勝|500万/.test(rc);
}

type Outcome = { cost: number; payout: number };
const zero: Outcome = { cost: 0, payout: 0 };

function sorted(preds: Prediction[]): Prediction[] {
  return [...preds].filter((p) => p.odds > 0).sort((a, b) => b.ev - a.ev);
}

function umaren(vd: VD): Outcome {
  if (isExcludedUU(vd.meta?.raceClass)) return zero;
  const s = sorted(vd.predictions);
  const p1 = s[0], p2 = s[1];
  if (!p1 || !p2 || p1.ev < 1.0 || p2.ev < 1.0 || p1.score < 65 || p2.score < 65) return zero;
  for (const u of vd.results.payouts.umaren ?? []) {
    if (sameSet([p1.horseId, p2.horseId], u.combination.split('-').map(Number))) {
      return { cost: 100, payout: u.payout };
    }
  }
  return { cost: 100, payout: 0 };
}

function umatan(vd: VD): Outcome {
  if (isExcludedUU(vd.meta?.raceClass)) return zero;
  const s = sorted(vd.predictions);
  const p1 = s[0], p2 = s[1];
  if (!p1 || !p2 || p1.ev < 1.0 || p2.ev < 1.0 || p1.score < 65 || p2.score < 65) return zero;
  if (p1.odds > 15 || p2.odds > 15) return zero;
  let pay = 0;
  for (const perm of [[p1.horseId, p2.horseId], [p2.horseId, p1.horseId]]) {
    for (const u of vd.results.payouts.umatan ?? []) {
      const c = u.combination.split('-').map(Number);
      if (c.length === 2 && c[0] === perm[0] && c[1] === perm[1]) { pay += u.payout; break; }
    }
  }
  return { cost: 200, payout: pay };
}

function wide(vd: VD): Outcome {
  if (isExcludedW(vd.meta?.raceClass)) return zero;
  const s = sorted(vd.predictions);
  const p1 = s[0], p2 = s[1];
  if (!p1 || !p2 || p1.ev < 1.02 || p2.ev < 1.02 || p1.score < 65 || p2.score < 65) return zero;
  if (p1.odds > 10 || p2.odds > 10) return zero;
  for (const w of vd.results.payouts.wide ?? []) {
    if (sameSet([p1.horseId, p2.horseId], w.combination.split('-').map(Number))) {
      return { cost: 100, payout: w.payout };
    }
  }
  return { cost: 100, payout: 0 };
}

// ----------------------------------------
// 集計ユーティリティ
// ----------------------------------------

type Agg = { cost: number; payout: number; participated: number; hits: number };
const emptyAgg = (): Agg => ({ cost: 0, payout: 0, participated: 0, hits: 0 });
const addOut = (a: Agg, o: Outcome): void => {
  if (o.cost === 0) return;
  a.cost += o.cost; a.payout += o.payout; a.participated++;
  if (o.payout > 0) a.hits++;
};
const roi = (a: Agg): number => a.cost > 0 ? (a.payout / a.cost) * 100 : 0;

// ----------------------------------------
// メイン
// ----------------------------------------

async function main(): Promise<void> {
  const files = (await fs.readdir(DIR)).filter((f) => f.endsWith('.json'));

  // 全体集計
  const totalU = emptyAgg(), totalT = emptyAgg(), totalW = emptyAgg();

  // 月別集計
  type Month = {
    umaren: Agg; umatan: Agg; wide: Agg;
    samples: number;  // 推奨対象となったR数 (重複含まず、レース数として)
  };
  const byMonth = new Map<string, Month>();
  const getM = (k: string): Month => {
    let m = byMonth.get(k);
    if (!m) { m = { umaren: emptyAgg(), umatan: emptyAgg(), wide: emptyAgg(), samples: 0 }; byMonth.set(k, m); }
    return m;
  };

  // カテゴリ別集計 (信頼度用、3階層フォールバック)
  //   tight  = class + surface + distanceBand
  //   medium = class + surface
  //   class  = class のみ
  type CategoryAgg = {
    total: number;                  // このバケットに該当したレース総数
    umaren: Agg;
    monthlyUmaren: Map<string, Agg>; // 月別 umaren Agg (CV計算用)
  };
  const emptyCat = (): CategoryAgg => ({ total: 0, umaren: emptyAgg(), monthlyUmaren: new Map() });
  const byTight  = new Map<string, CategoryAgg>();
  const byMedium = new Map<string, CategoryAgg>();
  const byClass  = new Map<string, CategoryAgg>();
  const getCat = (m: Map<string, CategoryAgg>, k: string): CategoryAgg => {
    let c = m.get(k); if (!c) { c = emptyCat(); m.set(k, c); }
    return c;
  };
  const accumCat = (c: CategoryAgg, ou: Outcome, month: string): void => {
    c.total++;
    addOut(c.umaren, ou);
    if (ou.cost > 0) {
      let mo = c.monthlyUmaren.get(month); if (!mo) { mo = emptyAgg(); c.monthlyUmaren.set(month, mo); }
      addOut(mo, ou);
    }
  };

  let totalRaces = 0;
  const dateMin: string[] = [], dateMax: string[] = [];

  for (const f of files) {
    let vd: VD;
    try { vd = JSON.parse(await fs.readFile(path.join(DIR, f), 'utf-8')); } catch { continue; }
    if (!vd.predictions || vd.predictions.length < 2 || !vd.results?.payouts) continue;

    totalRaces++;
    const rd = vd.meta?.raceDate ?? f.substring(0, 8);
    const month = `${String(rd).substring(0,4)}-${String(rd).substring(4,6)}`;
    if (dateMin.length === 0 || String(rd) < dateMin[0]) dateMin[0] = String(rd);
    if (dateMax.length === 0 || String(rd) > dateMax[0]) dateMax[0] = String(rd);

    const ou = umaren(vd), ot = umatan(vd), ow = wide(vd);
    addOut(totalU, ou); addOut(totalT, ot); addOut(totalW, ow);

    const mo = getM(month);
    mo.samples++;
    addOut(mo.umaren, ou); addOut(mo.umatan, ot); addOut(mo.wide, ow);

    // --- カテゴリ別集計 ---
    const cls  = classifyClassKey({ raceClass: vd.meta?.raceClass, raceGrade: vd.meta?.raceGrade });
    const surf = surfaceKey(vd.meta?.surface);
    const band = distanceBandKey(vd.meta?.distance);
    accumCat(getCat(byTight,  `${cls}|${surf}|${band}`), ou, month);
    accumCat(getCat(byMedium, `${cls}|${surf}`),         ou, month);
    accumCat(getCat(byClass,  cls),                       ou, month);
  }

  const sortedMonths = Array.from(byMonth.keys()).sort();
  const monthly = sortedMonths.map((m) => {
    const mo = byMonth.get(m)!;
    return {
      month: m,
      samples: mo.samples,
      umarenHonmei: {
        participated: mo.umaren.participated,
        hits: mo.umaren.hits,
        roi: roi(mo.umaren),
      },
      umatanHonmei: {
        participated: mo.umatan.participated,
        hits: mo.umatan.hits,
        roi: roi(mo.umatan),
      },
      wideKenjitsu: {
        participated: mo.wide.participated,
        hits: mo.wide.hits,
        roi: roi(mo.wide),
      },
    };
  });

  // 券種別 CV / 最良月 / 最悪月
  const calcCV = (rois: number[]): number => {
    if (rois.length < 2) return 0;
    const m = rois.reduce((s,v)=>s+v,0)/rois.length;
    if (m === 0) return 0;
    const sd = Math.sqrt(rois.reduce((s,v)=>s+(v-m)**2,0)/rois.length);
    return sd/m;
  };

  type BestWorst = { best: { month: string; roi: number } | null; worst: { month: string; roi: number } | null; cv: number };
  const bestWorst = (kind: 'umaren' | 'umatan' | 'wide'): BestWorst => {
    const items = sortedMonths
      .map((m) => {
        const mo = byMonth.get(m)!;
        const agg = kind === 'umaren' ? mo.umaren : kind === 'umatan' ? mo.umatan : mo.wide;
        return { month: m, roi: roi(agg), participated: agg.participated };
      })
      .filter((it) => it.participated >= 3); // 3R未満は外れ値扱い
    if (items.length === 0) return { best: null, worst: null, cv: 0 };
    const best  = items.reduce((b, it) => it.roi > b.roi ? it : b);
    const worst = items.reduce((b, it) => it.roi < b.roi ? it : b);
    const cv = calcCV(items.map((it) => it.roi));
    return { best: { month: best.month, roi: best.roi }, worst: { month: worst.month, roi: worst.roi }, cv };
  };

  const formatPeriod = (d: string): string =>
    d.length >= 8 ? `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}` : d;

  // カテゴリ別の出力形式に変換 (Map → plain object)
  const serializeCat = (m: Map<string, CategoryAgg>): Record<string, {
    total: number;
    umarenParticipated: number;
    umarenHits: number;
    umarenROI: number;
    monthlyCV: number;
    monthsEvaluated: number;
  }> => {
    const out: Record<string, {
      total: number;
      umarenParticipated: number;
      umarenHits: number;
      umarenROI: number;
      monthlyCV: number;
      monthsEvaluated: number;
    }> = {};
    for (const [k, v] of Array.from(m.entries())) {
      const monthlyROIs: number[] = [];
      for (const a of Array.from(v.monthlyUmaren.values())) {
        if (a.participated >= 3) monthlyROIs.push(roi(a)); // 月内 <3R は外れ値扱い
      }
      let cv = 0;
      if (monthlyROIs.length >= 2) {
        const mn = monthlyROIs.reduce((s,x)=>s+x,0)/monthlyROIs.length;
        if (mn > 0) {
          const sd = Math.sqrt(monthlyROIs.reduce((s,x)=>s+(x-mn)**2,0)/monthlyROIs.length);
          cv = sd/mn;
        }
      }
      out[k] = {
        total: v.total,
        umarenParticipated: v.umaren.participated,
        umarenHits: v.umaren.hits,
        umarenROI: roi(v.umaren),
        monthlyCV: cv,
        monthsEvaluated: monthlyROIs.length,
      };
    }
    return out;
  };

  const out = {
    generatedAt: new Date().toISOString(),
    summary: {
      totalRaces,
      period: {
        from: formatPeriod(dateMin[0] ?? ''),
        to:   formatPeriod(dateMax[0] ?? ''),
      },
      totalPt: roi(totalU) + roi(totalT) + roi(totalW),
      umarenHonmeiROI: roi(totalU),
      umatanHonmeiROI: roi(totalT),
      wideKenjitsuROI: roi(totalW),
      // 全体的中率 = 3券種合計の hits / participated
      overallHitRate: (() => {
        const p = totalU.participated + totalT.participated + totalW.participated;
        const h = totalU.hits + totalT.hits + totalW.hits;
        return p > 0 ? (h / p) * 100 : 0;
      })(),
      joinedRacesUmaren: totalU.participated,
    },
    monthly,
    byType: {
      umarenHonmei: {
        roi:            roi(totalU),
        joinedRaces:    totalU.participated,
        totalRaces,
        hits:           totalU.hits,
        hitRate:        totalU.participated > 0 ? (totalU.hits / totalU.participated) * 100 : 0,
        recoveryRate:   roi(totalU),
        monthlyCV:      bestWorst('umaren').cv,
        bestMonth:      bestWorst('umaren').best,
        worstMonth:     bestWorst('umaren').worst,
        label:          '馬連本命',
        costPerRace:    100,
        condition:      '両馬 EV≥1.00 かつ スコア≥65 (C1/C2 除外)',
      },
      umatanHonmei: {
        roi:            roi(totalT),
        joinedRaces:    totalT.participated,
        totalRaces,
        hits:           totalT.hits,
        hitRate:        totalT.participated > 0 ? (totalT.hits / totalT.participated) * 100 : 0,
        recoveryRate:   roi(totalT),
        monthlyCV:      bestWorst('umatan').cv,
        bestMonth:      bestWorst('umatan').best,
        worstMonth:     bestWorst('umatan').worst,
        label:          '馬単本命',
        costPerRace:    200,
        condition:      '両馬 EV≥1.00 & スコア≥65 & オッズ≤15 (C1/C2 除外), 2点 BOX',
      },
      wideKenjitsu: {
        roi:            roi(totalW),
        joinedRaces:    totalW.participated,
        totalRaces,
        hits:           totalW.hits,
        hitRate:        totalW.participated > 0 ? (totalW.hits / totalW.participated) * 100 : 0,
        recoveryRate:   roi(totalW),
        monthlyCV:      bestWorst('wide').cv,
        bestMonth:      bestWorst('wide').best,
        worstMonth:     bestWorst('wide').worst,
        label:          'ワイド堅実',
        costPerRace:    100,
        condition:      '両馬 EV≥1.02 & スコア≥65 & オッズ≤10 (C1 のみ除外)',
      },
    },
    // 信頼度用カテゴリ集計 (3階層フォールバック)
    // キー形式:
    //   tight:  `${class}|${surface}|${distanceBand}`
    //   medium: `${class}|${surface}`
    //   classOnly: `${class}`
    byCategory: {
      tight:     serializeCat(byTight),
      medium:    serializeCat(byMedium),
      classOnly: serializeCat(byClass),
    },
    strategy: {
      name: 'Phase 2G ハイブリッド',
      description: 'クラス別除外 × EVベースの3段階推奨戦略',
      rules: [
        { class: '1勝クラス (500万以下)', umaren: 'skip', umatan: 'skip', wide: 'skip' },
        { class: '2勝クラス (1000万以下)', umaren: 'skip', umatan: 'skip', wide: '参加' },
        { class: '3勝/OP/G1-G3',         umaren: '参加', umatan: '参加', wide: '参加' },
        { class: '新馬/未勝利',           umaren: '参加', umatan: '参加', wide: '参加' },
      ],
      verificationSummary: '3233R × 時系列CV 3セットで検証済み',
    },
  };

  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(out, null, 2), 'utf-8');

  console.log('====================================================');
  console.log(`  ダッシュボードデータ出力完了`);
  console.log('====================================================');
  console.log(`  総R数:     ${totalRaces}`);
  console.log(`  期間:      ${out.summary.period.from} 〜 ${out.summary.period.to}`);
  console.log(`  合計pt:    ${out.summary.totalPt.toFixed(1)}`);
  console.log(`  馬連本命:  ${roi(totalU).toFixed(1)}% (参加 ${totalU.participated}R / 的中 ${totalU.hits}R)`);
  console.log(`  馬単本命:  ${roi(totalT).toFixed(1)}% (参加 ${totalT.participated}R / 的中 ${totalT.hits}R)`);
  console.log(`  ワイド:    ${roi(totalW).toFixed(1)}% (参加 ${totalW.participated}R / 的中 ${totalW.hits}R)`);
  console.log(`  月数:      ${sortedMonths.length}`);
  console.log(`  出力先:    ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
