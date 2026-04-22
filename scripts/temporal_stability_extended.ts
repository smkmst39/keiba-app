// ==========================================
// 拡張データでの時系列再検証 (Phase 3)
//
// 2025/05〜2026/04 の拡張データ (2500R想定) で以下を再集計:
//   1. Phase 2G 馬連本命 の月別 ROI
//   2. 2-A (右×ダ×ダ良) の月別 ROI + 安定性指標
//   3. 3-B (2-A + 性別制限なし) の月別 ROI + 安定性指標
//   4. v2 強化候補 Top5 の月別安定性
//   5. 930R 版 vs 拡張版 の比較
//
// 実行: pnpm tsx scripts/temporal_stability_extended.ts
// 出力: scripts/verification/temporal_stability_extended.md
// ==========================================

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { VerificationData } from '../lib/scraper/types';

const DIR = path.resolve(__dirname, 'verification');
const REPORT = path.join(DIR, 'temporal_stability_extended.md');

// Phase 2G ロジック
function isExcludedForUmarenUmatan(rc?: string): boolean {
  if (!rc) return false;
  return /1勝|500万|2勝|1000万/.test(rc);
}
function isExcludedForWide(rc?: string): boolean {
  if (!rc) return false;
  return /1勝|500万/.test(rc);
}

type Prediction = VerificationData['predictions'][number];
function sortedByEV(preds: Prediction[]): Prediction[] {
  return [...preds].filter((p) => p.odds > 0).sort((a, b) => b.ev - a.ev);
}
const sameSet = (a: number[], b: number[]): boolean =>
  a.length === b.length && [...a].sort((x, y) => x - y).join(',') === [...b].sort((x, y) => x - y).join(',');

type RecResult = { recommended: boolean; payout: number; hit: boolean };

function recUmarenHonmei(vd: VerificationData, rc?: string): RecResult {
  if (isExcludedForUmarenUmatan(rc)) return { recommended: false, payout: 0, hit: false };
  const s = sortedByEV(vd.predictions);
  if (s.length < 2) return { recommended: false, payout: 0, hit: false };
  if (s[0].ev < 1.00 || s[1].ev < 1.00 || s[0].score < 65 || s[1].score < 65) {
    return { recommended: false, payout: 0, hit: false };
  }
  for (const u of vd.results.payouts.umaren) {
    if (sameSet([s[0].horseId, s[1].horseId], u.combination.split('-').map(Number))) {
      return { recommended: true, payout: u.payout, hit: true };
    }
  }
  return { recommended: true, payout: 0, hit: false };
}

const RIGHT_TURN_CODES = new Set(['01', '02', '03', '06', '08', '09', '10']);
const isRightTurn = (raceId: string): boolean => RIGHT_TURN_CODES.has(raceId.slice(4, 6));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getMeta(vd: any): any { return vd?.meta ?? {}; }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function is2A(vd: VerificationData, m: any): boolean {
  return isRightTurn(vd.raceId) && m.surface === 'dirt' && m.trackCondition === '良';
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function is3B(vd: VerificationData, m: any): boolean {
  return is2A(vd, m) && m.sexLimit !== '牝';
}

type Stats = { recommendedR: number; hits: number; cost: number; payout: number };
const empty = (): Stats => ({ recommendedR: 0, hits: 0, cost: 0, payout: 0 });
const roi = (s: Stats): number => s.cost > 0 ? (s.payout / s.cost) * 100 : 0;
function accum(s: Stats, r: RecResult): void {
  s.recommendedR++; s.cost += 100; s.payout += r.payout;
  if (r.hit) s.hits++;
}
function stdDev(arr: number[]): number {
  if (arr.length === 0) return 0;
  const mean = arr.reduce((s, x) => s + x, 0) / arr.length;
  return Math.sqrt(arr.reduce((s, x) => s + (x - mean) ** 2, 0) / arr.length);
}
function cv(arr: number[]): number {
  if (arr.length === 0) return 0;
  const mean = arr.reduce((s, x) => s + x, 0) / arr.length;
  return mean === 0 ? 0 : stdDev(arr) / mean;
}

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

  // 月別集計
  const monthAll = new Map<string, Stats>();
  const month2A  = new Map<string, Stats>();
  const month3B  = new Map<string, Stats>();

  const put = (map: Map<string, Stats>, key: string, r: RecResult): void => {
    let s = map.get(key);
    if (!s) { s = empty(); map.set(key, s); }
    accum(s, r);
  };

  for (const vd of all) {
    if (vd.predictions.length < 2 || vd.results.results.length === 0) continue;
    const m = getMeta(vd);
    const r = recUmarenHonmei(vd, m.raceClass);
    if (!r.recommended) continue;
    const mth = vd.date.slice(0, 7);
    put(monthAll, mth, r);
    if (is2A(vd, m)) put(month2A, mth, r);
    if (is3B(vd, m)) put(month3B, mth, r);
  }

  const allMonthsSet = new Set<string>();
  for (const k of Array.from(monthAll.keys())) allMonthsSet.add(k);
  for (const k of Array.from(month2A.keys()))  allMonthsSet.add(k);
  for (const k of Array.from(month3B.keys()))  allMonthsSet.add(k);
  const allMonths = Array.from(allMonthsSet).sort();

  // 930R 期間 (2025-12 〜 2026-04) と拡張分 (2025-05〜2025-11) で分割
  const oldPeriod = allMonths.filter((m) => m >= '2025-12');
  const newPeriod = allMonths.filter((m) => m < '2025-12');

  // 合計
  const agg = (map: Map<string, Stats>, months: string[]): Stats => {
    const t = empty();
    for (const m of months) {
      const s = map.get(m);
      if (s) { t.recommendedR += s.recommendedR; t.hits += s.hits; t.cost += s.cost; t.payout += s.payout; }
    }
    return t;
  };

  const totalAll_old = agg(monthAll, oldPeriod);
  const totalAll_new = agg(monthAll, newPeriod);
  const total2A_old = agg(month2A, oldPeriod);
  const total2A_new = agg(month2A, newPeriod);
  const total3B_old = agg(month3B, oldPeriod);
  const total3B_new = agg(month3B, newPeriod);
  const totalAll = agg(monthAll, allMonths);
  const total2A  = agg(month2A,  allMonths);
  const total3B  = agg(month3B,  allMonths);

  function stability(map: Map<string, Stats>, months: string[]): { cv: number; min: number; max: number; diff: number; zeros: number } {
    const rois = months.map((m) => {
      const s = map.get(m) ?? empty();
      return s.recommendedR >= 5 ? roi(s) : -1; // -1 = サンプル不足
    }).filter((x) => x >= 0);
    if (rois.length === 0) return { cv: 0, min: 0, max: 0, diff: 0, zeros: 0 };
    const mx = Math.max(...rois);
    const mn = Math.min(...rois);
    const zeros = months.filter((m) => {
      const s = map.get(m) ?? empty();
      return s.recommendedR === 0;
    }).length;
    return { cv: cv(rois), min: mn, max: mx, diff: mx - mn, zeros };
  }

  const stabAll = stability(monthAll, allMonths);
  const stab2A  = stability(month2A,  allMonths);
  const stab3B  = stability(month3B,  allMonths);

  // ---- Markdown ----
  const md: string[] = [];
  const mp = (s = ''): void => { md.push(s); };

  mp(`# 拡張データ 時系列再検証レポート`);
  mp('');
  mp(`- 生成日時: ${new Date().toISOString()}`);
  mp(`- 対象: **${all.length} R** (${allMonths[0]} 〜 ${allMonths[allMonths.length - 1]})`);
  mp(`- 拡張前 930R (${oldPeriod[0]} 〜 ${oldPeriod[oldPeriod.length - 1]})`);
  mp(`- 今回追加 ${newPeriod.length} ヶ月分 (${newPeriod[0]} 〜 ${newPeriod[newPeriod.length - 1]})`);
  mp('');

  // 1. Phase 2G 馬連本命 全体 月別
  mp(`## 1. Phase 2G 馬連本命 (全体) 月別 ROI`);
  mp('');
  mp(`| 月 | 推奨R | 的中R | ROI |`);
  mp(`|---|---|---|---|`);
  for (const mth of allMonths) {
    const s = monthAll.get(mth) ?? empty();
    mp(`| ${mth} | ${s.recommendedR} | ${s.hits} | ${roi(s).toFixed(1)}% |`);
  }
  mp(`| **合計** | **${totalAll.recommendedR}** | **${totalAll.hits}** | **${roi(totalAll).toFixed(1)}%** |`);
  mp('');

  // 2. 2-A 月別
  mp(`## 2. 2-A (右×ダ×ダ良) 月別 ROI`);
  mp('');
  mp(`| 月 | 推奨R | 的中R | ROI |`);
  mp(`|---|---|---|---|`);
  for (const mth of allMonths) {
    const s = month2A.get(mth) ?? empty();
    mp(`| ${mth} | ${s.recommendedR} | ${s.hits} | ${roi(s).toFixed(1)}% |`);
  }
  mp(`| **合計** | **${total2A.recommendedR}** | **${total2A.hits}** | **${roi(total2A).toFixed(1)}%** |`);
  mp('');

  // 3. 3-B 月別
  mp(`## 3. 3-B (2-A + 性別制限なし) 月別 ROI`);
  mp('');
  mp(`| 月 | 推奨R | 的中R | ROI |`);
  mp(`|---|---|---|---|`);
  for (const mth of allMonths) {
    const s = month3B.get(mth) ?? empty();
    mp(`| ${mth} | ${s.recommendedR} | ${s.hits} | ${roi(s).toFixed(1)}% |`);
  }
  mp(`| **合計** | **${total3B.recommendedR}** | **${total3B.hits}** | **${roi(total3B).toFixed(1)}%** |`);
  mp('');

  // 4. 930R 版 vs 拡張版 の比較
  mp(`## 4. 930R 版 vs 拡張版 の比較`);
  mp('');
  mp(`| 指標 | 930R版 (${oldPeriod[0]}〜) | 拡張版 (${allMonths[0]}〜) | 差分 |`);
  mp(`|---|---|---|---|`);
  mp(`| 全体 馬連本命 推奨R | ${totalAll_old.recommendedR} | ${totalAll.recommendedR} | +${totalAll.recommendedR - totalAll_old.recommendedR} |`);
  mp(`| 全体 馬連本命 ROI | ${roi(totalAll_old).toFixed(1)}% | ${roi(totalAll).toFixed(1)}% | ${(roi(totalAll) - roi(totalAll_old) >= 0 ? '+' : '') + (roi(totalAll) - roi(totalAll_old)).toFixed(1)}pt |`);
  mp(`| 2-A 推奨R | ${total2A_old.recommendedR} | ${total2A.recommendedR} | +${total2A.recommendedR - total2A_old.recommendedR} |`);
  mp(`| 2-A ROI | ${roi(total2A_old).toFixed(1)}% | ${roi(total2A).toFixed(1)}% | ${(roi(total2A) - roi(total2A_old) >= 0 ? '+' : '') + (roi(total2A) - roi(total2A_old)).toFixed(1)}pt |`);
  mp(`| 3-B 推奨R | ${total3B_old.recommendedR} | ${total3B.recommendedR} | +${total3B.recommendedR - total3B_old.recommendedR} |`);
  mp(`| 3-B ROI | ${roi(total3B_old).toFixed(1)}% | ${roi(total3B).toFixed(1)}% | ${(roi(total3B) - roi(total3B_old) >= 0 ? '+' : '') + (roi(total3B) - roi(total3B_old)).toFixed(1)}pt |`);
  mp('');

  // 5. 安定性指標
  mp(`## 5. 安定性指標 (拡張版)`);
  mp('');
  mp(`| 指標 | 全体 | 2-A | 3-B |`);
  mp(`|---|---|---|---|`);
  mp(`| 月別 ROI 変動係数 (CV) | ${stabAll.cv.toFixed(3)} | ${stab2A.cv.toFixed(3)} | ${stab3B.cv.toFixed(3)} |`);
  mp(`| 月別 ROI 最大値 | ${stabAll.max.toFixed(1)}% | ${stab2A.max.toFixed(1)}% | ${stab3B.max.toFixed(1)}% |`);
  mp(`| 月別 ROI 最小値 | ${stabAll.min.toFixed(1)}% | ${stab2A.min.toFixed(1)}% | ${stab3B.min.toFixed(1)}% |`);
  mp(`| 最良 / 最悪 差 | ${stabAll.diff.toFixed(1)}pt | ${stab2A.diff.toFixed(1)}pt | ${stab3B.diff.toFixed(1)}pt |`);
  mp(`| 推奨R = 0 月数 | ${stabAll.zeros} | ${stab2A.zeros} | ${stab3B.zeros} |`);
  mp('');

  // 930R版との比較
  mp(`### 930R 版 vs 拡張版 安定性比較`);
  mp('');
  mp(`| パターン | 930R CV | 拡張CV | 変化 | 930R ROI差 | 拡張 ROI差 | 変化 |`);
  mp(`|---|---|---|---|---|---|---|`);
  const stab2A_old = stability(month2A, oldPeriod);
  const stab3B_old = stability(month3B, oldPeriod);
  mp(`| 2-A | ${stab2A_old.cv.toFixed(3)} | ${stab2A.cv.toFixed(3)} | ${(stab2A.cv - stab2A_old.cv >= 0 ? '+' : '') + (stab2A.cv - stab2A_old.cv).toFixed(3)} | ${stab2A_old.diff.toFixed(0)}pt | ${stab2A.diff.toFixed(0)}pt | ${(stab2A.diff - stab2A_old.diff >= 0 ? '+' : '') + (stab2A.diff - stab2A_old.diff).toFixed(0)}pt |`);
  mp(`| 3-B | ${stab3B_old.cv.toFixed(3)} | ${stab3B.cv.toFixed(3)} | ${(stab3B.cv - stab3B_old.cv >= 0 ? '+' : '') + (stab3B.cv - stab3B_old.cv).toFixed(3)} | ${stab3B_old.diff.toFixed(0)}pt | ${stab3B.diff.toFixed(0)}pt | ${(stab3B.diff - stab3B_old.diff >= 0 ? '+' : '') + (stab3B.diff - stab3B_old.diff).toFixed(0)}pt |`);
  mp('');

  // 結論
  mp(`## 6. 結論`);
  mp('');
  const improved2A = stab2A.cv < stab2A_old.cv * 0.7 && stab2A.diff < stab2A_old.diff * 0.7;
  const improved3B = stab3B.cv < stab3B_old.cv * 0.7 && stab3B.diff < stab3B_old.diff * 0.7;
  const stable = (stab2A.cv <= 0.4 && stab2A.diff <= 400) || (stab3B.cv <= 0.4 && stab3B.diff <= 400);

  if (improved2A || improved3B || stable) {
    mp(`**ケースA: ✅ 時系列変動が縮小、複合シグナルが安定**`);
    mp('');
    mp(`サンプル拡大により 2-A / 3-B の月別変動が有意に縮小。馬連特化型の本番実装を再検討推奨:`);
    mp(`- shouldRecommendUmarenStrong の実装`);
    mp(`- UI "🚀超本命級" バッジ`);
    mp(`- 2-A マッチ時の加重投資ロジック`);
  } else if (stab2A.cv > 0.6 || stab3B.cv > 0.7) {
    mp(`**ケースB: ⚠️ 時系列変動が変わらず、2極化継続**`);
    mp('');
    mp(`サンプル拡大後も月別 ROI の変動が大きい。複合シグナル戦略は断念し、以下の方向へ:`);
    mp(`- Phase 2G ハイブリッド継続で本番戦略確定`);
    mp(`- Phase 2C (年齢別スコア分離) 等の別改善方向へ進む`);
  } else {
    mp(`**ケースC: 新たな状況変化あり**`);
    mp('');
    mp(`2-A / 3-B 以外の強化候補 (v2 の他の軸) について、拡張データで安定性を再評価する価値あり。`);
  }
  mp('');

  mp(`---`);
  mp(`*再実行: \`pnpm tsx scripts/temporal_stability_extended.ts\`*`);

  await fs.writeFile(REPORT, md.join('\n'), 'utf-8');

  // コンソール
  console.log('='.repeat(84));
  console.log('  拡張データ 時系列再検証');
  console.log('='.repeat(84));
  console.log(`対象: ${all.length} R (${allMonths[0]} 〜 ${allMonths[allMonths.length - 1]})`);
  console.log('');
  console.log(`全体 馬連本命: 推奨${totalAll.recommendedR}R / ROI ${roi(totalAll).toFixed(1)}% (930R版 ${roi(totalAll_old).toFixed(1)}%)`);
  console.log(`2-A (右×ダ×ダ良): 推奨${total2A.recommendedR}R / ROI ${roi(total2A).toFixed(1)}%`);
  console.log(`  CV ${stab2A.cv.toFixed(3)} (930R版 ${stab2A_old.cv.toFixed(3)}) / ROI差 ${stab2A.diff.toFixed(0)}pt (930R版 ${stab2A_old.diff.toFixed(0)}pt)`);
  console.log(`3-B (2-A + 性別制限なし): 推奨${total3B.recommendedR}R / ROI ${roi(total3B).toFixed(1)}%`);
  console.log(`  CV ${stab3B.cv.toFixed(3)} (930R版 ${stab3B_old.cv.toFixed(3)}) / ROI差 ${stab3B.diff.toFixed(0)}pt (930R版 ${stab3B_old.diff.toFixed(0)}pt)`);
  console.log('');
  console.log(`Markdown: ${REPORT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
