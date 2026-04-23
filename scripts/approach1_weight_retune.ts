// ==========================================
// アプローチ1: 既存重み再最適化
//
// 目的:
//   現行の全年齢共通重み配分 (Phase 2E Stage 3 の 930R 導出値) を
//   3233R + 時系列 CV 3 セットで堅実に再最適化する。
//
// 設計思想 (Phase 2C / アプローチ4 の教訓):
//   - 主要 4 項目のみ動かす (7項目全探索は過学習リスク大)
//   - 粒度 0.05 固定 (0.025 はオーバーフィット助長)
//   - 時系列 CV 3 セット (単一 train/test は時系列バイアスに脆弱)
//   - 平均・最悪・ratio 全てを基準に判定
//
// 主要項目 (4): lastThreeF, courseRecord, prevClass, breeding
// 固定項目 (3): training=0.125, weightChange=0.070, jockey=0.055 (合計 0.250)
// 主要合計 = 1.000 - 0.250 = 0.750 (整数表記 15 を 4 分割 each 1〜9)
//
// 実行: pnpm tsx scripts/approach1_weight_retune.ts
// 出力: scripts/verification/approach1_weight_retune.md
// ==========================================

import { promises as fs } from 'node:fs';
import path from 'node:path';

const DIR = path.resolve(__dirname, 'verification');
const REPORT = path.join(DIR, 'approach1_weight_retune.md');

// ----------------------------------------
// 型
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

const KEYS: (keyof Components)[] = [
  'lastThreeF','training','courseRecord','prevClass','breeding','weightChange','jockey',
];

type Weights = Components;

// 現行 (Phase 2E Stage 3)
const CURRENT: Weights = {
  lastThreeF:   0.244,
  training:     0.125,
  courseRecord: 0.198,
  prevClass:    0.146,
  breeding:     0.158,
  weightChange: 0.071,
  jockey:       0.058,
};

// アプローチ1 の探索設計
// 主要 4 項目 (合計 = MAIN_SUM)
const MAIN_AXES: (keyof Components)[] = ['lastThreeF', 'courseRecord', 'prevClass', 'breeding'];
// 固定 3 項目 (合計 = 1 - MAIN_SUM = 0.25)
const FIXED: Partial<Weights> = {
  training:     0.125,
  weightChange: 0.070,
  jockey:       0.055,
};
const MAIN_SUM = 1.0 - (0.125 + 0.070 + 0.055); // = 0.750

// 粒度 0.05, 各軸 1〜9 (整数で管理: 15 を 4 分割)
const STEP = 0.05;
const MAIN_TOTAL_INT = Math.round(MAIN_SUM / STEP); // = 15
const MIN_INT = 1; // 0.05
const MAX_INT = 9; // 0.45

type Prediction = {
  horseId: number;
  odds: number;
  components: Components;
};

type Payout = { combination: string; payout: number };

type Race = {
  raceId: string;
  raceDate: string; // YYYYMMDD
  month: string;    // YYYY-MM
  raceClass: string | undefined;
  preds: Prediction[];
  umaren: Payout[];
  umatan: Payout[];
  wide: Payout[];
};

// ----------------------------------------
// 計算
// ----------------------------------------

function calcScore(c: Components, w: Weights): number {
  let s = 0;
  for (const k of KEYS) s += c[k] * w[k];
  return Math.max(0, Math.min(100, s));
}

const CF = 0.2, MAXC = 0.2, OFS = -0.02;
function getOW(o: number): number {
  if (o <= 5) return 1.00;
  if (o <= 10) return 0.80;
  if (o <= 20) return 0.50;
  if (o <= 50) return 0.20;
  return 0.05;
}
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

type Scored = { horseId: number; odds: number; score: number; ev: number };
function scoreRace(preds: Prediction[], w: Weights): Scored[] {
  const scores = preds.map((p) => calcScore(p.components, w));
  const avg = scores.reduce((s, v) => s + v, 0) / scores.length;
  return preds.map((p, i) => {
    if (p.odds <= 0) return { horseId: p.horseId, odds: p.odds, score: scores[i], ev: 0 };
    const mkt = 1 / p.odds;
    const dev = avg === 0 ? 0 : (scores[i] - avg) / avg;
    const c = clamp(dev * CF * getOW(p.odds) + OFS, -MAXC, MAXC);
    return { horseId: p.horseId, odds: p.odds, score: scores[i], ev: mkt * (1 + c) * p.odds };
  });
}

function isExUU(rc?: string): boolean { return !!rc && /1勝|500万|2勝|1000万/.test(rc); }
function isExW(rc?: string): boolean  { return !!rc && /1勝|500万/.test(rc); }

const sameSet = (a: number[], b: number[]): boolean =>
  a.length === b.length && [...a].sort((x,y)=>x-y).join(',') === [...b].sort((x,y)=>x-y).join(',');

type Outcome = { cost: number; payout: number };
const Z: Outcome = { cost: 0, payout: 0 };

function umaren(r: Race, sc: Scored[]): Outcome {
  if (isExUU(r.raceClass)) return Z;
  const s = sc.filter((x)=>x.odds>0).sort((a,b)=>b.ev-a.ev);
  const p1 = s[0], p2 = s[1];
  if (!p1 || !p2 || p1.ev < 1.0 || p2.ev < 1.0 || p1.score < 65 || p2.score < 65) return Z;
  for (const u of r.umaren) {
    if (sameSet([p1.horseId, p2.horseId], u.combination.split('-').map(Number))) return { cost: 100, payout: u.payout };
  }
  return { cost: 100, payout: 0 };
}
function umatan(r: Race, sc: Scored[]): Outcome {
  if (isExUU(r.raceClass)) return Z;
  const s = sc.filter((x)=>x.odds>0).sort((a,b)=>b.ev-a.ev);
  const p1 = s[0], p2 = s[1];
  if (!p1 || !p2 || p1.ev < 1.0 || p2.ev < 1.0 || p1.score < 65 || p2.score < 65) return Z;
  if (p1.odds > 15 || p2.odds > 15) return Z;
  let pay = 0;
  for (const perm of [[p1.horseId, p2.horseId], [p2.horseId, p1.horseId]]) {
    for (const u of r.umatan) {
      const c = u.combination.split('-').map(Number);
      if (c.length === 2 && c[0] === perm[0] && c[1] === perm[1]) { pay += u.payout; break; }
    }
  }
  return { cost: 200, payout: pay };
}
function wide(r: Race, sc: Scored[]): Outcome {
  if (isExW(r.raceClass)) return Z;
  const s = sc.filter((x)=>x.odds>0).sort((a,b)=>b.ev-a.ev);
  const p1 = s[0], p2 = s[1];
  if (!p1 || !p2 || p1.ev < 1.02 || p2.ev < 1.02 || p1.score < 65 || p2.score < 65) return Z;
  if (p1.odds > 10 || p2.odds > 10) return Z;
  for (const w of r.wide) {
    if (sameSet([p1.horseId, p2.horseId], w.combination.split('-').map(Number))) return { cost: 100, payout: w.payout };
  }
  return { cost: 100, payout: 0 };
}

type Agg = { cost: number; payout: number };
const eA = (): Agg => ({ cost: 0, payout: 0 });
const R = (a: Agg): number => a.cost > 0 ? (a.payout / a.cost) * 100 : 0;

function evaluateSet(rs: Race[], w: Weights): {
  u: Agg; t: Agg; wd: Agg; totalPt: number; monthly: Map<string, Agg>;
} {
  const U = eA(), T = eA(), W = eA();
  const mo = new Map<string, Agg>();
  for (const r of rs) {
    const sc = scoreRace(r.preds, w);
    const ou = umaren(r, sc), ot = umatan(r, sc), ow = wide(r, sc);
    U.cost += ou.cost; U.payout += ou.payout;
    T.cost += ot.cost; T.payout += ot.payout;
    W.cost += ow.cost; W.payout += ow.payout;
    if (ou.cost > 0) {
      let m = mo.get(r.month); if (!m) { m = eA(); mo.set(r.month, m); }
      m.cost += ou.cost; m.payout += ou.payout;
    }
  }
  return { u: U, t: T, wd: W, totalPt: R(U) + R(T) + R(W), monthly: mo };
}

function monthlyCV(m: Map<string, Agg>): number {
  const arr: number[] = [];
  for (const a of Array.from(m.values())) if (a.cost > 0) arr.push(R(a));
  if (arr.length < 2) return 0;
  const mean = arr.reduce((s,v)=>s+v,0)/arr.length;
  const sd = Math.sqrt(arr.reduce((s,v)=>s+(v-mean)**2,0)/arr.length);
  return mean === 0 ? 0 : sd / mean;
}

// ----------------------------------------
// データロード
// ----------------------------------------

async function loadAll(): Promise<Race[]> {
  const files = (await fs.readdir(DIR)).filter((f) => f.endsWith('.json'));
  const out: Race[] = [];
  for (const f of files) {
    let j: any;
    try { j = JSON.parse(await fs.readFile(path.join(DIR, f), 'utf-8')); } catch { continue; }
    if (!j.predictions || j.predictions.length < 2 || !j.results?.payouts) continue;
    const ok = j.predictions.every((p: any) => p.components);
    if (!ok) continue;
    const preds: Prediction[] = j.predictions.map((p: any) => ({
      horseId: p.horseId, odds: p.odds,
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
    out.push({
      raceId: j.raceId,
      raceDate: String(rd),
      month: `${String(rd).substring(0,4)}-${String(rd).substring(4,6)}`,
      raceClass: j.meta?.raceClass,
      preds,
      umaren: j.results.payouts.umaren ?? [],
      umatan: j.results.payouts.umatan ?? [],
      wide:   j.results.payouts.wide   ?? [],
    });
  }
  return out.sort((a, b) => a.raceDate.localeCompare(b.raceDate));
}

// ----------------------------------------
// CV 切り口定義
// ----------------------------------------

type CV = { id: string; trainMonths: Set<string>; testMonths: Set<string>; label: string };

function buildCVs(): CV[] {
  const mk = (ms: string[]): Set<string> => new Set(ms);
  return [
    {
      id: 'CV1',
      label: '早期 train:2025/05-10 → test:2025/11-12',
      trainMonths: mk(['2025-05','2025-06','2025-07','2025-08','2025-09','2025-10']),
      testMonths:  mk(['2025-11','2025-12']),
    },
    {
      id: 'CV2',
      label: '中期 train:2025/07-12 → test:2026/01-02',
      trainMonths: mk(['2025-07','2025-08','2025-09','2025-10','2025-11','2025-12']),
      testMonths:  mk(['2026-01','2026-02']),
    },
    {
      id: 'CV3',
      label: '後期 train:2025/09-2026/02 → test:2026/03-04',
      trainMonths: mk(['2025-09','2025-10','2025-11','2025-12','2026-01','2026-02']),
      testMonths:  mk(['2026-03','2026-04']),
    },
  ];
}

function splitByCV(all: Race[], cv: CV): { train: Race[]; test: Race[] } {
  return {
    train: all.filter((r) => cv.trainMonths.has(r.month)),
    test:  all.filter((r) => cv.testMonths.has(r.month)),
  };
}

// ----------------------------------------
// 候補重み列挙
// ----------------------------------------

function* enumerateWeights(): Generator<Weights> {
  // MAIN_AXES の4軸を整数で1〜9、合計=MAIN_TOTAL_INT(=15)
  for (let a = MIN_INT; a <= MAX_INT; a++) {
    for (let b = MIN_INT; b <= MAX_INT; b++) {
      for (let c = MIN_INT; c <= MAX_INT; c++) {
        const d = MAIN_TOTAL_INT - a - b - c;
        if (d < MIN_INT || d > MAX_INT) continue;
        const w: Weights = {
          ...(FIXED as Weights),
          lastThreeF:   a * STEP,
          courseRecord: b * STEP,
          prevClass:    c * STEP,
          breeding:     d * STEP,
        };
        yield w;
      }
    }
  }
}

// ----------------------------------------
// メイン
// ----------------------------------------

type CVMetrics = {
  cvId: string;
  trainPt: number;
  testPt: number;
  ratio: number;   // test/train
  testMonthlyCV: number;
};

type CandidateEval = {
  w: Weights;
  perCV: CVMetrics[];
  avgTestPt: number;
  minTestPt: number;
  avgRatio: number;
  maxMonthlyCV: number;
  avgMonthlyCV: number;
  // full 3233R も後で算出
};

function evalCandidate(w: Weights, cvs: CV[], all: Race[]): CandidateEval {
  const perCV: CVMetrics[] = [];
  let sumTest = 0, sumRatio = 0, sumMCV = 0;
  let minTest = Infinity, maxMCV = 0;
  for (const cv of cvs) {
    const { train, test } = splitByCV(all, cv);
    const evTrain = evaluateSet(train, w);
    const evTest  = evaluateSet(test,  w);
    const ratio = evTrain.totalPt === 0 ? 1 : evTest.totalPt / evTrain.totalPt;
    const mcv = monthlyCV(evTest.monthly);
    perCV.push({ cvId: cv.id, trainPt: evTrain.totalPt, testPt: evTest.totalPt, ratio, testMonthlyCV: mcv });
    sumTest += evTest.totalPt;
    sumRatio += ratio;
    sumMCV += mcv;
    if (evTest.totalPt < minTest) minTest = evTest.totalPt;
    if (mcv > maxMCV) maxMCV = mcv;
  }
  return {
    w,
    perCV,
    avgTestPt: sumTest / cvs.length,
    minTestPt: minTest,
    avgRatio: sumRatio / cvs.length,
    maxMonthlyCV: maxMCV,
    avgMonthlyCV: sumMCV / cvs.length,
  };
}

async function main(): Promise<void> {
  console.log('==================================================');
  console.log('  アプローチ1: 既存重み再最適化');
  console.log('==================================================');

  const all = await loadAll();
  console.log(`データ: ${all.length} R`);

  const cvs = buildCVs();
  for (const cv of cvs) {
    const s = splitByCV(all, cv);
    console.log(`  ${cv.id}: ${cv.label} → train ${s.train.length}R / test ${s.test.length}R`);
  }

  // 候補列挙
  const candidates = Array.from(enumerateWeights());
  console.log(`\n候補数: ${candidates.length} (MAIN 4軸 × 0.05刻み, 合計=${MAIN_SUM})`);

  // ベースライン評価
  const baseEval = evalCandidate(CURRENT, cvs, all);
  const baseFull = evaluateSet(all, CURRENT);
  console.log(`\n[ベースライン (現行)]`);
  for (const m of baseEval.perCV) {
    console.log(`  ${m.cvId}: train=${m.trainPt.toFixed(1)} test=${m.testPt.toFixed(1)} ratio=${(m.ratio*100).toFixed(0)}% mCV=${m.testMonthlyCV.toFixed(3)}`);
  }
  console.log(`  平均test=${baseEval.avgTestPt.toFixed(1)} 最悪test=${baseEval.minTestPt.toFixed(1)} 平均ratio=${(baseEval.avgRatio*100).toFixed(0)}% 全3233R合計pt=${baseFull.totalPt.toFixed(1)}`);

  // グリッドサーチ
  console.log(`\nグリッドサーチ実行中...`);
  const results: CandidateEval[] = [];
  let i = 0;
  for (const w of candidates) {
    results.push(evalCandidate(w, cvs, all));
    i++;
    if (i % 50 === 0) console.log(`  ${i}/${candidates.length}`);
  }

  // 平均test pt 降順でソート
  results.sort((a, b) => b.avgTestPt - a.avgTestPt);

  // 採用候補フィルタ: avg test ≥ baseline + 10, min test ≥ baseline (それぞれのCVで), avgRatio ≥ 0.80, maxMCV ≤ 1.0
  const baseTestPerCV = baseEval.perCV.map((m) => m.testPt);
  const eligible = results.filter((r) => {
    // min test はCVごとにベースラインと比較
    if (r.avgTestPt < baseEval.avgTestPt + 10) return false;
    for (let j = 0; j < r.perCV.length; j++) {
      if (r.perCV[j].testPt < baseTestPerCV[j]) return false; // 最悪 CV で下回らない
    }
    if (r.avgRatio < 0.80) return false;
    if (r.maxMonthlyCV > 1.0) return false;
    return true;
  });

  console.log(`\n採用候補 (全基準満たす): ${eligible.length} 件`);
  const best = eligible[0] ?? null;

  // 全データでの統合バックテスト (採用候補 or 最良候補)
  const pickForShow = best ?? results[0];
  const fullNew = evaluateSet(all, pickForShow.w);

  // ---- Markdown レポート ----
  const md: string[] = [];
  const mp = (s = ''): void => { md.push(s); };

  mp(`# アプローチ1: 既存重み再最適化 実装報告`);
  mp('');
  mp(`- 生成日時: ${new Date().toISOString()}`);
  mp(`- 対象: **${all.length} R** (2025-05 〜 2026-04)`);
  mp('');

  mp(`## 1. 現行重み配分の確定`);
  mp('');
  mp(`| 項目 | 現行重み |`);
  mp(`|---|---|`);
  for (const k of KEYS) mp(`| ${k} | ${CURRENT[k].toFixed(3)} |`);
  mp(`| **合計** | **${Object.values(CURRENT).reduce((s,v)=>s+v,0).toFixed(3)}** |`);
  mp('');
  mp(`Phase 2E Stage 3 (930R × ランダムサンプリング500) の最適解。本タスクで 3233R + 時系列CV で再検証。`);
  mp('');

  mp(`## 2. 主要項目の選定`);
  mp('');
  mp(`**探索対象 (4項目)**: lastThreeF, courseRecord, prevClass, breeding`);
  mp(`**固定項目 (3項目)**: training=0.125, weightChange=0.070, jockey=0.055 (合計 0.250)`);
  mp('');
  mp(`選定理由:`);
  mp(`- **lastThreeF (現行 0.244)**: 最大重み、前走上がり3F は予測核心`);
  mp(`- **courseRecord (現行 0.198)**: 第2位、コース適性は真の予測シグナル (※ Phase 1-C 時点で 50 固定プレースホルダだが、重み変更で他項目に配分再分配)`);
  mp(`- **breeding (現行 0.158)**: 第3位、血統×距離帯の信号`);
  mp(`- **prevClass (現行 0.146)**: 第4位、前走クラス通用力`);
  mp('');
  mp(`training は lastThreeF と同一値 (兼用) のため固定。weightChange/jockey は重み小 (<0.08) で、動かしても影響軽微。`);
  mp('');

  mp(`## 3. グリッドサーチ設計`);
  mp('');
  mp(`- 探索範囲: 各主要軸 **0.05〜0.45** (0.05刻み 9段階)`);
  mp(`- 制約: 主要4軸の合計 = **${MAIN_SUM}** (固定軸合計 0.250 + 主要 0.750 = 1.000)`);
  mp(`- 組み合わせ総数: **${candidates.length}** 通り (9⁴=6561 のうち合計制約を満たすもの)`);
  mp('');

  mp(`## 4. 時系列クロスバリデーション設計`);
  mp('');
  mp(`単一 train/test は時系列バイアスに脆弱 (アプローチ4 で 2025年後半と2026年初頭の ROI 乖離が判明) のため、**3切り口で検証**。`);
  mp('');
  mp(`| CV | train 期間 | test 期間 | train R数 | test R数 |`);
  mp(`|---|---|---|---|---|`);
  for (const cv of cvs) {
    const s = splitByCV(all, cv);
    mp(`| ${cv.id} | ${cv.label.split('→')[0].trim().replace('train:','')} | ${cv.label.split('→')[1].trim().replace('test:','')} | ${s.train.length} | ${s.test.length} |`);
  }
  mp('');

  mp(`## 5. グリッドサーチ結果 (平均test pt 降順 上位15)`);
  mp('');
  mp(`| 順位 | lastThreeF | courseRecord | prevClass | breeding | CV1 test | CV2 test | CV3 test | 平均test | 最悪test | 平均ratio | maxMCV |`);
  mp(`|---|---|---|---|---|---|---|---|---|---|---|---|`);
  // ベースライン行
  mp(`| (現行) | ${CURRENT.lastThreeF.toFixed(2)} | ${CURRENT.courseRecord.toFixed(2)} | ${CURRENT.prevClass.toFixed(2)} | ${CURRENT.breeding.toFixed(2)} | ${baseEval.perCV[0].testPt.toFixed(1)} | ${baseEval.perCV[1].testPt.toFixed(1)} | ${baseEval.perCV[2].testPt.toFixed(1)} | **${baseEval.avgTestPt.toFixed(1)}** | ${baseEval.minTestPt.toFixed(1)} | ${(baseEval.avgRatio*100).toFixed(0)}% | ${baseEval.maxMonthlyCV.toFixed(3)} |`);
  for (let k = 0; k < Math.min(15, results.length); k++) {
    const r = results[k];
    mp(`| ${k+1} | ${r.w.lastThreeF.toFixed(2)} | ${r.w.courseRecord.toFixed(2)} | ${r.w.prevClass.toFixed(2)} | ${r.w.breeding.toFixed(2)} | ${r.perCV[0].testPt.toFixed(1)} | ${r.perCV[1].testPt.toFixed(1)} | ${r.perCV[2].testPt.toFixed(1)} | **${r.avgTestPt.toFixed(1)}** | ${r.minTestPt.toFixed(1)} | ${(r.avgRatio*100).toFixed(0)}% | ${r.maxMonthlyCV.toFixed(3)} |`);
  }
  mp('');

  mp(`## 6. 時系列安定性評価 (採用候補 or 最良パターン)`);
  mp('');
  const show = best ?? results[0];
  mp(`**対象重み**: lastThreeF=${show.w.lastThreeF.toFixed(3)}, courseRecord=${show.w.courseRecord.toFixed(3)}, prevClass=${show.w.prevClass.toFixed(3)}, breeding=${show.w.breeding.toFixed(3)}`);
  mp('');
  mp(`| CV | train 合計pt | test 合計pt | test/train | test 月別CV |`);
  mp(`|---|---|---|---|---|`);
  for (const m of show.perCV) {
    mp(`| ${m.cvId} | ${m.trainPt.toFixed(1)} | ${m.testPt.toFixed(1)} | ${(m.ratio*100).toFixed(0)}% | ${m.testMonthlyCV.toFixed(3)} |`);
  }
  mp(`| **平均** | - | **${show.avgTestPt.toFixed(1)}** | **${(show.avgRatio*100).toFixed(0)}%** | - |`);
  mp('');
  mp(`(比較) ベースライン平均test: **${baseEval.avgTestPt.toFixed(1)}pt** / 最悪test: **${baseEval.minTestPt.toFixed(1)}pt**`);
  mp('');

  mp(`## 7. 採用判定`);
  mp('');
  mp(`### 採用基準チェック`);
  const gain = show.avgTestPt - baseEval.avgTestPt;
  mp(`- ${gain >= 10 ? '✅' : '❌'} 平均 test ROI +10pt 以上 (差分 ${gain >= 0 ? '+' : ''}${gain.toFixed(1)}pt)`);
  const allMinOK = show.perCV.every((m, j) => m.testPt >= baseEval.perCV[j].testPt);
  mp(`- ${allMinOK ? '✅' : '❌'} 各CVで test ROI ≥ ベースライン`);
  mp(`- ${show.avgRatio >= 0.80 ? '✅' : '❌'} 平均 test/train ≥ 80% (${(show.avgRatio*100).toFixed(0)}%)`);
  mp(`- ${show.maxMonthlyCV <= 1.0 ? '✅' : '❌'} 最大月別CV ≤ 1.0 (${show.maxMonthlyCV.toFixed(3)})`);
  mp('');

  let verdict: 'α' | 'β' | 'γ';
  if (best && gain >= 30) verdict = 'α';
  else if (best && gain >= 10) verdict = 'β';
  else verdict = 'γ';
  mp(`### 結論: ケース${verdict}`);
  mp('');
  if (verdict === 'α') mp(`**大幅改善 (+${gain.toFixed(1)}pt)**。本番実装を推奨 (別タスク)。`);
  else if (verdict === 'β') mp(`**微改善 (+${gain.toFixed(1)}pt)**。採用基準を満たす、本番実装候補 (別タスク)。`);
  else mp(`**採用基準未達**。現行重みが既に堅牢、見送り。`);
  mp('');

  mp(`## 8. 統合バックテスト (全3233R)`);
  mp('');
  mp(`| 指標 | 現行 | アプローチ1候補 | 差分 |`);
  mp(`|---|---|---|---|`);
  mp(`| 馬連本命 ROI | ${R(baseFull.u).toFixed(1)}% | ${R(fullNew.u).toFixed(1)}% | ${((R(fullNew.u)-R(baseFull.u))>=0?'+':'')}${(R(fullNew.u)-R(baseFull.u)).toFixed(1)}pt |`);
  mp(`| 馬単本命 ROI | ${R(baseFull.t).toFixed(1)}% | ${R(fullNew.t).toFixed(1)}% | ${((R(fullNew.t)-R(baseFull.t))>=0?'+':'')}${(R(fullNew.t)-R(baseFull.t)).toFixed(1)}pt |`);
  mp(`| ワイド堅実 ROI | ${R(baseFull.wd).toFixed(1)}% | ${R(fullNew.wd).toFixed(1)}% | ${((R(fullNew.wd)-R(baseFull.wd))>=0?'+':'')}${(R(fullNew.wd)-R(baseFull.wd)).toFixed(1)}pt |`);
  mp(`| **合計pt** | **${baseFull.totalPt.toFixed(1)}** | **${fullNew.totalPt.toFixed(1)}** | **${((fullNew.totalPt-baseFull.totalPt)>=0?'+':'')}${(fullNew.totalPt-baseFull.totalPt).toFixed(1)}pt** |`);
  mp(`| 月別CV(馬連) | ${monthlyCV(baseFull.monthly).toFixed(3)} | ${monthlyCV(fullNew.monthly).toFixed(3)} | - |`);
  mp('');

  // 9. 本番反映案
  if (verdict !== 'γ') {
    mp(`## 9. 本番反映案`);
    mp('');
    mp('```typescript');
    mp('// lib/score/calculator.ts');
    mp('');
    mp('const WEIGHTS = {');
    for (const k of KEYS) {
      const changed = show.w[k] !== CURRENT[k];
      const annot = changed ? `  // 変更: ${CURRENT[k].toFixed(3)} → ${show.w[k].toFixed(3)}` : `  // 固定`;
      mp(`  ${k.padEnd(13)}: ${show.w[k].toFixed(3)},${annot}`);
    }
    mp('} as const;');
    mp('```');
    mp('');
    mp(`### テストケース`);
    mp(`- 同じ馬で現行重み / 新重み で score 値を比較`);
    mp(`- 合計が 1.000 (浮動小数誤差許容) になっているか検証`);
  } else {
    mp(`## 9. 次のアクション`);
    mp('');
    mp(`- 現行重みが既に堅牢と確認 → **UI 改修** へ進む`);
    mp(`- 週次スクレイプで 4000R 以上に達したら再評価の価値あり`);
  }
  mp('');
  mp(`---`);
  mp(`*再実行: \`pnpm tsx scripts/approach1_weight_retune.ts\`*`);

  await fs.writeFile(REPORT, md.join('\n'), 'utf-8');

  console.log('');
  console.log('==================================================');
  console.log(`  採用判定: ケース${verdict}`);
  console.log(`  ベースライン平均test: ${baseEval.avgTestPt.toFixed(1)}`);
  console.log(`  最良候補 平均test: ${show.avgTestPt.toFixed(1)} (${gain>=0?'+':''}${gain.toFixed(1)}pt)`);
  console.log(`  重み: ${KEYS.map((k) => `${k}=${show.w[k].toFixed(3)}`).join(' ')}`);
  console.log(`  Markdown: ${REPORT}`);
  console.log('==================================================');
}

main().catch((e) => { console.error(e); process.exit(1); });
