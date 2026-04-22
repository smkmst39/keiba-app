// ==========================================
// 多軸ROI俯瞰分析 (Phase 2G ハイブリッド戦略適用時)
//
// 10軸で集計:
//   1. 距離 / 2. 芝ダ / 3. コース回り / 4. 頭数 / 5. 年齢条件
//   6. 斤量ルール / 7. 馬場状態 / 8. 天気 / 9. レース時刻 / 10. 性別限定
//
// 本番コード変更なし。出力は scripts/verification/multi_axis_roi_report.md
//
// 実行: pnpm tsx scripts/multi_axis_analysis.ts
// ==========================================

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { VerificationData } from '../lib/scraper/types';

const DIR = path.resolve(__dirname, 'verification');
const REPORT = path.join(DIR, 'multi_axis_roi_report.md');

// ----------------------------------------
// Phase 2G ハイブリッド除外ロジック (本番と同一)
// ----------------------------------------

function isExcludedForUmarenUmatan(raceClass?: string): boolean {
  if (!raceClass) return false;
  return /1勝|500万|2勝|1000万/.test(raceClass);
}
function isExcludedForWide(raceClass?: string): boolean {
  if (!raceClass) return false;
  return /1勝|500万/.test(raceClass);
}

// ----------------------------------------
// 判定 + 配当
// ----------------------------------------

type Prediction = VerificationData['predictions'][number];

function sortedByEV(preds: Prediction[]): Prediction[] {
  return [...preds].filter((p) => p.odds > 0).sort((a, b) => b.ev - a.ev);
}

const sameSet = (a: number[], b: number[]): boolean =>
  a.length === b.length && [...a].sort((x, y) => x - y).join(',') === [...b].sort((x, y) => x - y).join(',');
const sameSeq = (a: number[], b: number[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

type BetOutcome = { cost: number; payout: number; hit: boolean; participated: boolean };

/** 馬連本命: C1/C2除外 + 両馬EV≥1.00 + スコア≥65 */
function betUmarenHonmei(vd: VerificationData, raceClass?: string): BetOutcome {
  if (isExcludedForUmarenUmatan(raceClass)) return { cost: 0, payout: 0, hit: false, participated: false };
  const s = sortedByEV(vd.predictions);
  if (s.length < 2) return { cost: 0, payout: 0, hit: false, participated: false };
  if (s[0].ev < 1.00 || s[1].ev < 1.00 || s[0].score < 65 || s[1].score < 65) {
    return { cost: 0, payout: 0, hit: false, participated: false };
  }
  let pay = 0, hit = false;
  for (const u of vd.results.payouts.umaren) {
    if (sameSet([s[0].horseId, s[1].horseId], u.combination.split('-').map(Number))) {
      pay = u.payout; hit = true; break;
    }
  }
  return { cost: 100, payout: pay, hit, participated: true };
}

/** 馬単本命: C1/C2除外 + 両馬EV≥1.00 + スコア≥65 + オッズ≤15 (BOX 2点) */
function betUmatanHonmei(vd: VerificationData, raceClass?: string): BetOutcome {
  if (isExcludedForUmarenUmatan(raceClass)) return { cost: 0, payout: 0, hit: false, participated: false };
  const s = sortedByEV(vd.predictions);
  if (s.length < 2) return { cost: 0, payout: 0, hit: false, participated: false };
  if (s[0].ev < 1.00 || s[1].ev < 1.00 || s[0].score < 65 || s[1].score < 65 || s[0].odds > 15 || s[1].odds > 15) {
    return { cost: 0, payout: 0, hit: false, participated: false };
  }
  let pay = 0, hit = false;
  for (const perm of [[s[0].horseId, s[1].horseId], [s[1].horseId, s[0].horseId]]) {
    for (const u of vd.results.payouts.umatan ?? []) {
      if (sameSeq(perm, u.combination.split('-').map(Number))) { pay += u.payout; hit = true; break; }
    }
  }
  return { cost: 200, payout: pay, hit, participated: true };
}

/** ワイド堅実: C1除外 + 両馬EV≥1.02 + スコア≥65 + オッズ≤10 */
function betWideKenjitsu(vd: VerificationData, raceClass?: string): BetOutcome {
  if (isExcludedForWide(raceClass)) return { cost: 0, payout: 0, hit: false, participated: false };
  const s = sortedByEV(vd.predictions);
  if (s.length < 2) return { cost: 0, payout: 0, hit: false, participated: false };
  if (s[0].ev < 1.02 || s[1].ev < 1.02 || s[0].score < 65 || s[1].score < 65 || s[0].odds > 10 || s[1].odds > 10) {
    return { cost: 0, payout: 0, hit: false, participated: false };
  }
  let pay = 0, hit = false;
  for (const w of vd.results.payouts.wide ?? []) {
    if (sameSet([s[0].horseId, s[1].horseId], w.combination.split('-').map(Number))) {
      pay = w.payout; hit = true; break;
    }
  }
  return { cost: 100, payout: pay, hit, participated: true };
}

// ----------------------------------------
// Stats
// ----------------------------------------

type Stats = { races: number; participated: number; hits: number; cost: number; payout: number };
const empty = (): Stats => ({ races: 0, participated: 0, hits: 0, cost: 0, payout: 0 });
const roi = (s: Stats): number => s.cost > 0 ? (s.payout / s.cost) * 100 : 0;
const pct = (n: number, d: number): string => d === 0 ? 'N/A' : `${((n / d) * 100).toFixed(1)}%`;

type Triple = { umaren: Stats; umatan: Stats; wide: Stats };
const emptyTriple = (): Triple => ({ umaren: empty(), umatan: empty(), wide: empty() });

function accumulate(s: Stats, o: BetOutcome): void {
  s.races++;
  if (o.participated) {
    s.participated++;
    s.cost   += o.cost;
    s.payout += o.payout;
    if (o.hit) s.hits++;
  }
}

function triplePt(t: Triple): number {
  return roi(t.umaren) + roi(t.umatan) + roi(t.wide);
}

function verdict(totalPt: number, umarenRoi: number, sample: number): string {
  if (sample < 20) return 'サンプル不足';
  if (totalPt >= 600 || umarenRoi >= 250) return '⭐ 最良';
  if (totalPt >= 500) return '○ 良好';
  if (totalPt >= 400) return '- 普通';
  if (totalPt >= 300) return '⚠️ 注意';
  return '❌ 低調';
}

// ----------------------------------------
// 軸カテゴライザ
// ----------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getMeta(vd: any): any { return vd?.meta ?? {}; }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function classifyDistance(m: any): string {
  const d = m.distance ?? 0;
  if (d === 0) return '不明';
  if (d <= 1400) return '短距離 (〜1400m)';
  if (d <= 1800) return 'マイル (1400〜1800m)';
  if (d <= 2200) return '中距離 (1800〜2200m)';
  return '長距離 (2200m〜)';
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function classifySurface(m: any): string {
  return m.surface === 'dirt' ? 'ダート' : m.surface === 'turf' ? '芝' : '不明';
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function classifyCourseTurn(m: any): string {
  const t = m.courseTurn ?? '';
  if (t === '右') return '右回り';
  if (t === '左') return '左回り';
  if (t === '直線') return '直線';
  return '不明';
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function classifyHeadCount(m: any): string {
  const n = m.headCount ?? 0;
  if (n === 0) return '不明';
  if (n <= 10) return '少頭数 (〜10頭)';
  if (n <= 14) return '中頭数 (11〜14頭)';
  return '多頭数 (15頭〜)';
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function classifyAge(m: any): string {
  const a = m.ageLimit ?? '';
  if (!a) return '不明';
  if (/2歳/.test(a)) return '2歳';
  if (/3歳以上/.test(a)) return '3歳以上';
  if (/3歳/.test(a)) return '3歳';
  if (/4歳以上/.test(a)) return '4歳以上';
  return a;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function classifyHandicap(m: any): string {
  const h = m.handicap ?? '';
  return h || '不明';
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function classifyTrackCondition(m: any): string {
  const t = m.trackCondition ?? '';
  return t || '不明';
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function classifyWeather(m: any): string {
  const w = m.weather ?? '';
  return w || '不明';
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function classifyStartTime(m: any): string {
  const s = m.startTime ?? '';
  if (!s) return '不明';
  const [h] = s.split(':').map(Number);
  if (h < 11) return '早朝 (〜11:00)';
  if (h < 14) return '昼 (11:00〜14:00)';
  if (h < 17) return 'メイン (14:00〜17:00)';
  return '夜 (17:00〜)';
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function classifySex(m: any): string {
  return m.sexLimit === '牝' ? '牝馬限定' : '制限なし';
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function classifyTrackBySurface(m: any): string {
  const t = m.trackCondition ?? '';
  const s = m.surface === 'dirt' ? 'ダ' : '芝';
  return t ? `${s}${t}` : '不明';
}

const AXES: Array<{ key: string; label: string; fn: (m: any, vd: any) => string; order?: string[] }> = [
  { key: 'distance',  label: '距離別',        fn: classifyDistance,        order: ['短距離 (〜1400m)', 'マイル (1400〜1800m)', '中距離 (1800〜2200m)', '長距離 (2200m〜)', '不明'] },
  { key: 'surface',   label: '芝/ダ別',       fn: classifySurface,         order: ['芝', 'ダート', '不明'] },
  { key: 'turn',      label: 'コース回り別',   fn: classifyCourseTurn,      order: ['右回り', '左回り', '直線', '不明'] },
  { key: 'head',      label: '頭数別',        fn: classifyHeadCount,       order: ['少頭数 (〜10頭)', '中頭数 (11〜14頭)', '多頭数 (15頭〜)', '不明'] },
  { key: 'age',       label: '年齢条件別',    fn: classifyAge,             order: ['2歳', '3歳', '3歳以上', '4歳以上', '不明'] },
  { key: 'handicap',  label: '斤量ルール別',  fn: classifyHandicap,        order: ['ハンデ', '馬齢', '別定', '定量', '不明'] },
  { key: 'track',     label: '馬場状態別',    fn: classifyTrackConditionByCombined, order: ['芝良', '芝稍重', '芝重', '芝不良', 'ダ良', 'ダ稍重', 'ダ重', 'ダ不良', '不明'] },
  { key: 'weather',   label: '天気別',        fn: classifyWeather,         order: ['晴', '曇', '小雨', '雨', '雪', '不明'] },
  { key: 'time',      label: 'レース時刻別',  fn: classifyStartTime,       order: ['早朝 (〜11:00)', '昼 (11:00〜14:00)', 'メイン (14:00〜17:00)', '夜 (17:00〜)', '不明'] },
  { key: 'sex',       label: '性別限定別',    fn: classifySex,             order: ['牝馬限定', '制限なし'] },
];

// track は芝/ダで別集計したいのでラッパー
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function classifyTrackConditionByCombined(m: any): string {
  return classifyTrackBySurface(m);
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
  if (all.length === 0) { console.error('no data'); process.exit(1); }

  // 軸ごとの集計: Map<category, Triple>
  const byAxis: Record<string, Map<string, Triple>> = {};
  for (const a of AXES) byAxis[a.key] = new Map();

  // 全体合計 (参照値)
  const overall: Triple = emptyTriple();

  for (const vd of all) {
    if (vd.predictions.length < 2 || vd.results.results.length === 0) continue;
    const m = getMeta(vd);
    const rc = m.raceClass;
    const uOut = betUmarenHonmei(vd, rc);
    const tOut = betUmatanHonmei(vd, rc);
    const wOut = betWideKenjitsu(vd, rc);

    accumulate(overall.umaren, uOut);
    accumulate(overall.umatan, tOut);
    accumulate(overall.wide,   wOut);

    for (const a of AXES) {
      const cat = a.fn(m, vd);
      let t = byAxis[a.key].get(cat);
      if (!t) { t = emptyTriple(); byAxis[a.key].set(cat, t); }
      accumulate(t.umaren, uOut);
      accumulate(t.umatan, tOut);
      accumulate(t.wide,   wOut);
    }
  }

  // ---- 出力 ----
  const md: string[] = [];
  const mp = (s = ''): void => { md.push(s); };

  mp(`# 多軸ROI俯瞰分析 (Phase 2G ハイブリッド適用時)`);
  mp('');
  mp(`- 生成日時: ${new Date().toISOString()}`);
  mp(`- 対象: **${all.length} R** (Phase 2G 再収集データ)`);
  mp(`- 戦略: Phase 2G ハイブリッド除外 (馬連/馬単: C1+C2除外、ワイド: C1のみ除外)`);
  mp('');
  mp(`## 全体参照値`);
  mp('');
  mp(`| 券種 | 参加R | 的中 | ROI |`);
  mp(`|---|---|---|---|`);
  mp(`| 馬連本命 | ${overall.umaren.participated} | ${overall.umaren.hits} | ${roi(overall.umaren).toFixed(1)}% |`);
  mp(`| 馬単本命 | ${overall.umatan.participated} | ${overall.umatan.hits} | ${roi(overall.umatan).toFixed(1)}% |`);
  mp(`| ワイド堅実 | ${overall.wide.participated} | ${overall.wide.hits} | ${roi(overall.wide).toFixed(1)}% |`);
  mp(`| 合計pt | — | — | **${triplePt(overall).toFixed(1)}** |`);
  mp('');

  // 各軸のレポート
  const axisLabels: Record<string, { categories: Array<{ cat: string; triple: Triple; sample: number }> }> = {};
  for (const a of AXES) {
    const map = byAxis[a.key];
    const order = a.order ?? Array.from(map.keys()).sort();
    const entries: Array<{ cat: string; triple: Triple; sample: number }> = [];
    for (const cat of order) {
      const t = map.get(cat);
      if (!t) continue;
      // 参加R = umaren.races = umatan.races = wide.races (全レース同じ)
      const sample = t.umaren.races;
      entries.push({ cat, triple: t, sample });
    }
    // 未知カテゴリも拾う
    for (const [cat, t] of Array.from(map.entries())) {
      if (!order.includes(cat)) entries.push({ cat, triple: t, sample: t.umaren.races });
    }
    axisLabels[a.key] = { categories: entries };

    mp(`<details>`);
    mp(`<summary><h2>${a.label}</h2></summary>`);
    mp('');
    mp(`| カテゴリ | レースR | 馬連(参加/的中/ROI) | 馬単(参加/的中/ROI) | ワイド(参加/的中/ROI) | 合計pt | 判定 |`);
    mp(`|---|---|---|---|---|---|---|`);
    for (const e of entries) {
      const t = e.triple;
      const pt = triplePt(t);
      const v = verdict(pt, roi(t.umaren), e.sample);
      const fmt = (s: Stats): string =>
        s.participated === 0 ? '—' : `${s.participated}/${s.hits}/${roi(s).toFixed(1)}%`;
      mp(`| ${e.cat} | ${e.sample} | ${fmt(t.umaren)} | ${fmt(t.umatan)} | ${fmt(t.wide)} | ${pt.toFixed(1)} | ${v} |`);
    }
    mp('');
    mp(`</details>`);
    mp('');
  }

  // ----------------------------------------
  // 俯瞰サマリー
  // ----------------------------------------
  mp(`## 🔭 俯瞰サマリー`);
  mp('');

  // 全カテゴリを収集して判定ラベル別に整理
  type Hit = { axis: string; cat: string; triple: Triple; sample: number; pt: number };
  const allHits: Hit[] = [];
  for (const a of AXES) {
    for (const e of axisLabels[a.key].categories) {
      if (e.sample < 20) continue;
      allHits.push({ axis: a.label, cat: e.cat, triple: e.triple, sample: e.sample, pt: triplePt(e.triple) });
    }
  }

  // サマリー A: 除外すべき条件候補 (低ROI)
  const excludeCandidates = [...allHits]
    .filter((h) => h.pt < 400 || roi(h.triple.umaren) < 100)
    .sort((a, b) => a.pt - b.pt)
    .slice(0, 7);

  mp(`### A. 除外候補 (低ROI、Phase 2G で新たに除外検討に値する条件)`);
  mp('');
  if (excludeCandidates.length === 0) {
    mp(`- 該当なし (サンプル≥20Rで pt<400 / 馬連ROI<100% を満たすカテゴリなし)`);
  } else {
    mp(`| 優先 | 軸 | カテゴリ | 参加R | 馬連ROI | 合計pt | 備考 |`);
    mp(`|---|---|---|---|---|---|---|`);
    excludeCandidates.forEach((h, i) => {
      const umarenRoi = roi(h.triple.umaren);
      const note = umarenRoi < 50 ? '馬連的中ゼロ級' : h.pt < 200 ? '全券種低調' : '要深掘り';
      mp(`| ${i + 1} | ${h.axis} | ${h.cat} | ${h.sample} | ${umarenRoi.toFixed(1)}% | ${h.pt.toFixed(1)} | ${note} |`);
    });
  }
  mp('');

  // サマリー B: 強化候補 (高ROI)
  const boostCandidates = [...allHits]
    .filter((h) => h.pt >= 550 || roi(h.triple.umaren) >= 300)
    .sort((a, b) => b.pt - a.pt)
    .slice(0, 7);

  mp(`### B. 強化候補 (高ROI、積極的に買うべき条件)`);
  mp('');
  if (boostCandidates.length === 0) {
    mp(`- 該当なし`);
  } else {
    mp(`| 優先 | 軸 | カテゴリ | 参加R | 馬連ROI | 合計pt | 備考 |`);
    mp(`|---|---|---|---|---|---|---|`);
    boostCandidates.forEach((h, i) => {
      const umarenRoi = roi(h.triple.umaren);
      const note = umarenRoi >= 400 ? '馬連超高ROI' : h.pt >= 700 ? '全券種高ROI' : '高ROIゾーン';
      mp(`| ${i + 1} | ${h.axis} | ${h.cat} | ${h.sample} | ${umarenRoi.toFixed(1)}% | ${h.pt.toFixed(1)} | ${note} |`);
    });
  }
  mp('');

  // サマリー C: 意外な発見
  mp(`### C. 意外な発見`);
  mp('');
  const findings: string[] = [];

  // 障害戦の有無チェック: surface ダ以外
  // weather 雨・雪 vs 晴の差
  const weatherMap = byAxis.weather;
  const sunny = weatherMap.get('晴');
  const cloudy = weatherMap.get('曇');
  if (sunny && cloudy && sunny.umaren.races >= 20 && cloudy.umaren.races >= 20) {
    const dS = triplePt(sunny), dC = triplePt(cloudy);
    if (Math.abs(dS - dC) >= 100) {
      findings.push(`**天気差が大**: 晴 ${dS.toFixed(0)}pt vs 曇 ${dC.toFixed(0)}pt (差 ${Math.abs(dS - dC).toFixed(0)}pt)`);
    }
  }

  // 頭数別の差
  const headMap = byAxis.head;
  const smallH = headMap.get('少頭数 (〜10頭)');
  const bigH = headMap.get('多頭数 (15頭〜)');
  if (smallH && bigH && smallH.umaren.races >= 20 && bigH.umaren.races >= 20) {
    const dS = triplePt(smallH), dB = triplePt(bigH);
    if (Math.abs(dS - dB) >= 100) {
      findings.push(`**頭数差が大**: 少頭数 ${dS.toFixed(0)}pt vs 多頭数 ${dB.toFixed(0)}pt (差 ${Math.abs(dS - dB).toFixed(0)}pt)`);
    }
  }

  // 距離別の極端
  const distMap = byAxis.distance;
  const distEntries = Array.from(distMap.entries()).filter(([, t]) => t.umaren.races >= 20);
  if (distEntries.length >= 2) {
    const sorted = distEntries.sort((a, b) => triplePt(b[1]) - triplePt(a[1]));
    const best = sorted[0], worst = sorted[sorted.length - 1];
    const diff = triplePt(best[1]) - triplePt(worst[1]);
    if (diff >= 150) {
      findings.push(`**距離による差が大**: ${best[0]} ${triplePt(best[1]).toFixed(0)}pt vs ${worst[0]} ${triplePt(worst[1]).toFixed(0)}pt (差 ${diff.toFixed(0)}pt)`);
    }
  }

  // ハンデ戦 vs 馬齢/別定
  const hMap = byAxis.handicap;
  const hande = hMap.get('ハンデ');
  const baiw  = hMap.get('馬齢');
  if (hande && baiw && hande.umaren.races >= 20 && baiw.umaren.races >= 20) {
    const d = triplePt(hande) - triplePt(baiw);
    if (Math.abs(d) >= 100) {
      findings.push(`**ハンデ vs 馬齢**: ハンデ ${triplePt(hande).toFixed(0)}pt vs 馬齢 ${triplePt(baiw).toFixed(0)}pt (差 ${d.toFixed(0)}pt)`);
    }
  }

  // 牝馬限定 vs 制限なし
  const sexMap = byAxis.sex;
  const hinba = sexMap.get('牝馬限定');
  const normal = sexMap.get('制限なし');
  if (hinba && normal && hinba.umaren.races >= 20 && normal.umaren.races >= 20) {
    const d = triplePt(hinba) - triplePt(normal);
    if (Math.abs(d) >= 100) {
      findings.push(`**牝馬限定 vs 制限なし**: ${triplePt(hinba).toFixed(0)}pt vs ${triplePt(normal).toFixed(0)}pt (差 ${d.toFixed(0)}pt)`);
    }
  }

  if (findings.length === 0) {
    mp(`- 明確な外れ値・想定外のパターンは検出されず`);
  } else {
    findings.forEach((f) => mp(`- ${f}`));
  }
  mp('');

  // サマリー D: 次の検証候補
  mp(`### D. 次の検証候補 (推奨度順)`);
  mp('');
  mp(`以下は本俯瞰から推奨される深掘り項目:`);
  mp('');

  const nextSteps: Array<{ pri: number; title: string; why: string; est: string }> = [];

  // 除外候補トップから派生
  if (excludeCandidates.length > 0) {
    const top = excludeCandidates[0];
    nextSteps.push({
      pri: 1,
      title: `${top.axis}:「${top.cat}」除外の効果検証`,
      why: `${top.sample}R, 馬連ROI ${roi(top.triple.umaren).toFixed(1)}%, 合計 ${top.pt.toFixed(0)}pt と明確に低調。除外で全体ROI向上の可能性`,
      est: `+10〜30pt の改善可能性 (サンプル数依存)`,
    });
  }
  // 強化候補から派生
  if (boostCandidates.length > 0) {
    const top = boostCandidates[0];
    nextSteps.push({
      pri: 2,
      title: `${top.axis}:「${top.cat}」での条件緩和`,
      why: `${top.sample}R, 馬連ROI ${roi(top.triple.umaren).toFixed(1)}%, 合計 ${top.pt.toFixed(0)}pt。条件緩和 (例: スコア≥60へ) で参加R増やせる可能性`,
      est: `参加R +20〜50 / 合計ROI +5〜15pt`,
    });
  }
  // クロス集計候補
  nextSteps.push({
    pri: 3,
    title: 'クロス軸分析 (距離 × 馬場状態 など)',
    why: '単軸で見えない交互作用を検出。特に「ダート+重馬場+少頭数」のような複合シグナル',
    est: '新たな高ROIゾーン発見の可能性',
  });

  mp(`| 優先 | 検証候補 | 理由 | 期待改善 |`);
  mp(`|---|---|---|---|`);
  nextSteps.forEach((s) => {
    mp(`| ${s.pri} | ${s.title} | ${s.why} | ${s.est} |`);
  });
  mp('');

  mp(`---`);
  mp(`*再実行: \`pnpm tsx scripts/multi_axis_analysis.ts\`*`);

  await fs.writeFile(REPORT, md.join('\n'), 'utf-8');
  console.log(`Markdown saved: ${REPORT}`);

  // ---- 簡易コンソール出力 ----
  console.log('');
  console.log('='.repeat(88));
  console.log(`  多軸 ROI 俯瞰分析  (Phase 2G, ${all.length}R)`);
  console.log('='.repeat(88));
  console.log(`全体参照: 馬連 ${roi(overall.umaren).toFixed(1)}% / 馬単 ${roi(overall.umatan).toFixed(1)}% / ワイド ${roi(overall.wide).toFixed(1)}% / 合計 ${triplePt(overall).toFixed(1)}pt`);
  console.log('');
  console.log('▼ 除外候補 Top 5:');
  excludeCandidates.slice(0, 5).forEach((h, i) => {
    console.log(`  ${i + 1}. [${h.axis}] ${h.cat}: ${h.sample}R / 馬連${roi(h.triple.umaren).toFixed(1)}% / 合計${h.pt.toFixed(0)}pt`);
  });
  console.log('');
  console.log('▼ 強化候補 Top 5:');
  boostCandidates.slice(0, 5).forEach((h, i) => {
    console.log(`  ${i + 1}. [${h.axis}] ${h.cat}: ${h.sample}R / 馬連${roi(h.triple.umaren).toFixed(1)}% / 合計${h.pt.toFixed(0)}pt`);
  });
  console.log('');
  console.log('▼ 意外な発見:');
  findings.forEach((f) => console.log(`  - ${f}`));
}

main().catch((e) => { console.error(e); process.exit(1); });
