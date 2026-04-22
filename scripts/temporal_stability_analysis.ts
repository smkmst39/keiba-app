// ==========================================
// 複合シグナル 時期依存性 最終確認
//
// 馬連本命 2-A (右×ダ×ダ良) と 3-B (2-A+性別制限なし) の月別 ROI を集計し、
// 時期集中型/均等分布型/2極化型などの偏りパターンを判定する。
//
// 実行: pnpm tsx scripts/temporal_stability_analysis.ts
// 出力: scripts/verification/temporal_stability_report.md
// ==========================================

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { VerificationData } from '../lib/scraper/types';

const DIR = path.resolve(__dirname, 'verification');
const REPORT = path.join(DIR, 'temporal_stability_report.md');

// ----------------------------------------
// Phase 2G ロジック
// ----------------------------------------

function isExcludedForUmarenUmatan(rc?: string): boolean {
  if (!rc) return false;
  return /1勝|500万|2勝|1000万/.test(rc);
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

// 条件
const RIGHT_TURN_CODES = new Set(['01', '02', '03', '06', '08', '09', '10']);
const isRightTurn = (raceId: string): boolean => RIGHT_TURN_CODES.has(raceId.slice(4, 6));
const COURSE_MAP: Record<string, string> = {
  '01': '札幌', '02': '函館', '03': '福島', '04': '新潟',
  '05': '東京', '06': '中山', '07': '中京', '08': '京都',
  '09': '阪神', '10': '小倉',
};
const courseOf = (raceId: string): string => COURSE_MAP[raceId.slice(4, 6)] ?? '不明';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getMeta(vd: any): any { return vd?.meta ?? {}; }

// ----------------------------------------
// 集計
// ----------------------------------------

type Stats = { recommendedR: number; hits: number; cost: number; payout: number };
const empty = (): Stats => ({ recommendedR: 0, hits: 0, cost: 0, payout: 0 });
const roi = (s: Stats): number => s.cost > 0 ? (s.payout / s.cost) * 100 : 0;
function accum(s: Stats, r: RecResult): void {
  s.recommendedR++;
  s.cost += 100;
  s.payout += r.payout;
  if (r.hit) s.hits++;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function matchesPattern2A(vd: VerificationData, m: any): boolean {
  return isRightTurn(vd.raceId) && m.surface === 'dirt' && m.trackCondition === '良';
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function matchesPattern3B(vd: VerificationData, m: any): boolean {
  return matchesPattern2A(vd, m) && m.sexLimit !== '牝';
}

// ----------------------------------------
// 統計ヘルパ
// ----------------------------------------

function stdDev(arr: number[]): number {
  if (arr.length === 0) return 0;
  const mean = arr.reduce((s, x) => s + x, 0) / arr.length;
  const v = arr.reduce((s, x) => s + (x - mean) ** 2, 0) / arr.length;
  return Math.sqrt(v);
}
function cv(arr: number[]): number {
  if (arr.length === 0) return 0;
  const mean = arr.reduce((s, x) => s + x, 0) / arr.length;
  if (mean === 0) return 0;
  return stdDev(arr) / mean;
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

  // 月別集計: パターン毎に Map<YYYY-MM, Stats>
  const monthOverall = new Map<string, Stats>();
  const month2A      = new Map<string, Stats>();
  const month3B      = new Map<string, Stats>();

  // 月 × 競馬場 の 2-A 分布
  const monthCourse2A = new Map<string, Map<string, Stats>>(); // YYYY-MM -> 競馬場 -> Stats

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

    const month = vd.date.slice(0, 7); // YYYY-MM
    put(monthOverall, month, r);

    if (matchesPattern2A(vd, m)) {
      put(month2A, month, r);

      // 月×場
      const c = courseOf(vd.raceId);
      if (!monthCourse2A.has(month)) monthCourse2A.set(month, new Map());
      const mc = monthCourse2A.get(month)!;
      let cs = mc.get(c);
      if (!cs) { cs = empty(); mc.set(c, cs); }
      accum(cs, r);
    }
    if (matchesPattern3B(vd, m)) {
      put(month3B, month, r);
    }
  }

  // 月 (sorted)
  const allMonths = Array.from(new Set([
    ...Array.from(monthOverall.keys()),
    ...Array.from(month2A.keys()),
    ...Array.from(month3B.keys()),
  ])).sort();

  // 全体合計
  const total2A = empty();
  const total3B = empty();
  const totalOverall = empty();
  for (const s of Array.from(monthOverall.values())) { totalOverall.recommendedR += s.recommendedR; totalOverall.hits += s.hits; totalOverall.cost += s.cost; totalOverall.payout += s.payout; }
  for (const s of Array.from(month2A.values())) { total2A.recommendedR += s.recommendedR; total2A.hits += s.hits; total2A.cost += s.cost; total2A.payout += s.payout; }
  for (const s of Array.from(month3B.values())) { total3B.recommendedR += s.recommendedR; total3B.hits += s.hits; total3B.cost += s.cost; total3B.payout += s.payout; }

  // ---- 安定性指標 ----
  function computeStability(map: Map<string, Stats>, total: Stats) {
    const entries = allMonths.map((m) => {
      const s = map.get(m) ?? empty();
      return { month: m, stats: s, roi: roi(s), share: total.recommendedR > 0 ? (s.recommendedR / total.recommendedR) * 100 : 0 };
    });
    // ROI (推奨R>=5 のみ)
    const validRois = entries.filter((e) => e.stats.recommendedR >= 5).map((e) => e.roi);
    const maxRoi = validRois.length > 0 ? Math.max(...validRois) : 0;
    const minRoi = validRois.length > 0 ? Math.min(...validRois) : 0;
    const cvVal  = cv(validRois);
    const monthsLow = entries.filter((e) => e.stats.recommendedR < 5 && e.stats.recommendedR > 0).length;
    const monthsZero = entries.filter((e) => e.stats.recommendedR === 0).length;
    const maxShare = Math.max(...entries.map((e) => e.share));
    return { entries, validRois, maxRoi, minRoi, roiDiff: maxRoi - minRoi, cv: cvVal, monthsLow, monthsZero, maxShare };
  }

  const stab2A = computeStability(month2A, total2A);
  const stab3B = computeStability(month3B, total3B);

  // 偏りパターン判定
  function patternOf(stab: ReturnType<typeof computeStability>, totalR: number): string {
    const entries = stab.entries.filter((e) => e.stats.recommendedR > 0);
    if (entries.length === 0) return '該当なし';
    const maxM = entries.reduce((a, b) => (b.stats.recommendedR > a.stats.recommendedR ? b : a));
    const maxShare = (maxM.stats.recommendedR / totalR) * 100;
    if (maxShare >= 50) return `α 特定月集中型 (${maxM.month} に ${maxShare.toFixed(0)}%)`;
    if (stab.cv <= 0.3 && entries.every((e) => e.stats.recommendedR >= 5)) return 'β 均等分布型';
    if (stab.roiDiff > 500) return 'δ 2極化型 (ROI差 大)';
    // 徐々に増減
    const rois = entries.map((e) => e.roi);
    const slopes: number[] = [];
    for (let i = 1; i < rois.length; i++) slopes.push(rois[i] - rois[i - 1]);
    const allSameDir = slopes.every((x) => x >= 0) || slopes.every((x) => x <= 0);
    if (allSameDir && Math.abs(rois[rois.length - 1] - rois[0]) > 200) return 'γ 徐々に増減型';
    return '中間 (明確なパターンなし)';
  }

  const pat2A = patternOf(stab2A, total2A.recommendedR);
  const pat3B = patternOf(stab3B, total3B.recommendedR);

  // 判定
  function judge(stab: ReturnType<typeof computeStability>, totalR: number): string {
    if (stab.cv <= 0.3 && stab.entries.every((e) => e.stats.recommendedR >= 5 || e.stats.recommendedR === 0) && stab.roiDiff <= 300 && stab.maxShare <= 40) {
      return '✅ 時期非依存 (実装推奨)';
    }
    if (stab.cv > 0.5 || stab.maxShare > 50 || stab.roiDiff > 500) {
      return '❌ 強い偏りあり (実装見送り推奨)';
    }
    return '⚠️ 軽い偏りあり (実装可だが注意事項付記)';
  }
  const verdict2A = judge(stab2A, total2A.recommendedR);
  const verdict3B = judge(stab3B, total3B.recommendedR);

  // ---- Markdown 出力 ----
  const md: string[] = [];
  const mp = (s = ''): void => { md.push(s); };

  mp(`# 複合シグナル 時期依存性レポート`);
  mp('');
  mp(`- 生成日時: ${new Date().toISOString()}`);
  mp(`- 対象期間: **${allMonths[0]} 〜 ${allMonths[allMonths.length - 1]}** (930R)`);
  mp(`- 検証: 馬連本命 2-A (右×ダ×ダ良) / 3-B (2-A + 性別制限なし) の月別安定性`);
  mp('');

  mp(`## 1. 月別 基本統計`);
  mp('');

  // Phase 2G 全体
  mp(`### Phase 2G 馬連本命 全体`);
  mp('');
  mp(`| 月 | 推奨R | 的中R | 投資 | 払戻 | ROI |`);
  mp(`|---|---|---|---|---|---|`);
  for (const m of allMonths) {
    const s = monthOverall.get(m) ?? empty();
    mp(`| ${m} | ${s.recommendedR} | ${s.hits} | ${s.cost.toLocaleString()} | ${s.payout.toLocaleString()} | ${roi(s).toFixed(1)}% |`);
  }
  mp(`| **合計** | **${totalOverall.recommendedR}** | **${totalOverall.hits}** | **${totalOverall.cost.toLocaleString()}** | **${totalOverall.payout.toLocaleString()}** | **${roi(totalOverall).toFixed(1)}%** |`);
  mp('');

  // 2-A
  mp(`### 2-A (右 × ダ × ダ良) 月別分布`);
  mp('');
  mp(`| 月 | 推奨R | 的中R | 投資 | 払戻 | ROI | 全体比 |`);
  mp(`|---|---|---|---|---|---|---|`);
  for (const e of stab2A.entries) {
    const s = e.stats;
    mp(`| ${e.month} | ${s.recommendedR} | ${s.hits} | ${s.cost.toLocaleString()} | ${s.payout.toLocaleString()} | ${roi(s).toFixed(1)}% | ${e.share.toFixed(1)}% |`);
  }
  mp(`| **合計** | **${total2A.recommendedR}** | **${total2A.hits}** | **${total2A.cost.toLocaleString()}** | **${total2A.payout.toLocaleString()}** | **${roi(total2A).toFixed(1)}%** | 100% |`);
  mp('');

  // 3-B
  mp(`### 3-B (2-A + 性別制限なし) 月別分布`);
  mp('');
  mp(`| 月 | 推奨R | 的中R | 投資 | 払戻 | ROI | 全体比 |`);
  mp(`|---|---|---|---|---|---|---|`);
  for (const e of stab3B.entries) {
    const s = e.stats;
    mp(`| ${e.month} | ${s.recommendedR} | ${s.hits} | ${s.cost.toLocaleString()} | ${s.payout.toLocaleString()} | ${roi(s).toFixed(1)}% | ${e.share.toFixed(1)}% |`);
  }
  mp(`| **合計** | **${total3B.recommendedR}** | **${total3B.hits}** | **${total3B.cost.toLocaleString()}** | **${total3B.payout.toLocaleString()}** | **${roi(total3B).toFixed(1)}%** | 100% |`);
  mp('');

  // 安定性評価
  mp(`## 2. 安定性評価指標`);
  mp('');
  mp(`| 指標 | 2-A | 3-B |`);
  mp(`|---|---|---|`);
  mp(`| 月別 ROI 変動係数 (CV) | ${stab2A.cv.toFixed(3)} | ${stab3B.cv.toFixed(3)} |`);
  mp(`| 月別 ROI 最大値 | ${stab2A.maxRoi.toFixed(1)}% | ${stab3B.maxRoi.toFixed(1)}% |`);
  mp(`| 月別 ROI 最小値 | ${stab2A.minRoi.toFixed(1)}% | ${stab3B.minRoi.toFixed(1)}% |`);
  mp(`| 最良月/最悪月 ROI 差 | ${stab2A.roiDiff.toFixed(1)}pt | ${stab3B.roiDiff.toFixed(1)}pt |`);
  mp(`| 推奨R < 5 の月数 | ${stab2A.monthsLow} | ${stab3B.monthsLow} |`);
  mp(`| 推奨R = 0 の月数 | ${stab2A.monthsZero} | ${stab3B.monthsZero} |`);
  mp(`| 単一月への最大集中率 | ${stab2A.maxShare.toFixed(1)}% | ${stab3B.maxShare.toFixed(1)}% |`);
  mp('');

  // 偏りパターン判定
  mp(`## 3. 偏りパターン判定`);
  mp('');
  mp(`| パターン | 判定 | 根拠 |`);
  mp(`|---|---|---|`);
  mp(`| 2-A | ${pat2A} | max月 ${stab2A.maxShare.toFixed(1)}% / CV ${stab2A.cv.toFixed(2)} / ROI差 ${stab2A.roiDiff.toFixed(0)}pt |`);
  mp(`| 3-B | ${pat3B} | max月 ${stab3B.maxShare.toFixed(1)}% / CV ${stab3B.cv.toFixed(2)} / ROI差 ${stab3B.roiDiff.toFixed(0)}pt |`);
  mp('');

  // 月 × 場 クロス
  mp(`## 4. 月 × 競馬場 クロス (2-A)`);
  mp('');
  mp(`| 月 \\ 競馬場 | 中山 | 福島 | 阪神 | 京都 | 小倉 | その他 | 合計 |`);
  mp(`|---|---|---|---|---|---|---|---|`);
  const rightCourses = ['中山', '福島', '阪神', '京都', '小倉'];
  for (const m of allMonths) {
    const mc = monthCourse2A.get(m);
    if (!mc) { mp(`| ${m} | - | - | - | - | - | - | 0 |`); continue; }
    const cells: string[] = [];
    let other = 0;
    for (const rc of rightCourses) {
      const s = mc.get(rc);
      cells.push(s ? `${s.recommendedR}R / ROI ${roi(s).toFixed(0)}%` : '-');
    }
    for (const [c, s] of Array.from(mc.entries())) {
      if (!rightCourses.includes(c)) other += s.recommendedR;
    }
    cells.push(other > 0 ? `${other}R` : '-');
    const rowTotal = Array.from(mc.values()).reduce((t, s) => t + s.recommendedR, 0);
    mp(`| ${m} | ${cells.join(' | ')} | ${rowTotal} |`);
  }
  mp('');

  // 特定の月×場 に集中していないか
  let maxMC = { month: '', course: '', count: 0 };
  for (const [mon, mc] of Array.from(monthCourse2A.entries())) {
    for (const [c, s] of Array.from(mc.entries())) {
      if (s.recommendedR > maxMC.count) maxMC = { month: mon, course: c, count: s.recommendedR };
    }
  }
  if (maxMC.count > 0) {
    const share = (maxMC.count / total2A.recommendedR) * 100;
    mp(`**最大集中セル**: ${maxMC.month} × ${maxMC.course} = ${maxMC.count}R (${share.toFixed(1)}%)`);
    if (share > 30) {
      mp(`⚠️ ${share.toFixed(0)}% の集中、特定開催の特性に依存している可能性`);
    }
    mp('');
  }

  // 総合判定
  mp(`## 🏁 総合判定`);
  mp('');
  mp(`### 2-A (右×ダ×ダ良)`);
  mp(`- 判定: **${verdict2A}**`);
  mp(`- パターン: ${pat2A}`);
  mp('');
  mp(`### 3-B (2-A + 性別制限なし)`);
  mp(`- 判定: **${verdict3B}**`);
  mp(`- パターン: ${pat3B}`);
  mp('');

  // 実装への影響
  mp(`### 実装への影響`);
  mp('');
  const bothSafe = verdict2A.startsWith('✅') && verdict3B.startsWith('✅');
  const bothDangerous = verdict2A.startsWith('❌') || verdict3B.startsWith('❌');

  if (bothSafe) {
    mp(`**ケースA: ✅ 時期非依存、計画通り実装可**`);
    mp('');
    mp(`- \`shouldRecommendUmarenStrong\` + UI "🚀超本命級" バッジの実装を推奨`);
    mp(`- 加重投資戦略 (2-A マッチ時 2倍) で期待 ROI +59pt`);
    mp(`- 月別 ROI 変動係数は 2-A ${stab2A.cv.toFixed(2)} / 3-B ${stab3B.cv.toFixed(2)} で安定`);
  } else if (bothDangerous) {
    mp(`**ケースD: 🚫 強い偏りあり、実装見送り推奨**`);
    mp('');
    mp(`- 時期集中が大きく、本番環境で同じ ROI を再現する保証なし`);
    mp(`- Phase 2G ハイブリッドを維持、サンプル拡大 (1500R+) 後に再検証`);
  } else {
    mp(`**ケースB: ⚠️ 軽い偏りあり、実装可だが注意事項付記**`);
    mp('');
    mp(`- 実装は進めるが、UI に「時期によって効果が変動する可能性」を注記`);
    mp(`- 本番運用で月別 ROI をモニタリング、大きく乖離したら閾値見直し`);
    if (verdict3B.startsWith('❌') || verdict3B.startsWith('⚠️')) {
      mp(`- 3-B 特化は避け、より安定している 2-A ベースでの実装を推奨`);
    }
  }
  mp('');

  mp(`### 推奨事項`);
  mp('');
  // 個別の推奨
  if (stab2A.monthsLow + stab2A.monthsZero > 0) {
    mp(`- 2-A: ${stab2A.monthsLow + stab2A.monthsZero} ヶ月でサンプル不足 (<5R)。該当月の ROI は参考値扱い`);
  }
  if (stab3B.maxShare > 40) {
    mp(`- 3-B: 最大 ${stab3B.maxShare.toFixed(0)}% が単一月に集中。3-B 条件 (性別制限なし追加) は限定的効果と見るべき`);
  }
  if (stab3B.roiDiff > 500) {
    mp(`- 3-B: 月別 ROI 差 ${stab3B.roiDiff.toFixed(0)}pt と大きい。3-B は「最強」とは言えない`);
  }
  mp('');

  mp(`---`);
  mp(`*再実行: \`pnpm tsx scripts/temporal_stability_analysis.ts\`*`);

  await fs.writeFile(REPORT, md.join('\n'), 'utf-8');

  // ---- コンソール要約 ----
  console.log('='.repeat(84));
  console.log('  時期依存性 最終確認');
  console.log('='.repeat(84));
  console.log(`対象期間: ${allMonths[0]} 〜 ${allMonths[allMonths.length - 1]}`);
  console.log('');
  console.log('▼ 2-A (右×ダ×ダ良) 月別');
  for (const e of stab2A.entries) {
    console.log(`  ${e.month}: ${e.stats.recommendedR}R / 的中${e.stats.hits} / ROI ${roi(e.stats).toFixed(1)}% (全体比 ${e.share.toFixed(1)}%)`);
  }
  console.log(`  CV=${stab2A.cv.toFixed(3)} / ROI差=${stab2A.roiDiff.toFixed(0)}pt / max集中=${stab2A.maxShare.toFixed(1)}% → ${pat2A}`);
  console.log('');
  console.log('▼ 3-B (2-A + 性別制限なし) 月別');
  for (const e of stab3B.entries) {
    console.log(`  ${e.month}: ${e.stats.recommendedR}R / 的中${e.stats.hits} / ROI ${roi(e.stats).toFixed(1)}% (全体比 ${e.share.toFixed(1)}%)`);
  }
  console.log(`  CV=${stab3B.cv.toFixed(3)} / ROI差=${stab3B.roiDiff.toFixed(0)}pt / max集中=${stab3B.maxShare.toFixed(1)}% → ${pat3B}`);
  console.log('');
  console.log(`総合判定 2-A: ${verdict2A}`);
  console.log(`総合判定 3-B: ${verdict3B}`);
  console.log('');
  console.log(`Markdown: ${REPORT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
