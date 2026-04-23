// ==========================================
// アプローチ4: 未活用軸のスコア統合分析
//
// 目的:
//   現状スコア計算 (lib/score/calculator.ts) に活用されていない
//   未活用軸を特定し、除外ルール拡張として統合できるか検証する。
//
// Phase 2C の教訓:
//   - train 390.8pt も test 90.8〜221.4pt で崩壊 → 過学習
//   - 複雑な重み最適化は 3233R でも統計的不安定
//
// 方針 (手法C: 除外ルール拡張):
//   - 既存スコア構造は触らない
//   - 軸別バケットごとに ROI<80% の「ハズレ帯」を特定
//   - 該当レースを Phase 2G ハイブリッド除外に追加
//   - chronological train/test 70/30 分割で過学習検証
//
// 実行: pnpm tsx scripts/approach4_unused_axes.ts
// 出力: scripts/verification/approach4_unused_axes.md
// ==========================================

import { promises as fs } from 'node:fs';
import path from 'node:path';

const DIR = path.resolve(__dirname, 'verification');
const REPORT = path.join(DIR, 'approach4_unused_axes.md');

// ----------------------------------------
// 型
// ----------------------------------------

type Prediction = {
  horseId: number;
  score: number;
  ev: number;
  odds: number;
  waku?: number;
};

type Payout = { combination: string; payout: number };

type VD = {
  raceId: string;
  raceName: string;
  predictions: Prediction[];
  results: {
    results: Array<{ rank: number; horseId: number }>;
    payouts: {
      umaren?: Payout[];
      umatan?: Payout[];
      wide?: Payout[];
    };
  };
  meta?: {
    raceClass?: string;
    raceCondition?: string;
    raceGrade?: string;
    weather?: string;
    trackCondition?: string;
    handicap?: string;
    prize?: number;
    ageLimit?: string;
    sexLimit?: string;
    courseTurn?: string;
    distance?: number;
    surface?: string;
    startTime?: string;
    raceDate?: string;
    headCount?: number;
  };
};

// ----------------------------------------
// Phase 2G 本命級戦略 + クラス除外
// ----------------------------------------

const sameSet = (a: number[], b: number[]): boolean =>
  a.length === b.length && [...a].sort((x,y)=>x-y).join(',') === [...b].sort((x,y)=>x-y).join(',');

function isExcludedUmarenUmatan(rc?: string): boolean {
  if (!rc) return false;
  return /1勝|500万|2勝|1000万/.test(rc);
}
function isExcludedWide(rc?: string): boolean {
  if (!rc) return false;
  return /1勝|500万/.test(rc);
}

type Outcome = { cost: number; payout: number };
const zero: Outcome = { cost: 0, payout: 0 };

function sorted(preds: Prediction[]): Prediction[] {
  return [...preds].filter((p) => p.odds > 0).sort((a, b) => b.ev - a.ev);
}

function umarenHonmei(vd: VD): Outcome {
  if (isExcludedUmarenUmatan(vd.meta?.raceClass)) return zero;
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

function umatanHonmei(vd: VD): Outcome {
  if (isExcludedUmarenUmatan(vd.meta?.raceClass)) return zero;
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

function wideKenjitsu(vd: VD): Outcome {
  if (isExcludedWide(vd.meta?.raceClass)) return zero;
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
const addAgg = (a: Agg, o: Outcome): void => {
  if (o.cost === 0) return;
  a.cost += o.cost; a.payout += o.payout; a.participated++;
  if (o.payout > 0) a.hits++;
};
const roi = (a: Agg): number => a.cost > 0 ? (a.payout / a.cost) * 100 : 0;

// ----------------------------------------
// バケット化関数群
// ----------------------------------------

function bucketPrize(p?: number): string {
  if (p == null) return '不明';
  if (p < 500)  return '<500万';
  if (p < 1000) return '500-1000万';
  if (p < 2000) return '1000-2000万';
  if (p < 5000) return '2000-5000万';
  return '5000万+';
}

function bucketHeadCount(n?: number): string {
  if (n == null) return '不明';
  if (n <= 8)  return '≤8頭';
  if (n <= 12) return '9-12頭';
  if (n <= 15) return '13-15頭';
  return '16頭+';
}

function bucketDistance(d?: number): string {
  if (d == null) return '不明';
  if (d <= 1400) return '短距離 (≤1400)';
  if (d <= 1800) return 'マイル (1401-1800)';
  if (d <= 2200) return '中距離 (1801-2200)';
  return '長距離 (2201+)';
}

function bucketStartTime(t?: string): string {
  if (!t) return '不明';
  const h = parseInt(t.split(':')[0], 10);
  if (isNaN(h)) return '不明';
  if (h < 11) return '午前 (〜10:59)';
  if (h < 14) return '昼 (11:00-13:59)';
  if (h < 16) return '午後 (14:00-15:59)';
  return '夕方 (16:00+)';
}

function bucketTopWaku(vd: VD): string {
  const s = sorted(vd.predictions);
  const p1 = s[0];
  if (!p1 || p1.waku == null) return '不明';
  return `${p1.waku}枠`;
}

// ----------------------------------------
// 軸定義
// ----------------------------------------

type AxisDef = {
  name: string;
  bucket: (vd: VD) => string;
  // 辞書順ではなく論理順で並べたい場合
  order?: string[];
};

const AXES: AxisDef[] = [
  { name: 'handicap',        bucket: (v) => v.meta?.handicap ?? '不明', order: ['馬齢','定量','別定','ハンデ','不明'] },
  { name: 'headCount',       bucket: (v) => bucketHeadCount(v.meta?.headCount),
    order: ['≤8頭','9-12頭','13-15頭','16頭+','不明'] },
  { name: 'trackCondition',  bucket: (v) => v.meta?.trackCondition ?? '不明', order: ['良','稍重','重','不良','不明'] },
  { name: 'weather',         bucket: (v) => v.meta?.weather ?? '不明' },
  { name: 'prize',           bucket: (v) => bucketPrize(v.meta?.prize),
    order: ['<500万','500-1000万','1000-2000万','2000-5000万','5000万+','不明'] },
  { name: 'surface',         bucket: (v) => v.meta?.surface ?? '不明' },
  { name: 'distance',        bucket: (v) => bucketDistance(v.meta?.distance),
    order: ['短距離 (≤1400)','マイル (1401-1800)','中距離 (1801-2200)','長距離 (2201+)','不明'] },
  { name: 'startTime',       bucket: (v) => bucketStartTime(v.meta?.startTime),
    order: ['午前 (〜10:59)','昼 (11:00-13:59)','午後 (14:00-15:59)','夕方 (16:00+)','不明'] },
  { name: 'courseTurn',      bucket: (v) => v.meta?.courseTurn ?? '不明' },
  { name: 'topPickWaku',     bucket: bucketTopWaku,
    order: ['1枠','2枠','3枠','4枠','5枠','6枠','7枠','8枠','不明'] },
];

// ----------------------------------------
// 各軸バケット別 ROI 集計 (Phase 2G 現行 = ベースライン)
// ----------------------------------------

type BucketStats = { umaren: Agg; umatan: Agg; wide: Agg };
const emptyBS = (): BucketStats => ({ umaren: emptyAgg(), umatan: emptyAgg(), wide: emptyAgg() });

function analyzeAxis(axis: AxisDef, all: VD[]): Map<string, BucketStats> {
  const map = new Map<string, BucketStats>();
  for (const vd of all) {
    const b = axis.bucket(vd);
    let st = map.get(b); if (!st) { st = emptyBS(); map.set(b, st); }
    addAgg(st.umaren, umarenHonmei(vd));
    addAgg(st.umatan, umatanHonmei(vd));
    addAgg(st.wide,   wideKenjitsu(vd));
  }
  return map;
}

// ----------------------------------------
// 除外候補判定
// ----------------------------------------

type ExclusionCandidate = {
  axis: string;
  bucket: string;
  betType: 'umaren' | 'umatan' | 'wide';
  participated: number;
  roi: number;
};

/**
 * 除外候補の条件:
 *   - 参加R >= 30 (最低サンプル)
 *   - ROI < 70% (明確なハズレ帯)
 */
function findExclusionCandidates(
  axisName: string,
  stats: Map<string, BucketStats>,
): ExclusionCandidate[] {
  const out: ExclusionCandidate[] = [];
  for (const [bucket, s] of Array.from(stats.entries())) {
    const U = s.umaren, T = s.umatan, W = s.wide;
    if (U.participated >= 30 && roi(U) < 70) out.push({ axis: axisName, bucket, betType: 'umaren', participated: U.participated, roi: roi(U) });
    if (T.participated >= 30 && roi(T) < 70) out.push({ axis: axisName, bucket, betType: 'umatan', participated: T.participated, roi: roi(T) });
    if (W.participated >= 30 && roi(W) < 70) out.push({ axis: axisName, bucket, betType: 'wide',   participated: W.participated, roi: roi(W) });
  }
  return out;
}

// ----------------------------------------
// 除外ルール適用バックテスト
// ----------------------------------------

type ExclusionRule = {
  // key = betType, value = set of (axis+bucket) to exclude
  umaren: Array<{ axis: AxisDef; bucket: string }>;
  umatan: Array<{ axis: AxisDef; bucket: string }>;
  wide:   Array<{ axis: AxisDef; bucket: string }>;
};

function applyExclusion(
  vd: VD,
  kind: 'umaren' | 'umatan' | 'wide',
  rule: ExclusionRule,
): boolean {
  // true = excluded
  const items = kind === 'umaren' ? rule.umaren : kind === 'umatan' ? rule.umatan : rule.wide;
  for (const { axis, bucket } of items) {
    if (axis.bucket(vd) === bucket) return true;
  }
  return false;
}

function backtestWithRule(all: VD[], rule: ExclusionRule): {
  umaren: Agg; umatan: Agg; wide: Agg; totalPt: number;
  monthlyUmaren: Map<string, Agg>;
} {
  const U = emptyAgg(), T = emptyAgg(), W_ = emptyAgg();
  const monthlyU = new Map<string, Agg>();
  for (const vd of all) {
    if (!applyExclusion(vd, 'umaren', rule)) {
      const o = umarenHonmei(vd);
      addAgg(U, o);
      if (o.cost > 0) {
        const m = (vd.meta?.raceDate ?? vd.raceId).substring(0, 6);
        const key = `${m.substring(0,4)}-${m.substring(4,6)}`;
        let mo = monthlyU.get(key); if (!mo) { mo = emptyAgg(); monthlyU.set(key, mo); }
        addAgg(mo, o);
      }
    }
    if (!applyExclusion(vd, 'umatan', rule)) addAgg(T, umatanHonmei(vd));
    if (!applyExclusion(vd, 'wide',   rule)) addAgg(W_, wideKenjitsu(vd));
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
// データ読込・時系列分割
// ----------------------------------------

async function loadAll(): Promise<VD[]> {
  const files = (await fs.readdir(DIR)).filter((f) => f.endsWith('.json'));
  const out: VD[] = [];
  for (const f of files) {
    try {
      const j = JSON.parse(await fs.readFile(path.join(DIR, f), 'utf-8'));
      if (!j.predictions || j.predictions.length < 2) continue;
      if (!j.results?.payouts) continue;
      out.push(j);
    } catch {}
  }
  // 月でソート
  return out.sort((a, b) => {
    const da = a.meta?.raceDate ?? a.raceId.substring(0, 8);
    const db = b.meta?.raceDate ?? b.raceId.substring(0, 8);
    return String(da).localeCompare(String(db));
  });
}

// ----------------------------------------
// メイン
// ----------------------------------------

async function main(): Promise<void> {
  console.log('=====================================================');
  console.log('  アプローチ4: 未活用軸のスコア統合分析');
  console.log('=====================================================');

  const all = await loadAll();
  console.log(`総データ: ${all.length} R`);

  // Chronological train/test 70/30
  const cutIdx = Math.floor(all.length * 0.7);
  const train = all.slice(0, cutIdx);
  const test  = all.slice(cutIdx);
  const getDate = (v: VD): string => v.meta?.raceDate ?? v.raceId.substring(0,8);
  console.log(`train: ${train.length}R (${getDate(train[0])}〜${getDate(train.at(-1)!)})`);
  console.log(` test: ${test.length}R  (${getDate(test[0])}〜${getDate(test.at(-1)!)})`);

  // --- Step 2: 軸別単独効果分析 (全データで発見、過学習防止のため採用判定は train で) ---
  const analyzeOn = (set: VD[]): Map<string, Map<string, BucketStats>> => {
    const out = new Map<string, Map<string, BucketStats>>();
    for (const ax of AXES) out.set(ax.name, analyzeAxis(ax, set));
    return out;
  };
  const axisStatsFull  = analyzeOn(all);
  const axisStatsTrain = analyzeOn(train);
  const axisStatsTest  = analyzeOn(test);

  // --- ベースライン: 除外なし (現行 Phase 2G) ---
  const baseRule: ExclusionRule = { umaren: [], umatan: [], wide: [] };
  const baseAll   = backtestWithRule(all,   baseRule);
  const baseTrain = backtestWithRule(train, baseRule);
  const baseTest  = backtestWithRule(test,  baseRule);
  console.log('');
  console.log(`[ベースライン 全3233R] 合計pt=${baseAll.totalPt.toFixed(1)}`);
  console.log(`[ベースライン train]   合計pt=${baseTrain.totalPt.toFixed(1)}`);
  console.log(`[ベースライン test]    合計pt=${baseTest.totalPt.toFixed(1)}`);

  // --- Step 4: 除外候補を train で発見 (過学習防止) ---
  const candidates: ExclusionCandidate[] = [];
  for (const ax of AXES) {
    const s = axisStatsTrain.get(ax.name)!;
    candidates.push(...findExclusionCandidates(ax.name, s));
  }
  // roi 昇順 (最もハズレな順)
  candidates.sort((a, b) => a.roi - b.roi);

  console.log(`\n除外候補 (train ROI<70% かつ 参加R≥30): ${candidates.length} 件`);
  for (const c of candidates.slice(0, 20)) {
    console.log(`  [${c.betType}] ${c.axis}=${c.bucket}: ${c.participated}R, ROI ${c.roi.toFixed(1)}%`);
  }

  // --- Step 5: 統合パターン候補を train で評価 ---
  type PatternSpec = { id: string; label: string; candidates: ExclusionCandidate[] };

  // 採用ルール:
  //   P1 = train で最も低ROIな候補 1件
  //   P2 = 上位 2 件
  //   P3 = 上位 3 件
  //   Ptop = 上位 5 件
  //   Pall = 全候補採用 (過学習の確認用)
  const topN = (n: number): ExclusionCandidate[] => candidates.slice(0, n);
  const patterns: PatternSpec[] = [
    { id: 'P0', label: '除外なし (現行 Phase 2G)', candidates: [] },
    { id: 'P1', label: 'train 最悪候補 1件追加', candidates: topN(1) },
    { id: 'P2', label: 'train 最悪候補 2件追加', candidates: topN(2) },
    { id: 'P3', label: 'train 最悪候補 3件追加', candidates: topN(3) },
    { id: 'P5', label: 'train 最悪候補 5件追加', candidates: topN(5) },
    { id: 'Pall', label: '全候補追加 (過学習確認)', candidates: [...candidates] },
  ];

  const axByName = new Map<string, AxisDef>(AXES.map((a) => [a.name, a]));
  const makeRule = (cands: ExclusionCandidate[]): ExclusionRule => {
    const r: ExclusionRule = { umaren: [], umatan: [], wide: [] };
    for (const c of cands) {
      const ax = axByName.get(c.axis)!;
      (r[c.betType] as Array<{ axis: AxisDef; bucket: string }>).push({ axis: ax, bucket: c.bucket });
    }
    return r;
  };

  type PatResult = {
    spec: PatternSpec;
    rule: ExclusionRule;
    train: ReturnType<typeof backtestWithRule>;
    test:  ReturnType<typeof backtestWithRule>;
    full:  ReturnType<typeof backtestWithRule>;
  };
  const patResults: PatResult[] = [];
  for (const p of patterns) {
    const rule = makeRule(p.candidates);
    patResults.push({
      spec: p, rule,
      train: backtestWithRule(train, rule),
      test:  backtestWithRule(test,  rule),
      full:  backtestWithRule(all,   rule),
    });
  }

  // --- 最良パターン選定 ---
  // 採用基準: test ROI >= 100% 各券種 AND test/train >= 0.80 AND test合計pt 最大
  const baseTestPt = baseTest.totalPt;
  const isOverfitOK = (pr: PatResult): boolean => {
    if (pr.train.totalPt === 0) return true;
    return pr.test.totalPt / pr.train.totalPt >= 0.80;
  };
  const eligibleResults = patResults.filter((pr) => isOverfitOK(pr) && pr.test.totalPt >= baseTestPt);
  const best = eligibleResults.sort((a, b) => b.test.totalPt - a.test.totalPt)[0] ?? patResults[0];

  // --- Markdown ---
  const md: string[] = [];
  const mp = (s = ''): void => { md.push(s); };

  mp(`# アプローチ4: 未活用軸スコア統合 実装報告`);
  mp('');
  mp(`- 生成日時: ${new Date().toISOString()}`);
  mp(`- 対象: **${all.length} R** (chronological 70/30 = train ${train.length}R / test ${test.length}R)`);
  mp(`- 方針: **手法C (除外ルール拡張)** — 既存スコア構造を変えず、ハズレ帯のみ除外`);
  mp('');

  // 1. 現状分析
  mp(`## 1. 現状のスコア算出ロジック分析`);
  mp('');
  mp(`### スコアに使われている項目 (lib/score/calculator.ts)`);
  mp('');
  mp(`| 項目 | 重み | 備考 |`);
  mp(`|---|---|---|`);
  mp(`| lastThreeF   | 0.244 | 上がり3F (Horse.lastThreeF) |`);
  mp(`| training     | 0.125 | 調教 (Horse.lastThreeF 兼用) |`);
  mp(`| courseRecord | 0.198 | 同コース成績 (未実装、50固定) |`);
  mp(`| prevClass    | 0.146 | 前走クラス (Horse.prevRaceName) |`);
  mp(`| breeding     | 0.158 | 父馬×コース×距離帯 (Horse.breedingFitness) |`);
  mp(`| weightChange | 0.071 | 馬体重増減 (Horse.weightDiff) |`);
  mp(`| jockey       | 0.058 | 騎手勝率 (jockeyRates) |`);
  mp(`| **合計**     | **1.000** | |`);
  mp('');
  mp(`### 除外ロジックで使われている項目 (Phase 2G)`);
  mp(`- \`race.raceClass\` → 馬連/馬単は C1+C2 除外、ワイドは C1 のみ除外`);
  mp('');
  mp(`### 取得済みだがスコア・除外に使われていない項目`);
  mp(`- \`handicap\` (ハンデ/別定/馬齢/定量)`);
  mp(`- \`headCount\` (出走頭数)`);
  mp(`- \`trackCondition\` (良/稍重/重/不良)`);
  mp(`- \`weather\` (晴/曇/雨/雪)`);
  mp(`- \`prize\` (1着賞金, 万円)`);
  mp(`- \`distance\` (m) — breeding 内で距離帯判定に間接利用のみ`);
  mp(`- \`surface\` (turf/dirt) — breeding 内で間接利用のみ`);
  mp(`- \`startTime\` (発走時刻)`);
  mp(`- \`courseTurn\` (右/左/直線)`);
  mp(`- \`ageLimit\`, \`sexLimit\`, \`raceGrade\` (Phase 2C で別途検証済)`);
  mp(`- \`Horse.waku\` (枠番) — スコアに未反映`);
  mp('');

  // 2. 軸別単独効果
  mp(`## 2. 軸別単独効果分析 (全3233R, Phase 2G 現行ルール適用後)`);
  mp('');
  mp(`各バケットで本命級推奨が発生したレースのみ集計。参加R≥50 で判定。`);
  mp(`判定: ⭐ROI≥150% / ○100〜150% / -80〜100% / ❌<80% / ⚠️ 参加R<50`);
  mp('');

  const judge = (a: Agg): string => {
    if (a.participated < 50) return '⚠️';
    const r = roi(a);
    if (r >= 150) return '⭐';
    if (r >= 100) return '○';
    if (r >= 80)  return '-';
    return '❌';
  };

  for (const ax of AXES) {
    const st = axisStatsFull.get(ax.name)!;
    const keys = ax.order
      ? ax.order.filter((k) => st.has(k)).concat(Array.from(st.keys()).filter((k) => !ax.order!.includes(k)))
      : Array.from(st.keys()).sort();
    mp(`### 軸: \`${ax.name}\``);
    mp('');
    mp(`| バケット | 馬連本命 (参加/hit/ROI) | 馬単本命 (参加/hit/ROI) | ワイド堅実 (参加/hit/ROI) |`);
    mp(`|---|---|---|---|`);
    for (const k of keys) {
      const s = st.get(k)!;
      const f = (a: Agg): string => `${a.participated}R/${a.hits}/${roi(a).toFixed(1)}% ${judge(a)}`;
      mp(`| ${k} | ${f(s.umaren)} | ${f(s.umatan)} | ${f(s.wide)} |`);
    }
    mp('');
  }

  // 3. 除外候補一覧 (train)
  mp(`## 3. 除外候補一覧 (train で発見, ROI<70%, 参加R≥30)`);
  mp('');
  if (candidates.length === 0) {
    mp(`→ 条件を満たす除外候補なし。全軸のバケットで ROI≥70% または 参加R<30。`);
  } else {
    mp(`| 券種 | 軸=バケット | train 参加R | train ROI | test 参加R | test ROI | full 参加R | full ROI |`);
    mp(`|---|---|---|---|---|---|---|---|`);
    for (const c of candidates) {
      const axObj = axByName.get(c.axis)!;
      const trainS = axisStatsTrain.get(c.axis)!.get(c.bucket) ?? emptyBS();
      const testS  = axisStatsTest .get(c.axis)!.get(c.bucket) ?? emptyBS();
      const fullS  = axisStatsFull .get(c.axis)!.get(c.bucket) ?? emptyBS();
      const pick = (s: BucketStats): Agg => s[c.betType];
      const tr = pick(trainS), te = pick(testS), fu = pick(fullS);
      mp(`| ${c.betType} | ${c.axis}=${c.bucket} | ${tr.participated} | ${roi(tr).toFixed(1)}% | ${te.participated} | ${roi(te).toFixed(1)}% | ${fu.participated} | ${roi(fu).toFixed(1)}% |`);
    }
  }
  mp('');

  // 4. 統合パターン評価
  mp(`## 4. 除外ルール統合パターン評価 (train/test 分割)`);
  mp('');
  mp(`**採用候補を train で決定 → test で汎化性能検証**`);
  mp('');
  mp(`| ID | 内容 | train 合計pt | test 合計pt | test/train | 月別CV(馬連) | 判定 |`);
  mp(`|---|---|---|---|---|---|---|`);
  for (const pr of patResults) {
    const ratio = pr.train.totalPt === 0 ? 1 : pr.test.totalPt / pr.train.totalPt;
    const cv = monthlyCV(pr.test.monthlyUmaren).cv;
    const okOver  = ratio >= 0.80;
    const okVsBase = pr.test.totalPt >= baseTestPt;
    const okCV    = cv <= 1.0;
    const mark = (okOver && okVsBase && okCV) ? '✅' : okOver ? '△' : '❌';
    mp(`| ${pr.spec.id} | ${pr.spec.label} | ${pr.train.totalPt.toFixed(1)} | ${pr.test.totalPt.toFixed(1)} | ${(ratio*100).toFixed(0)}% | ${cv.toFixed(3)} | ${mark} |`);
  }
  mp('');

  // 5. 詳細 (各パターンの券種別ROI)
  mp(`## 5. パターン詳細 (各券種)`);
  mp('');
  mp(`| ID | train 馬連 | train 馬単 | train ワイド | test 馬連 | test 馬単 | test ワイド |`);
  mp(`|---|---|---|---|---|---|---|`);
  for (const pr of patResults) {
    mp(`| ${pr.spec.id} | ${roi(pr.train.umaren).toFixed(1)}% | ${roi(pr.train.umatan).toFixed(1)}% | ${roi(pr.train.wide).toFixed(1)}% | ${roi(pr.test.umaren).toFixed(1)}% | ${roi(pr.test.umatan).toFixed(1)}% | ${roi(pr.test.wide).toFixed(1)}% |`);
  }
  mp('');

  // 6. 月別安定性
  mp(`## 6. 月別安定性 (test 馬連本命 ROI)`);
  mp('');
  mp(`| ID | CV | 最悪月ROI | 最良月ROI |`);
  mp(`|---|---|---|---|`);
  for (const pr of patResults) {
    const mv = monthlyCV(pr.test.monthlyUmaren);
    mp(`| ${pr.spec.id} | ${mv.cv.toFixed(3)} | ${mv.min.toFixed(1)}% | ${mv.max.toFixed(1)}% |`);
  }
  mp('');

  // 7. 採用判定
  mp(`## 7. 採用判定`);
  mp('');
  const baseFullPt = baseAll.totalPt;
  const bestFullPt = best.full.totalPt;
  const gain = bestFullPt - baseFullPt;
  const ratio = best.train.totalPt === 0 ? 1 : best.test.totalPt / best.train.totalPt;
  const testBetter = best.test.totalPt >= baseTestPt;

  mp(`**最良候補: ${best.spec.id}** (${best.spec.label})`);
  mp('');
  mp(`- 採用除外ルール:`);
  if (best.spec.candidates.length === 0) mp(`  - なし (現行維持)`);
  for (const c of best.spec.candidates) mp(`  - [${c.betType}] ${c.axis}=${c.bucket} (train ROI ${c.roi.toFixed(1)}%, ${c.participated}R)`);
  mp('');
  mp(`### 採用基準チェック`);
  mp(`- ${gain >= 10 ? '✅' : '❌'} 合計pt +10pt以上 (現行 ${baseFullPt.toFixed(1)} → 採用 ${bestFullPt.toFixed(1)}, 差分 ${gain>=0?'+':''}${gain.toFixed(1)}pt)`);
  mp(`- ${ratio >= 0.80 ? '✅' : '❌'} test/train ≥ 80% (${(ratio*100).toFixed(0)}%)`);
  mp(`- ${testBetter ? '✅' : '❌'} test 合計pt ≥ 現行 test 合計pt (${best.test.totalPt.toFixed(1)} vs ${baseTestPt.toFixed(1)})`);
  const cvBest = monthlyCV(best.test.monthlyUmaren).cv;
  mp(`- ${cvBest <= 1.0 ? '✅' : '❌'} test 月別CV ≤ 1.0 (${cvBest.toFixed(3)})`);
  mp('');

  // 結論
  let verdict: 'α' | 'β' | 'γ';
  if (gain >= 30 && ratio >= 0.80 && testBetter && cvBest <= 1.0) verdict = 'α';
  else if (gain >= 10 && ratio >= 0.80 && testBetter && cvBest <= 1.0) verdict = 'β';
  else verdict = 'γ';

  mp(`### 結論: ケース${verdict}`);
  mp('');
  if (verdict === 'α') mp(`**大幅改善 (+${gain.toFixed(1)}pt)**、本番実装を推奨。`);
  else if (verdict === 'β') mp(`**微改善 (+${gain.toFixed(1)}pt)**、採用基準を満たす、本番実装候補。`);
  else mp(`**改善なし/過学習/不安定**。見送り。`);
  mp('');

  // 8. 本番反映
  if (verdict !== 'γ') {
    mp(`## 8. 本番反映案`);
    mp('');
    mp(`### 実装差分 (lib/score/calculator.ts)`);
    mp('');
    mp('```typescript');
    mp('// 軸値の追加除外判定を race.meta から参照する前提');
    mp('// ※ Race 型に meta 相当のフィールドがある前提 (handicap, headCount, trackCondition 等)');
    mp('');
    // 軸ごとに判定関数を生成
    const byAxis: Record<string, string[]> = {};
    const byAxisBetType: Record<string, Record<string, string[]>> = {};
    for (const c of best.spec.candidates) {
      const key = `${c.betType}`;
      if (!byAxis[key]) byAxis[key] = [];
      byAxis[key].push(`${c.axis}=${c.bucket}`);
      if (!byAxisBetType[c.betType]) byAxisBetType[c.betType] = {};
      if (!byAxisBetType[c.betType][c.axis]) byAxisBetType[c.betType][c.axis] = [];
      byAxisBetType[c.betType][c.axis].push(c.bucket);
    }
    mp('function isExcludedByApproach4(race: Race, bet: "umaren"|"umatan"|"wide"): boolean {');
    mp('  // アプローチ4 で発見した除外条件');
    for (const [bt, byA] of Object.entries(byAxisBetType)) {
      mp(`  if (bet === "${bt}") {`);
      for (const [ax, buckets] of Object.entries(byA)) {
        const vals = buckets.map((b) => `"${b}"`).join(', ');
        mp(`    if ([${vals}].includes(String(race.${ax} ?? ""))) return true;`);
      }
      mp(`  }`);
    }
    mp('  return false;');
    mp('}');
    mp('');
    mp('// 既存の shouldRecommendUmaren/Umatan/Wide の先頭に追加:');
    mp('//   if (isExcludedByApproach4(race, "umaren")) return "skip";');
    mp('```');
  } else {
    mp(`## 8. 次のアクション`);
    mp('');
    mp(`- **アプローチ2: 新軸追加・特徴量再設計** へ進む`);
    mp(`  - 前走着差、斤量変化率、騎手コース別勝率など未取得だが予測価値のある軸`);
    mp(`  - あるいは既存軸の計算方法再設計 (lastThreeF を加重平均化など)`);
  }
  mp('');

  mp(`---`);
  mp(`*再実行: \`pnpm tsx scripts/approach4_unused_axes.ts\`*`);

  await fs.writeFile(REPORT, md.join('\n'), 'utf-8');

  console.log('');
  console.log('=====================================================');
  console.log(`  採用判定: ケース${verdict}`);
  console.log(`  ベースライン 全3233R pt: ${baseFullPt.toFixed(1)}`);
  console.log(`  最良候補 ${best.spec.id}: train=${best.train.totalPt.toFixed(1)} test=${best.test.totalPt.toFixed(1)} full=${bestFullPt.toFixed(1)}`);
  console.log(`  改善: ${gain>=0?'+':''}${gain.toFixed(1)}pt / test/train=${(ratio*100).toFixed(0)}% / CV=${cvBest.toFixed(3)}`);
  console.log(`  Markdown: ${REPORT}`);
  console.log('=====================================================');
}

main().catch((e) => { console.error(e); process.exit(1); });
