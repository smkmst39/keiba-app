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
//     Section 1-7: サマリー / A案 / B案 / 発動条件別 / クラス別 / 違和感深掘り / メタ
//     Section 8:   危険判定が当たった例（3着外）の深掘り
//     Section 9:   本命人気が3着以内に来たレースの分布（オッズ帯・スコア帯別）
//     Section 10:  危険判定 vs 非危険判定の本命馬比較
//     Section 11:  サマリー所感（自動生成）
//
// 実行: pnpm verify:kiken
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
type ComponentScores = {
  lastThreeF?: number;
  training?: number;
  courseRecord?: number;
  prevClass?: number;
  breeding?: number;
  weightChange?: number;
  jockey?: number;
};

type Prediction = {
  horseId: number;
  horseName: string;
  score: number;
  ev: number;
  odds: number;
  waku?: number;
  jockey?: string;
  components?: ComponentScores | null;
};

type ResultEntry = {
  rank: number;
  horseId: number;
  horseName: string;
  time?: string;
  lastThreeF?: number;
};

type PayoutEntry = { horseId?: number; combination?: string; payout: number };

type VerificationData = {
  raceId: string;
  raceName: string;
  date: string;
  predictions: Prediction[];
  results?: {
    results: ResultEntry[];
    payouts?: { tan?: PayoutEntry[]; [k: string]: PayoutEntry[] | undefined };
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
    sexLimit?: string | null;
    courseTurn?: string;
    distance?: number;
    surface?: string;
    startTime?: string;
    raceDate?: string;
    headCount?: number;
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

/** 危険判定された馬の詳細レコード（Section 6 / 8 の表示用） */
type KikenRecord = {
  raceId: string;
  date: string;
  klass: ClassKey;
  klassLabel: string;
  raceName: string;
  horseId: number;
  horseName: string;
  jockey: string;
  score: number;
  ev: number;
  popularityRank: number;
  odds: number;
  finishRank: number | null;
  finishTime: string;
  finishLastThreeF: number | null;
  tanPayout: number;
  components: ComponentScores;
  /** 最低スコア要素 */
  minComponentName: string;
  minComponentValue: number;
  // レース条件
  distance: number;
  surface: string;
  trackCondition: string;
  weather: string;
  headCount: number;
  // 補助
  conditionType: 'evOnly' | 'scoreOnly' | 'both';
  hitWithin3: boolean; // 3着以内に来たか
};

/** 本命馬（pop=1）の詳細レコード（Section 9, 10 用） */
type HonmeiRecord = {
  raceId: string;
  klass: ClassKey;
  honmeiIsKiken: boolean;     // 本命馬自身が危険判定された
  raceHasKiken: boolean;      // レース内に危険判定された馬がいる
  odds: number;
  score: number;
  ev: number;
  finishRank: number | null;
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

  const n = raceName ?? '';
  if (/G1|G2|G3|GⅠ|GⅡ|GⅢ|オープン|（L）|\(L\)|リステッド/.test(n)) return 'OP';
  if (/3勝|1600万/.test(n)) return 'C3';
  if (/2勝|1000万/.test(n)) return 'C2';
  if (/1勝|500万/.test(n)) return 'C1';
  if (/未勝利/.test(n)) return 'UW';
  if (/新馬/.test(n)) return 'NW';
  return 'OTHER';
}

function categorizeFinish(finishRank: number | null): FinishCategory {
  if (finishRank === null) return 'cancelled';
  if (finishRank === 1) return 'rank1';
  if (finishRank === 2) return 'rank2';
  if (finishRank === 3) return 'rank3';
  if (finishRank <= 5) return 'rank4_5';
  return 'rank6plus';
}

function getMinComponent(components: ComponentScores | null | undefined): { name: string; value: number } {
  if (!components) return { name: 'N/A', value: -1 };
  const entries = Object.entries(components).filter(([, v]) => typeof v === 'number') as [string, number][];
  if (entries.length === 0) return { name: 'N/A', value: -1 };
  let minName = entries[0][0]; let minValue = entries[0][1];
  for (const [k, v] of entries) {
    if (v < minValue) { minName = k; minValue = v; }
  }
  return { name: minName, value: minValue };
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

function addToAggA(agg: AggA, finishCat: FinishCategory) {
  agg.total++;
  agg.dist[finishCat]++;
  if (finishCat === 'rank1') { agg.rank1++; agg.within2++; agg.within3++; }
  else if (finishCat === 'rank2') { agg.within2++; agg.within3++; }
  else if (finishCat === 'rank3') { agg.within3++; }
}

// ----------------------------------------
// オッズ帯・スコア帯
// ----------------------------------------
type OddsBand = '1.0-1.4' | '1.5-1.9' | '2.0-2.9' | '3.0-4.9' | '5.0-9.9' | '10+';
const ODDS_BANDS: OddsBand[] = ['1.0-1.4', '1.5-1.9', '2.0-2.9', '3.0-4.9', '5.0-9.9', '10+'];

function classifyOddsBand(odds: number): OddsBand {
  if (odds < 1.5) return '1.0-1.4';
  if (odds < 2.0) return '1.5-1.9';
  if (odds < 3.0) return '2.0-2.9';
  if (odds < 5.0) return '3.0-4.9';
  if (odds < 10.0) return '5.0-9.9';
  return '10+';
}

type ScoreBand = '<30' | '30-39' | '40-49' | '50-59' | '60+';
const SCORE_BANDS: ScoreBand[] = ['<30', '30-39', '40-49', '50-59', '60+'];

function classifyScoreBand(score: number): ScoreBand {
  if (score < 30) return '<30';
  if (score < 40) return '30-39';
  if (score < 50) return '40-49';
  if (score < 60) return '50-59';
  return '60+';
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

const kikenRecords: KikenRecord[] = []; // 危険判定された全馬の詳細
const honmeiRecords: HonmeiRecord[] = []; // 本命馬（pop=1）の詳細

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

  const results = data.results?.results;
  if (!results || results.length === 0) {
    skipped++;
    skipReasons.push(`${file}: 結果データなし`);
    continue;
  }
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

  const resultByHorseId = new Map<number, ResultEntry>();
  for (const r of results) {
    resultByHorseId.set(r.horseId, r);
  }

  // 単勝払戻マップ（horseId → payout、的中馬以外は 0）
  const tanPayoutMap = new Map<number, number>();
  for (const t of data.results?.payouts?.tan ?? []) {
    if (typeof t.horseId === 'number') tanPayoutMap.set(t.horseId, t.payout);
  }

  // 危険判定
  const kikens = data.predictions.filter(p => {
    const r = popRanks.get(p.horseId) ?? 99;
    return isKikenPopular(p, r);
  });

  // A案: 危険判定された各馬を集計＋詳細レコードに残す
  for (const h of kikens) {
    const popRank = popRanks.get(h.horseId) ?? 99;
    const result = resultByHorseId.get(h.horseId);
    const finishRank = result?.rank ?? null;
    const cat = categorizeFinish(finishRank);

    addToAggA(aggA_global, cat);
    addToAggA(aggByClass[klass].a, cat);

    const evHit = (h.ev ?? 0) < KIKEN_EV_MAX;
    const scoreHit = (h.score ?? 0) < KIKEN_SCORE_MIN;
    const condKey: 'evOnly' | 'scoreOnly' | 'both' =
      (evHit && scoreHit) ? 'both' : evHit ? 'evOnly' : 'scoreOnly';
    addToAggA(aggCond_global[condKey], cat);
    addToAggA(aggByClass[klass].cond[condKey], cat);

    const minC = getMinComponent(h.components);

    kikenRecords.push({
      raceId: data.raceId,
      date: data.date ?? data.meta?.raceDate ?? '',
      klass,
      klassLabel: CLASS_LABEL[klass],
      raceName: data.raceName ?? '',
      horseId: h.horseId,
      horseName: h.horseName,
      jockey: h.jockey ?? '',
      score: h.score,
      ev: h.ev,
      popularityRank: popRank,
      odds: h.odds,
      finishRank,
      finishTime: result?.time ?? '',
      finishLastThreeF: typeof result?.lastThreeF === 'number' ? result.lastThreeF : null,
      tanPayout: tanPayoutMap.get(h.horseId) ?? 0,
      components: h.components ?? {},
      minComponentName: minC.name,
      minComponentValue: minC.value,
      distance: data.meta?.distance ?? 0,
      surface: data.meta?.surface ?? '',
      trackCondition: data.meta?.trackCondition ?? '',
      weather: data.meta?.weather ?? '',
      headCount: data.meta?.headCount ?? 0,
      conditionType: condKey,
      hitWithin3: cat === 'rank1' || cat === 'rank2' || cat === 'rank3',
    });
  }

  // B案 + Section 9/10 用: 本命馬を記録
  const honmei = data.predictions.find(p => popRanks.get(p.horseId) === 1);
  if (honmei) {
    const honmeiResult = resultByHorseId.get(honmei.horseId);
    const honmeiFinish = honmeiResult?.rank ?? null;
    const within3 = honmeiFinish !== null && honmeiFinish <= 3;
    const target = kikens.length > 0 ? 'withKiken' : 'withoutKiken';
    aggB_global[target].races++;
    aggByClass[klass].b[target].races++;
    if (within3) {
      aggB_global[target].honmeiWithin3++;
      aggByClass[klass].b[target].honmeiWithin3++;
    }

    honmeiRecords.push({
      raceId: data.raceId,
      klass,
      honmeiIsKiken: isKikenPopular(honmei, 1),
      raceHasKiken: kikens.length > 0,
      odds: honmei.odds,
      score: honmei.score,
      ev: honmei.ev,
      finishRank: honmeiFinish,
    });
  }
}

// ----------------------------------------
// Section 9 用集計
// ----------------------------------------
type RankBucket = { races: number; rank1: number; rank2: number; rank3: number; within3: number; rank4plus: number };
function newBucket(): RankBucket {
  return { races: 0, rank1: 0, rank2: 0, rank3: 0, within3: 0, rank4plus: 0 };
}
function addToBucket(b: RankBucket, finishRank: number | null) {
  b.races++;
  if (finishRank === 1) { b.rank1++; b.within3++; }
  else if (finishRank === 2) { b.rank2++; b.within3++; }
  else if (finishRank === 3) { b.rank3++; b.within3++; }
  else b.rank4plus++; // 着外・取消
}

// 9-1: 全体
const honmei_all = newBucket();
// 9-2: あり/なし
const honmei_withKiken = newBucket();
const honmei_withoutKiken = newBucket();
// 9-3: オッズ帯別 × 危険判定あり/なし
const honmei_byOdds_with: Record<OddsBand, RankBucket> =
  Object.fromEntries(ODDS_BANDS.map(b => [b, newBucket()])) as Record<OddsBand, RankBucket>;
const honmei_byOdds_without: Record<OddsBand, RankBucket> =
  Object.fromEntries(ODDS_BANDS.map(b => [b, newBucket()])) as Record<OddsBand, RankBucket>;
// 9-4: スコア帯別 × 危険判定あり/なし
const honmei_byScore_with: Record<ScoreBand, RankBucket> =
  Object.fromEntries(SCORE_BANDS.map(b => [b, newBucket()])) as Record<ScoreBand, RankBucket>;
const honmei_byScore_without: Record<ScoreBand, RankBucket> =
  Object.fromEntries(SCORE_BANDS.map(b => [b, newBucket()])) as Record<ScoreBand, RankBucket>;

// Section 10: 本命馬自身が危険判定されたか で2分割（オッズ帯別/スコア帯別）
const honmei10_byOdds_kikenSelf: Record<OddsBand, RankBucket> =
  Object.fromEntries(ODDS_BANDS.map(b => [b, newBucket()])) as Record<OddsBand, RankBucket>;
const honmei10_byOdds_nonKikenSelf: Record<OddsBand, RankBucket> =
  Object.fromEntries(ODDS_BANDS.map(b => [b, newBucket()])) as Record<OddsBand, RankBucket>;
const honmei10_byScore_kikenSelf: Record<ScoreBand, RankBucket> =
  Object.fromEntries(SCORE_BANDS.map(b => [b, newBucket()])) as Record<ScoreBand, RankBucket>;
const honmei10_byScore_nonKikenSelf: Record<ScoreBand, RankBucket> =
  Object.fromEntries(SCORE_BANDS.map(b => [b, newBucket()])) as Record<ScoreBand, RankBucket>;

for (const h of honmeiRecords) {
  addToBucket(honmei_all, h.finishRank);
  if (h.raceHasKiken) {
    addToBucket(honmei_withKiken, h.finishRank);
    addToBucket(honmei_byOdds_with[classifyOddsBand(h.odds)], h.finishRank);
    addToBucket(honmei_byScore_with[classifyScoreBand(h.score)], h.finishRank);
  } else {
    addToBucket(honmei_withoutKiken, h.finishRank);
    addToBucket(honmei_byOdds_without[classifyOddsBand(h.odds)], h.finishRank);
    addToBucket(honmei_byScore_without[classifyScoreBand(h.score)], h.finishRank);
  }
  if (h.honmeiIsKiken) {
    addToBucket(honmei10_byOdds_kikenSelf[classifyOddsBand(h.odds)], h.finishRank);
    addToBucket(honmei10_byScore_kikenSelf[classifyScoreBand(h.score)], h.finishRank);
  } else {
    addToBucket(honmei10_byOdds_nonKikenSelf[classifyOddsBand(h.odds)], h.finishRank);
    addToBucket(honmei10_byScore_nonKikenSelf[classifyScoreBand(h.score)], h.finishRank);
  }
}

// ----------------------------------------
// レポート出力
// ----------------------------------------
const pct = (n: number, d: number): string => d === 0 ? 'N/A' : `${((n / d) * 100).toFixed(1)}%`;
const pctNum = (n: number, d: number): number => d === 0 ? 0 : (n / d) * 100;

const now = new Date();
const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
const yyyymmdd = jst.toISOString().slice(0, 10).replace(/-/g, '');
const isoNow = jst.toISOString().replace('Z', '+09:00');

// --- コンソール出力（Section 1-5 のみ簡易） ---
console.log('');
console.log('=== 危険人気馬 検証レポート ===');
console.log(`対象: ${totalRaces}R （スキップ: ${skipped}R）`);
console.log('');
console.log('【全体】');
console.log(`A案: 危険判定数 ${aggA_global.total}頭 / 3着内 ${aggA_global.within3}頭 (${pct(aggA_global.within3, aggA_global.total)})`);
console.log(`B案: 危険ありレース ${aggB_global.withKiken.races}R 本命3着内率 ${pct(aggB_global.withKiken.honmeiWithin3, aggB_global.withKiken.races)}`);
console.log(`     危険なしレース ${aggB_global.withoutKiken.races}R 本命3着内率 ${pct(aggB_global.withoutKiken.honmeiWithin3, aggB_global.withoutKiken.races)}`);
console.log('');
console.log('【発動条件別】');
console.log(`  EV<0.85 のみ: ${aggCond_global.evOnly.total}頭, 3着内率 ${pct(aggCond_global.evOnly.within3, aggCond_global.evOnly.total)}`);
console.log(`  score<55 のみ: ${aggCond_global.scoreOnly.total}頭, 3着内率 ${pct(aggCond_global.scoreOnly.within3, aggCond_global.scoreOnly.total)}`);
console.log(`  両方:          ${aggCond_global.both.total}頭, 3着内率 ${pct(aggCond_global.both.within3, aggCond_global.both.total)}`);
console.log('');
console.log('【Section 8: 危険判定が当たった例 (3着外)】');
const kikenMissCount = kikenRecords.filter(r => !r.hitWithin3).length;
console.log(`  該当: ${kikenMissCount}頭 (${pct(kikenMissCount, kikenRecords.length)} of 危険判定総数)`);
console.log('');
console.log('【Section 9-2: 本命馬の3着以内分布（あり/なし）】');
console.log(`  全体:        ${honmei_all.races}R, 3着内 ${pct(honmei_all.within3, honmei_all.races)}`);
console.log(`  危険あり:    ${honmei_withKiken.races}R, 3着内 ${pct(honmei_withKiken.within3, honmei_withKiken.races)}`);
console.log(`  危険なし:    ${honmei_withoutKiken.races}R, 3着内 ${pct(honmei_withoutKiken.within3, honmei_withoutKiken.races)}`);
console.log('');

// ----------------------------------------
// JSON 出力
// ----------------------------------------
const jsonPath = path.join(OUT_DIR, `kiken_popular_verification_${yyyymmdd}.json`);
const jsonReport = {
  generatedAt: isoNow,
  thresholds: { KIKEN_POP_TOP_N, KIKEN_EV_MAX, KIKEN_SCORE_MIN },
  summary: {
    totalRaces,
    skipped,
    skipReasons: skipReasons.slice(0, 20),
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
  honmeiSection9: {
    all: honmei_all,
    withKiken: honmei_withKiken,
    withoutKiken: honmei_withoutKiken,
    byOdds: { with: honmei_byOdds_with, without: honmei_byOdds_without },
    byScore: { with: honmei_byScore_with, without: honmei_byScore_without },
  },
  honmeiSection10: {
    byOdds: { kikenSelf: honmei10_byOdds_kikenSelf, nonKikenSelf: honmei10_byOdds_nonKikenSelf },
    byScore: { kikenSelf: honmei10_byScore_kikenSelf, nonKikenSelf: honmei10_byScore_nonKikenSelf },
  },
  kikenRecords,    // 危険判定された全馬の詳細（components 含む）
  honmeiRecords,   // 本命馬全件
};
fs.writeFileSync(jsonPath, JSON.stringify(jsonReport, null, 2), 'utf8');
console.log(`[verify_kiken] JSON 保存: ${jsonPath}`);

// ----------------------------------------
// Section 11: 自動所感生成
// ----------------------------------------
function buildSection11Insights(): string[] {
  const insights: string[] = [];

  // オッズ帯ごとの差分（Section 9: 危険判定あり vs なし）
  const oddsRows = ODDS_BANDS.map(b => {
    const w = honmei_byOdds_with[b];
    const wo = honmei_byOdds_without[b];
    return {
      band: b,
      withRate: pctNum(w.within3, w.races),
      withoutRate: pctNum(wo.within3, wo.races),
      diff: pctNum(w.within3, w.races) - pctNum(wo.within3, wo.races),
      withN: w.races,
      withoutN: wo.races,
    };
  });

  const scoreRows = SCORE_BANDS.map(b => {
    const w = honmei_byScore_with[b];
    const wo = honmei_byScore_without[b];
    return {
      band: b,
      withRate: pctNum(w.within3, w.races),
      withoutRate: pctNum(wo.within3, wo.races),
      diff: pctNum(w.within3, w.races) - pctNum(wo.within3, wo.races),
      withN: w.races,
      withoutN: wo.races,
    };
  });

  // 機能している帯 = diff が大きく負（あり < なし）かつ両側 N>=20
  const functioning = oddsRows.filter(r => r.diff <= -5 && r.withN >= 20 && r.withoutN >= 20)
    .sort((a, b) => a.diff - b.diff);
  const counterproductive = oddsRows.filter(r => r.diff >= 5 && r.withN >= 20 && r.withoutN >= 20)
    .sort((a, b) => b.diff - a.diff);

  if (functioning.length > 0) {
    insights.push(
      `<b>機能しているオッズ帯</b>: ` +
      functioning.map(r => `${r.band}（差分 ${r.diff.toFixed(1)}pt, あり=${r.withRate.toFixed(1)}%, なし=${r.withoutRate.toFixed(1)}%）`).join(' / ') +
      `。これらの帯では「危険判定あり」レースの本命3着以内率が「なし」より低く、判定が機能している。`
    );
  } else {
    insights.push(`<b>機能しているオッズ帯</b>: サンプルサイズ N≥20 と差分≥5pt の両方を満たす帯はなし。`);
  }

  if (counterproductive.length > 0) {
    insights.push(
      `<b>逆効果のオッズ帯</b>: ` +
      counterproductive.map(r => `${r.band}（差分 +${r.diff.toFixed(1)}pt, あり=${r.withRate.toFixed(1)}%, なし=${r.withoutRate.toFixed(1)}%）`).join(' / ') +
      `。これらの帯では「危険判定あり」レースの方が本命3着以内率が高く、判定が逆効果になっている可能性。`
    );
  }

  // スコア帯所感
  const scoreCondNote: string[] = [];
  const lowScoreKiken = aggCond_global.scoreOnly.total;
  const evOnlyKiken = aggCond_global.evOnly.total;
  const bothKiken = aggCond_global.both.total;
  if (evOnlyKiken === 0 && bothKiken === 0) {
    scoreCondNote.push(
      `verification データでは <code>EV&lt;0.85</code> を満たす人気上位馬が ${evOnlyKiken + bothKiken} 頭と事実上ゼロ。` +
      `現在の危険判定 ${lowScoreKiken} 頭は <b>すべて score&lt;55 のみ</b> で発動しており、EV 条件は冗長。` +
      `事後オッズベースでも EV は補正係数 0.2 / オフセット -0.02 のレンジでほぼ 0.95-1.0 に収束するため。`
    );
  }

  // スコア帯別の機能性
  const funcScore = scoreRows.filter(r => r.diff <= -5 && r.withN >= 20 && r.withoutN >= 20)
    .sort((a, b) => a.diff - b.diff);
  if (funcScore.length > 0) {
    scoreCondNote.push(
      `<b>機能しているスコア帯</b>: ` +
      funcScore.map(r => `${r.band}（差分 ${r.diff.toFixed(1)}pt）`).join(' / ')
    );
  }

  if (scoreCondNote.length > 0) {
    insights.push(scoreCondNote.join(' '));
  }

  // クラス別の所感
  const classRows = CLASS_ORDER.map(ck => {
    const c = aggByClass[ck];
    return {
      ck,
      label: CLASS_LABEL[ck],
      withinA: pctNum(c.a.within3, c.a.total),
      total: c.a.total,
      bWith: pctNum(c.b.withKiken.honmeiWithin3, c.b.withKiken.races),
      bWithout: pctNum(c.b.withoutKiken.honmeiWithin3, c.b.withoutKiken.races),
      diff: pctNum(c.b.withKiken.honmeiWithin3, c.b.withKiken.races) - pctNum(c.b.withoutKiken.honmeiWithin3, c.b.withoutKiken.races),
      bWithN: c.b.withKiken.races, bWithoutN: c.b.withoutKiken.races,
    };
  }).filter(r => r.bWithN >= 20 && r.bWithoutN >= 20);

  if (classRows.length > 0) {
    const sorted = [...classRows].sort((a, b) => a.diff - b.diff);
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];
    insights.push(
      `<b>クラス別</b>: 判定が最も機能しているのは <b>${best.label}</b>（差分 ${best.diff.toFixed(1)}pt）、` +
      `逆効果になっているのは <b>${worst.label}</b>（差分 ${worst.diff.toFixed(1)}pt）。` +
      `（N≥20 のクラスのみ評価）`
    );
  }

  // 改善提案
  const proposals: string[] = [];
  if (counterproductive.length > 0) {
    proposals.push(
      `<b>提案1</b>: 逆効果のオッズ帯（${counterproductive.map(r => r.band).join(', ')}）では危険判定の発動を抑制する条件を追加することを検討。`
    );
  }
  if (evOnlyKiken === 0 && bothKiken === 0) {
    proposals.push(
      `<b>提案2</b>: EV 条件 (EV&lt;${KIKEN_EV_MAX}) は事後オッズでは事実上発動していない。閾値を引き上げる（例: EV&lt;0.95）か、AND 条件への変更（pop≤3 && EV&lt;X && score&lt;Y）を検討。`
    );
  }
  // クラス別差が大きければ提案
  if (classRows.length > 0) {
    const sorted = [...classRows].sort((a, b) => a.withinA - b.withinA);
    const lowestA = sorted[0];
    const highestA = sorted[sorted.length - 1];
    if (highestA.withinA - lowestA.withinA >= 5) {
      proposals.push(
        `<b>提案3</b>: クラス別の3着以内率に ${(highestA.withinA - lowestA.withinA).toFixed(1)}pt の差。閾値をクラス別に分けることで精度向上の余地がある（例: ${lowestA.label}=現状, ${highestA.label}=score閾値を引き下げ）。`
      );
    }
  }
  if (proposals.length > 0) insights.push(proposals.join(' '));

  return insights;
}
const section11Insights = buildSection11Insights();

// ----------------------------------------
// HTML 出力
// ----------------------------------------
const htmlPath = path.join(OUT_DIR, `kiken_popular_verification_${yyyymmdd}.html`);
const html = renderHtml({
  generatedAt: isoNow,
  totalRaces,
  skipped,
  thresholds: { KIKEN_POP_TOP_N, KIKEN_EV_MAX, KIKEN_SCORE_MIN },
  global: { a: aggA_global, b: aggB_global, cond: aggCond_global },
  byClass: aggByClass,
  kikenRecords,
  honmeiAll: honmei_all,
  honmeiWith: honmei_withKiken,
  honmeiWithout: honmei_withoutKiken,
  honmeiByOddsWith: honmei_byOdds_with,
  honmeiByOddsWithout: honmei_byOdds_without,
  honmeiByScoreWith: honmei_byScore_with,
  honmeiByScoreWithout: honmei_byScore_without,
  honmeiByOddsKikenSelf: honmei10_byOdds_kikenSelf,
  honmeiByOddsNonKikenSelf: honmei10_byOdds_nonKikenSelf,
  honmeiByScoreKikenSelf: honmei10_byScore_kikenSelf,
  honmeiByScoreNonKikenSelf: honmei10_byScore_nonKikenSelf,
  insights: section11Insights,
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
  kikenRecords: KikenRecord[];
  honmeiAll: RankBucket;
  honmeiWith: RankBucket;
  honmeiWithout: RankBucket;
  honmeiByOddsWith: Record<OddsBand, RankBucket>;
  honmeiByOddsWithout: Record<OddsBand, RankBucket>;
  honmeiByScoreWith: Record<ScoreBand, RankBucket>;
  honmeiByScoreWithout: Record<ScoreBand, RankBucket>;
  honmeiByOddsKikenSelf: Record<OddsBand, RankBucket>;
  honmeiByOddsNonKikenSelf: Record<OddsBand, RankBucket>;
  honmeiByScoreKikenSelf: Record<ScoreBand, RankBucket>;
  honmeiByScoreNonKikenSelf: Record<ScoreBand, RankBucket>;
  insights: string[];
}): string {
  const {
    global, byClass, kikenRecords, thresholds, totalRaces, skipped, generatedAt,
    honmeiAll, honmeiWith, honmeiWithout,
    honmeiByOddsWith, honmeiByOddsWithout,
    honmeiByScoreWith, honmeiByScoreWithout,
    honmeiByOddsKikenSelf, honmeiByOddsNonKikenSelf,
    honmeiByScoreKikenSelf, honmeiByScoreNonKikenSelf,
    insights,
  } = args;

  function rateColor(rate: number): string {
    if (rate >= 35) return '#c53030';
    if (rate >= 25) return '#dd6b20';
    return '#2f855a';
  }

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

  // 本命3着分布バー（Section 9 用 - 1着/2着/3着/4着以下）
  const honmeiDistBar = (b: RankBucket): string => {
    if (b.races === 0) return '<div class="bar-empty">データなし</div>';
    const segs = [
      { label: '1着', n: b.rank1, color: '#e53e3e' },
      { label: '2着', n: b.rank2, color: '#dd6b20' },
      { label: '3着', n: b.rank3, color: '#d69e2e' },
      { label: '4着以下', n: b.rank4plus, color: '#4a5568' },
    ];
    return `<div class="bar-stack">${segs.map(s => {
      const w = (s.n / b.races) * 100;
      if (s.n === 0) return '';
      return `<div class="bar-seg" style="width:${w.toFixed(2)}%;background:${s.color}" title="${s.label}: ${s.n}R (${w.toFixed(1)}%)">${w >= 6 ? `${s.label} ${w.toFixed(1)}%` : ''}</div>`;
    }).join('')}</div>
    <div class="bar-legend">${segs.map(s => `<span><i style="background:${s.color}"></i>${s.label}: ${s.n}R (${pct(s.n, b.races)})</span>`).join(' ')}</div>`;
  };

  const rateA_within3 = pctNum(global.a.within3, global.a.total);
  const rateB_with = pctNum(global.b.withKiken.honmeiWithin3, global.b.withKiken.races);
  const rateB_without = pctNum(global.b.withoutKiken.honmeiWithin3, global.b.withoutKiken.races);
  const rateB_diff = rateB_with - rateB_without;

  const cellBg = (rate: number): string => {
    if (rate >= 40) return '#fed7d7';
    if (rate >= 30) return '#feebc8';
    if (rate >= 20) return '#fefcbf';
    if (rate >= 10) return '#c6f6d5';
    return '#bee3f8';
  };

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
    50,
  );

  // 21列テーブルの行レンダリング（Section 6 / 8 共通）
  function minComponentBg(value: number): string {
    if (value < 0) return '#e0e0e0';
    if (value < 30) return '#ff6b6b';
    if (value < 50) return '#ffa3a3';
    return '#e0e0e0';
  }
  function renderRecordRow(r: KikenRecord): string {
    return `
    <tr data-class="${r.klass}" data-finish="${r.finishRank ?? 'cancelled'}">
      <td>${escapeHtml(r.date)}</td>
      <td>${escapeHtml(r.klassLabel)}</td>
      <td>${escapeHtml(r.raceName)}</td>
      <td class="num">${r.horseId}</td>
      <td>${escapeHtml(r.horseName)}</td>
      <td>${escapeHtml(r.jockey)}</td>
      <td class="num">${r.score.toFixed(1)}</td>
      <td class="num">${r.ev.toFixed(2)}</td>
      <td class="num">${r.popularityRank}</td>
      <td class="num">${r.odds.toFixed(1)}</td>
      <td class="num"><b>${r.finishRank ?? '取消'}</b></td>
      <td class="num">${escapeHtml(r.finishTime)}</td>
      <td class="num">${r.finishLastThreeF !== null ? r.finishLastThreeF.toFixed(1) : ''}</td>
      <td class="num">${r.tanPayout > 0 ? r.tanPayout.toLocaleString() : '0'}</td>
      <td class="min-comp" style="background:${minComponentBg(r.minComponentValue)};color:${r.minComponentValue < 50 ? '#fff' : '#333'}" data-min-value="${r.minComponentValue.toFixed(2)}">${escapeHtml(r.minComponentName)}: ${r.minComponentValue.toFixed(1)}</td>
      <td class="num">${r.distance > 0 ? r.distance + 'm' : ''}</td>
      <td>${r.surface === 'turf' ? '芝' : r.surface === 'dirt' ? 'ダ' : escapeHtml(r.surface)}</td>
      <td>${escapeHtml(r.trackCondition)}</td>
      <td>${escapeHtml(r.weather)}</td>
      <td class="num">${r.headCount > 0 ? r.headCount + '頭' : ''}</td>
      <td>${escapeHtml(r.raceId)}</td>
    </tr>`;
  }

  const tableHeaderRow = `
    <tr>
      <th class="sortable" data-sort="0">開催日<span class="arrow">▲▼</span></th>
      <th class="sortable" data-sort="1">クラス<span class="arrow">▲▼</span></th>
      <th class="sortable" data-sort="2">レース<span class="arrow">▲▼</span></th>
      <th class="sortable num" data-sort="3" data-num="1">馬番<span class="arrow">▲▼</span></th>
      <th class="sortable" data-sort="4">馬名<span class="arrow">▲▼</span></th>
      <th class="sortable" data-sort="5">騎手<span class="arrow">▲▼</span></th>
      <th class="sortable num" data-sort="6" data-num="1">スコア<span class="arrow">▲▼</span></th>
      <th class="sortable num" data-sort="7" data-num="1">EV<span class="arrow">▲▼</span></th>
      <th class="sortable num" data-sort="8" data-num="1">人気<span class="arrow">▲▼</span></th>
      <th class="sortable num" data-sort="9" data-num="1">オッズ<span class="arrow">▲▼</span></th>
      <th class="sortable num" data-sort="10" data-num="1">着順<span class="arrow">▲▼</span></th>
      <th class="sortable num" data-sort="11">タイム<span class="arrow">▲▼</span></th>
      <th class="sortable num" data-sort="12" data-num="1">後3F<span class="arrow">▲▼</span></th>
      <th class="sortable num" data-sort="13" data-num="1">単勝払戻<span class="arrow">▲▼</span></th>
      <th class="sortable" data-sort="14" data-min-comp="1">最低スコア要素<span class="arrow">▲▼</span></th>
      <th class="sortable num" data-sort="15" data-num="1">距離<span class="arrow">▲▼</span></th>
      <th class="sortable" data-sort="16">馬場<span class="arrow">▲▼</span></th>
      <th class="sortable" data-sort="17">馬場状態<span class="arrow">▲▼</span></th>
      <th class="sortable" data-sort="18">天候<span class="arrow">▲▼</span></th>
      <th class="sortable num" data-sort="19" data-num="1">頭数<span class="arrow">▲▼</span></th>
      <th class="sortable" data-sort="20">レースID<span class="arrow">▲▼</span></th>
    </tr>`;

  const hits = kikenRecords.filter(r => r.hitWithin3);
  const misses = kikenRecords.filter(r => !r.hitWithin3);
  const hitsRows = hits.map(renderRecordRow).join('');
  const missesRows = misses.map(renderRecordRow).join('');

  // クラス別テーブル（Section 5）
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

  // Section 9-3 / 9-4 表
  function renderBandTable(
    bands: readonly string[],
    withMap: Record<string, RankBucket>,
    withoutMap: Record<string, RankBucket>,
    bandLabel: string,
  ): string {
    const rows = bands.map(b => {
      const w = withMap[b]; const wo = withoutMap[b];
      const wRate = pctNum(w.within3, w.races);
      const woRate = pctNum(wo.within3, wo.races);
      const diff = wRate - woRate;
      return `<tr>
        <td><b>${escapeHtml(b)}</b></td>
        <td class="num">${w.races}R</td>
        <td class="num">${pct(w.rank1, w.races)}</td>
        <td class="num">${pct(w.rank1 + w.rank2, w.races)}</td>
        <td class="num" style="background:${cellBg(wRate)}">${pct(w.within3, w.races)}</td>
        <td class="num">${wo.races}R</td>
        <td class="num">${pct(wo.rank1, wo.races)}</td>
        <td class="num">${pct(wo.rank1 + wo.rank2, wo.races)}</td>
        <td class="num" style="background:${cellBg(woRate)}">${pct(wo.within3, wo.races)}</td>
        <td class="num" style="color:${diff < 0 ? '#2f855a' : '#c53030'};font-weight:700">${w.races > 0 && wo.races > 0 ? (diff >= 0 ? '+' : '') + diff.toFixed(1) + 'pt' : 'N/A'}</td>
      </tr>`;
    }).join('');
    return `<table>
      <thead><tr>
        <th>${escapeHtml(bandLabel)}</th>
        <th class="num" colspan="4" style="text-align:center;background:#fff5f5">危険判定<b>あり</b></th>
        <th class="num" colspan="4" style="text-align:center;background:#f0fff4">危険判定<b>なし</b></th>
        <th class="num" rowspan="2">差分(あり-なし)</th>
      </tr><tr>
        <th></th>
        <th class="num">レース数</th><th class="num">1着率</th><th class="num">2着内</th><th class="num">3着内</th>
        <th class="num">レース数</th><th class="num">1着率</th><th class="num">2着内</th><th class="num">3着内</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  // Section 10 表（本命馬自身が危険判定された/されなかった の比較）
  function renderSection10Table(
    bands: readonly string[],
    kikenSelfMap: Record<string, RankBucket>,
    nonKikenSelfMap: Record<string, RankBucket>,
    bandLabel: string,
  ): string {
    const rows = bands.map(b => {
      const k = kikenSelfMap[b]; const nk = nonKikenSelfMap[b];
      const kRate = pctNum(k.within3, k.races);
      const nkRate = pctNum(nk.within3, nk.races);
      const diff = kRate - nkRate;
      let diffBg = '#e2e8f0'; // grey neutral
      let diffColor = '#4a5568';
      const sampleOk = k.races >= 20 && nk.races >= 20;
      if (sampleOk) {
        if (diff <= -5) { diffBg = '#c6f6d5'; diffColor = '#22543d'; } // 緑：機能（危険判定された方が低い）
        else if (diff >= 5) { diffBg = '#fed7d7'; diffColor = '#742a2a'; } // 赤：逆効果
      }
      return `<tr>
        <td><b>${escapeHtml(b)}</b></td>
        <td class="num">${k.races}R</td>
        <td class="num" style="background:${cellBg(kRate)}">${pct(k.within3, k.races)}</td>
        <td class="num">${nk.races}R</td>
        <td class="num" style="background:${cellBg(nkRate)}">${pct(nk.within3, nk.races)}</td>
        <td class="num" style="background:${diffBg};color:${diffColor};font-weight:700">${sampleOk ? (diff >= 0 ? '+' : '') + diff.toFixed(1) + 'pt' : `N不足(${k.races}/${nk.races})`}</td>
      </tr>`;
    }).join('');
    return `<table>
      <thead><tr>
        <th>${escapeHtml(bandLabel)}</th>
        <th class="num" colspan="2" style="text-align:center;background:#fff5f5">本命が危険判定された</th>
        <th class="num" colspan="2" style="text-align:center;background:#f0fff4">本命が危険判定されてない</th>
        <th class="num" rowspan="2">差分(危険-非危険)</th>
      </tr><tr>
        <th></th>
        <th class="num">レース数</th><th class="num">3着内率</th>
        <th class="num">レース数</th><th class="num">3着内率</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

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
  .container { max-width: 1400px; margin: 0 auto; }
  h1 { font-size: 1.6rem; margin: 0 0 0.5rem; }
  h2 { font-size: 1.15rem; margin: 0 0 0.8rem; padding-bottom: 0.4rem; border-bottom: 2px solid var(--accent); color: var(--accent); }
  h3 { font-size: 0.95rem; margin: 1rem 0 0.5rem; color: var(--fg2); }
  .meta-line { color: var(--fg2); font-size: 0.85rem; margin-bottom: 2rem; }
  section { background: var(--bg); border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem;
            box-shadow: 0 1px 3px rgba(0,0,0,0.08); }

  .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; }
  .summary-card { padding: 1rem; border-radius: 6px; background: var(--bg2); border: 1px solid var(--line); }
  .summary-card .label { font-size: 0.75rem; color: var(--fg2); margin-bottom: 0.4rem; }
  .summary-card .value { font-size: 1.8rem; font-weight: 800; line-height: 1; }
  .summary-card .sub { font-size: 0.7rem; color: var(--fg2); margin-top: 0.4rem; }

  .bar-stack { display: flex; height: 36px; border-radius: 4px; overflow: hidden;
               border: 1px solid var(--line); margin-bottom: 0.5rem; }
  .bar-seg { color: #fff; font-size: 0.7rem; font-weight: 600; padding: 0 0.4rem;
             display: flex; align-items: center; justify-content: center; white-space: nowrap; overflow: hidden; }
  .bar-empty { color: var(--fg2); font-size: 0.85rem; padding: 0.4rem; }
  .bar-legend { display: flex; flex-wrap: wrap; gap: 0.7rem; font-size: 0.75rem; color: var(--fg2); }
  .bar-legend span { display: inline-flex; align-items: center; gap: 0.2rem; }
  .bar-legend i { width: 10px; height: 10px; display: inline-block; border-radius: 2px; }

  .compare-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1rem; align-items: stretch; }
  .compare-card { padding: 1.2rem; border-radius: 6px; background: var(--bg2); border: 1px solid var(--line); text-align: center; }
  .compare-card.diff { background: #fffbea; border-color: #f6e05e; }
  .compare-card .label { font-size: 0.78rem; color: var(--fg2); margin-bottom: 0.6rem; }
  .compare-card .value { font-size: 2rem; font-weight: 800; line-height: 1; }
  .compare-card .sub { font-size: 0.72rem; color: var(--fg2); margin-top: 0.5rem; }

  .cond-row { display: grid; grid-template-columns: 200px 1fr 120px; gap: 0.8rem; align-items: center; margin-bottom: 0.6rem; }
  .cond-label { font-size: 0.85rem; font-weight: 600; }
  .cond-bar-track { height: 28px; background: var(--bg2); border: 1px solid var(--line); border-radius: 4px; position: relative; overflow: hidden; }
  .cond-bar-fill { height: 100%; min-width: 40px; display: flex; align-items: center; justify-content: flex-end;
                   padding: 0 0.6rem; color: #fff; font-weight: 700; font-size: 0.85rem; }
  .cond-meta { font-size: 0.78rem; color: var(--fg2); text-align: right; }

  table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
  th, td { padding: 0.4rem 0.6rem; border-bottom: 1px solid var(--line); text-align: left; }
  th { background: var(--bg2); font-weight: 700; color: var(--fg2); cursor: pointer; user-select: none; white-space: nowrap; }
  th.sortable:hover { background: #edf2f7; }
  th .arrow { font-size: 0.6rem; opacity: 0.4; margin-left: 0.2rem; }
  th.active .arrow { opacity: 1; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.min-comp { font-size: 0.72rem; font-weight: 600; white-space: nowrap; }
  tbody tr:nth-child(even) { background: var(--bg2); }
  tbody tr:hover { background: #ebf8ff; }
  .table-scroll { overflow-x: auto; max-height: 700px; overflow-y: auto; border: 1px solid var(--line); border-radius: 4px; }
  .table-scroll table { font-size: 0.78rem; }
  .table-scroll th { position: sticky; top: 0; z-index: 2; }

  .filter-bar { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-bottom: 0.8rem; align-items: center; }
  .filter-bar .label { font-size: 0.78rem; color: var(--fg2); margin-right: 0.4rem; }
  .filter-btn { padding: 0.3rem 0.7rem; border: 1px solid var(--line); background: #fff; border-radius: 4px;
                font-size: 0.78rem; cursor: pointer; }
  .filter-btn.active { background: var(--accent); color: #fff; border-color: var(--accent); }
  .filter-btn:hover { background: #edf2f7; }
  .filter-btn.active:hover { background: var(--accent); opacity: 0.9; }

  .meta-table { width: auto; }
  .meta-table td { padding: 0.3rem 0.7rem; }
  .meta-table td:first-child { color: var(--fg2); }

  .threshold { display: inline-block; padding: 0.15rem 0.5rem; background: #edf2f7; border-radius: 3px;
               font-family: monospace; font-size: 0.78rem; margin-right: 0.4rem; }
  .note { font-size: 0.78rem; color: var(--fg2); margin-top: 0.5rem; line-height: 1.6; }

  .insight { padding: 1rem 1.2rem; background: #fff5f5; border-left: 4px solid #fc8181; border-radius: 4px;
             margin-bottom: 0.8rem; line-height: 1.7; font-size: 0.88rem; }
  .insight code { background: #fff; padding: 0.1rem 0.3rem; border-radius: 3px; font-size: 0.85rem; }
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
    <h2>Section 4: 発動条件別の予測力</h2>
    <div class="note" style="margin-bottom:1rem">
      閾値は OR 条件（EV または score）。両方を独立に評価し、どちらが「危険」のシグナルとして強いかを比較する。
    </div>
    ${condBar('EV<0.85 のみ満たす', global.cond.evOnly, condMaxRate)}
    ${condBar('score<55 のみ満たす', global.cond.scoreOnly, condMaxRate)}
    ${condBar('両方満たす', global.cond.both, condMaxRate)}
    <div class="note" style="margin-top:1rem">
      バーは 3着以内率を表示。<b>低いほど判定として機能している</b>（人気馬なのに着内に来ない＝判定が当たっている）。
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
      <tbody>${classRows}</tbody>
    </table>
    <div class="note">セルの背景色は的中率の目安: 青＜緑＜黄＜橙＜赤（赤は40%超）。差分はB案の差分（あり − なし、ptは percentage point）。</div>
  </section>

  <section>
    <h2>Section 6: 危険判定が外れた例（3着以内に来た馬）</h2>
    <div class="filter-bar">
      <span class="label">クラス:</span>
      <button class="filter-btn active" data-table="hits" data-filter-class="all">すべて</button>
      ${CLASS_ORDER.filter(c => hits.some(h => h.klass === c)).map(c =>
        `<button class="filter-btn" data-table="hits" data-filter-class="${c}">${escapeHtml(CLASS_LABEL[c])}</button>`
      ).join('')}
    </div>
    <div class="filter-bar">
      <span class="label">着順:</span>
      <button class="filter-btn active" data-table="hits" data-filter-finish="all">すべて</button>
      <button class="filter-btn" data-table="hits" data-filter-finish="1">1着</button>
      <button class="filter-btn" data-table="hits" data-filter-finish="2">2着</button>
      <button class="filter-btn" data-table="hits" data-filter-finish="3">3着</button>
    </div>
    <div class="table-scroll">
      <table id="hits-table" data-table-id="hits">
        <thead>${tableHeaderRow}</thead>
        <tbody>${hitsRows}</tbody>
      </table>
    </div>
    <div class="note" style="margin-top:0.6rem">全 ${hits.length} 件。列ヘッダクリックでソート可能。</div>
  </section>

  <section>
    <h2>Section 8: 危険判定が当たった例（3着以内に来なかった馬）</h2>
    <div class="filter-bar">
      <span class="label">クラス:</span>
      <button class="filter-btn active" data-table="misses" data-filter-class="all">すべて</button>
      ${CLASS_ORDER.filter(c => misses.some(h => h.klass === c)).map(c =>
        `<button class="filter-btn" data-table="misses" data-filter-class="${c}">${escapeHtml(CLASS_LABEL[c])}</button>`
      ).join('')}
    </div>
    <div class="filter-bar">
      <span class="label">着順:</span>
      <button class="filter-btn active" data-table="misses" data-filter-finish="all">すべて</button>
      <button class="filter-btn" data-table="misses" data-filter-finish="4">4着</button>
      <button class="filter-btn" data-table="misses" data-filter-finish="5">5着</button>
      <button class="filter-btn" data-table="misses" data-filter-finish="6plus">6着以下</button>
      <button class="filter-btn" data-table="misses" data-filter-finish="cancelled">取消・除外</button>
    </div>
    <div class="table-scroll">
      <table id="misses-table" data-table-id="misses">
        <thead>${tableHeaderRow}</thead>
        <tbody>${missesRows}</tbody>
      </table>
    </div>
    <div class="note" style="margin-top:0.6rem">全 ${misses.length} 件。列ヘッダクリックでソート可能。Section 6 と同列構成（21列）で上下比較可能。</div>
  </section>

  <section>
    <h2>Section 9: 本命人気が3着以内に来たレースの分布</h2>

    <h3>9-1: 全体集計</h3>
    <div class="summary-grid" style="grid-template-columns: repeat(3, 1fr); margin-bottom: 0.8rem;">
      <div class="summary-card">
        <div class="label">対象レース数</div>
        <div class="value">${honmeiAll.races}R</div>
      </div>
      <div class="summary-card">
        <div class="label">本命3着以内</div>
        <div class="value" style="color:${rateColor(pctNum(honmeiAll.within3, honmeiAll.races))}">${pct(honmeiAll.within3, honmeiAll.races)}</div>
        <div class="sub">${honmeiAll.within3}R</div>
      </div>
      <div class="summary-card">
        <div class="label">うち1着</div>
        <div class="value" style="color:${rateColor(pctNum(honmeiAll.rank1, honmeiAll.races))}">${pct(honmeiAll.rank1, honmeiAll.races)}</div>
        <div class="sub">${honmeiAll.rank1}R</div>
      </div>
    </div>
    ${honmeiDistBar(honmeiAll)}

    <h3>9-2: 危険判定あり vs なし の比較</h3>
    <table>
      <thead><tr>
        <th>区分</th><th class="num">レース数</th>
        <th class="num">1着</th><th class="num">2着</th><th class="num">3着</th><th class="num">4着以下</th>
        <th class="num">3着以内率</th>
      </tr></thead>
      <tbody>
        <tr>
          <td><b>危険判定あり</b></td>
          <td class="num">${honmeiWith.races}R</td>
          <td class="num">${honmeiWith.rank1}</td>
          <td class="num">${honmeiWith.rank2}</td>
          <td class="num">${honmeiWith.rank3}</td>
          <td class="num">${honmeiWith.rank4plus}</td>
          <td class="num" style="background:${cellBg(pctNum(honmeiWith.within3, honmeiWith.races))}"><b>${pct(honmeiWith.within3, honmeiWith.races)}</b></td>
        </tr>
        <tr>
          <td><b>危険判定なし</b></td>
          <td class="num">${honmeiWithout.races}R</td>
          <td class="num">${honmeiWithout.rank1}</td>
          <td class="num">${honmeiWithout.rank2}</td>
          <td class="num">${honmeiWithout.rank3}</td>
          <td class="num">${honmeiWithout.rank4plus}</td>
          <td class="num" style="background:${cellBg(pctNum(honmeiWithout.within3, honmeiWithout.races))}"><b>${pct(honmeiWithout.within3, honmeiWithout.races)}</b></td>
        </tr>
      </tbody>
    </table>

    <h3>9-3: オッズ帯別の内訳（危険判定あり/なし並列）</h3>
    ${renderBandTable(ODDS_BANDS, honmeiByOddsWith, honmeiByOddsWithout, 'オッズ帯')}

    <h3>9-4: スコア帯別の内訳（危険判定あり/なし並列）</h3>
    ${renderBandTable(SCORE_BANDS, honmeiByScoreWith, honmeiByScoreWithout, 'スコア帯')}
    <div class="note">「あり/なし」は<b>そのレースに危険判定された馬がいるかどうか</b>で分割。本命馬自身が危険判定されたかとは異なる軸（後者は Section 10）。</div>
  </section>

  <section>
    <h2>Section 10: 危険判定 vs 非危険判定の本命馬比較</h2>
    <div class="note" style="margin-bottom:1rem">
      本命馬（pop=1）自身が危険判定された／されなかった でグループ分けし、3着以内率を比較。
      差分セルの色: <span style="background:#c6f6d5;padding:0.1rem 0.4rem;border-radius:3px">緑=機能（差分≤-5pt）</span>
      / <span style="background:#e2e8f0;padding:0.1rem 0.4rem;border-radius:3px">中立(±5pt以内)</span>
      / <span style="background:#fed7d7;padding:0.1rem 0.4rem;border-radius:3px">赤=逆効果（差分≥+5pt）</span>。
      サンプル N&lt;20 のセルは「N不足」と表示し色判定はしない。
    </div>
    <h3>10-1: オッズ帯別</h3>
    ${renderSection10Table(ODDS_BANDS, honmeiByOddsKikenSelf, honmeiByOddsNonKikenSelf, 'オッズ帯')}

    <h3>10-2: スコア帯別</h3>
    ${renderSection10Table(SCORE_BANDS, honmeiByScoreKikenSelf, honmeiByScoreNonKikenSelf, 'スコア帯')}
  </section>

  <section>
    <h2>Section 11: サマリー所感（自動生成）</h2>
    ${insights.length === 0 ? '<div class="insight">特筆すべき所感なし</div>' : insights.map(s => `<div class="insight">${s}</div>`).join('')}
    <div class="note">サンプル N&lt;20 のセルは所感生成から除外している。完全な数値は Section 5/9/10 のテーブルを参照。</div>
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
  // テーブルごとにフィルタ状態を持つ
  const tables = {};
  document.querySelectorAll('[data-table-id]').forEach(t => {
    tables[t.dataset.tableId] = {
      tbody: t.querySelector('tbody'),
      rows: Array.from(t.querySelectorAll('tbody tr')),
      filterClass: 'all',
      filterFinish: 'all',
      lastSort: -1,
      lastDir: 1,
    };
  });

  function applyFilter(tid) {
    const t = tables[tid];
    if (!t) return;
    t.rows.forEach(r => {
      const c = r.dataset.class;
      const f = r.dataset.finish;
      const okClass = t.filterClass === 'all' || c === t.filterClass;
      let okFinish = false;
      if (t.filterFinish === 'all') okFinish = true;
      else if (t.filterFinish === '1' || t.filterFinish === '2' || t.filterFinish === '3') {
        okFinish = String(f) === t.filterFinish;
      } else if (t.filterFinish === '4') okFinish = String(f) === '4';
      else if (t.filterFinish === '5') okFinish = String(f) === '5';
      else if (t.filterFinish === '6plus') {
        const n = parseInt(f, 10);
        okFinish = !isNaN(n) && n >= 6;
      } else if (t.filterFinish === 'cancelled') okFinish = f === 'cancelled';
      r.style.display = (okClass && okFinish) ? '' : 'none';
    });
  }

  document.querySelectorAll('[data-filter-class]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tid = btn.dataset.table;
      tables[tid].filterClass = btn.dataset.filterClass;
      document.querySelectorAll('[data-table="' + tid + '"][data-filter-class]').forEach(b => b.classList.toggle('active', b === btn));
      applyFilter(tid);
    });
  });
  document.querySelectorAll('[data-filter-finish]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tid = btn.dataset.table;
      tables[tid].filterFinish = btn.dataset.filterFinish;
      document.querySelectorAll('[data-table="' + tid + '"][data-filter-finish]').forEach(b => b.classList.toggle('active', b === btn));
      applyFilter(tid);
    });
  });

  // ソート
  document.querySelectorAll('table[data-table-id]').forEach(table => {
    const tid = table.dataset.tableId;
    const t = tables[tid];
    table.querySelectorAll('th.sortable').forEach(th => {
      th.addEventListener('click', () => {
        const idx = parseInt(th.dataset.sort, 10);
        const isNum = th.dataset.num === '1';
        const isMinComp = th.dataset.minComp === '1';
        const dir = (idx === t.lastSort) ? -t.lastDir : 1;
        t.lastSort = idx; t.lastDir = dir;
        table.querySelectorAll('th.sortable').forEach(x => x.classList.remove('active'));
        th.classList.add('active');
        const visible = t.rows.filter(r => r.style.display !== 'none');
        const hidden = t.rows.filter(r => r.style.display === 'none');
        visible.sort((a, b) => {
          const ac = a.children[idx];
          const bc = b.children[idx];
          if (isMinComp) {
            const av = parseFloat(ac.dataset.minValue);
            const bv = parseFloat(bc.dataset.minValue);
            return (av - bv) * dir;
          }
          const av = ac.textContent.trim();
          const bv = bc.textContent.trim();
          if (isNum) {
            const an = parseFloat(av.replace(/[^\\d.\\-]/g, ''));
            const bn = parseFloat(bv.replace(/[^\\d.\\-]/g, ''));
            return (an - bn) * dir;
          }
          return av.localeCompare(bv, 'ja') * dir;
        });
        t.tbody.innerHTML = '';
        visible.forEach(r => t.tbody.appendChild(r));
        hidden.forEach(r => t.tbody.appendChild(r));
      });
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
