// ==========================================
// クロス軸分析 — 券種横展開 (馬連 + 馬単 + ワイド)
//
// 前回 cross_axis_analysis.ts で馬連本命の複合シグナルが判明:
//   2-A 右×ダ×ダ良: 51R / 476.3% (1.79x)
//   3-B 2-A+性別制限なし: 41R / 517.8% (1.95x)
//
// 今回はこれが馬単本命・ワイド堅実でも効くかを検証。
// + 馬連-馬単-ワイドの推奨重複率 + 3-B の月別時系列安定性。
//
// 実行: pnpm tsx scripts/cross_axis_cross_type.ts
// 出力: scripts/verification/cross_axis_cross_type.md
// ==========================================

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { VerificationData } from '../lib/scraper/types';

const DIR = path.resolve(__dirname, 'verification');
const REPORT = path.join(DIR, 'cross_axis_cross_type.md');

// ----------------------------------------
// Phase 2G ハイブリッド除外
// ----------------------------------------
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
const sameSeq = (a: number[], b: number[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

// ----------------------------------------
// 3 券種の判定 + 配当
// ----------------------------------------

type RecResult = {
  recommended: boolean;
  cost: number;
  payout: number;
  hit: boolean;
};

function recUmaren(vd: VerificationData, rc?: string): RecResult {
  if (isExcludedForUmarenUmatan(rc)) return { recommended: false, cost: 0, payout: 0, hit: false };
  const s = sortedByEV(vd.predictions);
  if (s.length < 2) return { recommended: false, cost: 0, payout: 0, hit: false };
  if (s[0].ev < 1.00 || s[1].ev < 1.00 || s[0].score < 65 || s[1].score < 65) {
    return { recommended: false, cost: 0, payout: 0, hit: false };
  }
  let pay = 0, hit = false;
  for (const u of vd.results.payouts.umaren) {
    if (sameSet([s[0].horseId, s[1].horseId], u.combination.split('-').map(Number))) {
      pay = u.payout; hit = true; break;
    }
  }
  return { recommended: true, cost: 100, payout: pay, hit };
}

function recUmatan(vd: VerificationData, rc?: string): RecResult {
  if (isExcludedForUmarenUmatan(rc)) return { recommended: false, cost: 0, payout: 0, hit: false };
  const s = sortedByEV(vd.predictions);
  if (s.length < 2) return { recommended: false, cost: 0, payout: 0, hit: false };
  if (s[0].ev < 1.00 || s[1].ev < 1.00 || s[0].score < 65 || s[1].score < 65 || s[0].odds > 15 || s[1].odds > 15) {
    return { recommended: false, cost: 0, payout: 0, hit: false };
  }
  let pay = 0, hit = false;
  for (const perm of [[s[0].horseId, s[1].horseId], [s[1].horseId, s[0].horseId]]) {
    for (const u of vd.results.payouts.umatan ?? []) {
      if (sameSeq(perm, u.combination.split('-').map(Number))) { pay += u.payout; hit = true; break; }
    }
  }
  return { recommended: true, cost: 200, payout: pay, hit };
}

function recWide(vd: VerificationData, rc?: string): RecResult {
  if (isExcludedForWide(rc)) return { recommended: false, cost: 0, payout: 0, hit: false };
  const s = sortedByEV(vd.predictions);
  if (s.length < 2) return { recommended: false, cost: 0, payout: 0, hit: false };
  if (s[0].ev < 1.02 || s[1].ev < 1.02 || s[0].score < 65 || s[1].score < 65 || s[0].odds > 10 || s[1].odds > 10) {
    return { recommended: false, cost: 0, payout: 0, hit: false };
  }
  let pay = 0, hit = false;
  for (const w of vd.results.payouts.wide ?? []) {
    if (sameSet([s[0].horseId, s[1].horseId], w.combination.split('-').map(Number))) {
      pay = w.payout; hit = true; break;
    }
  }
  return { recommended: true, cost: 100, payout: pay, hit };
}

// ----------------------------------------
// 条件述語
// ----------------------------------------

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

type Cond = (vd: VerificationData, m: ReturnType<typeof getMeta>) => boolean;
const IS_DIRT: Cond = (_, m) => m.surface === 'dirt';
const IS_TURF: Cond = (_, m) => m.surface === 'turf';
const IS_GOOD: Cond = (_, m) => m.trackCondition === '良';
const IS_DA_GOOD: Cond = (_, m) => m.surface === 'dirt' && m.trackCondition === '良';
const IS_RIGHT: Cond = (vd) => isRightTurn(vd.raceId);
const IS_LEFT: Cond = (vd) => !isRightTurn(vd.raceId);
const IS_DAYTIME: Cond = (_, m) => {
  const h = parseInt((m.startTime ?? '').split(':')[0] ?? '0', 10);
  return h >= 11 && h < 14;
};
const IS_NO_SEX: Cond = (_, m) => m.sexLimit !== '牝';

function AND(...cs: Cond[]): Cond {
  return (vd, m) => cs.every((c) => c(vd, m));
}

// ----------------------------------------
// Stats
// ----------------------------------------

type Stats = { recommendedR: number; hits: number; cost: number; payout: number };
const empty = (): Stats => ({ recommendedR: 0, hits: 0, cost: 0, payout: 0 });
const roi = (s: Stats): number => s.cost > 0 ? (s.payout / s.cost) * 100 : 0;

function aggregate(
  all: VerificationData[],
  recFn: (vd: VerificationData, rc?: string) => RecResult,
  filter: Cond,
): Stats {
  const s = empty();
  for (const vd of all) {
    if (vd.predictions.length < 2 || vd.results.results.length === 0) continue;
    const m = getMeta(vd);
    const r = recFn(vd, m.raceClass);
    if (!r.recommended) continue;
    if (!filter(vd, m)) continue;
    s.recommendedR++;
    s.cost   += r.cost;
    s.payout += r.payout;
    if (r.hit) s.hits++;
  }
  return s;
}

/** 単軸平均比で判定 */
function judgeRatio(cur: number, baseline: number, n: number): string {
  if (n < 15) return '⚠️ サンプル不足';
  const ratio = baseline > 0 ? cur / baseline : 0;
  if (n >= 30 && ratio >= 2.0) return `🚀 超強力 (${ratio.toFixed(2)}x)`;
  if (n >= 30 && ratio >= 1.5) return `⭐ 強力 (${ratio.toFixed(2)}x)`;
  if (n >= 30 && ratio >= 1.3) return `◎ 優秀 (${ratio.toFixed(2)}x)`;
  if (ratio >= 0.9 && ratio <= 1.3) return `- 通常 (${ratio.toFixed(2)}x)`;
  if (ratio < 0.9) return `❌ 悪化 (${ratio.toFixed(2)}x)`;
  return `(${ratio.toFixed(2)}x)`;
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

type BetKind = { name: string; recFn: typeof recUmaren };
const BETS: BetKind[] = [
  { name: '馬連本命', recFn: recUmaren },
  { name: '馬単本命', recFn: recUmatan },
  { name: 'ワイド堅実', recFn: recWide },
];

async function main(): Promise<void> {
  const all = await loadData();

  // 参照値 (Phase 2G 平均)
  const refs: Record<string, Stats> = {};
  for (const b of BETS) refs[b.name] = aggregate(all, b.recFn, () => true);

  // パターン定義
  const PATTERNS: Array<{ key: string; label: string; cond: Cond }> = [
    { key: '1-A', label: '右回り × ダート',       cond: AND(IS_RIGHT, IS_DIRT) },
    { key: '1-B', label: '右回り × ダ良',         cond: AND(IS_RIGHT, IS_DA_GOOD) },
    { key: '1-C', label: 'ダート × ダ良',         cond: AND(IS_DIRT, IS_DA_GOOD) },
    { key: '2-A', label: '右 × ダ × ダ良',         cond: AND(IS_RIGHT, IS_DIRT, IS_DA_GOOD) },
    { key: '2-B', label: '右 × ダ × 良',          cond: AND(IS_RIGHT, IS_DIRT, IS_GOOD) },
    { key: '3-A', label: '2-A + 昼',              cond: AND(IS_RIGHT, IS_DIRT, IS_DA_GOOD, IS_DAYTIME) },
    { key: '3-B', label: '2-A + 性別制限なし',     cond: AND(IS_RIGHT, IS_DIRT, IS_DA_GOOD, IS_NO_SEX) },
    { key: '4-A', label: '左回り × 芝 × 良',       cond: AND(IS_LEFT, IS_TURF, IS_GOOD) },
    { key: '4-B', label: '右回り × 芝 × 良',       cond: AND(IS_RIGHT, IS_TURF, IS_GOOD) },
  ];

  // 券種 × パターン
  const table: Record<string, Record<string, Stats>> = {};
  for (const b of BETS) {
    table[b.name] = {};
    for (const p of PATTERNS) {
      table[b.name][p.key] = aggregate(all, b.recFn, p.cond);
    }
  }

  // 券種間の推奨重複率
  const recSets: Record<string, Set<string>> = {};
  for (const b of BETS) recSets[b.name] = new Set();
  for (const vd of all) {
    if (vd.predictions.length < 2 || vd.results.results.length === 0) continue;
    const m = getMeta(vd);
    for (const b of BETS) {
      if (b.recFn(vd, m.raceClass).recommended) recSets[b.name].add(vd.raceId);
    }
  }
  const overlap_UM = Array.from(recSets['馬連本命']).filter((r) => recSets['馬単本命'].has(r)).length;
  const overlap_UW = Array.from(recSets['馬連本命']).filter((r) => recSets['ワイド堅実'].has(r)).length;
  const overlap_MW = Array.from(recSets['馬単本命']).filter((r) => recSets['ワイド堅実'].has(r)).length;
  const overlap_ALL3 = Array.from(recSets['馬連本命'])
    .filter((r) => recSets['馬単本命'].has(r) && recSets['ワイド堅実'].has(r)).length;

  // 2-A マッチレースで各券種の推奨重複
  let twoA_umaren = 0, twoA_umatan = 0, twoA_wide = 0, twoA_all3 = 0;
  for (const vd of all) {
    if (vd.predictions.length < 2 || vd.results.results.length === 0) continue;
    const m = getMeta(vd);
    const u = recUmaren(vd, m.raceClass);
    if (!u.recommended) continue;
    if (!AND(IS_RIGHT, IS_DIRT, IS_DA_GOOD)(vd, m)) continue;
    twoA_umaren++;
    if (recUmatan(vd, m.raceClass).recommended) twoA_umatan++;
    if (recWide(vd, m.raceClass).recommended)   twoA_wide++;
    if (recUmatan(vd, m.raceClass).recommended && recWide(vd, m.raceClass).recommended) twoA_all3++;
  }

  // 3-B の馬連月別
  const p3bMonth = new Map<string, Stats>();
  for (const vd of all) {
    if (vd.predictions.length < 2 || vd.results.results.length === 0) continue;
    const m = getMeta(vd);
    const r = recUmaren(vd, m.raceClass);
    if (!r.recommended) continue;
    if (!AND(IS_RIGHT, IS_DIRT, IS_DA_GOOD, IS_NO_SEX)(vd, m)) continue;
    const mth = vd.date.slice(0, 7);
    let s = p3bMonth.get(mth);
    if (!s) { s = empty(); p3bMonth.set(mth, s); }
    s.recommendedR++;
    s.cost += 100;
    s.payout += r.payout;
    if (r.hit) s.hits++;
  }

  // ---- Markdown ----
  const md: string[] = [];
  const mp = (s = ''): void => { md.push(s); };

  mp(`# クロス軸分析 券種横展開レポート`);
  mp('');
  mp(`- 生成日時: ${new Date().toISOString()}`);
  mp(`- 対象: **930 R** (Phase 2G)`);
  mp(`- 検証: 馬連で発見した複合シグナル (2-A, 3-B) が馬単・ワイドでも効くか`);
  mp('');

  // 参照値
  mp(`## 全体参照値 (Phase 2G 単軸平均)`);
  mp('');
  mp(`| 券種 | 推奨R | 的中R | ROI |`);
  mp(`|---|---|---|---|`);
  for (const b of BETS) {
    const s = refs[b.name];
    mp(`| ${b.name} | ${s.recommendedR} | ${s.hits} | **${roi(s).toFixed(1)}%** |`);
  }
  mp('');

  // 券種別のクロスパターン詳細
  for (const b of BETS) {
    mp(`## ${b.name} の複合パターン`);
    mp('');
    const ref = refs[b.name];
    const refRoi = roi(ref);
    mp(`参照: 全体 ${ref.recommendedR}R / ROI ${refRoi.toFixed(1)}%`);
    mp('');
    mp(`| パターン | 条件 | 推奨R | 的中R | ROI | 単軸平均比 | 判定 |`);
    mp(`|---|---|---|---|---|---|---|`);
    mp(`| 参照 | 全体 | ${ref.recommendedR} | ${ref.hits} | ${refRoi.toFixed(1)}% | 1.00x | ベース |`);
    for (const p of PATTERNS) {
      const s = table[b.name][p.key];
      const r = roi(s);
      const ratio = refRoi > 0 ? r / refRoi : 0;
      mp(`| ${p.key} | ${p.label} | ${s.recommendedR} | ${s.hits} | ${r.toFixed(1)}% | ${ratio.toFixed(2)}x | ${judgeRatio(r, refRoi, s.recommendedR)} |`);
    }
    mp('');
  }

  // 券種横断マッピング
  mp(`## A. 券種横断 効果マッピング`);
  mp('');
  mp(`| パターン | 馬連 ROI (x) | 馬単 ROI (x) | ワイド ROI (x) | 総合判定 |`);
  mp(`|---|---|---|---|---|`);
  const crossRows = ['1-A', '1-B', '2-A', '3-B', '4-B'];
  for (const key of crossRows) {
    const cells: string[] = [];
    const strengths: number[] = [];
    for (const b of BETS) {
      const s = table[b.name][key];
      const refRoi = roi(refs[b.name]);
      const r = roi(s);
      const ratio = refRoi > 0 ? r / refRoi : 0;
      if (s.recommendedR >= 15) strengths.push(ratio);
      const marker = s.recommendedR < 15 ? '⚠️' : ratio >= 1.5 ? '⭐' : ratio >= 1.3 ? '◎' : ratio >= 0.9 ? '-' : '❌';
      cells.push(`${r.toFixed(1)}% (${ratio.toFixed(2)}x) ${marker}`);
    }
    // 総合判定
    let overall = '-';
    const validStrengths = strengths.filter((x) => x > 0);
    if (validStrengths.length === 3 && validStrengths.every((x) => x >= 1.5)) overall = '🚀 全券種で強力';
    else if (validStrengths.some((x) => x >= 1.5) && validStrengths.every((x) => x >= 1.0)) overall = '◎ 部分的に効く';
    else if (validStrengths[0] >= 1.5 && validStrengths.length >= 1) overall = '⭐ 馬連のみ強力';
    else overall = '- 明確な効果なし';
    const pLabel = PATTERNS.find((x) => x.key === key)?.label ?? key;
    mp(`| **${key}** (${pLabel}) | ${cells[0]} | ${cells[1]} | ${cells[2]} | ${overall} |`);
  }
  mp('');

  // 実装戦略
  mp(`## B. 実装戦略の判定`);
  mp('');
  const ma2A = roi(table['馬連本命']['2-A']);
  const um2A = roi(table['馬単本命']['2-A']);
  const wi2A = roi(table['ワイド堅実']['2-A']);
  const ma2ARatio = roi(refs['馬連本命']) > 0 ? ma2A / roi(refs['馬連本命']) : 0;
  const um2ARatio = roi(refs['馬単本命']) > 0 ? um2A / roi(refs['馬単本命']) : 0;
  const wi2ARatio = roi(refs['ワイド堅実']) > 0 ? wi2A / roi(refs['ワイド堅実']) : 0;

  if (um2ARatio >= 1.3 && wi2ARatio >= 1.3 && table['馬単本命']['2-A'].recommendedR >= 15 && table['ワイド堅実']['2-A'].recommendedR >= 15) {
    mp(`**🚀 全券種強化型 を推奨**`);
    mp('');
    mp(`2-A マッチ時、3券種すべてで単軸平均比 1.3x 以上:`);
    mp(`- 馬連: ${ma2ARatio.toFixed(2)}x / 馬単: ${um2ARatio.toFixed(2)}x / ワイド: ${wi2ARatio.toFixed(2)}x`);
    mp(`- 実装: \`shouldBoostAll(race)\` で一括判定、マッチ時に全券種2倍`);
  } else if (ma2ARatio >= 1.5 && (um2ARatio < 1.3 || wi2ARatio < 1.3)) {
    mp(`**⭐ 馬連特化型 を推奨**`);
    mp('');
    mp(`2-A は馬連でのみ強い効果 (馬連 ${ma2ARatio.toFixed(2)}x、他は ${um2ARatio.toFixed(2)}x / ${wi2ARatio.toFixed(2)}x)`);
    mp(`- 馬単・ワイドは現状の Phase 2G ロジックを維持`);
    mp(`- 馬連のみ \`shouldRecommendUmarenStrong(race)\` を追加`);
    mp(`- 期待効果: 馬連 ROI +59pt (前回シミュレーション値)`);
  } else {
    mp(`**- 判定保留** — 複合効果は限定的。サンプル拡大後に再検証。`);
  }
  mp('');

  // 注意点
  mp(`## C. 注意点`);
  mp('');
  mp(`### 券種間の推奨重複`);
  mp('');
  mp(`| 重複パターン | 重複R | 馬連の中 | 馬単の中 | ワイドの中 |`);
  mp(`|---|---|---|---|---|`);
  const rM = recSets['馬連本命'].size;
  const rU = recSets['馬単本命'].size;
  const rW = recSets['ワイド堅実'].size;
  mp(`| 馬連 ∩ 馬単 | ${overlap_UM} | ${((overlap_UM / rM) * 100).toFixed(1)}% | ${((overlap_UM / rU) * 100).toFixed(1)}% | — |`);
  mp(`| 馬連 ∩ ワイド | ${overlap_UW} | ${((overlap_UW / rM) * 100).toFixed(1)}% | — | ${((overlap_UW / rW) * 100).toFixed(1)}% |`);
  mp(`| 馬単 ∩ ワイド | ${overlap_MW} | — | ${((overlap_MW / rU) * 100).toFixed(1)}% | ${((overlap_MW / rW) * 100).toFixed(1)}% |`);
  mp(`| **3券種 all** | **${overlap_ALL3}** | - | - | - |`);
  mp('');

  mp(`### 2-A マッチレースでの券種重複`);
  mp('');
  mp(`| 指標 | 値 |`);
  mp(`|---|---|`);
  mp(`| 2-A マッチ + 馬連推奨 | ${twoA_umaren} R |`);
  mp(`| 2-A マッチ + 馬連 + 馬単 | ${twoA_umatan} R |`);
  mp(`| 2-A マッチ + 馬連 + ワイド | ${twoA_wide} R |`);
  mp(`| 2-A マッチ + **3券種 all** | **${twoA_all3} R** |`);
  mp('');
  const umatanRatio = twoA_umaren > 0 ? (twoA_umatan / twoA_umaren) * 100 : 0;
  const wideRatio = twoA_umaren > 0 ? (twoA_wide / twoA_umaren) * 100 : 0;
  mp(`→ 2-A マッチレースのうち、${umatanRatio.toFixed(0)}% が馬単も推奨、${wideRatio.toFixed(0)}% がワイドも推奨`);
  mp('');

  // 3-B 月別
  mp(`## 3-B 最強シグナルの月別安定性 (馬連)`);
  mp('');
  mp(`| 月 | 推奨R | 的中R | ROI |`);
  mp(`|---|---|---|---|`);
  const p3bRows = Array.from(p3bMonth.entries()).sort(([a], [b]) => a.localeCompare(b));
  for (const [mth, s] of p3bRows) {
    mp(`| ${mth} | ${s.recommendedR} | ${s.hits} | ${roi(s).toFixed(1)}% |`);
  }
  mp('');
  const monthRois = p3bRows.filter(([, s]) => s.recommendedR >= 5).map(([, s]) => roi(s));
  if (monthRois.length >= 2) {
    const mx = Math.max(...monthRois);
    const mn = Math.min(...monthRois);
    if (mx - mn > 500) {
      mp(`⚠️ 月別 ROI の振れ幅 ${(mx - mn).toFixed(0)}pt — 時期依存の可能性あり`);
    } else {
      mp(`✅ 月別 ROI は比較的安定 (範囲 ${mn.toFixed(0)}% 〜 ${mx.toFixed(0)}%)`);
    }
  } else {
    mp(`月別 5R 以上のサンプルが ${monthRois.length} 月しかなく、時系列安定性の判断は保留`);
  }
  mp('');

  // サマリーD
  mp(`## D. 次の検証候補`);
  mp('');
  mp(`1. **本番実装プロトタイプ**: 判定結果に応じて「全券種強化型」or「馬連特化型」の実装案を作成`);
  mp(`2. **競馬場別細分化**: 2-A マッチ 51R のうち、どの競馬場が ROI を牽引しているか特定`);
  mp(`3. **EV/スコア閾値緩和**: 2-A 条件下ではスコア≥60 に緩めて参加Rを増やせるか検証`);
  mp('');

  mp(`---`);
  mp(`*再実行: \`pnpm tsx scripts/cross_axis_cross_type.ts\`*`);

  await fs.writeFile(REPORT, md.join('\n'), 'utf-8');

  // ---- コンソール ----
  console.log('='.repeat(96));
  console.log('  クロス軸 券種横展開');
  console.log('='.repeat(96));
  for (const b of BETS) {
    const ref = refs[b.name];
    console.log(`\n[${b.name}] 参照 ${ref.recommendedR}R / ROI ${roi(ref).toFixed(1)}%`);
    for (const p of PATTERNS) {
      const s = table[b.name][p.key];
      const r = roi(s);
      const ratio = roi(ref) > 0 ? r / roi(ref) : 0;
      const ratioStr = '(' + ratio.toFixed(2) + 'x)';
      console.log(`  ${p.key.padEnd(3)} ${p.label.padEnd(20)} ${s.recommendedR.toString().padStart(3)}R / 的中${s.hits.toString().padStart(2)} / ROI ${r.toFixed(1).padStart(6)}% ${ratioStr} ${judgeRatio(r, roi(ref), s.recommendedR)}`);
    }
  }
  console.log('');
  console.log(`券種重複: 馬連∩馬単=${overlap_UM} / 馬連∩ワイド=${overlap_UW} / 馬単∩ワイド=${overlap_MW} / 3券種=${overlap_ALL3}`);
  console.log(`2-A 51R中: 馬連のみ / +馬単 ${twoA_umatan} / +ワイド ${twoA_wide} / 3券種 ${twoA_all3}`);
  console.log('');
  console.log(`Markdown: ${REPORT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
