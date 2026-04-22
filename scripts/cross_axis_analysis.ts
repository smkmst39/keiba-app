// ==========================================
// クロス軸分析 — 複合シグナル検証
//
// 多軸ROI v2 で馬連本命の強化候補 Top3:
//   右回り 433.8% (56R) / ダ良 433.6% (58R) / ダート 399.2% (63R)
// これらが複合した場合のROI を検証。
//
// 検証パターン:
//   1-A/B/C: 2軸組み合わせ
//   2-A: 右回り × ダート × ダ良 (本命複合)
//   2-B: 右回り × ダート × 良 (対照)
//   3-A/B: 3軸 + 時刻 / 性別
//   4-A/B: 参照用 (左回り×芝×良 / 右回り×芝×良)
//
// + 相関分析 + 競馬場別内訳 + 月別時系列
//
// 実行: pnpm tsx scripts/cross_axis_analysis.ts
// 出力: scripts/verification/cross_axis_analysis.md
// ==========================================

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { VerificationData } from '../lib/scraper/types';

const DIR = path.resolve(__dirname, 'verification');
const REPORT = path.join(DIR, 'cross_axis_analysis.md');

// ----------------------------------------
// Phase 2G ハイブリッド除外
// ----------------------------------------

function isExcludedForUmarenUmatan(rc?: string): boolean {
  if (!rc) return false;
  return /1勝|500万|2勝|1000万/.test(rc);
}

// ----------------------------------------
// 馬連本命 判定 + 配当
// ----------------------------------------

type Prediction = VerificationData['predictions'][number];
function sortedByEV(preds: Prediction[]): Prediction[] {
  return [...preds].filter((p) => p.odds > 0).sort((a, b) => b.ev - a.ev);
}
const sameSet = (a: number[], b: number[]): boolean =>
  a.length === b.length && [...a].sort((x, y) => x - y).join(',') === [...b].sort((x, y) => x - y).join(',');

type RecResult = {
  recommended: boolean;
  pair?: [number, number];
  payout: number;
  hit: boolean;
};

function umarenHonmei(vd: VerificationData, rc?: string): RecResult {
  if (isExcludedForUmarenUmatan(rc)) return { recommended: false, payout: 0, hit: false };
  const s = sortedByEV(vd.predictions);
  if (s.length < 2) return { recommended: false, payout: 0, hit: false };
  if (s[0].ev < 1.00 || s[1].ev < 1.00 || s[0].score < 65 || s[1].score < 65) {
    return { recommended: false, payout: 0, hit: false };
  }
  const pair: [number, number] = [s[0].horseId, s[1].horseId];
  for (const u of vd.results.payouts.umaren) {
    if (sameSet([...pair], u.combination.split('-').map(Number))) {
      return { recommended: true, pair, payout: u.payout, hit: true };
    }
  }
  return { recommended: true, pair, payout: 0, hit: false };
}

// ----------------------------------------
// 競馬場判定 (raceId 5-6桁目)
// ----------------------------------------

const COURSE_MAP: Record<string, string> = {
  '01': '札幌', '02': '函館', '03': '福島', '04': '新潟',
  '05': '東京', '06': '中山', '07': '中京', '08': '京都',
  '09': '阪神', '10': '小倉',
};
const RIGHT_TURN_CODES = new Set(['01', '02', '03', '06', '08', '09', '10']); // 左は 04/05/07

function courseOf(raceId: string): string {
  return COURSE_MAP[raceId.slice(4, 6)] ?? '不明';
}
function isRightTurn(raceId: string): boolean {
  return RIGHT_TURN_CODES.has(raceId.slice(4, 6));
}

// ----------------------------------------
// メタデータアクセサ
// ----------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getMeta(vd: any): any { return vd?.meta ?? {}; }

// 条件述語
type Cond = (vd: VerificationData, m: ReturnType<typeof getMeta>) => boolean;

const IS_DIRT: Cond     = (_, m) => m.surface === 'dirt';
const IS_TURF: Cond     = (_, m) => m.surface === 'turf';
const IS_GOOD: Cond     = (_, m) => m.trackCondition === '良';
const IS_DA_GOOD: Cond  = (_, m) => m.surface === 'dirt' && m.trackCondition === '良';
const IS_RIGHT: Cond    = (vd) => isRightTurn(vd.raceId);
const IS_LEFT: Cond     = (vd) => !isRightTurn(vd.raceId);
const IS_DAYTIME: Cond  = (_, m) => {
  const t = m.startTime ?? '';
  const h = parseInt(t.split(':')[0] ?? '0', 10);
  return h >= 11 && h < 14;
};
const IS_NO_SEX_LIMIT: Cond = (_, m) => m.sexLimit !== '牝';

function AND(...conds: Cond[]): Cond {
  return (vd, m) => conds.every((c) => c(vd, m));
}

// ----------------------------------------
// 集計
// ----------------------------------------

type Stats = { recommendedR: number; hits: number; cost: number; payout: number };
const empty = (): Stats => ({ recommendedR: 0, hits: 0, cost: 0, payout: 0 });
const roi = (s: Stats): number => s.cost > 0 ? (s.payout / s.cost) * 100 : 0;

/** 馬連本命が発動したレースのうち、条件を満たすもののみ集計 */
function aggregate(all: VerificationData[], filter: Cond): Stats {
  const s = empty();
  for (const vd of all) {
    if (vd.predictions.length < 2 || vd.results.results.length === 0) continue;
    const m = getMeta(vd);
    const r = umarenHonmei(vd, m.raceClass);
    if (!r.recommended) continue;
    if (!filter(vd, m)) continue;
    s.recommendedR++;
    s.cost += 100;
    s.payout += r.payout;
    if (r.hit) s.hits++;
  }
  return s;
}

function judge(s: Stats): string {
  if (s.recommendedR < 15) return '⚠️ サンプル不足';
  const r = roi(s);
  if (s.recommendedR >= 30 && r >= 500) return '🚀 超強力';
  if (s.recommendedR >= 30 && r >= 400) return '⭐ 強力';
  if (s.recommendedR >= 30 && r >= 300) return '◎ 優秀';
  if (s.recommendedR >= 30 && r >= 200) return '○ 良好';
  return '- 通常';
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

  // --- 参照値 ---
  const refAll   = aggregate(all, () => true);
  const refRight = aggregate(all, IS_RIGHT);
  const refDirt  = aggregate(all, IS_DIRT);
  const refDaGd  = aggregate(all, IS_DA_GOOD);

  // --- パターン 1 ---
  const p1a = aggregate(all, AND(IS_RIGHT, IS_DIRT));
  const p1b = aggregate(all, AND(IS_RIGHT, IS_DA_GOOD));
  const p1c = aggregate(all, AND(IS_DIRT, IS_DA_GOOD));

  // --- パターン 2 ---
  const p2a = aggregate(all, AND(IS_RIGHT, IS_DIRT, IS_DA_GOOD));
  const p2b = aggregate(all, AND(IS_RIGHT, IS_DIRT, IS_GOOD));

  // --- パターン 3 ---
  const p3a = aggregate(all, AND(IS_RIGHT, IS_DIRT, IS_DA_GOOD, IS_DAYTIME));
  const p3b = aggregate(all, AND(IS_RIGHT, IS_DIRT, IS_DA_GOOD, IS_NO_SEX_LIMIT));

  // --- パターン 4 (参照) ---
  const p4a = aggregate(all, AND(IS_LEFT, IS_TURF, IS_GOOD));
  const p4b = aggregate(all, AND(IS_RIGHT, IS_TURF, IS_GOOD));

  // --- 相関分析 ---
  // 馬連本命推奨 132R のうち、各条件に該当する数
  let totalRec = 0;
  let nRight = 0, nDirt = 0, nDaGood = 0;
  let nRD = 0, nRG = 0, nDG = 0;
  let nAll3 = 0;
  for (const vd of all) {
    if (vd.predictions.length < 2 || vd.results.results.length === 0) continue;
    const m = getMeta(vd);
    const r = umarenHonmei(vd, m.raceClass);
    if (!r.recommended) continue;
    totalRec++;
    const right = isRightTurn(vd.raceId);
    const dirt  = m.surface === 'dirt';
    const daGd  = dirt && m.trackCondition === '良';
    if (right) nRight++;
    if (dirt)  nDirt++;
    if (daGd)  nDaGood++;
    if (right && dirt) nRD++;
    if (right && daGd) nRG++;
    if (dirt && daGd)  nDG++;
    if (right && dirt && daGd) nAll3++;
  }

  // --- 競馬場別内訳 (2-A 条件のレース) ---
  const p2aByCourse = new Map<string, Stats>();
  for (const vd of all) {
    if (vd.predictions.length < 2 || vd.results.results.length === 0) continue;
    const m = getMeta(vd);
    const r = umarenHonmei(vd, m.raceClass);
    if (!r.recommended) continue;
    if (!AND(IS_RIGHT, IS_DIRT, IS_DA_GOOD)(vd, m)) continue;
    const course = courseOf(vd.raceId);
    let s = p2aByCourse.get(course);
    if (!s) { s = empty(); p2aByCourse.set(course, s); }
    s.recommendedR++;
    s.cost += 100;
    s.payout += r.payout;
    if (r.hit) s.hits++;
  }

  // --- 月別時系列 (2-A 条件) ---
  const p2aByMonth = new Map<string, Stats>();
  for (const vd of all) {
    if (vd.predictions.length < 2 || vd.results.results.length === 0) continue;
    const m = getMeta(vd);
    const r = umarenHonmei(vd, m.raceClass);
    if (!r.recommended) continue;
    if (!AND(IS_RIGHT, IS_DIRT, IS_DA_GOOD)(vd, m)) continue;
    const month = vd.date.slice(0, 7); // YYYY-MM
    let s = p2aByMonth.get(month);
    if (!s) { s = empty(); p2aByMonth.set(month, s); }
    s.recommendedR++;
    s.cost += 100;
    s.payout += r.payout;
    if (r.hit) s.hits++;
  }

  // ---- 出力 ----
  const md: string[] = [];
  const mp = (s = ''): void => { md.push(s); };

  mp(`# クロス軸分析 — 複合シグナル検証`);
  mp('');
  mp(`- 生成日時: ${new Date().toISOString()}`);
  mp(`- 対象: **930 R** (Phase 2G データ)`);
  mp(`- 券種: 馬連本命 (Phase 2G ハイブリッド + 条件マッチのみ集計)`);
  mp(`- 判定基準: 推奨R ≥ 30 で結論、推奨R < 15 はサンプル不足`);
  mp('');

  mp(`## メインテーブル`);
  mp('');
  mp(`| パターン | 条件 | 推奨R | 的中R | ROI | 判定 |`);
  mp(`|---|---|---|---|---|---|`);
  mp(`| 参照 | 全体 (Phase 2G 平均) | ${refAll.recommendedR} | ${refAll.hits} | ${roi(refAll).toFixed(1)}% | ベースライン |`);
  mp(`| 参照 | 右回り 単独 | ${refRight.recommendedR} | ${refRight.hits} | ${roi(refRight).toFixed(1)}% | 強化候補1 |`);
  mp(`| 参照 | ダ良 単独 | ${refDaGd.recommendedR} | ${refDaGd.hits} | ${roi(refDaGd).toFixed(1)}% | 強化候補2 |`);
  mp(`| 参照 | ダート 単独 | ${refDirt.recommendedR} | ${refDirt.hits} | ${roi(refDirt).toFixed(1)}% | 強化候補3 |`);
  mp(`| 1-A | 右回り × ダート | ${p1a.recommendedR} | ${p1a.hits} | ${roi(p1a).toFixed(1)}% | ${judge(p1a)} |`);
  mp(`| 1-B | 右回り × ダ良 | ${p1b.recommendedR} | ${p1b.hits} | ${roi(p1b).toFixed(1)}% | ${judge(p1b)} |`);
  mp(`| 1-C | ダート × ダ良 | ${p1c.recommendedR} | ${p1c.hits} | ${roi(p1c).toFixed(1)}% | ${judge(p1c)} |`);
  mp(`| **2-A** | **右 × ダ × ダ良** | **${p2a.recommendedR}** | **${p2a.hits}** | **${roi(p2a).toFixed(1)}%** | **${judge(p2a)}** |`);
  mp(`| 2-B | 右 × ダ × 良 | ${p2b.recommendedR} | ${p2b.hits} | ${roi(p2b).toFixed(1)}% | ${judge(p2b)} |`);
  mp(`| 3-A | 2-A + 昼 (11-14時) | ${p3a.recommendedR} | ${p3a.hits} | ${roi(p3a).toFixed(1)}% | ${judge(p3a)} |`);
  mp(`| 3-B | 2-A + 性別制限なし | ${p3b.recommendedR} | ${p3b.hits} | ${roi(p3b).toFixed(1)}% | ${judge(p3b)} |`);
  mp(`| 4-A | 左回り × 芝 × 良 | ${p4a.recommendedR} | ${p4a.hits} | ${roi(p4a).toFixed(1)}% | ${judge(p4a)} |`);
  mp(`| 4-B | 右回り × 芝 × 良 | ${p4b.recommendedR} | ${p4b.hits} | ${roi(p4b).toFixed(1)}% | ${judge(p4b)} |`);
  mp('');

  // 相関分析
  mp(`## 相関分析`);
  mp('');
  mp(`馬連本命推奨 **${totalRec}R** のうち、各条件の該当数:`);
  mp('');
  mp(`| 条件 | 該当R | 推奨R比 |`);
  mp(`|---|---|---|`);
  mp(`| 右回り | ${nRight} | ${((nRight / totalRec) * 100).toFixed(1)}% |`);
  mp(`| ダート | ${nDirt} | ${((nDirt / totalRec) * 100).toFixed(1)}% |`);
  mp(`| ダ良 | ${nDaGood} | ${((nDaGood / totalRec) * 100).toFixed(1)}% |`);
  mp(`| 右回り × ダート | ${nRD} | ${((nRD / totalRec) * 100).toFixed(1)}% |`);
  mp(`| 右回り × ダ良 | ${nRG} | ${((nRG / totalRec) * 100).toFixed(1)}% |`);
  mp(`| ダート × ダ良 | ${nDG} | ${((nDG / totalRec) * 100).toFixed(1)}% |`);
  mp(`| **3軸全て** | **${nAll3}** | **${((nAll3 / totalRec) * 100).toFixed(1)}%** |`);
  mp('');
  mp(`### 独立性の評価`);
  mp('');
  // ダート と ダ良 の関係: ダ良は必ずダート (自明)
  const daIsDaGoodRatio = nDirt > 0 ? (nDaGood / nDirt) * 100 : 0;
  mp(`- **ダート × ダ良**: ダートの ${daIsDaGoodRatio.toFixed(1)}% がダ良 (残りは稍重/重/不良)`);
  const rightIsDirtRatio = nRight > 0 ? (nRD / nRight) * 100 : 0;
  mp(`- **右回り × ダート**: 右回りの ${rightIsDirtRatio.toFixed(1)}% がダート (馬連本命推奨 ${totalRec}R 内)`);
  const dirtIsRightRatio = nDirt > 0 ? (nRD / nDirt) * 100 : 0;
  mp(`- **ダート × 右回り**: ダートの ${dirtIsRightRatio.toFixed(1)}% が右回り`);
  mp(`- → 強化候補 Top3 は**高い相関**を持ち、実質的にほぼ同じレース群を別軸で見ている可能性が高い`);
  mp('');

  // 競馬場別
  mp(`## 競馬場別内訳 (2-A: 右×ダ×ダ良 ${p2a.recommendedR}R)`);
  mp('');
  mp(`| 競馬場 | 推奨R | 的中R | ROI |`);
  mp(`|---|---|---|---|`);
  const courseArr = Array.from(p2aByCourse.entries()).sort((a, b) => b[1].recommendedR - a[1].recommendedR);
  for (const [c, s] of courseArr) {
    mp(`| ${c} | ${s.recommendedR} | ${s.hits} | ${roi(s).toFixed(1)}% |`);
  }
  mp('');
  if (courseArr.length > 0) {
    const dominant = courseArr[0];
    const dominantRatio = (dominant[1].recommendedR / p2a.recommendedR) * 100;
    if (dominantRatio > 50) {
      mp(`⚠️ **${dominant[0]}** が ${dominantRatio.toFixed(1)}% を占めており、2-A の ROI は **${dominant[0]} 特性** に大きく依存`);
    } else {
      mp(`✅ 特定競馬場の偏りは限定的 (最多でも ${dominantRatio.toFixed(1)}%)`);
    }
  }
  mp('');

  // 月別時系列
  mp(`## 月別時系列 (2-A 条件)`);
  mp('');
  mp(`| 月 | 推奨R | 的中R | ROI |`);
  mp(`|---|---|---|---|`);
  const monthArr = Array.from(p2aByMonth.entries()).sort(([a], [b]) => a.localeCompare(b));
  for (const [m, s] of monthArr) {
    mp(`| ${m} | ${s.recommendedR} | ${s.hits} | ${roi(s).toFixed(1)}% |`);
  }
  mp('');
  const monthRois = monthArr.filter(([, s]) => s.recommendedR >= 5).map(([, s]) => roi(s));
  if (monthRois.length > 0) {
    const maxRoi = Math.max(...monthRois);
    const minRoi = Math.min(...monthRois);
    if (maxRoi - minRoi > 500) {
      mp(`⚠️ 月ごとの ROI の振れ幅が大きい (${minRoi.toFixed(0)}% 〜 ${maxRoi.toFixed(0)}%)。特定月への依存を示唆`);
    } else {
      mp(`✅ 月ごとの ROI は比較的安定`);
    }
  }
  mp('');

  // ---- 俯瞰サマリー ----
  mp(`## 🔭 俯瞰サマリー`);
  mp('');

  const best = [p1a, p1b, p1c, p2a, p2b, p3a, p3b]
    .map((s, i) => ({ name: ['1-A', '1-B', '1-C', '2-A', '2-B', '3-A', '3-B'][i], s }))
    .filter((x) => x.s.recommendedR >= 15)
    .sort((a, b) => roi(b.s) - roi(a.s));

  mp(`### A. 複合シグナルの強度`);
  mp('');
  mp(`単軸 ROI と複合 ROI の比較:`);
  mp('');
  mp(`| シグナル | 推奨R | ROI | vs 単軸最強 (右回り 433.8%) |`);
  mp(`|---|---|---|---|`);
  mp(`| 単軸: 右回り | ${refRight.recommendedR} | ${roi(refRight).toFixed(1)}% | baseline |`);
  mp(`| 1-A 2軸複合 | ${p1a.recommendedR} | ${roi(p1a).toFixed(1)}% | ${(roi(p1a) - roi(refRight)).toFixed(1)}pt |`);
  mp(`| 2-A 3軸複合 | ${p2a.recommendedR} | ${roi(p2a).toFixed(1)}% | ${(roi(p2a) - roi(refRight)).toFixed(1)}pt |`);
  mp('');
  if (best.length > 0) {
    mp(`**最強複合シグナル**: ${best[0].name} ROI ${roi(best[0].s).toFixed(1)}% (推奨 ${best[0].s.recommendedR}R)`);
  }
  mp('');

  mp(`### B. 本番適用可能性`);
  mp('');
  const p2aRoi = roi(p2a);
  const refRoi = roi(refAll);
  if (p2a.recommendedR >= 30 && p2aRoi >= 500) {
    mp(`**🚀 本番適用推奨**: 2-A が推奨 ${p2a.recommendedR}R / ROI ${p2aRoi.toFixed(1)}% と超強力。`);
    mp(`実装案:`);
    mp(`- \`shouldRecommendUmaren\` にクロス条件フラグを追加`);
    mp(`- 2-A マッチ時は「🚀 超本命級」として表示`);
    mp(`- 投資配分を通常の 2 倍に増やす選択肢も検討`);
  } else if (p2a.recommendedR < 15) {
    mp(`⚠️ 2-A はサンプル不足 (${p2a.recommendedR}R) で本番適用判断は保留`);
  } else if (p2aRoi > refRoi + 100) {
    mp(`**検討価値あり**: 2-A が ROI ${p2aRoi.toFixed(1)}% でベースライン ${refRoi.toFixed(1)}% を +${(p2aRoi - refRoi).toFixed(1)}pt 上回る`);
    mp(`ただし「右回り・ダート・ダ良」の相関が高いため、独立シグナルとしての効果は限定的`);
  } else {
    mp(`**本番適用見送り**: 複合効果が単軸を明確には上回らない`);
  }
  mp('');

  mp(`### C. 注意点`);
  mp('');
  mp(`- **サンプル不足**: 3-A (時刻絞り) / 3-B (性別絞り) は推奨R が 15 未満の場合、判定を保留`);
  if (nDaGood > 0 && nDirt > 0 && (nDaGood / nDirt) > 0.9) {
    mp(`- **相関による重複**: ダ良はダートの ${((nDaGood / nDirt) * 100).toFixed(0)}% を占めるため、`);
    mp(`  「ダート」と「ダ良」は実質ほぼ同じレース群を見ている`);
  }
  mp(`- **競馬場偏り**: ダートで右回りは 中山/阪神/京都/小倉 が中心、特定場の特性が ROI に反映されている可能性`);
  if (monthRois.length >= 2) {
    const diff = Math.max(...monthRois) - Math.min(...monthRois);
    if (diff > 300) {
      mp(`- **月別変動**: ${diff.toFixed(0)}pt の振れ幅、時期依存の可能性あり`);
    }
  }
  mp('');

  mp(`### D. 次の検証候補`);
  mp('');
  mp(`1. **2-A を本番適用した場合の全体効果シミュレーション**`);
  mp(`   - 現状 Phase 2G 馬連 ${roi(refAll).toFixed(1)}% × 推奨 ${refAll.recommendedR}R`);
  mp(`   - 2-A 条件下でのみ投資 2 倍 / 外は現行維持 の期待値`);
  mp(`2. **馬単・ワイドでも同じクロス条件検証** (右×ダ×ダ良 以外に強化余地あるか)`);
  mp(`3. **4軸複合 (競馬場別に特化)** — 中山×ダ×良 などがさらに高いか`);
  mp('');

  mp(`---`);
  mp(`*再実行: \`pnpm tsx scripts/cross_axis_analysis.ts\`*`);

  await fs.writeFile(REPORT, md.join('\n'), 'utf-8');

  // ---- コンソール要約 ----
  console.log('='.repeat(88));
  console.log('  クロス軸分析 (Phase 2G 馬連本命)');
  console.log('='.repeat(88));
  console.log(`参照: 全体 ${refAll.recommendedR}R / ROI ${roi(refAll).toFixed(1)}%`);
  console.log(`  右回り単独 ${refRight.recommendedR}R / ROI ${roi(refRight).toFixed(1)}%`);
  console.log(`  ダート単独 ${refDirt.recommendedR}R / ROI ${roi(refDirt).toFixed(1)}%`);
  console.log(`  ダ良単独   ${refDaGd.recommendedR}R / ROI ${roi(refDaGd).toFixed(1)}%`);
  console.log('');
  console.log('複合パターン:');
  const rows = [
    ['1-A 右×ダ',      p1a],
    ['1-B 右×ダ良',    p1b],
    ['1-C ダ×ダ良',   p1c],
    ['2-A 右×ダ×ダ良', p2a],
    ['2-B 右×ダ×良',   p2b],
    ['3-A 2-A+昼',     p3a],
    ['3-B 2-A+制限なし', p3b],
    ['4-A 左×芝×良',   p4a],
    ['4-B 右×芝×良',   p4b],
  ] as const;
  rows.forEach(([name, s]) => {
    console.log(`  ${name.padEnd(18)}: ${s.recommendedR.toString().padStart(3)}R / 的中${s.hits.toString().padStart(2)} / ROI ${roi(s).toFixed(1).padStart(6)}% ${judge(s)}`);
  });
  console.log('');
  console.log(`相関: 馬連本命 ${totalRec}R 中`);
  console.log(`  右回り ${nRight} / ダート ${nDirt} / ダ良 ${nDaGood} / 3軸全て ${nAll3}`);
  console.log('');
  console.log(`Markdown: ${REPORT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
