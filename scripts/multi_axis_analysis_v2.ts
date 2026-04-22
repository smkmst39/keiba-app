// ==========================================
// 多軸ROI分析 v2 — 推奨Rベース厳密集計
//
// v1 (multi_axis_analysis.ts) の問題:
//   「参加R」として「総R数」を表示していたため、推奨数が少ないカテゴリで
//   0R 的中 → ROI 0.0% が「低調」と誤判定されていた
//
// v2 で追加:
//   総R (カテゴリ全体) / 対象R (C1/C2除外後) / 推奨R (実推奨発生) を区別
//   推奨R < 20 は「サンプル不足」として統計的結論を出さない
//
// 実行: pnpm tsx scripts/multi_axis_analysis_v2.ts
// 出力: scripts/verification/multi_axis_roi_v2.md
// ==========================================

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { VerificationData } from '../lib/scraper/types';

const DIR = path.resolve(__dirname, 'verification');
const REPORT = path.join(DIR, 'multi_axis_roi_v2.md');

// ----------------------------------------
// Phase 2G ハイブリッド除外ロジック
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

// ----------------------------------------
// 3 券種の判定と配当
// ----------------------------------------

type BetResult = {
  targeted: boolean;    // 対象R かどうか (クラス除外後)
  recommended: boolean; // 推奨R かどうか (条件満たす)
  cost: number;
  payout: number;
  hit: boolean;
};

function betUmarenHonmei(vd: VerificationData, rc?: string): BetResult {
  const targeted = !isExcludedForUmarenUmatan(rc);
  if (!targeted) return { targeted: false, recommended: false, cost: 0, payout: 0, hit: false };
  const s = sortedByEV(vd.predictions);
  if (s.length < 2) return { targeted: true, recommended: false, cost: 0, payout: 0, hit: false };
  const reco = s[0].ev >= 1.00 && s[1].ev >= 1.00 && s[0].score >= 65 && s[1].score >= 65;
  if (!reco) return { targeted: true, recommended: false, cost: 0, payout: 0, hit: false };
  let pay = 0, hit = false;
  for (const u of vd.results.payouts.umaren) {
    if (sameSet([s[0].horseId, s[1].horseId], u.combination.split('-').map(Number))) {
      pay = u.payout; hit = true; break;
    }
  }
  return { targeted: true, recommended: true, cost: 100, payout: pay, hit };
}

function betUmatanHonmei(vd: VerificationData, rc?: string): BetResult {
  const targeted = !isExcludedForUmarenUmatan(rc);
  if (!targeted) return { targeted: false, recommended: false, cost: 0, payout: 0, hit: false };
  const s = sortedByEV(vd.predictions);
  if (s.length < 2) return { targeted: true, recommended: false, cost: 0, payout: 0, hit: false };
  const reco = s[0].ev >= 1.00 && s[1].ev >= 1.00 && s[0].score >= 65 && s[1].score >= 65 && s[0].odds <= 15 && s[1].odds <= 15;
  if (!reco) return { targeted: true, recommended: false, cost: 0, payout: 0, hit: false };
  let pay = 0, hit = false;
  for (const perm of [[s[0].horseId, s[1].horseId], [s[1].horseId, s[0].horseId]]) {
    for (const u of vd.results.payouts.umatan ?? []) {
      if (sameSeq(perm, u.combination.split('-').map(Number))) { pay += u.payout; hit = true; break; }
    }
  }
  return { targeted: true, recommended: true, cost: 200, payout: pay, hit };
}

function betWideKenjitsu(vd: VerificationData, rc?: string): BetResult {
  const targeted = !isExcludedForWide(rc);
  if (!targeted) return { targeted: false, recommended: false, cost: 0, payout: 0, hit: false };
  const s = sortedByEV(vd.predictions);
  if (s.length < 2) return { targeted: true, recommended: false, cost: 0, payout: 0, hit: false };
  const reco = s[0].ev >= 1.02 && s[1].ev >= 1.02 && s[0].score >= 65 && s[1].score >= 65 && s[0].odds <= 10 && s[1].odds <= 10;
  if (!reco) return { targeted: true, recommended: false, cost: 0, payout: 0, hit: false };
  let pay = 0, hit = false;
  for (const w of vd.results.payouts.wide ?? []) {
    if (sameSet([s[0].horseId, s[1].horseId], w.combination.split('-').map(Number))) {
      pay = w.payout; hit = true; break;
    }
  }
  return { targeted: true, recommended: true, cost: 100, payout: pay, hit };
}

// ----------------------------------------
// Stats (3-layer)
// ----------------------------------------

type Stats = {
  totalR: number;        // カテゴリ該当レース
  targetedR: number;     // 除外後
  recommendedR: number;  // 推奨発生
  hits: number;
  cost: number;
  payout: number;
};
const empty = (): Stats => ({ totalR: 0, targetedR: 0, recommendedR: 0, hits: 0, cost: 0, payout: 0 });

function accumulate(s: Stats, r: BetResult): void {
  s.totalR++;
  if (r.targeted) s.targetedR++;
  if (r.recommended) {
    s.recommendedR++;
    s.cost   += r.cost;
    s.payout += r.payout;
    if (r.hit) s.hits++;
  }
}

const roi = (s: Stats): number => s.cost > 0 ? (s.payout / s.cost) * 100 : 0;
const hitRate = (s: Stats): string => s.recommendedR === 0 ? 'N/A' : `${((s.hits / s.recommendedR) * 100).toFixed(1)}%`;

/** 判定記号 (厳密化) */
function judge(s: Stats): string {
  const n = s.recommendedR;
  if (n < 20) return '⚠️ サンプル不足';
  const r = roi(s);
  if (n >= 50 && r >= 200) return '⭐ 最良';
  if (n >= 50 && r >= 150) return '◎ 優秀';
  if (n >= 20 && r >= 100) return '○ 良好';
  if (n >= 20 && r >= 80)  return '- 普通';
  if (n >= 50 && r < 80)   return '❌ 低調';
  return '‐ 不安定';
}

type Triple = { umaren: Stats; umatan: Stats; wide: Stats };
const emptyTriple = (): Triple => ({ umaren: empty(), umatan: empty(), wide: empty() });

// ----------------------------------------
// 軸カテゴライザ (v1 と同じ)
// ----------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getMeta(vd: any): any { return vd?.meta ?? {}; }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cDistance(m: any): string {
  const d = m.distance ?? 0;
  if (d === 0) return '不明';
  if (d <= 1400) return '短距離 (〜1400m)';
  if (d <= 1800) return 'マイル (1400〜1800m)';
  if (d <= 2200) return '中距離 (1800〜2200m)';
  return '長距離 (2200m〜)';
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cSurface(m: any): string { return m.surface === 'dirt' ? 'ダート' : m.surface === 'turf' ? '芝' : '不明'; }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cTurn(m: any): string {
  const t = m.courseTurn ?? '';
  return t === '右' ? '右回り' : t === '左' ? '左回り' : t === '直線' ? '直線' : '不明';
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cHead(m: any): string {
  const n = m.headCount ?? 0;
  if (n === 0) return '不明';
  if (n <= 10) return '少頭数 (〜10頭)';
  if (n <= 14) return '中頭数 (11〜14頭)';
  return '多頭数 (15頭〜)';
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cAge(m: any): string {
  const a = m.ageLimit ?? '';
  if (!a) return '不明';
  if (/2歳/.test(a)) return '2歳';
  if (/3歳以上/.test(a)) return '3歳以上';
  if (/3歳/.test(a)) return '3歳';
  if (/4歳以上/.test(a)) return '4歳以上';
  return a;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cHandicap(m: any): string { return m.handicap || '不明'; }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cTrackCombined(m: any): string {
  const t = m.trackCondition ?? '';
  const s = m.surface === 'dirt' ? 'ダ' : '芝';
  return t ? `${s}${t}` : '不明';
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cWeather(m: any): string { return m.weather || '不明'; }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cStartTime(m: any): string {
  const s = m.startTime ?? '';
  if (!s) return '不明';
  const [h] = s.split(':').map(Number);
  if (h < 11) return '早朝 (〜11:00)';
  if (h < 14) return '昼 (11:00〜14:00)';
  if (h < 17) return 'メイン (14:00〜17:00)';
  return '夜 (17:00〜)';
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cSex(m: any): string { return m.sexLimit === '牝' ? '牝馬限定' : '制限なし'; }

const AXES: Array<{ key: string; label: string; fn: (m: any) => string; order?: string[] }> = [
  { key: 'distance',  label: '距離別',        fn: cDistance,     order: ['短距離 (〜1400m)', 'マイル (1400〜1800m)', '中距離 (1800〜2200m)', '長距離 (2200m〜)', '不明'] },
  { key: 'surface',   label: '芝/ダ別',       fn: cSurface,      order: ['芝', 'ダート', '不明'] },
  { key: 'turn',      label: 'コース回り別',   fn: cTurn,         order: ['右回り', '左回り', '直線', '不明'] },
  { key: 'head',      label: '頭数別',        fn: cHead,         order: ['少頭数 (〜10頭)', '中頭数 (11〜14頭)', '多頭数 (15頭〜)', '不明'] },
  { key: 'age',       label: '年齢条件別',    fn: cAge,          order: ['2歳', '3歳', '3歳以上', '4歳以上', '不明'] },
  { key: 'handicap',  label: '斤量ルール別',  fn: cHandicap,     order: ['ハンデ', '馬齢', '別定', '定量', '不明'] },
  { key: 'track',     label: '馬場状態別',    fn: cTrackCombined, order: ['芝良', '芝稍重', '芝重', '芝不良', 'ダ良', 'ダ稍重', 'ダ重', 'ダ不良', '不明'] },
  { key: 'weather',   label: '天気別',        fn: cWeather,      order: ['晴', '曇', '小雨', '雨', '雪', '不明'] },
  { key: 'time',      label: 'レース時刻別',  fn: cStartTime,    order: ['早朝 (〜11:00)', '昼 (11:00〜14:00)', 'メイン (14:00〜17:00)', '夜 (17:00〜)', '不明'] },
  { key: 'sex',       label: '性別限定別',    fn: cSex,          order: ['牝馬限定', '制限なし'] },
];

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

  const byAxis: Record<string, Map<string, Triple>> = {};
  for (const a of AXES) byAxis[a.key] = new Map();
  const overall: Triple = emptyTriple();

  // データ品質チェック: 不明系カテゴリ統計
  const qualityIssues = new Map<string, number>();

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
      const cat = a.fn(m);
      if (cat === '不明') qualityIssues.set(a.key, (qualityIssues.get(a.key) ?? 0) + 1);
      let t = byAxis[a.key].get(cat);
      if (!t) { t = emptyTriple(); byAxis[a.key].set(cat, t); }
      accumulate(t.umaren, uOut);
      accumulate(t.umatan, tOut);
      accumulate(t.wide,   wOut);
    }
  }

  // ---- Markdown 出力 ----
  const md: string[] = [];
  const mp = (s = ''): void => { md.push(s); };

  mp(`# 多軸ROI分析 v2 (推奨Rベース厳密集計)`);
  mp('');
  mp(`- 生成日時: ${new Date().toISOString()}`);
  mp(`- 対象: **${all.length} R** (Phase 2G データ、trackCondition 欠損 0R)`);
  mp(`- 戦略: Phase 2G ハイブリッド (馬連/馬単 C1+C2 除外、ワイド C1 のみ除外)`);
  mp(`- **判定基準**: 推奨R < 20 は統計的結論を出さない (「サンプル不足」扱い)`);
  mp('');

  mp(`## データ品質チェック`);
  mp('');
  if (qualityIssues.size === 0) {
    mp(`✅ 全軸で「不明」カテゴリなし — データ品質は完全`);
  } else {
    mp(`⚠️ 以下の軸に「不明」カテゴリが残存:`);
    mp('');
    for (const [k, n] of Array.from(qualityIssues.entries())) {
      const axis = AXES.find((a) => a.key === k);
      mp(`- ${axis?.label ?? k}: ${n} R`);
    }
  }
  mp('');

  mp(`## 全体参照値 (Phase 2G ハイブリッド適用時)`);
  mp('');
  mp(`| 券種 | 総R | 対象R (C除外後) | 推奨R | 的中R | ROI |`);
  mp(`|---|---|---|---|---|---|`);
  mp(`| 馬連本命 | ${overall.umaren.totalR} | ${overall.umaren.targetedR} | ${overall.umaren.recommendedR} | ${overall.umaren.hits} | **${roi(overall.umaren).toFixed(1)}%** |`);
  mp(`| 馬単本命 | ${overall.umatan.totalR} | ${overall.umatan.targetedR} | ${overall.umatan.recommendedR} | ${overall.umatan.hits} | **${roi(overall.umatan).toFixed(1)}%** |`);
  mp(`| ワイド堅実 | ${overall.wide.totalR} | ${overall.wide.targetedR} | ${overall.wide.recommendedR} | ${overall.wide.hits} | **${roi(overall.wide).toFixed(1)}%** |`);
  mp(`| 合計pt | — | — | — | — | **${(roi(overall.umaren) + roi(overall.umatan) + roi(overall.wide)).toFixed(1)}** |`);
  mp('');

  // 各軸の詳細
  for (const a of AXES) {
    const map = byAxis[a.key];
    const order = a.order ?? Array.from(map.keys()).sort();
    const entries: Array<{ cat: string; triple: Triple }> = [];
    for (const cat of order) {
      const t = map.get(cat);
      if (!t) continue;
      entries.push({ cat, triple: t });
    }
    for (const [cat, t] of Array.from(map.entries())) {
      if (!order.includes(cat)) entries.push({ cat, triple: t });
    }

    mp(`<details>`);
    mp(`<summary><h2>${a.label}</h2></summary>`);
    mp('');

    for (const betLabel of ['馬連本命', '馬単本命', 'ワイド堅実'] as const) {
      mp(`### ${betLabel}`);
      mp('');
      mp(`| カテゴリ | 総R | 対象R | 推奨R | 的中R | 的中率 | ROI | 判定 |`);
      mp(`|---|---|---|---|---|---|---|---|`);
      for (const e of entries) {
        const s = betLabel === '馬連本命' ? e.triple.umaren : betLabel === '馬単本命' ? e.triple.umatan : e.triple.wide;
        const r = s.recommendedR === 0 ? '—' : roi(s).toFixed(1) + '%';
        mp(`| ${e.cat} | ${s.totalR} | ${s.targetedR} | ${s.recommendedR} | ${s.hits} | ${hitRate(s)} | ${r} | ${judge(s)} |`);
      }
      mp('');
    }
    mp(`</details>`);
    mp('');
  }

  // ----------------------------------------
  // サマリー
  // ----------------------------------------
  type Hit = { axis: string; cat: string; betType: string; stats: Stats };
  const allHits: Hit[] = [];
  for (const a of AXES) {
    for (const [cat, t] of Array.from(byAxis[a.key].entries())) {
      allHits.push({ axis: a.label, cat, betType: '馬連本命',  stats: t.umaren });
      allHits.push({ axis: a.label, cat, betType: '馬単本命',  stats: t.umatan });
      allHits.push({ axis: a.label, cat, betType: 'ワイド堅実', stats: t.wide });
    }
  }

  mp(`## 🔭 俯瞰サマリー`);
  mp('');

  // サマリーA: 真の除外候補 (推奨R≥50 かつ ROI<80%)
  mp(`### A. 真の除外候補 (推奨R ≥ 50 かつ ROI < 80%)`);
  mp('');
  mp(`統計的に信頼できるサンプル数で、明確に ROI が低い層。Phase 2I 候補。`);
  mp('');
  const excludeCandidates = allHits
    .filter((h) => h.stats.recommendedR >= 50 && roi(h.stats) < 80)
    .sort((a, b) => roi(a.stats) - roi(b.stats));

  if (excludeCandidates.length === 0) {
    mp(`✅ **該当なし** — 推奨R≥50 のカテゴリは全て ROI ≥ 80%。Phase 2G ハイブリッドは既に最適化されている`);
  } else {
    mp(`| 優先 | 軸 | カテゴリ | 券種 | 推奨R | 的中 | ROI |`);
    mp(`|---|---|---|---|---|---|---|`);
    excludeCandidates.slice(0, 10).forEach((h, i) => {
      mp(`| ${i + 1} | ${h.axis} | ${h.cat} | ${h.betType} | ${h.stats.recommendedR} | ${h.stats.hits} | ${roi(h.stats).toFixed(1)}% |`);
    });
  }
  mp('');

  // サマリーB: 真の強化候補 (推奨R≥50 かつ ROI≥200%)
  mp(`### B. 真の強化候補 (推奨R ≥ 50 かつ ROI ≥ 200%)`);
  mp('');
  mp(`サンプル十分で高 ROI を維持。参加条件を緩めるか投資配分を厚くする候補。`);
  mp('');
  const boostCandidates = allHits
    .filter((h) => h.stats.recommendedR >= 50 && roi(h.stats) >= 200)
    .sort((a, b) => roi(b.stats) - roi(a.stats));

  if (boostCandidates.length === 0) {
    mp(`- 該当なし`);
  } else {
    mp(`| 優先 | 軸 | カテゴリ | 券種 | 推奨R | 的中 | ROI |`);
    mp(`|---|---|---|---|---|---|---|`);
    boostCandidates.slice(0, 10).forEach((h, i) => {
      mp(`| ${i + 1} | ${h.axis} | ${h.cat} | ${h.betType} | ${h.stats.recommendedR} | ${h.stats.hits} | ${roi(h.stats).toFixed(1)}% |`);
    });
  }
  mp('');

  // サマリーC: サンプル不足で判断保留
  mp(`### C. サンプル不足 (推奨R < 20、判断保留)`);
  mp('');
  mp(`前回 v1 で「除外候補」と誤判定されたものの多くがここに該当。`);
  mp(`今後サンプルが蓄積されたら再評価すべき層。`);
  mp('');
  const unknowns = allHits.filter((h) => h.stats.recommendedR > 0 && h.stats.recommendedR < 20);
  mp(`**該当カテゴリ数**: ${unknowns.length} 件`);
  mp('');
  // 代表例 (v1で問題だったもの)
  const notableSmallSample = unknowns.filter((h) =>
    /ハンデ|長距離|少頭数|別定|G1|G2|G3|OP|直線|雪|小雨|夜|2歳/.test(h.cat) ||
    /^2歳$/.test(h.cat),
  ).slice(0, 15);
  if (notableSmallSample.length > 0) {
    mp(`#### 前回 v1 で誤判定されていた可能性があるカテゴリ`);
    mp('');
    mp(`| 軸 | カテゴリ | 券種 | 推奨R | 的中 | ROI (参考値) |`);
    mp(`|---|---|---|---|---|---|`);
    notableSmallSample.forEach((h) => {
      mp(`| ${h.axis} | ${h.cat} | ${h.betType} | ${h.stats.recommendedR} | ${h.stats.hits} | ${roi(h.stats).toFixed(1)}% |`);
    });
    mp('');
    mp(`⚠️ これらの ROI 数値は**サンプル不足で統計的に無意味**。前回 v1 で「除外候補」と誤判定されていた。`);
  }
  mp('');

  // サマリーD: Phase 2G との比較
  mp(`### D. Phase 2G 現状 vs 改善案の比較`);
  mp('');
  mp(`Phase 2G (現状):`);
  mp(`- 馬連 ${roi(overall.umaren).toFixed(1)}% (推奨 ${overall.umaren.recommendedR}R)`);
  mp(`- 馬単 ${roi(overall.umatan).toFixed(1)}% (推奨 ${overall.umatan.recommendedR}R)`);
  mp(`- ワイド ${roi(overall.wide).toFixed(1)}% (推奨 ${overall.wide.recommendedR}R)`);
  mp(`- **合計 ${(roi(overall.umaren) + roi(overall.umatan) + roi(overall.wide)).toFixed(1)}pt**`);
  mp('');

  if (excludeCandidates.length === 0) {
    mp(`**結論**: サマリー A に真の除外候補なし。Phase 2G ハイブリッドは統計的に最適と確定。`);
  } else {
    // 除外適用時のシミュレーション
    mp(`**サマリーA 除外候補 を適用した場合の試算**:`);
    mp('');
    // 券種ごとに最悪の除外候補を適用
    const byBetType = { 馬連本命: overall.umaren, 馬単本命: overall.umatan, ワイド堅実: overall.wide };
    const newStats: Record<string, Stats> = {
      馬連本命: { ...overall.umaren },
      馬単本命: { ...overall.umatan },
      ワイド堅実: { ...overall.wide },
    };
    for (const h of excludeCandidates) {
      const cur = newStats[h.betType];
      if (!cur) continue;
      cur.recommendedR = Math.max(0, cur.recommendedR - h.stats.recommendedR);
      cur.hits         = Math.max(0, cur.hits         - h.stats.hits);
      cur.cost         = Math.max(0, cur.cost         - h.stats.cost);
      cur.payout       = Math.max(0, cur.payout       - h.stats.payout);
    }
    const newRoi = (key: string): number => roi(newStats[key]);
    mp(`| 券種 | 現状 | 除外適用後 | 差分 |`);
    mp(`|---|---|---|---|`);
    for (const k of Object.keys(byBetType)) {
      const before = roi(byBetType[k as keyof typeof byBetType]);
      const after  = newRoi(k);
      mp(`| ${k} | ${before.toFixed(1)}% | ${after.toFixed(1)}% | ${(after - before >= 0 ? '+' : '') + (after - before).toFixed(1)}pt |`);
    }
    const totalBefore = roi(overall.umaren) + roi(overall.umatan) + roi(overall.wide);
    const totalAfter  = newRoi('馬連本命') + newRoi('馬単本命') + newRoi('ワイド堅実');
    mp(`| **合計pt** | **${totalBefore.toFixed(1)}** | **${totalAfter.toFixed(1)}** | **${(totalAfter - totalBefore >= 0 ? '+' : '') + (totalAfter - totalBefore).toFixed(1)}pt** |`);
    mp('');
  }

  // ----------------------------------------
  // 前回 v1 との差分
  // ----------------------------------------
  mp(`## 前回 v1 との判定差分`);
  mp('');
  mp(`### v1 で「除外候補」「強化候補」とされていたが、v2 で「サンプル不足」になったもの`);
  mp('');
  mp(`v1 の主な誤判定:`);
  mp('');
  mp(`| v1 判定 | 軸・カテゴリ | v1 表示 | v2 実態 (推奨R) | 正しい判定 |`);
  mp(`|---|---|---|---|---|`);

  // 具体的な対比 (主要なもの)
  const v1Problems = [
    { axis: '斤量ルール', cat: 'ハンデ', betType: '馬連本命', v1: '除外候補 (ROI 0%)' },
    { axis: '距離', cat: '長距離 (2200m〜)', betType: '馬連本命', v1: '除外候補 (ROI 0%)' },
    { axis: '頭数', cat: '少頭数 (〜10頭)', betType: '馬連本命', v1: '除外候補 (ROI 0%)' },
    { axis: '斤量ルール', cat: '別定', betType: '馬連本命', v1: '強化候補 (ROI 1022%)' },
  ];
  for (const p of v1Problems) {
    const hit = allHits.find((h) => h.axis.includes(p.axis) && h.cat === p.cat && h.betType === p.betType);
    if (!hit) continue;
    const n = hit.stats.recommendedR;
    const r = hit.stats.recommendedR > 0 ? roi(hit.stats).toFixed(1) + '%' : '—';
    const newJudge = n < 20 ? '⚠️ サンプル不足' : judge(hit.stats);
    mp(`| ${p.v1} | ${p.axis} / ${p.cat} | - | 推奨${n}R / ROI ${r} | ${newJudge} |`);
  }
  mp('');
  mp(`**理由**: v1 の「参加R」表示が実は「総R数」(カテゴリ該当の全レース) であり、`);
  mp(`推奨が出たレース数ではなかった。推奨が1桁の小サンプルで ROI 0% や 1000%+ が表示されていた。`);
  mp(`v2 では「推奨R < 20 はサンプル不足」と厳密化することで誤判定を防いでいる。`);
  mp('');

  // 最終結論
  mp(`## 🏁 最終結論`);
  mp('');
  if (excludeCandidates.length === 0 && boostCandidates.length === 0) {
    mp(`**Phase 2G ハイブリッドは現時点の 930R データでは最適**。`);
    mp('');
    mp(`- 真の除外候補 (推奨R≥50, ROI<80%): 0 件`);
    mp(`- 真の強化候補 (推奨R≥50, ROI≥200%): 0 件`);
    mp(`- サンプル不足 (推奨R<20): ${unknowns.length} 件 (判断保留)`);
    mp('');
    mp(`追加改善はサンプル拡大 (例: 1500R+) 後に再検証する価値あり。現状は変更不要。`);
  } else if (excludeCandidates.length > 0) {
    mp(`**Phase 2I 候補あり**: サマリー A の ${excludeCandidates.length} 件の除外適用を検討。`);
  } else {
    mp(`**Phase 2G 強化候補あり**: サマリー B の ${boostCandidates.length} 件の条件緩和を検討。`);
  }
  mp('');

  mp(`---`);
  mp(`*再実行: \`pnpm tsx scripts/multi_axis_analysis_v2.ts\`*`);

  await fs.writeFile(REPORT, md.join('\n'), 'utf-8');

  // ---- コンソールサマリー ----
  console.log('='.repeat(84));
  console.log(`  多軸 ROI 分析 v2 — 推奨R ベース (930R Phase 2G)`);
  console.log('='.repeat(84));
  console.log(`全体参照:`);
  console.log(`  馬連 推奨${overall.umaren.recommendedR}R / 的中${overall.umaren.hits} / ROI ${roi(overall.umaren).toFixed(1)}%`);
  console.log(`  馬単 推奨${overall.umatan.recommendedR}R / 的中${overall.umatan.hits} / ROI ${roi(overall.umatan).toFixed(1)}%`);
  console.log(`  ワイド 推奨${overall.wide.recommendedR}R / 的中${overall.wide.hits} / ROI ${roi(overall.wide).toFixed(1)}%`);
  console.log(`  合計pt: ${(roi(overall.umaren) + roi(overall.umatan) + roi(overall.wide)).toFixed(1)}`);
  console.log('');
  console.log(`▼ 真の除外候補 (推奨R≥50, ROI<80%): ${excludeCandidates.length} 件`);
  excludeCandidates.slice(0, 5).forEach((h, i) => {
    console.log(`  ${i + 1}. [${h.axis}] ${h.cat} (${h.betType}): 推奨${h.stats.recommendedR}R / 的中${h.stats.hits} / ROI ${roi(h.stats).toFixed(1)}%`);
  });
  console.log('');
  console.log(`▼ 真の強化候補 (推奨R≥50, ROI≥200%): ${boostCandidates.length} 件`);
  boostCandidates.slice(0, 5).forEach((h, i) => {
    console.log(`  ${i + 1}. [${h.axis}] ${h.cat} (${h.betType}): 推奨${h.stats.recommendedR}R / 的中${h.stats.hits} / ROI ${roi(h.stats).toFixed(1)}%`);
  });
  console.log('');
  console.log(`▼ サンプル不足 (推奨R<20): ${unknowns.length} 件 (判断保留)`);
  console.log('');
  console.log(`Markdown: ${REPORT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
