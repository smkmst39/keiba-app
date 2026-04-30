// ==========================================
// 危険人気馬の判定ロジック検証スクリプト
//
// 目的:
//   RaceReport.tsx の kikenHorses (人気上位3頭で EV<0.85 または score<55) が
//   過去レースに対してどの程度予測力を持つかをオフライン検証する。
//
// 判定ロジック:
//   本番側 (app/components/RaceReport.tsx L743-749) と同条件をローカル関数として
//   コピーして実装。本番コードは変更しない。
//
// 入力:
//   scripts/verification/*.json （collect-verification.ts が収集した過去レース）
//
// 出力:
//   - コンソール: サマリー
//   - scripts/output/kiken_popular_verification_YYYYMMDD.json: 集計＋個別ケース全件
//   - scripts/output/kiken_popular_verification_YYYYMMDD.html: 視覚的レポート
//
// 実行: pnpm tsx scripts/verify_kiken_popular.ts
// ==========================================

import fs from 'node:fs';
import path from 'node:path';

// ----------------------------------------
// 閾値（本番 RaceReport.tsx L746 と一致）
// ----------------------------------------
const KIKEN_POP_TOP_N = 3;
const KIKEN_EV_MAX = 0.85;
const KIKEN_SCORE_MIN = 55;

// ----------------------------------------
// 型
// ----------------------------------------
type Prediction = {
  horseId: number;
  horseName: string;
  score: number;
  ev: number;
  odds: number;
  waku?: number;
};

type ResultEntry = {
  rank: number;
  horseId: number;
  horseName: string;
};

type VerificationData = {
  raceId: string;
  raceName: string;
  date: string;
  predictions: Prediction[];
  results?: { results: ResultEntry[]; payouts?: any };
  meta?: {
    raceClass?: string;
    raceGrade?: string;
    distance?: number;
    surface?: string;
    headCount?: number;
    raceDate?: string;
  };
};

type ClassKey = 'C1' | 'C2' | 'C3' | 'OP' | 'UW' | 'NW' | 'OTHER';

const CLASS_LABEL: Record<ClassKey, string> = {
  C1: 'C1（1勝クラス）',
  C2: 'C2（2勝クラス）',
  C3: 'C3+（3勝クラス）',
  OP: 'オープン（OP/L/重賞）',
  UW: '未勝利',
  NW: '新馬',
  OTHER: 'その他/不明',
};

const CLASS_ORDER: ClassKey[] = ['OP', 'C3', 'C2', 'C1', 'UW', 'NW', 'OTHER'];

type FinishCategory = 'rank1' | 'rank2' | 'rank3' | 'rank4_5' | 'rank6plus' | 'cancelled';

const FINISH_LABEL: Record<FinishCategory, string> = {
  rank1: '1着',
  rank2: '2着',
  rank3: '3着',
  rank4_5: '4-5着',
  rank6plus: '6着以下',
  cancelled: '取消・除外',
};

type AggA = {
  total: number;
  rank1: number;
  within2: number;
  within3: number;
  dist: Record<FinishCategory, number>;
};

type AggB = {
  withKiken: { races: number; honmeiWithin3: number };
  withoutKiken: { races: number; honmeiWithin3: number };
};

type AggCondition = {
  evOnly: AggA;
  scoreOnly: AggA;
  both: AggA;
};

type KikenHit = {
  raceId: string;
  date: string;
  klass: ClassKey;
  klassLabel: string;
  raceName: string;
  horseId: number;
  horseName: string;
  score: number;
  ev: number;
  odds: number;
  popularityRank: number;
  finishRank: number;
  conditionType: 'evOnly' | 'scoreOnly' | 'both';
};

// ----------------------------------------
// 純関数（本番からコピー、挙動完全一致）
// ----------------------------------------
function isKikenPopular(h: { ev?: number; score?: number }, popularityRank: number): boolean {
  if (popularityRank > KIKEN_POP_TOP_N) return false;
  return (h.ev ?? 0) < KIKEN_EV_MAX || (h.score ?? 0) < KIKEN_SCORE_MIN;
}

/** RaceReport.tsx L46-53 と完全一致（horseId キーで返す） */
function calcPopularityRanks(horses: Prediction[]): Map<number, number> {
  const sorted = [...horses]
    .filter(h => h.odds > 0)
    .sort((a, b) => a.odds - b.odds);
  const map = new Map<number, number>();
  sorted.forEach((h, i) => map.set(h.horseId, i + 1));
  return map;
}

/** クラス分類（class_analysis.ts のロジックを簡略化） */
function classifyRace(meta: VerificationData['meta'], raceName: string): ClassKey {
  const grade = meta?.raceGrade;
  if (grade === 'G1' || grade === 'G2' || grade === 'G3' || grade === 'L') return 'OP';

  const rc = meta?.raceClass;
  if (rc) {
    if (/3勝|1600万/.test(rc)) return 'C3';
    if (/2勝|1000万/.test(rc)) return 'C2';
    if (/1勝|500万/.test(rc)) return 'C1';
    if (/未勝利/.test(rc)) return 'UW';
    if (/新馬/.test(rc)) return 'NW';
    if (/オープン|OP|リステッド/.test(rc)) return 'OP';
  }

  // フォールバック: レース名から推測
  const n = raceName ?? '';
  if (/G1|G2|G3|GⅠ|GⅡ|GⅢ|オープン|（L）|\(L\)|リステッド/.test(n)) return 'OP';
  if (/3勝|1600万/.test(n)) return 'C3';
  if (/2勝|1000万/.test(n)) return 'C2';
  if (/1勝|500万/.test(n)) return 'C1';
  if (/未勝利/.test(n)) return 'UW';
  if (/新馬/.test(n)) return 'NW';
  return 'OTHER';
}

function categorizeFinish(finishRank: number | undefined): FinishCategory {
  if (finishRank === undefined) return 'cancelled';
  if (finishRank === 1) return 'rank1';
  if (finishRank === 2) return 'rank2';
  if (finishRank === 3) return 'rank3';
  if (finishRank <= 5) return 'rank4_5';
  return 'rank6plus';
}

function newAggA(): AggA {
  return {
    total: 0, rank1: 0, within2: 0, within3: 0,
    dist: { rank1: 0, rank2: 0, rank3: 0, rank4_5: 0, rank6plus: 0, cancelled: 0 },
  };
}

function newAggB(): AggB {
  return {
    withKiken: { races: 0, honmeiWithin3: 0 },
    withoutKiken: { races: 0, honmeiWithin3: 0 },
  };
}

function newAggCondition(): AggCondition {
  return { evOnly: newAggA(), scoreOnly: newAggA(), both: newAggA() };
}

/** AggA に1頭分の結果を加算 */
function addToAggA(agg: AggA, finishCat: FinishCategory) {
  agg.total++;
  agg.dist[finishCat]++;
  if (finishCat === 'rank1') { agg.rank1++; agg.within2++; agg.within3++; }
  else if (finishCat === 'rank2') { agg.within2++; agg.within3++; }
  else if (finishCat === 'rank3') { agg.within3++; }
}

// ----------------------------------------
// メイン集計
// ----------------------------------------
const SCRIPTS_DIR = __dirname;
const VERIFY_DIR = path.join(SCRIPTS_DIR, 'verification');
const OUT_DIR = path.join(SCRIPTS_DIR, 'output');

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
if (!fs.existsSync(VERIFY_DIR)) {
  console.error(`[verify_kiken] verification ディレクトリが見つかりません: ${VERIFY_DIR}`);
  process.exit(1);
}

const files = fs.readdirSync(VERIFY_DIR).filter(f => f.endsWith('.json'));
console.log(`[verify_kiken] verification ディレクトリ: ${files.length}件のJSONを検査`);

let totalRaces = 0;
let skipped = 0;
const skipReasons: string[] = [];

const aggA_global = newAggA();
const aggB_global = newAggB();
const aggCond_global = newAggCondition();

const aggByClass: Record<ClassKey, { a: AggA; b: AggB; cond: AggCondition }> = {
  C1: { a: newAggA(), b: newAggB(), cond: newAggCondition() },
  C2: { a: newAggA(), b: newAggB(), cond: newAggCondition() },
  C3: { a: newAggA(), b: newAggB(), cond: newAggCondition() },
  OP: { a: newAggA(), b: newAggB(), cond: newAggCondition() },
  UW: { a: newAggA(), b: newAggB(), cond: newAggCondition() },
  NW: { a: newAggA(), b: newAggB(), cond: newAggCondition() },
  OTHER: { a: newAggA(), b: newAggB(), cond: newAggCondition() },
};

const kikenHits: KikenHit[] = [];

let processedCount = 0;
const PROGRESS_EVERY = 500;

for (const file of files) {
  let data: VerificationData;
  try {
    data = JSON.parse(fs.readFileSync(path.join(VERIFY_DIR, file), 'utf8'));
  } catch (e) {
    skipped++;
    skipReasons.push(`${file}: JSON パース失敗`);
    continue;
  }

  // 結果データ無し → スキップ
  const results = data.results?.results;
  if (!results || results.length === 0) {
    skipped++;
    skipReasons.push(`${file}: 結果データなし`);
    continue;
  }
  // 予測データ無し → スキップ
  if (!data.predictions || data.predictions.length === 0) {
    skipped++;
    skipReasons.push(`${file}: 予測データなし`);
    continue;
  }

  totalRaces++;
  processedCount++;
  if (processedCount % PROGRESS_EVERY === 0) {
    console.log(`[verify_kiken] 処理中... ${processedCount}/${files.length}`);
  }

  const popRanks = calcPopularityRanks(data.predictions);
  const klass = classifyRace(data.meta, data.raceName);

  const rankByHorseId = new Map<number, number>();
  for (const r of results) {
    rankByHorseId.set(r.horseId, r.rank);
  }

  // 危険判定
  const kikens = data.predictions.filter(p => {
    const r = popRanks.get(p.horseId) ?? 99;
    return isKikenPopular(p, r);
  });

  // A案: 危険判定された各馬の着順
  for (const h of kikens) {
    const popRank = popRanks.get(h.horseId) ?? 99;
    const finish = rankByHorseId.get(h.horseId);
    const cat = categorizeFinish(finish);

    addToAggA(aggA_global, cat);
    addToAggA(aggByClass[klass].a, cat);

    // 発動条件別
    const evHit = (h.ev ?? 0) < KIKEN_EV_MAX;
    const scoreHit = (h.score ?? 0) < KIKEN_SCORE_MIN;
    const condKey: 'evOnly' | 'scoreOnly' | 'both' =
      (evHit && scoreHit) ? 'both' : evHit ? 'evOnly' : 'scoreOnly';
    addToAggA(aggCond_global[condKey], cat);
    addToAggA(aggByClass[klass].cond[condKey], cat);

    // 個別ケース: 3着以内
    if (cat === 'rank1' || cat === 'rank2' || cat === 'rank3') {
      kikenHits.push({
        raceId: data.raceId,
        date: data.date ?? data.meta?.raceDate ?? '',
        klass,
        klassLabel: CLASS_LABEL[klass],
        raceName: data.raceName ?? '',
        horseId: h.horseId,
        horseName: h.horseName,
        score: h.score,
        ev: h.ev,
        odds: h.odds,
        popularityRank: popRank,
        finishRank: finish!,
        conditionType: condKey,
      });
    }
  }

  // B案: 本命人気（pop=1）の3着以内率を、危険判定あり/なしで分けて集計
  const honmei = data.predictions.find(p => popRanks.get(p.horseId) === 1);
  if (honmei) {
    const honmeiFinish = rankByHorseId.get(honmei.horseId);
    const within3 = honmeiFinish !== undefined && honmeiFinish <= 3;
    const target = kikens.length > 0 ? 'withKiken' : 'withoutKiken';
    aggB_global[target].races++;
    aggByClass[klass].b[target].races++;
    if (within3) {
      aggB_global[target].honmeiWithin3++;
      aggByClass[klass].b[target].honmeiWithin3++;
    }
  }
}

// ----------------------------------------
// レポート出力
// ----------------------------------------
const pct = (n: number, d: number): string => d === 0 ? 'N/A' : `${((n / d) * 100).toFixed(1)}%`;
const pctNum = (n: number, d: number): number => d === 0 ? 0 : (n / d) * 100;

// JST 日付（YYYYMMDD）
const now = new Date();
const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000); // UTC + 9
const yyyymmdd = jst.toISOString().slice(0, 10).replace(/-/g, '');
const isoNow = jst.toISOString().replace('Z', '+09:00');

// --- コンソール出力 ---
console.log('');
console.log('=== 危険人気馬 検証レポート ===');
console.log(`対象: ${totalRaces}R （スキップ: ${skipped}R）`);
console.log('');
console.log('【全体】');
console.log('A案: 危険判定された馬の的中率');
console.log(`  危険判定総数: ${aggA_global.total}頭`);
console.log(`    1着:       ${aggA_global.rank1}頭 (${pct(aggA_global.rank1, aggA_global.total)})`);
console.log(`    2着以内:   ${aggA_global.within2}頭 (${pct(aggA_global.within2, aggA_global.total)})`);
console.log(`    3着以内:   ${aggA_global.within3}頭 (${pct(aggA_global.within3, aggA_global.total)})`);
console.log('');
console.log('B案: 本命人気（pop=1）の3着以内率の比較');
console.log(`  危険判定ありレース: ${aggB_global.withKiken.races}R / 本命3着内 ${aggB_global.withKiken.honmeiWithin3}R (${pct(aggB_global.withKiken.honmeiWithin3, aggB_global.withKiken.races)})`);
console.log(`  危険判定なしレース: ${aggB_global.withoutKiken.races}R / 本命3着内 ${aggB_global.withoutKiken.honmeiWithin3}R (${pct(aggB_global.withoutKiken.honmeiWithin3, aggB_global.withoutKiken.races)})`);
console.log('');
console.log('【発動条件別の内訳】');
console.log(`  EV<0.85 のみ満たす:   ${aggCond_global.evOnly.total}頭, 3着内率 ${pct(aggCond_global.evOnly.within3, aggCond_global.evOnly.total)}`);
console.log(`  score<55 のみ満たす:  ${aggCond_global.scoreOnly.total}頭, 3着内率 ${pct(aggCond_global.scoreOnly.within3, aggCond_global.scoreOnly.total)}`);
console.log(`  両方満たす:           ${aggCond_global.both.total}頭, 3着内率 ${pct(aggCond_global.both.within3, aggCond_global.both.total)}`);
console.log('');
console.log('【クラス別】');
console.log('クラス                  危険判定数  3着内率  本命3着内率(あり)  本命3着内率(なし)');
for (const ck of CLASS_ORDER) {
  const c = aggByClass[ck];
  if (c.a.total === 0 && c.b.withKiken.races === 0 && c.b.withoutKiken.races === 0) continue;
  const label = CLASS_LABEL[ck].padEnd(20, ' ');
  const total = String(c.a.total).padStart(8, ' ');
  const w3 = pct(c.a.within3, c.a.total).padStart(7, ' ');
  const honmeiYes = pct(c.b.withKiken.honmeiWithin3, c.b.withKiken.races).padStart(15, ' ');
  const honmeiNo = pct(c.b.withoutKiken.honmeiWithin3, c.b.withoutKiken.races).padStart(15, ' ');
  console.log(`${label}  ${total}  ${w3}  ${honmeiYes}  ${honmeiNo}`);
}
console.log('');

// --- JSON 出力（生データ全件） ---
const jsonPath = path.join(OUT_DIR, `kiken_popular_verification_${yyyymmdd}.json`);
const jsonReport = {
  generatedAt: isoNow,
  thresholds: { KIKEN_POP_TOP_N, KIKEN_EV_MAX, KIKEN_SCORE_MIN },
  summary: {
    totalRaces,
    skipped,
    skipReasons: skipReasons.slice(0, 20), // 先頭20件のみ
  },
  global: {
    a: aggA_global,
    b: aggB_global,
    cond: aggCond_global,
  },
  byClass: Object.fromEntries(CLASS_ORDER.map(k => [k, {
    label: CLASS_LABEL[k],
    a: aggByClass[k].a,
    b: aggByClass[k].b,
    cond: aggByClass[k].cond,
  }])),
  kikenHits, // 危険判定なのに3着以内に来た馬の全件
};
fs.writeFileSync(jsonPath, JSON.stringify(jsonReport, null, 2), 'utf8');
console.log(`[verify_kiken] JSON 保存: ${jsonPath}`);

// --- HTML 出力 ---
const htmlPath = path.join(OUT_DIR, `kiken_popular_verification_${yyyymmdd}.html`);
const html = renderHtml({
  generatedAt: isoNow,
  totalRaces,
  skipped,
  thresholds: { KIKEN_POP_TOP_N, KIKEN_EV_MAX, KIKEN_SCORE_MIN },
  global: { a: aggA_global, b: aggB_global, cond: aggCond_global },
  byClass: aggByClass,
  kikenHits,
});
fs.writeFileSync(htmlPath, html, 'utf8');
console.log(`[verify_kiken] HTML 保存: ${htmlPath}`);

// ==========================================
// HTML レンダラ
// ==========================================
function renderHtml(args: {
  generatedAt: string;
  totalRaces: number;
  skipped: number;
  thresholds: { KIKEN_POP_TOP_N: number; KIKEN_EV_MAX: number; KIKEN_SCORE_MIN: number };
  global: { a: AggA; b: AggB; cond: AggCondition };
  byClass: Record<ClassKey, { a: AggA; b: AggB; cond: AggCondition }>;
  kikenHits: KikenHit[];
}): string {
  const { global, byClass, kikenHits, thresholds, totalRaces, skipped, generatedAt } = args;

  // 警告色判定: 「3着以内率が高い = 判定が外している」のでマー君的には警告
  // 35%超で赤、25-35%でオレンジ、25%未満で緑
  function rateColor(rate: number): string {
    if (rate >= 35) return '#c53030'; // 赤
    if (rate >= 25) return '#dd6b20'; // オレンジ
    return '#2f855a'; // 緑
  }

  // A案 着順分布バーチャート
  const distBar = (dist: AggA['dist'], total: number): string => {
    if (total === 0) return '<div class="bar-empty">データなし</div>';
    const order: FinishCategory[] = ['rank1', 'rank2', 'rank3', 'rank4_5', 'rank6plus', 'cancelled'];
    const colors: Record<FinishCategory, string> = {
      rank1: '#e53e3e', rank2: '#dd6b20', rank3: '#d69e2e',
      rank4_5: '#3182ce', rank6plus: '#4a5568', cancelled: '#a0aec0',
    };
    return `<div class="bar-stack">${order.map(k => {
      const v = dist[k];
      const w = total === 0 ? 0 : (v / total) * 100;
      if (v === 0) return '';
      return `<div class="bar-seg" style="width:${w.toFixed(2)}%;background:${colors[k]}" title="${FINISH_LABEL[k]}: ${v}頭 (${w.toFixed(1)}%)">${w >= 6 ? `${FINISH_LABEL[k]} ${w.toFixed(1)}%` : ''}</div>`;
    }).join('')}</div>
    <div class="bar-legend">${order.map(k => `<span><i style="background:${colors[k]}"></i>${FINISH_LABEL[k]}: ${dist[k]}頭 (${pct(dist[k], total)})</span>`).join(' ')}</div>`;
  };

  const rateA_within3 = pctNum(global.a.within3, global.a.total);
  const rateB_with = pctNum(global.b.withKiken.honmeiWithin3, global.b.withKiken.races);
  const rateB_without = pctNum(global.b.withoutKiken.honmeiWithin3, global.b.withoutKiken.races);
  const rateB_diff = rateB_with - rateB_without; // 負の値が大きいほど判定が機能している

  // クラス別テーブルの背景色（的中率に応じて）
  const cellBg = (rate: number): string => {
    if (rate >= 40) return '#fed7d7';
    if (rate >= 30) return '#feebc8';
    if (rate >= 20) return '#fefcbf';
    if (rate >= 10) return '#c6f6d5';
    return '#bee3f8';
  };

  // 発動条件別のバー
  const condBar = (label: string, agg: AggA, max: number): string => {
    const rate = pctNum(agg.within3, agg.total);
    const w = max === 0 ? 0 : (rate / max) * 100;
    return `<div class="cond-row">
      <div class="cond-label">${label}</div>
      <div class="cond-bar-track">
        <div class="cond-bar-fill" style="width:${w.toFixed(2)}%;background:${rateColor(rate)}">${rate.toFixed(1)}%</div>
      </div>
      <div class="cond-meta">${agg.within3}/${agg.total}頭</div>
    </div>`;
  };

  const condMaxRate = Math.max(
    pctNum(global.cond.evOnly.within3, global.cond.evOnly.total),
    pctNum(global.cond.scoreOnly.within3, global.cond.scoreOnly.total),
    pctNum(global.cond.both.within3, global.cond.both.total),
    50, // 軸の最大値は最低 50% （見た目の安定）
  );

  // 違和感深掘りリスト
  const hitsRows = kikenHits.map(h => `
    <tr data-class="${h.klass}" data-finish="${h.finishRank}">
      <td>${h.date}</td>
      <td>${escapeHtml(h.klassLabel)}</td>
      <td>${escapeHtml(h.raceName)}</td>
      <td>${h.horseId}</td>
      <td>${escapeHtml(h.horseName)}</td>
      <td class="num">${h.score.toFixed(1)}</td>
      <td class="num">${h.ev.toFixed(2)}</td>
      <td class="num">${h.popularityRank}</td>
      <td class="num">${h.odds.toFixed(1)}</td>
      <td class="num"><b>${h.finishRank}</b></td>
      <td>${escapeHtml(h.raceId)}</td>
    </tr>
  `).join('');

  const classRows = CLASS_ORDER.filter(ck => {
    const c = byClass[ck];
    return c.a.total > 0 || c.b.withKiken.races > 0 || c.b.withoutKiken.races > 0;
  }).map(ck => {
    const c = byClass[ck];
    const r1 = pctNum(c.a.rank1, c.a.total);
    const r2 = pctNum(c.a.within2, c.a.total);
    const r3 = pctNum(c.a.within3, c.a.total);
    const bWith = pctNum(c.b.withKiken.honmeiWithin3, c.b.withKiken.races);
    const bWithout = pctNum(c.b.withoutKiken.honmeiWithin3, c.b.withoutKiken.races);
    const diff = bWith - bWithout;
    return `<tr>
      <td>${escapeHtml(CLASS_LABEL[ck])}</td>
      <td class="num">${c.a.total}</td>
      <td class="num" style="background:${cellBg(r1)}">${pct(c.a.rank1, c.a.total)}</td>
      <td class="num" style="background:${cellBg(r2)}">${pct(c.a.within2, c.a.total)}</td>
      <td class="num" style="background:${cellBg(r3)}">${pct(c.a.within3, c.a.total)}</td>
      <td class="num">${c.b.withKiken.races}R</td>
      <td class="num">${pct(c.b.withKiken.honmeiWithin3, c.b.withKiken.races)}</td>
      <td class="num">${c.b.withoutKiken.races}R</td>
      <td class="num">${pct(c.b.withoutKiken.honmeiWithin3, c.b.withoutKiken.races)}</td>
      <td class="num" style="color:${diff < 0 ? '#2f855a' : '#c53030'};font-weight:700">${diff >= 0 ? '+' : ''}${diff.toFixed(1)}pt</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>危険人気馬 検証レポート ${yyyymmdd}</title>
<style>
  :root {
    --fg: #1a202c; --fg2: #4a5568; --bg: #fff; --bg2: #f7fafc;
    --line: #e2e8f0; --accent: #2b6cb0;
  }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Yu Gothic", sans-serif;
         color: var(--fg); background: var(--bg2); margin: 0; padding: 2rem; line-height: 1.5; }
  .container { max-width: 1200px; margin: 0 auto; }
  h1 { font-size: 1.6rem; margin: 0 0 0.5rem; }
  h2 { font-size: 1.15rem; margin: 0 0 0.8rem; padding-bottom: 0.4rem; border-bottom: 2px solid var(--accent); color: var(--accent); }
  .meta-line { color: var(--fg2); font-size: 0.85rem; margin-bottom: 2rem; }
  section { background: var(--bg); border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem;
            box-shadow: 0 1px 3px rgba(0,0,0,0.08); }

  /* サマリーカード */
  .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; }
  .summary-card { padding: 1rem; border-radius: 6px; background: var(--bg2); border: 1px solid var(--line); }
  .summary-card .label { font-size: 0.75rem; color: var(--fg2); margin-bottom: 0.4rem; }
  .summary-card .value { font-size: 1.8rem; font-weight: 800; line-height: 1; }
  .summary-card .sub { font-size: 0.7rem; color: var(--fg2); margin-top: 0.4rem; }

  /* バーチャート */
  .bar-stack { display: flex; height: 36px; border-radius: 4px; overflow: hidden;
               border: 1px solid var(--line); margin-bottom: 0.5rem; }
  .bar-seg { color: #fff; font-size: 0.7rem; font-weight: 600; padding: 0 0.4rem;
             display: flex; align-items: center; justify-content: center; white-space: nowrap; overflow: hidden; }
  .bar-empty { color: var(--fg2); font-size: 0.85rem; padding: 0.4rem; }
  .bar-legend { display: flex; flex-wrap: wrap; gap: 0.7rem; font-size: 0.75rem; color: var(--fg2); }
  .bar-legend span { display: inline-flex; align-items: center; gap: 0.2rem; }
  .bar-legend i { width: 10px; height: 10px; display: inline-block; border-radius: 2px; }

  /* B案 比較 */
  .compare-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1rem; align-items: stretch; }
  .compare-card { padding: 1.2rem; border-radius: 6px; background: var(--bg2); border: 1px solid var(--line); text-align: center; }
  .compare-card.diff { background: #fffbea; border-color: #f6e05e; }
  .compare-card .label { font-size: 0.78rem; color: var(--fg2); margin-bottom: 0.6rem; }
  .compare-card .value { font-size: 2rem; font-weight: 800; line-height: 1; }
  .compare-card .sub { font-size: 0.72rem; color: var(--fg2); margin-top: 0.5rem; }

  /* 発動条件別バー */
  .cond-row { display: grid; grid-template-columns: 200px 1fr 120px; gap: 0.8rem; align-items: center; margin-bottom: 0.6rem; }
  .cond-label { font-size: 0.85rem; font-weight: 600; }
  .cond-bar-track { height: 28px; background: var(--bg2); border: 1px solid var(--line); border-radius: 4px; position: relative; overflow: hidden; }
  .cond-bar-fill { height: 100%; min-width: 40px; display: flex; align-items: center; justify-content: flex-end;
                   padding: 0 0.6rem; color: #fff; font-weight: 700; font-size: 0.85rem; }
  .cond-meta { font-size: 0.78rem; color: var(--fg2); text-align: right; }

  /* テーブル */
  table { width: 100%; border-collapse: collapse; font-size: 0.83rem; }
  th, td { padding: 0.45rem 0.7rem; border-bottom: 1px solid var(--line); text-align: left; }
  th { background: var(--bg2); font-weight: 700; color: var(--fg2); position: sticky; top: 0; cursor: pointer; user-select: none; }
  th.sortable:hover { background: #edf2f7; }
  th .arrow { font-size: 0.6rem; opacity: 0.4; margin-left: 0.2rem; }
  th.active .arrow { opacity: 1; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  tbody tr:nth-child(even) { background: var(--bg2); }
  tbody tr:hover { background: #ebf8ff; }

  /* フィルタボタン */
  .filter-bar { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-bottom: 0.8rem; align-items: center; }
  .filter-bar .label { font-size: 0.78rem; color: var(--fg2); margin-right: 0.4rem; }
  .filter-btn { padding: 0.3rem 0.7rem; border: 1px solid var(--line); background: #fff; border-radius: 4px;
                font-size: 0.78rem; cursor: pointer; }
  .filter-btn.active { background: var(--accent); color: #fff; border-color: var(--accent); }
  .filter-btn:hover { background: #edf2f7; }
  .filter-btn.active:hover { background: var(--accent); opacity: 0.9; }

  /* メタ情報 */
  .meta-table { width: auto; }
  .meta-table td { padding: 0.3rem 0.7rem; }
  .meta-table td:first-child { color: var(--fg2); }

  .threshold { display: inline-block; padding: 0.15rem 0.5rem; background: #edf2f7; border-radius: 3px;
               font-family: monospace; font-size: 0.78rem; margin-right: 0.4rem; }
  .note { font-size: 0.78rem; color: var(--fg2); margin-top: 0.5rem; line-height: 1.6; }
</style>
</head>
<body>
<div class="container">
  <h1>危険人気馬 検証レポート</h1>
  <div class="meta-line">
    生成: ${generatedAt} / 対象: ${totalRaces}R / スキップ: ${skipped}R
  </div>

  <section>
    <h2>Section 1: サマリー</h2>
    <div class="summary-grid">
      <div class="summary-card">
        <div class="label">A案: 危険判定された馬の3着以内率</div>
        <div class="value" style="color:${rateColor(rateA_within3)}">${rateA_within3.toFixed(1)}%</div>
        <div class="sub">${global.a.within3} / ${global.a.total}頭</div>
      </div>
      <div class="summary-card">
        <div class="label">B案: 本命3着以内率（危険判定あり）</div>
        <div class="value" style="color:${rateColor(rateB_with)}">${rateB_with.toFixed(1)}%</div>
        <div class="sub">${global.b.withKiken.honmeiWithin3} / ${global.b.withKiken.races}R</div>
      </div>
      <div class="summary-card">
        <div class="label">B案: 本命3着以内率（危険判定なし）</div>
        <div class="value" style="color:${rateColor(rateB_without)}">${rateB_without.toFixed(1)}%</div>
        <div class="sub">${global.b.withoutKiken.honmeiWithin3} / ${global.b.withoutKiken.races}R</div>
      </div>
      <div class="summary-card">
        <div class="label">差分（あり − なし）</div>
        <div class="value" style="color:${rateB_diff < 0 ? '#2f855a' : '#c53030'}">${rateB_diff >= 0 ? '+' : ''}${rateB_diff.toFixed(1)}pt</div>
        <div class="sub">負の値が大きい＝判定が機能している</div>
      </div>
    </div>
    <div class="note">
      色の意味: <span style="color:#2f855a">緑＝判定が機能している（着内率が低い／本命が来にくい）</span>、
      <span style="color:#dd6b20">橙＝中立</span>、
      <span style="color:#c53030">赤＝想定より着内率が高く、判定が外している可能性あり</span>。
    </div>
  </section>

  <section>
    <h2>Section 2: A案 - 危険判定された馬の的中率</h2>
    <div class="summary-grid" style="grid-template-columns: repeat(3, 1fr); margin-bottom: 1rem;">
      <div class="summary-card">
        <div class="label">1着率</div>
        <div class="value" style="color:${rateColor(pctNum(global.a.rank1, global.a.total))}">${pct(global.a.rank1, global.a.total)}</div>
        <div class="sub">${global.a.rank1} / ${global.a.total}頭</div>
      </div>
      <div class="summary-card">
        <div class="label">2着以内率</div>
        <div class="value" style="color:${rateColor(pctNum(global.a.within2, global.a.total))}">${pct(global.a.within2, global.a.total)}</div>
        <div class="sub">${global.a.within2} / ${global.a.total}頭</div>
      </div>
      <div class="summary-card">
        <div class="label">3着以内率</div>
        <div class="value" style="color:${rateColor(pctNum(global.a.within3, global.a.total))}">${pct(global.a.within3, global.a.total)}</div>
        <div class="sub">${global.a.within3} / ${global.a.total}頭</div>
      </div>
    </div>
    <div class="label" style="font-size:0.78rem;color:var(--fg2);margin-bottom:0.4rem">着順度数分布</div>
    ${distBar(global.a.dist, global.a.total)}
  </section>

  <section>
    <h2>Section 3: B案 - 本命人気の3着以内率比較</h2>
    <div class="compare-grid">
      <div class="compare-card">
        <div class="label">危険判定<b>あり</b>レース</div>
        <div class="value" style="color:${rateColor(rateB_with)}">${rateB_with.toFixed(1)}%</div>
        <div class="sub">${global.b.withKiken.honmeiWithin3} / ${global.b.withKiken.races}R で本命3着以内</div>
      </div>
      <div class="compare-card">
        <div class="label">危険判定<b>なし</b>レース</div>
        <div class="value" style="color:${rateColor(rateB_without)}">${rateB_without.toFixed(1)}%</div>
        <div class="sub">${global.b.withoutKiken.honmeiWithin3} / ${global.b.withoutKiken.races}R で本命3着以内</div>
      </div>
      <div class="compare-card diff">
        <div class="label">差分（あり − なし）</div>
        <div class="value" style="color:${rateB_diff < 0 ? '#2f855a' : '#c53030'}">${rateB_diff >= 0 ? '+' : ''}${rateB_diff.toFixed(1)}pt</div>
        <div class="sub">${rateB_diff < 0 ? '判定が機能（本命が来にくい）' : '判定が機能していない可能性'}</div>
      </div>
    </div>
  </section>

  <section>
    <h2>Section 4: 発動条件別の予測力（重要）</h2>
    <div class="note" style="margin-bottom:1rem">
      閾値は OR 条件（EV または score）。両方を独立に評価し、どちらが「危険」のシグナルとして強いかを比較する。
    </div>
    ${condBar('EV<0.85 のみ満たす', global.cond.evOnly, condMaxRate)}
    ${condBar('score<55 のみ満たす', global.cond.scoreOnly, condMaxRate)}
    ${condBar('両方満たす', global.cond.both, condMaxRate)}
    <div class="note" style="margin-top:1rem">
      バーは 3着以内率を表示。<b>低いほど判定として機能している</b>（人気馬なのに着内に来ない＝判定が当たっている）。
      もし「両方満たす」が極端に低ければ閾値の AND 化検討、片方が高ければその条件は予測力が弱い可能性。
    </div>
  </section>

  <section>
    <h2>Section 5: クラス別の予測力</h2>
    <table>
      <thead>
        <tr>
          <th>クラス</th>
          <th class="num">危険判定数</th>
          <th class="num">1着率</th>
          <th class="num">2着以内率</th>
          <th class="num">3着以内率</th>
          <th class="num">レース数(あり)</th>
          <th class="num">本命3着内率(あり)</th>
          <th class="num">レース数(なし)</th>
          <th class="num">本命3着内率(なし)</th>
          <th class="num">差分</th>
        </tr>
      </thead>
      <tbody>
        ${classRows}
      </tbody>
    </table>
    <div class="note">セルの背景色は的中率の目安: 青＜緑＜黄＜橙＜赤（赤は40%超）。差分はB案の差分（あり − なし、ptは percentage point）。</div>
  </section>

  <section>
    <h2>Section 6: 違和感深掘りリスト（危険判定なのに3着以内に来た馬）</h2>
    <div class="filter-bar">
      <span class="label">クラス:</span>
      <button class="filter-btn active" data-filter-class="all">すべて</button>
      ${CLASS_ORDER.filter(c => byClass[c].a.within3 > 0).map(c =>
        `<button class="filter-btn" data-filter-class="${c}">${escapeHtml(CLASS_LABEL[c])}</button>`
      ).join('')}
    </div>
    <div class="filter-bar">
      <span class="label">着順:</span>
      <button class="filter-btn active" data-filter-finish="all">すべて</button>
      <button class="filter-btn" data-filter-finish="1">1着</button>
      <button class="filter-btn" data-filter-finish="2">2着</button>
      <button class="filter-btn" data-filter-finish="3">3着</button>
    </div>
    <table id="hits-table">
      <thead>
        <tr>
          <th class="sortable" data-sort="0">開催日<span class="arrow">▲▼</span></th>
          <th class="sortable" data-sort="1">クラス<span class="arrow">▲▼</span></th>
          <th class="sortable" data-sort="2">レース<span class="arrow">▲▼</span></th>
          <th class="sortable num" data-sort="3" data-num="1">馬番<span class="arrow">▲▼</span></th>
          <th class="sortable" data-sort="4">馬名<span class="arrow">▲▼</span></th>
          <th class="sortable num" data-sort="5" data-num="1">スコア<span class="arrow">▲▼</span></th>
          <th class="sortable num" data-sort="6" data-num="1">EV<span class="arrow">▲▼</span></th>
          <th class="sortable num" data-sort="7" data-num="1">人気<span class="arrow">▲▼</span></th>
          <th class="sortable num" data-sort="8" data-num="1">オッズ<span class="arrow">▲▼</span></th>
          <th class="sortable num" data-sort="9" data-num="1">着順<span class="arrow">▲▼</span></th>
          <th class="sortable" data-sort="10">レースID<span class="arrow">▲▼</span></th>
        </tr>
      </thead>
      <tbody>
        ${hitsRows}
      </tbody>
    </table>
    <div class="note" style="margin-top:0.6rem">全 ${kikenHits.length} 件。列ヘッダクリックでソート可能。</div>
  </section>

  <section>
    <h2>Section 7: メタ情報</h2>
    <table class="meta-table">
      <tr><td>生成日時</td><td>${generatedAt}</td></tr>
      <tr><td>対象レース数</td><td>${totalRaces}R</td></tr>
      <tr><td>スキップR数</td><td>${skipped}R（結果データなし等）</td></tr>
      <tr><td>判定閾値</td><td>
        <span class="threshold">KIKEN_POP_TOP_N=${thresholds.KIKEN_POP_TOP_N}</span>
        <span class="threshold">KIKEN_EV_MAX=${thresholds.KIKEN_EV_MAX}</span>
        <span class="threshold">KIKEN_SCORE_MIN=${thresholds.KIKEN_SCORE_MIN}</span>
      </td></tr>
      <tr><td>判定式</td><td><code>pop ≤ ${thresholds.KIKEN_POP_TOP_N} && (ev &lt; ${thresholds.KIKEN_EV_MAX} || score &lt; ${thresholds.KIKEN_SCORE_MIN})</code></td></tr>
      <tr><td>データソース</td><td>scripts/verification/*.json （collect-verification.ts が事後収集した最終確定オッズ・着順）</td></tr>
      <tr><td>本番コードへの影響</td><td>なし（このスクリプトは判定ロジックを内部にコピーしており、lib/ や app/ 配下に変更は加えない）</td></tr>
    </table>
  </section>

</div>

<script>
(function () {
  // フィルタ
  const tbody = document.querySelector('#hits-table tbody');
  if (!tbody) return;
  const rows = Array.from(tbody.querySelectorAll('tr'));
  let filterClass = 'all';
  let filterFinish = 'all';

  function applyFilter() {
    rows.forEach(r => {
      const c = r.dataset.class;
      const f = r.dataset.finish;
      const okClass = filterClass === 'all' || c === filterClass;
      const okFinish = filterFinish === 'all' || f === filterFinish;
      r.style.display = (okClass && okFinish) ? '' : 'none';
    });
  }

  document.querySelectorAll('[data-filter-class]').forEach(btn => {
    btn.addEventListener('click', () => {
      filterClass = btn.dataset.filterClass;
      document.querySelectorAll('[data-filter-class]').forEach(b => b.classList.toggle('active', b === btn));
      applyFilter();
    });
  });
  document.querySelectorAll('[data-filter-finish]').forEach(btn => {
    btn.addEventListener('click', () => {
      filterFinish = btn.dataset.filterFinish;
      document.querySelectorAll('[data-filter-finish]').forEach(b => b.classList.toggle('active', b === btn));
      applyFilter();
    });
  });

  // ソート
  let lastSort = -1;
  let lastDir = 1;
  document.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const idx = parseInt(th.dataset.sort, 10);
      const isNum = th.dataset.num === '1';
      const dir = (idx === lastSort) ? -lastDir : 1;
      lastSort = idx; lastDir = dir;
      document.querySelectorAll('th.sortable').forEach(x => x.classList.remove('active'));
      th.classList.add('active');
      const visible = rows.filter(r => r.style.display !== 'none');
      const hidden = rows.filter(r => r.style.display === 'none');
      visible.sort((a, b) => {
        const av = a.children[idx].textContent.trim();
        const bv = b.children[idx].textContent.trim();
        if (isNum) return (parseFloat(av) - parseFloat(bv)) * dir;
        return av.localeCompare(bv, 'ja') * dir;
      });
      tbody.innerHTML = '';
      visible.forEach(r => tbody.appendChild(r));
      hidden.forEach(r => tbody.appendChild(r));
    });
  });
})();
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
