// ==========================================
// Phase 2G クラス別閾値 3233R版 再チューニング
//
// 目的:
//   930R時代の Phase 2G ハイブリッド除外ルール（C1全skip、C2は馬連馬単のみskip）が
//   サンプル拡大後の 3233R データで依然として最適か検証・再最適化する。
//
// 検証内容:
//   1. 3233R版でのベースライン計測（現行ハイブリッド）
//   2. クラス別 × 券種別 ROI 全集計
//   3. 除外ルール候補 A〜J の網羅的比較
//   4. 時系列安定性（月別CV）評価
//   5. 最適ルール判定・本番反映差分案
//
// 実行: pnpm tsx scripts/phase2g_retuning_3233r.ts
// 出力: scripts/verification/phase2g_retuning_3233r.md
// ==========================================

import { promises as fs } from 'node:fs';
import path from 'node:path';

const DIR = path.resolve(__dirname, 'verification');
const REPORT = path.join(DIR, 'phase2g_retuning_3233r.md');

// ----------------------------------------
// 型定義 (JSON 構造)
// ----------------------------------------

type Prediction = {
  horseId: number;
  horseName: string;
  score: number;
  ev: number;
  odds: number;
  waku?: number;
};

type PayoutEntry = { combination: string; payout: number };
type FukuEntry   = { horseId: number; payout: number };

type VD = {
  raceId: string;
  raceName: string;
  date: string;
  predictions: Prediction[];
  results: {
    results: Array<{ rank: number; horseId: number }>;
    payouts: {
      tan?: FukuEntry[];
      fuku?: FukuEntry[];
      umaren?: PayoutEntry[];
      umatan?: PayoutEntry[];
      wide?: PayoutEntry[];
    };
  };
  meta?: {
    raceClass?: string;
    raceGrade?: string;
    raceCondition?: string;
    trackCondition?: string;
    prize?: number;
    raceDate?: string;
  };
};

// ----------------------------------------
// クラス分類
// ----------------------------------------

type RaceClass =
  | 'G1' | 'G2' | 'G3' | 'OP' | 'SP'
  | 'C3' | 'C2' | 'C1' | 'UW' | 'NW' | 'Unknown';

const CLASS_ORDER: RaceClass[] = ['NW','UW','C1','C2','C3','SP','OP','G3','G2','G1','Unknown'];

const CLASS_LABEL: Record<RaceClass, string> = {
  NW: '新馬戦', UW: '未勝利戦', C1: '1勝クラス', C2: '2勝クラス', C3: '3勝クラス',
  SP: '特別(クラス不明)', OP: 'OP/L', G3: 'G3', G2: 'G2', G1: 'G1', Unknown: '不明',
};

function classifyRace(vd: VD): RaceClass {
  const meta = vd.meta;
  if (meta) {
    const g = meta.raceGrade;
    if (g === 'G1') return 'G1';
    if (g === 'G2') return 'G2';
    if (g === 'G3') return 'G3';
    if (g === 'L')  return 'OP';
    const rc = meta.raceClass;
    if (rc) {
      if (/3勝|1600万/.test(rc)) return 'C3';
      if (/2勝|1000万/.test(rc)) return 'C2';
      if (/1勝|500万/.test(rc))  return 'C1';
      if (/未勝利/.test(rc))      return 'UW';
      if (/新馬/.test(rc))        return 'NW';
      if (/オープン|OP|リステッド/.test(rc)) return 'OP';
    }
  }
  const n = vd.raceName ?? '';
  if (/G1|GⅠ|Ｇ１/.test(n)) return 'G1';
  if (/G2|GⅡ|Ｇ２/.test(n)) return 'G2';
  if (/G3|GⅢ|Ｇ３/.test(n)) return 'G3';
  if (/オープン|ＯＰ|\(L\)|リステッド/.test(n)) return 'OP';
  if (/3勝|1600万/.test(n)) return 'C3';
  if (/2勝|1000万/.test(n)) return 'C2';
  if (/1勝|500万/.test(n)) return 'C1';
  if (/未勝利/.test(n)) return 'UW';
  if (/新馬/.test(n)) return 'NW';
  if (/ステークス|特別|賞|杯|カップ|S$|C$/.test(n)) return 'SP';
  return 'Unknown';
}

// ----------------------------------------
// ユーティリティ
// ----------------------------------------

const roi = (c: number, p: number): number => c > 0 ? (p / c) * 100 : 0;

function sortedByEV(preds: Prediction[]): Prediction[] {
  return [...preds].filter((p) => p.odds > 0).sort((a, b) => b.ev - a.ev);
}

const sameSet = (a: number[], b: number[]): boolean =>
  a.length === b.length && [...a].sort((x,y)=>x-y).join(',') === [...b].sort((x,y)=>x-y).join(',');
const sameSeq = (a: number[], b: number[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

function permutations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  const r: T[][] = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0,i), ...arr.slice(i+1)];
    for (const p of permutations(rest, k-1)) r.push([arr[i], ...p]);
  }
  return r;
}

function mean(a: number[]): number { return a.length===0?0:a.reduce((s,v)=>s+v,0)/a.length; }
function stddev(a: number[]): number {
  if (a.length <= 1) return 0;
  const m = mean(a);
  return Math.sqrt(mean(a.map((v)=>(v-m)**2)));
}
function cv(a: number[]): number {
  if (a.length === 0) return 0;
  const m = mean(a); if (m === 0) return 0;
  return stddev(a) / m;
}

// ----------------------------------------
// 本命級戦略の判定
// ----------------------------------------

type BetOutcome = { cost: number; payout: number; hit: boolean };
const noBet: BetOutcome = { cost: 0, payout: 0, hit: false };

function computeUmarenHonmei(vd: VD): BetOutcome {
  const sorted = sortedByEV(vd.predictions);
  const p1 = sorted[0], p2 = sorted[1];
  if (!p1 || !p2) return noBet;
  if (p1.ev < 1.00 || p2.ev < 1.00) return noBet;
  if (p1.score < 65 || p2.score < 65) return noBet;
  const payouts = vd.results.payouts.umaren ?? [];
  for (const u of payouts) {
    if (sameSet([p1.horseId, p2.horseId], u.combination.split('-').map(Number))) {
      return { cost: 100, payout: u.payout, hit: true };
    }
  }
  return { cost: 100, payout: 0, hit: false };
}

function computeUmatanHonmei(vd: VD): BetOutcome {
  const sorted = sortedByEV(vd.predictions);
  const p1 = sorted[0], p2 = sorted[1];
  if (!p1 || !p2) return noBet;
  if (p1.ev < 1.00 || p2.ev < 1.00) return noBet;
  if (p1.score < 65 || p2.score < 65) return noBet;
  if (p1.odds > 15 || p2.odds > 15) return noBet;
  const payouts = vd.results.payouts.umatan ?? [];
  let hit = false, pay = 0;
  for (const perm of permutations([p1.horseId, p2.horseId], 2)) {
    for (const u of payouts) {
      if (sameSeq(perm, u.combination.split('-').map(Number))) {
        hit = true; pay += u.payout; break;
      }
    }
  }
  return { cost: 200, payout: pay, hit };
}

function computeWideKenjitsu(vd: VD): BetOutcome {
  const sorted = sortedByEV(vd.predictions);
  const p1 = sorted[0], p2 = sorted[1];
  if (!p1 || !p2) return noBet;
  if (p1.ev < 1.02 || p2.ev < 1.02) return noBet;
  if (p1.score < 65 || p2.score < 65) return noBet;
  if (p1.odds > 10 || p2.odds > 10) return noBet;
  const payouts = vd.results.payouts.wide ?? [];
  for (const w of payouts) {
    if (sameSet([p1.horseId, p2.horseId], w.combination.split('-').map(Number))) {
      return { cost: 100, payout: w.payout, hit: true };
    }
  }
  return { cost: 100, payout: 0, hit: false };
}

// ----------------------------------------
// 除外ルール定義
// ----------------------------------------

type ExclusionRule = {
  umaren: RaceClass[];
  umatan: RaceClass[];
  wide:   RaceClass[];
};

type Pattern = { id: string; label: string; rule: ExclusionRule };

const PATTERNS: Pattern[] = [
  { id: 'A', label: '現状維持 (C1全skip, C2は馬連馬単のみskip)',
    rule: { umaren: ['C1','C2'], umatan: ['C1','C2'], wide: ['C1'] } },
  { id: 'B', label: '全クラス参加 (除外なし)',
    rule: { umaren: [], umatan: [], wide: [] } },
  { id: 'C', label: '1勝クラスのみskip (全券種)',
    rule: { umaren: ['C1'], umatan: ['C1'], wide: ['C1'] } },
  { id: 'D', label: '1勝+2勝skip (全券種)',
    rule: { umaren: ['C1','C2'], umatan: ['C1','C2'], wide: ['C1','C2'] } },
  { id: 'E', label: '1勝+2勝+3勝skip (全券種)',
    rule: { umaren: ['C1','C2','C3'], umatan: ['C1','C2','C3'], wide: ['C1','C2','C3'] } },
  { id: 'F', label: '1勝skip、2勝は馬連馬単skip (A同義)',
    rule: { umaren: ['C1','C2'], umatan: ['C1','C2'], wide: ['C1'] } },
  { id: 'G', label: '1勝skip、2勝は馬連のみskip (ワイド・馬単は参加)',
    rule: { umaren: ['C1','C2'], umatan: ['C1'], wide: ['C1'] } },
  { id: 'I', label: '1勝+未勝利+新馬skip (低級戦全除外)',
    rule: { umaren: ['C1','NW','UW'], umatan: ['C1','NW','UW'], wide: ['C1','NW','UW'] } },
  { id: 'J', label: '1勝+2勝skip + OP/重賞のみ参加',
    rule: { umaren: ['C1','C2','C3','SP','NW','UW','Unknown'],
            umatan: ['C1','C2','C3','SP','NW','UW','Unknown'],
            wide:   ['C1','C2','C3','SP','NW','UW','Unknown'] } },
  { id: 'K', label: '1勝+2勝+SPskip (馬連馬単のみ)、ワイド=C1のみ',
    rule: { umaren: ['C1','C2','SP'], umatan: ['C1','C2','SP'], wide: ['C1'] } },
  { id: 'L', label: '1勝+未勝利skip (馬連馬単)、ワイド=C1+UW',
    rule: { umaren: ['C1','UW'], umatan: ['C1','UW'], wide: ['C1','UW'] } },
];

// ----------------------------------------
// メイン
// ----------------------------------------

type OutcomeByKind = {
  umaren: BetOutcome;
  umatan: BetOutcome;
  wide:   BetOutcome;
};

type Record_ = {
  raceId: string;
  month: string;   // "YYYY-MM"
  cls: RaceClass;
  outcomes: OutcomeByKind;
};

async function loadAll(): Promise<Record_[]> {
  const files = (await fs.readdir(DIR)).filter((f) => f.endsWith('.json'));
  const out: Record_[] = [];
  for (const f of files) {
    let vd: VD;
    try { vd = JSON.parse(await fs.readFile(path.join(DIR, f), 'utf-8')); }
    catch { continue; }
    if (!vd.predictions || vd.predictions.length < 2) continue;
    if (!vd.results?.payouts) continue;

    const cls = classifyRace(vd);
    const rd  = vd.meta?.raceDate ?? f.substring(0, 8);
    const month = `${String(rd).substring(0,4)}-${String(rd).substring(4,6)}`;

    out.push({
      raceId: vd.raceId, month, cls,
      outcomes: {
        umaren: computeUmarenHonmei(vd),
        umatan: computeUmatanHonmei(vd),
        wide:   computeWideKenjitsu(vd),
      },
    });
  }
  return out;
}

// パターン適用後の集計
type Agg = { cost: number; payout: number; hits: number; participated: number };
const emptyAgg = (): Agg => ({ cost: 0, payout: 0, hits: 0, participated: 0 });

function aggregate(records: Record_[], rule: ExclusionRule): {
  umaren: Agg; umatan: Agg; wide: Agg;
  monthlyROI: { umaren: Map<string, Agg>; umatan: Map<string, Agg>; wide: Map<string, Agg> };
  totalRaces: number;
} {
  const umaren = emptyAgg(), umatan = emptyAgg(), wide_ = emptyAgg();
  const mU = new Map<string, Agg>(), mT = new Map<string, Agg>(), mW = new Map<string, Agg>();
  const getOrInit = (m: Map<string, Agg>, k: string): Agg => {
    let v = m.get(k); if (!v) { v = emptyAgg(); m.set(k, v); } return v;
  };
  let totalRaces = 0;

  for (const r of records) {
    totalRaces++;
    const apply = (agg: Agg, mapAgg: Agg, o: BetOutcome, skipped: boolean): void => {
      if (skipped) return;
      if (o.cost === 0) return;
      agg.cost += o.cost; agg.payout += o.payout;
      agg.participated++; if (o.hit) agg.hits++;
      mapAgg.cost += o.cost; mapAgg.payout += o.payout;
      mapAgg.participated++; if (o.hit) mapAgg.hits++;
    };
    apply(umaren, getOrInit(mU, r.month), r.outcomes.umaren, rule.umaren.includes(r.cls));
    apply(umatan, getOrInit(mT, r.month), r.outcomes.umatan, rule.umatan.includes(r.cls));
    apply(wide_,  getOrInit(mW, r.month), r.outcomes.wide,   rule.wide.includes(r.cls));
  }
  return { umaren, umatan, wide: wide_, monthlyROI: { umaren: mU, umatan: mT, wide: mW }, totalRaces };
}

function monthlyCV(m: Map<string, Agg>, minSamples = 3): { cv: number; months: number; maxROI: number; minROI: number; zeroMonths: number } {
  const rois: number[] = [];
  let zeroMonths = 0;
  for (const a of Array.from(m.values())) {
    if (a.participated < minSamples) continue;
    rois.push(roi(a.cost, a.payout));
  }
  for (const a of Array.from(m.values())) if (a.participated === 0) zeroMonths++;
  if (rois.length === 0) return { cv: 0, months: 0, maxROI: 0, minROI: 0, zeroMonths };
  return { cv: cv(rois), months: rois.length, maxROI: Math.max(...rois), minROI: Math.min(...rois), zeroMonths };
}

async function main(): Promise<void> {
  console.log('================================================================');
  console.log('  Phase 2G クラス別閾値 3233R版 再チューニング');
  console.log('================================================================');

  const records = await loadAll();
  console.log(`対象: ${records.length} R`);

  // --- 1. クラス分布 ---
  const classCounts: Record<RaceClass, number> = { NW:0,UW:0,C1:0,C2:0,C3:0,SP:0,OP:0,G3:0,G2:0,G1:0,Unknown:0 };
  for (const r of records) classCounts[r.cls]++;

  // --- 2. クラス別 × 券種別 ROI（除外なし基準） ---
  type ClassKind = { umaren: Agg; umatan: Agg; wide: Agg };
  const byClass: Record<RaceClass, ClassKind> = Object.fromEntries(
    CLASS_ORDER.map((c) => [c, { umaren: emptyAgg(), umatan: emptyAgg(), wide: emptyAgg() }])
  ) as Record<RaceClass, ClassKind>;
  const addTo = (agg: Agg, o: BetOutcome): void => {
    if (o.cost === 0) return;
    agg.cost += o.cost; agg.payout += o.payout;
    agg.participated++; if (o.hit) agg.hits++;
  };
  for (const r of records) {
    addTo(byClass[r.cls].umaren, r.outcomes.umaren);
    addTo(byClass[r.cls].umatan, r.outcomes.umatan);
    addTo(byClass[r.cls].wide,   r.outcomes.wide);
  }

  // --- 3. パターン別集計 ---
  type PR = ReturnType<typeof aggregate>;
  const patternResults: Record<string, PR> = {};
  for (const p of PATTERNS) patternResults[p.id] = aggregate(records, p.rule);

  // --- 4. 最適ルール判定 ---
  const patScore = (id: string): number => {
    const a = patternResults[id];
    return roi(a.umaren.cost, a.umaren.payout) + roi(a.umatan.cost, a.umatan.payout) + roi(a.wide.cost, a.wide.payout);
  };
  let bestId = 'A'; let bestSum = patScore('A');
  for (const p of PATTERNS) { const s = patScore(p.id); if (s > bestSum) { bestSum = s; bestId = p.id; } }

  // --- Markdown 出力 ---
  const md: string[] = [];
  const mp = (s = ''): void => { md.push(s); };

  mp(`# Phase 2G クラス別閾値 3233R版 再チューニング報告`);
  mp('');
  mp(`- 生成日時: ${new Date().toISOString()}`);
  mp(`- 対象: **${records.length} R** (2025-05 〜 2026-04, 12ヶ月)`);
  mp(`- 930R 版 (2025-12〜2026-04, 5ヶ月) の結論を 3233R (+2303R) で再検証`);
  mp('');

  // クラス分布
  mp(`## クラス分布`);
  mp('');
  mp(`| クラス | R数 |`);
  mp(`|---|---|`);
  for (const c of CLASS_ORDER) if (classCounts[c] > 0) mp(`| ${CLASS_LABEL[c]} | ${classCounts[c]} |`);
  mp('');

  // 1. ベースライン
  mp(`## 1. 現行ルール 3233R版ベースライン (パターンA = Phase 2G ハイブリッド)`);
  mp('');
  const A = patternResults.A;
  const aU = roi(A.umaren.cost, A.umaren.payout);
  const aT = roi(A.umatan.cost, A.umatan.payout);
  const aW = roi(A.wide.cost,   A.wide.payout);
  mp(`| 指標 | 930R版 | 3233R版 | 差分 |`);
  mp(`|---|---|---|---|`);
  mp(`| 馬連本命 ROI   | 265.4% | **${aU.toFixed(1)}%** | ${(aU-265.4>=0?'+':'')}${(aU-265.4).toFixed(1)}pt |`);
  mp(`| 馬単本命 ROI   | 167.8% | **${aT.toFixed(1)}%** | ${(aT-167.8>=0?'+':'')}${(aT-167.8).toFixed(1)}pt |`);
  mp(`| ワイド堅実 ROI | 121.8% | **${aW.toFixed(1)}%** | ${(aW-121.8>=0?'+':'')}${(aW-121.8).toFixed(1)}pt |`);
  mp(`| 合計pt         | 554.9  | **${(aU+aT+aW).toFixed(1)}** | ${((aU+aT+aW)-554.9>=0?'+':'')}${((aU+aT+aW)-554.9).toFixed(1)}pt |`);
  mp(`| 参加R(馬連) | 670 | **${A.umaren.participated}** | ${A.umaren.participated-670>=0?'+':''}${A.umaren.participated-670} |`);
  mp('');

  // 2. クラス別全集計
  mp(`## 2. クラス別 × 券種別 ROI 全集計（除外なし基準）`);
  mp('');
  mp(`判定: ⭐ROI≥150% / ○100〜150% / -80〜100% / ❌<80% / ⚠️推奨R<50`);
  mp('');
  mp(`| クラス | R数 | 馬連本命 参加/的中/ROI | 馬単本命 参加/的中/ROI | ワイド堅実 参加/的中/ROI |`);
  mp(`|---|---|---|---|---|`);
  const judge = (r: number, part: number): string => {
    if (part < 50) return '⚠️';
    if (r >= 150) return '⭐';
    if (r >= 100) return '○';
    if (r >= 80)  return '-';
    return '❌';
  };
  for (const cls of CLASS_ORDER) {
    if (classCounts[cls] === 0) continue;
    const ck = byClass[cls];
    const fmt = (a: Agg): string => {
      const r = roi(a.cost, a.payout);
      return `${a.participated}R/${a.hits}/${r.toFixed(1)}% ${judge(r, a.participated)}`;
    };
    mp(`| ${CLASS_LABEL[cls]} | ${classCounts[cls]} | ${fmt(ck.umaren)} | ${fmt(ck.umatan)} | ${fmt(ck.wide)} |`);
  }
  mp('');

  // 3. 除外ルール候補比較
  mp(`## 3. 除外ルール候補比較 (パターン A〜L)`);
  mp('');
  mp(`| ID | ルール | 馬連ROI | 馬単ROI | ワイドROI | 合計pt | 参加R(馬連) | 馬連月別CV |`);
  mp(`|---|---|---|---|---|---|---|---|`);
  for (const p of PATTERNS) {
    const ag = patternResults[p.id];
    const u = roi(ag.umaren.cost, ag.umaren.payout);
    const t = roi(ag.umatan.cost, ag.umatan.payout);
    const w = roi(ag.wide.cost,   ag.wide.payout);
    const sum = u + t + w;
    const cvU = monthlyCV(ag.monthlyROI.umaren, 3);
    const mark = p.id === bestId ? ' ⭐' : '';
    mp(`| ${p.id}${mark} | ${p.label} | ${u.toFixed(1)}% | ${t.toFixed(1)}% | ${w.toFixed(1)}% | **${sum.toFixed(1)}** | ${ag.umaren.participated} | ${cvU.cv.toFixed(3)} |`);
  }
  mp('');

  // 4. 時系列安定性
  mp(`## 4. 時系列安定性評価（馬連本命の月別CV、推奨R≥3月）`);
  mp('');
  mp(`| ID | CV | 月数 | 最良月 | 最悪月 | 最良/最悪差 |`);
  mp(`|---|---|---|---|---|---|`);
  for (const p of PATTERNS) {
    const cvU = monthlyCV(patternResults[p.id].monthlyROI.umaren, 3);
    mp(`| ${p.id} | ${cvU.cv.toFixed(3)} | ${cvU.months} | ${cvU.maxROI.toFixed(1)}% | ${cvU.minROI.toFixed(1)}% | ${(cvU.maxROI-cvU.minROI).toFixed(1)}pt |`);
  }
  mp('');

  // 採用候補の月別ROI詳細 (パターンA + 最良)
  mp(`### パターンA (現状) と 最良パターン${bestId} の月別ROI詳細`);
  mp('');
  const allMonths = Array.from(new Set(records.map((r) => r.month))).sort();
  mp(`| 月 | A:馬連 | A:馬単 | A:ワイド | ${bestId}:馬連 | ${bestId}:馬単 | ${bestId}:ワイド |`);
  mp(`|---|---|---|---|---|---|---|`);
  const fmtMonth = (ag: Agg | undefined): string => {
    if (!ag || ag.participated === 0) return '0R/-';
    return `${ag.participated}R/${roi(ag.cost, ag.payout).toFixed(0)}%`;
  };
  for (const m of allMonths) {
    const a = patternResults.A;
    const b = patternResults[bestId];
    mp(`| ${m} | ${fmtMonth(a.monthlyROI.umaren.get(m))} | ${fmtMonth(a.monthlyROI.umatan.get(m))} | ${fmtMonth(a.monthlyROI.wide.get(m))} | ${fmtMonth(b.monthlyROI.umaren.get(m))} | ${fmtMonth(b.monthlyROI.umatan.get(m))} | ${fmtMonth(b.monthlyROI.wide.get(m))} |`);
  }
  mp('');

  // 5. 最適ルール判定
  mp(`## 5. 最適ルール判定`);
  mp('');
  const best = PATTERNS.find((p) => p.id === bestId)!;
  const bestAgg = patternResults[bestId];
  const bU = roi(bestAgg.umaren.cost, bestAgg.umaren.payout);
  const bT = roi(bestAgg.umatan.cost, bestAgg.umatan.payout);
  const bW = roi(bestAgg.wide.cost,   bestAgg.wide.payout);
  const bSum = bU + bT + bW;
  const aSum = aU + aT + aW;
  const cvA = monthlyCV(patternResults.A.monthlyROI.umaren, 3);
  const cvBest = monthlyCV(bestAgg.monthlyROI.umaren, 3);

  mp(`### 合算ROI最良: パターン${bestId} (${best.label})`);
  mp('');
  mp(`- 馬連本命 ROI: A=${aU.toFixed(1)}% → ${bestId}=${bU.toFixed(1)}% (${(bU-aU>=0?'+':'')}${(bU-aU).toFixed(1)}pt)`);
  mp(`- 馬単本命 ROI: A=${aT.toFixed(1)}% → ${bestId}=${bT.toFixed(1)}% (${(bT-aT>=0?'+':'')}${(bT-aT).toFixed(1)}pt)`);
  mp(`- ワイド堅実 ROI: A=${aW.toFixed(1)}% → ${bestId}=${bW.toFixed(1)}% (${(bW-aW>=0?'+':'')}${(bW-aW).toFixed(1)}pt)`);
  mp(`- 合計pt: A=${aSum.toFixed(1)} → ${bestId}=${bSum.toFixed(1)} (${(bSum-aSum>=0?'+':'')}${(bSum-aSum).toFixed(1)}pt)`);
  mp(`- 馬連月別CV: A=${cvA.cv.toFixed(3)} → ${bestId}=${cvBest.cv.toFixed(3)}`);
  mp(`- 馬連最悪月: A=${cvA.minROI.toFixed(1)}% → ${bestId}=${cvBest.minROI.toFixed(1)}%`);
  mp('');

  // 採用判定
  mp(`### 採用判定 (基準)`);
  mp('');
  const criteria = [
    { name: '合計pt が現行(A)以上', pass: bSum >= aSum },
    { name: '月別CV ≤ 0.5', pass: cvBest.cv <= 0.5 },
    { name: '最悪月ROI ≥ 50%', pass: cvBest.minROI >= 50 },
    { name: '各券種ROI 100%超', pass: bU >= 100 && bT >= 100 && bW >= 100 },
    { name: '参加R(馬連) ≥ 100', pass: bestAgg.umaren.participated >= 100 },
  ];
  for (const c of criteria) mp(`- ${c.pass ? '✅' : '❌'} ${c.name}`);
  mp('');

  const allPass = criteria.every((c) => c.pass);
  const significantGain = (bSum - aSum) >= 20;

  let verdict: 'α' | 'β' | 'γ' | 'δ';
  let verdictText: string;
  if (bestId === 'A' || !significantGain) {
    verdict = 'α';
    verdictText = '**ケースα: 現状維持推奨**。現行ルール(パターンA)がベスト、または有意な改善なし。次フェーズ(Phase 2C: 年齢別スコア分離)へ進むのが合理的。';
  } else if (!allPass) {
    verdict = 'γ';
    verdictText = `**ケースγ: 採用基準に未到達**。最良候補${bestId}の合算ROIはA+${(bSum-aSum).toFixed(1)}ptだが、安定性指標に懸念あり。本番反映は慎重な追加検証後に判断。`;
  } else if ((bSum - aSum) >= 50) {
    verdict = 'γ';
    verdictText = `**ケースγ: 大幅改善候補**。${bestId}で+${(bSum-aSum).toFixed(1)}ptの大幅改善。慎重な追加検証（数週間の運用観察）を経てから本番反映を推奨。`;
  } else {
    verdict = 'β';
    verdictText = `**ケースβ: 微修正で改善**。${bestId}で+${(bSum-aSum).toFixed(1)}ptの改善、採用基準を満たす。本番反映候補。`;
  }
  mp(`### 結論: ケース${verdict}`);
  mp('');
  mp(verdictText);
  mp('');

  // 6. 本番反映案
  mp(`## 6. 本番反映案`);
  mp('');
  if (verdict === 'α') {
    mp(`現状維持のため、\`lib/score/calculator.ts\` の変更不要。`);
    mp('');
    mp(`### 次のアクション`);
    mp(`- Phase 2C: 年齢別スコア分離の検証へ進む`);
    mp(`- 本チューニング結果を知見として記録`);
  } else {
    const rule = best.rule;
    const umarenRe = rule.umaren.length === 0 ? '(none)' : classSetToRegex(rule.umaren);
    const umatanRe = rule.umatan.length === 0 ? '(none)' : classSetToRegex(rule.umatan);
    const wideRe   = rule.wide.length === 0 ? '(none)' : classSetToRegex(rule.wide);
    mp(`### 実装差分 (lib/score/calculator.ts)`);
    mp('');
    mp('```typescript');
    mp('// 変更前 (現行 Phase 2G):');
    mp('function isExcludedForUmarenUmatan(raceClass: string | undefined): boolean {');
    mp('  if (!raceClass) return false;');
    mp('  return /1勝|500万|2勝|1000万/.test(raceClass);');
    mp('}');
    mp('function isExcludedForWide(raceClass: string | undefined): boolean {');
    mp('  if (!raceClass) return false;');
    mp('  return /1勝|500万/.test(raceClass);');
    mp('}');
    mp('');
    mp(`// 変更後 (パターン${bestId}):`);
    mp('function isExcludedForUmaren(raceClass: string | undefined): boolean {');
    mp('  if (!raceClass) return false;');
    mp(`  return ${umarenRe}.test(raceClass);`);
    mp('}');
    mp('function isExcludedForUmatan(raceClass: string | undefined): boolean {');
    mp('  if (!raceClass) return false;');
    mp(`  return ${umatanRe}.test(raceClass);`);
    mp('}');
    mp('function isExcludedForWide(raceClass: string | undefined): boolean {');
    mp('  if (!raceClass) return false;');
    mp(`  return ${wideRe}.test(raceClass);`);
    mp('}');
    mp('```');
    mp('');
    mp(`### 期待改善`);
    mp(`- 合計pt: ${aSum.toFixed(1)} → ${bSum.toFixed(1)} (+${(bSum-aSum).toFixed(1)}pt)`);
    mp(`- 馬連月別CV: ${cvA.cv.toFixed(3)} → ${cvBest.cv.toFixed(3)}`);
  }
  mp('');

  mp(`## 7. 結論`);
  mp('');
  if (verdict === 'α') {
    mp(`Phase 2G ハイブリッドを **現状維持** する。`);
    mp(`3233R 拡張データでも現行ルール(A)を上回る候補が見つからず、除外ルールの追加チューニングは効果薄と判明。`);
    mp(`次は **Phase 2C (年齢別スコア分離)** など別方向の改善へ。`);
  } else {
    mp(`Phase 2G ハイブリッドを **パターン${bestId}** に変更する ${verdict === 'β' ? '(微修正)' : '(大幅変更、慎重検証後)'}。`);
    mp(`期待効果: 合計pt +${(bSum-aSum).toFixed(1)}、安定性 ${cvBest.cv <= cvA.cv ? '改善' : '同等'}。`);
    mp(`リスク: 新ルールはサンプル拡大データでのみ検証、今後の月別動向を継続観察。`);
  }
  mp('');
  mp(`---`);
  mp(`*再実行: \`pnpm tsx scripts/phase2g_retuning_3233r.ts\`*`);

  await fs.writeFile(REPORT, md.join('\n'), 'utf-8');

  console.log('');
  console.log(`ベースライン (パターンA):`);
  console.log(`  馬連=${aU.toFixed(1)}%  馬単=${aT.toFixed(1)}%  ワイド=${aW.toFixed(1)}%  合計=${aSum.toFixed(1)}pt`);
  console.log('');
  console.log(`最良パターン: ${bestId} (${best.label})`);
  console.log(`  馬連=${bU.toFixed(1)}%  馬単=${bT.toFixed(1)}%  ワイド=${bW.toFixed(1)}%  合計=${bSum.toFixed(1)}pt`);
  console.log(`  改善: ${(bSum-aSum>=0?'+':'')}${(bSum-aSum).toFixed(1)}pt`);
  console.log(`  CV(馬連): A=${cvA.cv.toFixed(3)} → ${bestId}=${cvBest.cv.toFixed(3)}`);
  console.log('');
  console.log(`結論: ケース${verdict}`);
  console.log(`Markdown: ${REPORT}`);
}

function classSetToRegex(cs: RaceClass[]): string {
  // 正規表現パターン生成
  const parts: string[] = [];
  if (cs.includes('C1')) parts.push('1勝', '500万');
  if (cs.includes('C2')) parts.push('2勝', '1000万');
  if (cs.includes('C3')) parts.push('3勝', '1600万');
  if (cs.includes('UW')) parts.push('未勝利');
  if (cs.includes('NW')) parts.push('新馬');
  if (cs.includes('SP')) parts.push(/* SP は meta.raceClass では識別困難 */ );
  if (cs.includes('OP')) parts.push('オープン');
  return parts.length === 0 ? '/$^/' : `/${parts.join('|')}/`;
}

main().catch((e) => { console.error(e); process.exit(1); });
