// ==========================================
// 三連複・三連単の戦略比較バックテスト
//
// scripts/verification/*.json を使って 5 戦略を比較する:
//   1. EV 上位5頭 BOX (=現行相当)
//   2. EV≥1.00 + 上位5頭 (5頭未満なら不参加)
//   3. スコア上位5頭 BOX (全レース参加)
//   4. ハイブリッド (軸 EV≥1.05, ひも EV≥0.95)
//   5. EV 上位3頭 BOX (点数少ない)
//
// 実行: pnpm tsx scripts/backtest_trifecta.ts
// 出力: コンソール + scripts/verification/trifecta_strategies_report.md
// ==========================================

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { VerificationData } from '../lib/scraper/types';

// ----------------------------------------
// 定数
// ----------------------------------------

const VERIFICATION_DIR = path.resolve(__dirname, 'verification');
const REPORT_PATH = path.join(VERIFICATION_DIR, 'trifecta_strategies_report.md');

const EV_AXIS_MIN = 1.05; // 軸の EV 下限
const EV_SPOKE_MIN = 0.95; // ひもの EV 下限
const EV_LOOSE_MIN = 1.00; // 戦略2の緩和閾値
const MAX_PICKS_5 = 5;
const MAX_PICKS_3 = 3;

/** オッズ帯 */
const ODDS_BAND = {
  favorite: { label: '人気馬 (〜5倍)',  min: 0,  max: 5 },
  middle:   { label: '中穴 (5〜20倍)', min: 5,  max: 20 },
  longshot: { label: '大穴 (20倍以上)', min: 20, max: Infinity },
} as const;
type Band = keyof typeof ODDS_BAND;

function bandOf(odds: number): Band {
  if (odds < ODDS_BAND.favorite.max) return 'favorite';
  if (odds < ODDS_BAND.middle.max)   return 'middle';
  return 'longshot';
}

// ----------------------------------------
// 組み合わせ / 順列
// ----------------------------------------

function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [head, ...rest] = arr;
  return [
    ...combinations(rest, k - 1).map((c) => [head, ...c]),
    ...combinations(rest, k),
  ];
}

function permutations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const p of permutations(rest, k - 1)) result.push([arr[i], ...p]);
  }
  return result;
}

function sameSet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  return [...a].sort((x, y) => x - y).join(',') === [...b].sort((x, y) => x - y).join(',');
}

function sameSequence(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// ----------------------------------------
// 戦略: 馬リストの選出ロジック
// ----------------------------------------

type Prediction = VerificationData['predictions'][number];

/** 戦略が返す値: 三連複/三連単で購入する組み合わせセット */
type StrategyResult = {
  /** レースに参加するか (false = 不参加・投資 0) */
  participated: boolean;
  /** 三連複で買う馬番の組み合わせ (unordered 3頭セット) */
  sanfukuCombos: number[][];
  /** 三連単で買う馬番の順列 (ordered 3頭) */
  santanPerms: number[][];
  /** 選出された馬 (レポート用) */
  selectedIds: number[];
};

/** 戦略1: EV 上位5頭 BOX */
function strategy1_EvTop5Box(preds: Prediction[]): StrategyResult {
  const sorted = [...preds]
    .filter((p) => p.odds > 0)
    .sort((a, b) => b.ev - a.ev)
    .slice(0, MAX_PICKS_5);
  if (sorted.length < 3) return { participated: false, sanfukuCombos: [], santanPerms: [], selectedIds: [] };
  const ids = sorted.map((p) => p.horseId);
  return {
    participated: true,
    sanfukuCombos: combinations(ids, 3),
    santanPerms:   permutations(ids, 3),
    selectedIds:   ids,
  };
}

/** 戦略2: EV≥1.00 + 上位5頭 (5頭未満なら不参加) */
function strategy2_EvThresholdTop5(preds: Prediction[]): StrategyResult {
  const sorted = preds
    .filter((p) => p.odds > 0 && p.ev >= EV_LOOSE_MIN)
    .sort((a, b) => b.ev - a.ev)
    .slice(0, MAX_PICKS_5);
  if (sorted.length < 5) return { participated: false, sanfukuCombos: [], santanPerms: [], selectedIds: [] };
  const ids = sorted.map((p) => p.horseId);
  return {
    participated: true,
    sanfukuCombos: combinations(ids, 3),
    santanPerms:   permutations(ids, 3),
    selectedIds:   ids,
  };
}

/** 戦略3: スコア上位5頭 BOX (全レース参加) */
function strategy3_ScoreTop5Box(preds: Prediction[]): StrategyResult {
  const sorted = [...preds]
    .filter((p) => p.odds > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_PICKS_5);
  if (sorted.length < 3) return { participated: false, sanfukuCombos: [], santanPerms: [], selectedIds: [] };
  const ids = sorted.map((p) => p.horseId);
  return {
    participated: true,
    sanfukuCombos: combinations(ids, 3),
    santanPerms:   permutations(ids, 3),
    selectedIds:   ids,
  };
}

/**
 * 戦略4: ハイブリッド (軸 EV≥1.05, ひも EV≥0.95)
 *   三連複: 軸+ひもの全集合でBOX (= C(axes∪spokes, 3))
 *   三連単: 軸を「1着」に固定、ひもを「2-3着」に配置
 *     - 軸1頭なら:   軸 × P(ひも, 2)
 *     - 軸2頭以上なら: 各軸を1着候補として上記を足し合わせる
 *   条件: 軸≥1頭 かつ ひも≥2頭
 */
function strategy4_Hybrid(preds: Prediction[]): StrategyResult {
  const sorted = [...preds].filter((p) => p.odds > 0).sort((a, b) => b.ev - a.ev);
  const axes   = sorted.filter((p) => p.ev >= EV_AXIS_MIN).slice(0, 2);
  const spokes = sorted
    .filter((p) => p.ev >= EV_SPOKE_MIN && p.ev < EV_AXIS_MIN)
    .slice(0, 4);

  if (axes.length < 1 || spokes.length < 2) {
    return { participated: false, sanfukuCombos: [], santanPerms: [], selectedIds: [] };
  }

  const axesIds   = axes.map((p) => p.horseId);
  const spokesIds = spokes.map((p) => p.horseId);
  const allIds    = [...axesIds, ...spokesIds];

  // 三連複: 軸+ひも 全集合から3頭選ぶ BOX
  const sanfukuCombos = combinations(allIds, 3);

  // 三連単: 軸を1着固定、残りの2-3着をひも+(残りの軸)で組む
  const santanPerms: number[][] = [];
  for (const axis of axesIds) {
    const otherAxes = axesIds.filter((a) => a !== axis);
    const pool = [...otherAxes, ...spokesIds]; // 2-3着候補
    for (const [p2, p3] of permutations(pool, 2)) {
      santanPerms.push([axis, p2, p3]);
    }
  }

  return {
    participated: true,
    sanfukuCombos,
    santanPerms,
    selectedIds: allIds,
  };
}

/** 戦略5: EV 上位3頭 BOX (点数少ない = 現行 backtest.ts と同じ) */
function strategy5_EvTop3Box(preds: Prediction[]): StrategyResult {
  const sorted = [...preds]
    .filter((p) => p.odds > 0)
    .sort((a, b) => b.ev - a.ev)
    .slice(0, MAX_PICKS_3);
  if (sorted.length < 3) return { participated: false, sanfukuCombos: [], santanPerms: [], selectedIds: [] };
  const ids = sorted.map((p) => p.horseId);
  return {
    participated: true,
    sanfukuCombos: combinations(ids, 3),
    santanPerms:   permutations(ids, 3),
    selectedIds:   ids,
  };
}

// ----------------------------------------
// 1戦略の評価
// ----------------------------------------

type BetResult = {
  /** 購入点数 */
  points: number;
  /** 投資額 (100円 × 点数) */
  cost: number;
  /** 払戻額 */
  payout: number;
  /** 的中した点数 */
  hitPoints: number;
};

function evaluateSanfuku(combos: number[][], vd: VerificationData): BetResult {
  const points = combos.length;
  let payout = 0;
  let hitPoints = 0;
  for (const combo of combos) {
    for (const s of vd.results.payouts.sanfuku) {
      const nums = s.combination.split('-').map(Number);
      if (sameSet(combo, nums)) { payout += s.payout; hitPoints++; break; }
    }
  }
  return { points, cost: 100 * points, payout, hitPoints };
}

function evaluateSantan(perms: number[][], vd: VerificationData): BetResult {
  const points = perms.length;
  let payout = 0;
  let hitPoints = 0;
  for (const perm of perms) {
    for (const s of vd.results.payouts.santan) {
      const nums = s.combination.split('-').map(Number);
      if (sameSequence(perm, nums)) { payout += s.payout; hitPoints++; break; }
    }
  }
  return { points, cost: 100 * points, payout, hitPoints };
}

// ----------------------------------------
// 集計
// ----------------------------------------

type StrategyAgg = {
  name: string;
  participatedRaces: number;
  totalRaces: number;
  // 三連複
  sanfukuHits: number;       // 的中レース数
  sanfukuCost: number;
  sanfukuPayout: number;
  sanfukuPoints: number;
  // 三連単
  santanHits: number;
  santanCost: number;
  santanPayout: number;
  santanPoints: number;
  // サンプル (レポート用)
  samples: Array<{
    raceId: string;
    raceName: string;
    selectedIds: number[];
    sanfukuPayout: number;
    santanPayout: number;
  }>;
};

function emptyAgg(name: string): StrategyAgg {
  return {
    name,
    participatedRaces: 0,
    totalRaces: 0,
    sanfukuHits: 0, sanfukuCost: 0, sanfukuPayout: 0, sanfukuPoints: 0,
    santanHits:  0, santanCost:  0, santanPayout:  0, santanPoints:  0,
    samples: [],
  };
}

type StrategyFn = (preds: Prediction[]) => StrategyResult;

const STRATEGIES: Array<{ key: string; name: string; fn: StrategyFn }> = [
  { key: 's1', name: '戦略1: EV上位5頭BOX',           fn: strategy1_EvTop5Box },
  { key: 's2', name: '戦略2: EV≥1.00 + 上位5頭',      fn: strategy2_EvThresholdTop5 },
  { key: 's3', name: '戦略3: スコア上位5頭BOX',        fn: strategy3_ScoreTop5Box },
  { key: 's4', name: '戦略4: ハイブリッド(軸+ひも)',   fn: strategy4_Hybrid },
  { key: 's5', name: '戦略5: EV上位3頭BOX',           fn: strategy5_EvTop3Box },
];

function aggregateAll(allData: VerificationData[]): Map<string, StrategyAgg> {
  const result = new Map<string, StrategyAgg>();
  for (const s of STRATEGIES) result.set(s.key, emptyAgg(s.name));

  for (const vd of allData) {
    if (vd.predictions.length < 3 || vd.results.results.length === 0) continue;

    for (const s of STRATEGIES) {
      const agg = result.get(s.key)!;
      agg.totalRaces++;
      const pick = s.fn(vd.predictions);
      if (!pick.participated) continue;

      agg.participatedRaces++;
      const sf = evaluateSanfuku(pick.sanfukuCombos, vd);
      const st = evaluateSantan(pick.santanPerms, vd);

      agg.sanfukuPoints  += sf.points;
      agg.sanfukuCost    += sf.cost;
      agg.sanfukuPayout  += sf.payout;
      if (sf.hitPoints > 0) agg.sanfukuHits++;

      agg.santanPoints  += st.points;
      agg.santanCost    += st.cost;
      agg.santanPayout  += st.payout;
      if (st.hitPoints > 0) agg.santanHits++;

      // サンプル収集: 最大20件 (あとで上位/下位5件を切り出す)
      if (agg.samples.length < 500) {
        agg.samples.push({
          raceId: vd.raceId,
          raceName: vd.raceName,
          selectedIds: pick.selectedIds,
          sanfukuPayout: sf.payout - sf.cost,
          santanPayout:  st.payout - st.cost,
        });
      }
    }
  }
  return result;
}

// ----------------------------------------
// オッズ帯別の的中分布 (戦略ごと、三連複ベース)
// ----------------------------------------

function oddsBandDistribution(
  allData: VerificationData[],
  stratFn: StrategyFn,
): Record<Band, { hitRaces: number; totalRaces: number }> {
  const stats: Record<Band, { hitRaces: number; totalRaces: number }> = {
    favorite: { hitRaces: 0, totalRaces: 0 },
    middle:   { hitRaces: 0, totalRaces: 0 },
    longshot: { hitRaces: 0, totalRaces: 0 },
  };

  for (const vd of allData) {
    if (vd.predictions.length < 3 || vd.results.results.length === 0) continue;
    const pick = stratFn(vd.predictions);
    if (!pick.participated) continue;

    // レース代表オッズ = 選出馬の中での平均オッズ (帯分類用)
    const selectedPreds = vd.predictions.filter((p) => pick.selectedIds.includes(p.horseId));
    const avgOdds = selectedPreds.reduce((s, p) => s + p.odds, 0) / Math.max(1, selectedPreds.length);
    const band = bandOf(avgOdds);

    stats[band].totalRaces++;
    const hit = evaluateSanfuku(pick.sanfukuCombos, vd).hitPoints > 0;
    if (hit) stats[band].hitRaces++;
  }

  return stats;
}

// ----------------------------------------
// 出力ユーティリティ
// ----------------------------------------

function roi(cost: number, payout: number): number {
  return cost > 0 ? (payout / cost) * 100 : 0;
}

function pct(num: number, den: number): string {
  return den === 0 ? 'N/A' : `${((num / den) * 100).toFixed(1)}%`;
}

// ----------------------------------------
// メイン
// ----------------------------------------

async function loadAllData(): Promise<VerificationData[]> {
  const files = (await fs.readdir(VERIFICATION_DIR)).filter((f) => f.endsWith('.json'));
  const out: VerificationData[] = [];
  for (const f of files) {
    try {
      const raw = await fs.readFile(path.join(VERIFICATION_DIR, f), 'utf-8');
      out.push(JSON.parse(raw) as VerificationData);
    } catch { /* ignore */ }
  }
  return out;
}

async function main(): Promise<void> {
  const allData = await loadAllData();
  if (allData.length === 0) {
    console.error('検証データが見つかりません');
    process.exit(1);
  }

  const aggs = aggregateAll(allData);
  const bandsByStrategy = new Map<string, ReturnType<typeof oddsBandDistribution>>();
  for (const s of STRATEGIES) {
    bandsByStrategy.set(s.key, oddsBandDistribution(allData, s.fn));
  }

  // ---- コンソール & レポート組み立て ----
  const out: string[] = [];
  const log = (s = '') => { console.log(s); out.push(s); };
  const md: string[] = [];
  const mdPush = (s = '') => md.push(s);

  log('='.repeat(76));
  log(`  三連系 戦略比較バックテスト  (対象: ${allData.length} レース)`);
  log('='.repeat(76));

  // === セクション 1: 全戦略の比較表 ===
  log('\n▼ 1. 戦略比較サマリー (三連複)');
  log('-'.repeat(76));
  log('| 戦略                           | 参加 | 参加率| 的中 | 的中率| 投資(円)   | 払戻(円)   | 回収率  |');
  log('|--------------------------------|------|-------|------|-------|------------|------------|---------|');
  for (const s of STRATEGIES) {
    const a = aggs.get(s.key)!;
    log(
      `| ${s.name.padEnd(30)} |` +
      ` ${a.participatedRaces.toString().padStart(4)} |` +
      ` ${pct(a.participatedRaces, a.totalRaces).padStart(5)} |` +
      ` ${a.sanfukuHits.toString().padStart(4)} |` +
      ` ${pct(a.sanfukuHits, a.participatedRaces).padStart(5)} |` +
      ` ${a.sanfukuCost.toLocaleString().padStart(10)} |` +
      ` ${a.sanfukuPayout.toLocaleString().padStart(10)} |` +
      ` ${(roi(a.sanfukuCost, a.sanfukuPayout).toFixed(1) + '%').padStart(7)} |`
    );
  }

  log('\n▼ 1-B. 戦略比較サマリー (三連単)');
  log('-'.repeat(76));
  log('| 戦略                           | 参加 | 参加率| 的中 | 的中率| 投資(円)   | 払戻(円)   | 回収率  |');
  log('|--------------------------------|------|-------|------|-------|------------|------------|---------|');
  for (const s of STRATEGIES) {
    const a = aggs.get(s.key)!;
    log(
      `| ${s.name.padEnd(30)} |` +
      ` ${a.participatedRaces.toString().padStart(4)} |` +
      ` ${pct(a.participatedRaces, a.totalRaces).padStart(5)} |` +
      ` ${a.santanHits.toString().padStart(4)} |` +
      ` ${pct(a.santanHits, a.participatedRaces).padStart(5)} |` +
      ` ${a.santanCost.toLocaleString().padStart(10)} |` +
      ` ${a.santanPayout.toLocaleString().padStart(10)} |` +
      ` ${(roi(a.santanCost, a.santanPayout).toFixed(1) + '%').padStart(7)} |`
    );
  }

  // === セクション 2: 各戦略の上位5R・下位5R ===
  log('\n▼ 2. サンプル (戦略別・三連複+三連単合計の損益)');
  log('-'.repeat(76));
  for (const s of STRATEGIES) {
    const a = aggs.get(s.key)!;
    if (a.samples.length === 0) { log(`\n[${s.name}] 参加レースなし`); continue; }
    const samples = a.samples.map((x) => ({ ...x, total: x.sanfukuPayout + x.santanPayout }));
    const top5 = [...samples].sort((x, y) => y.total - x.total).slice(0, 5);
    const bot5 = [...samples].sort((x, y) => x.total - y.total).slice(0, 5);
    log(`\n[${s.name}]`);
    log('  TOP5 (損益):');
    top5.forEach((r) => log(`    ${r.raceId} ${r.raceName} → 選${r.selectedIds.join(',')} / 三連複${r.sanfukuPayout >= 0 ? '+' : ''}${r.sanfukuPayout} / 三連単${r.santanPayout >= 0 ? '+' : ''}${r.santanPayout}`));
    log('  WORST5 (損益):');
    bot5.forEach((r) => log(`    ${r.raceId} ${r.raceName} → 選${r.selectedIds.join(',')} / 三連複${r.sanfukuPayout} / 三連単${r.santanPayout}`));
  }

  // === セクション 3: オッズ帯別分布 ===
  log('\n▼ 3. オッズ帯別の三連複的中分布 (選出馬の平均オッズで帯分類)');
  log('-'.repeat(76));
  log('| 戦略                           | 帯        | 参加R | 的中R | 的中率 |');
  log('|--------------------------------|-----------|-------|-------|--------|');
  for (const s of STRATEGIES) {
    const b = bandsByStrategy.get(s.key)!;
    (['favorite', 'middle', 'longshot'] as Band[]).forEach((key, i) => {
      const r = b[key];
      const name = i === 0 ? s.name.padEnd(30) : ''.padEnd(30);
      log(
        `| ${name} | ${ODDS_BAND[key].label.padEnd(9)} |` +
        ` ${r.totalRaces.toString().padStart(5)} |` +
        ` ${r.hitRaces.toString().padStart(5)} |` +
        ` ${pct(r.hitRaces, r.totalRaces).padStart(6)} |`
      );
    });
  }

  // === セクション 4: 推奨 ===
  const ranking = STRATEGIES
    .map((s) => {
      const a = aggs.get(s.key)!;
      return {
        key: s.key,
        name: s.name,
        sanfukuRoi: roi(a.sanfukuCost, a.sanfukuPayout),
        santanRoi:  roi(a.santanCost,  a.santanPayout),
        totalRoi:   roi(a.sanfukuCost + a.santanCost, a.sanfukuPayout + a.santanPayout),
        participated: a.participatedRaces,
        sanfukuHits: a.sanfukuHits,
        totalRaces: a.totalRaces,
      };
    })
    .sort((x, y) => y.totalRoi - x.totalRoi);

  log('\n▼ 4. 総合回収率ランキング');
  log('-'.repeat(76));
  log('| 順位 | 戦略                           | 三連複 | 三連単 | 総合   | 参加率 | 三連複的中 |');
  log('|------|--------------------------------|--------|--------|--------|--------|------------|');
  ranking.forEach((r, i) => {
    log(
      `| ${(i + 1).toString().padStart(4)} | ${r.name.padEnd(30)} |` +
      ` ${(r.sanfukuRoi.toFixed(1) + '%').padStart(6)} |` +
      ` ${(r.santanRoi.toFixed(1) + '%').padStart(6)} |` +
      ` ${(r.totalRoi.toFixed(1) + '%').padStart(6)} |` +
      ` ${pct(r.participated, r.totalRaces).padStart(6)} |` +
      ` ${r.sanfukuHits.toString().padStart(10)} |`
    );
  });

  // 評価基準に照らす
  const qualified = ranking.filter(
    (r) => r.totalRoi >= 100 && r.participated >= 40 && r.sanfukuHits >= 20,
  );
  const above100 = ranking.filter((r) => r.totalRoi >= 100);

  log('\n▼ 5. 評価基準判定');
  log('-'.repeat(76));
  log(`  総合回収率 100% 超え戦略: ${above100.length} 戦略`);
  above100.forEach((r) => log(`    - ${r.name}: 総合 ${r.totalRoi.toFixed(1)}% / 参加${r.participated}R / 三連複的中${r.sanfukuHits}`));
  log('');
  log(`  全基準クリア (100% + 参加≥40R + 的中≥20): ${qualified.length} 戦略`);
  qualified.forEach((r) => log(`    ✓ ${r.name}: 総合 ${r.totalRoi.toFixed(1)}%`));

  const best = qualified[0] ?? ranking[0];
  log(`\n  → 推奨戦略: ${best.name} (総合${best.totalRoi.toFixed(1)}%)`);

  // ----------------------------------------
  // Markdown レポート
  // ----------------------------------------
  mdPush(`# 三連系 戦略比較バックテスト`);
  mdPush('');
  mdPush(`- 生成日時: ${new Date().toISOString()}`);
  mdPush(`- 対象レース数: **${allData.length}** レース`);
  mdPush(`- データソース: \`scripts/verification/*.json\``);
  mdPush('');

  mdPush(`## 1. 戦略一覧`);
  mdPush('');
  mdPush(`| Key | 戦略 | 選出ロジック |`);
  mdPush(`|---|---|---|`);
  mdPush(`| s1 | EV上位5頭BOX | EV順で上位5頭を選ぶ (3頭以上必要) |`);
  mdPush(`| s2 | EV≥1.00 + 上位5頭 | EV≥1.00 の中から上位5頭。5頭未満は不参加 |`);
  mdPush(`| s3 | スコア上位5頭BOX | EVを無視し score 順で上位5頭 |`);
  mdPush(`| s4 | ハイブリッド | 軸=EV≥1.05 (最大2)、ひも=EV≥0.95 (最大4)。軸≥1&ひも≥2で参加 |`);
  mdPush(`| s5 | EV上位3頭BOX | EV順で上位3頭 (現行backtest.tsと同じ) |`);
  mdPush('');

  mdPush(`## 2. 比較結果: 三連複`);
  mdPush('');
  mdPush(`| 戦略 | 参加レース数 | 参加率 | 的中数 | 的中率 | 投資額 | 払戻額 | 回収率 |`);
  mdPush(`|---|---|---|---|---|---|---|---|`);
  for (const s of STRATEGIES) {
    const a = aggs.get(s.key)!;
    mdPush(
      `| ${a.name} | ${a.participatedRaces}/${a.totalRaces} | ${pct(a.participatedRaces, a.totalRaces)} | ${a.sanfukuHits} | ${pct(a.sanfukuHits, a.participatedRaces)} | ${a.sanfukuCost.toLocaleString()}円 | ${a.sanfukuPayout.toLocaleString()}円 | **${roi(a.sanfukuCost, a.sanfukuPayout).toFixed(1)}%** |`
    );
  }
  mdPush('');

  mdPush(`## 3. 比較結果: 三連単`);
  mdPush('');
  mdPush(`| 戦略 | 参加レース数 | 参加率 | 的中数 | 的中率 | 投資額 | 払戻額 | 回収率 |`);
  mdPush(`|---|---|---|---|---|---|---|---|`);
  for (const s of STRATEGIES) {
    const a = aggs.get(s.key)!;
    mdPush(
      `| ${a.name} | ${a.participatedRaces}/${a.totalRaces} | ${pct(a.participatedRaces, a.totalRaces)} | ${a.santanHits} | ${pct(a.santanHits, a.participatedRaces)} | ${a.santanCost.toLocaleString()}円 | ${a.santanPayout.toLocaleString()}円 | **${roi(a.santanCost, a.santanPayout).toFixed(1)}%** |`
    );
  }
  mdPush('');

  mdPush(`## 4. オッズ帯別 三連複的中率 (選出馬の平均オッズで分類)`);
  mdPush('');
  mdPush(`| 戦略 | 人気馬(〜5倍) | 中穴(5〜20倍) | 大穴(20倍〜) |`);
  mdPush(`|---|---|---|---|`);
  for (const s of STRATEGIES) {
    const b = bandsByStrategy.get(s.key)!;
    const fmt = (r: { hitRaces: number; totalRaces: number }): string =>
      r.totalRaces === 0 ? '-' : `${r.hitRaces}/${r.totalRaces} (${pct(r.hitRaces, r.totalRaces)})`;
    mdPush(`| ${s.name} | ${fmt(b.favorite)} | ${fmt(b.middle)} | ${fmt(b.longshot)} |`);
  }
  mdPush('');

  mdPush(`## 5. 総合回収率ランキング (三連複+三連単 合算)`);
  mdPush('');
  mdPush(`| 順位 | 戦略 | 三連複回収率 | 三連単回収率 | 総合回収率 | 参加率 | 三連複的中 | 評価 |`);
  mdPush(`|---|---|---|---|---|---|---|---|`);
  ranking.forEach((r, i) => {
    const qualified = r.totalRoi >= 100 && r.participated >= 40 && r.sanfukuHits >= 20;
    const above100 = r.totalRoi >= 100;
    const badge = qualified ? '⭐ 全基準 OK' : above100 ? '○ 回収率のみOK' : '';
    mdPush(
      `| ${i + 1} | ${r.name} | ${r.sanfukuRoi.toFixed(1)}% | ${r.santanRoi.toFixed(1)}% | **${r.totalRoi.toFixed(1)}%** | ${pct(r.participated, r.totalRaces)} | ${r.sanfukuHits} | ${badge} |`
    );
  });
  mdPush('');

  mdPush(`## 6. 評価基準と推奨`);
  mdPush('');
  mdPush(`- **優先1**: 総合回収率 100% 以上 → ${above100.length} 戦略該当`);
  mdPush(`- **優先2**: 参加率 5% 以上 (最低40レース)`);
  mdPush(`- **優先3**: 三連複的中数 20 以上 (統計的有意性)`);
  mdPush('');
  if (qualified.length > 0) {
    mdPush(`### ⭐ 全基準クリア戦略`);
    qualified.forEach((r) => mdPush(`- **${r.name}**: 総合回収率 ${r.totalRoi.toFixed(1)}%, 参加 ${r.participated}R, 的中 ${r.sanfukuHits}`));
    mdPush('');
    mdPush(`**推奨採用**: ${best.name} (${best.totalRoi.toFixed(1)}%)`);
  } else {
    mdPush(`### 全基準をクリアする戦略は存在せず`);
    if (above100.length > 0) {
      mdPush(`総合100%超えはあるが参加数 or 的中数が基準を下回る:`);
      above100.forEach((r) => mdPush(`- ${r.name}: 総合 ${r.totalRoi.toFixed(1)}%, 参加 ${r.participated}R, 的中 ${r.sanfukuHits}`));
      mdPush('');
      mdPush(`**暫定推奨**: ${best.name} (${best.totalRoi.toFixed(1)}%)。サンプル拡大後に再検証が望ましい。`);
    } else {
      mdPush(`いずれの戦略も 100% に届かず。最も回収率が高いのは **${best.name}** (総合 ${best.totalRoi.toFixed(1)}%)。`);
    }
  }
  mdPush('');

  mdPush(`## 7. 戦略別 サンプルレース (TOP5 / WORST5 / 損益)`);
  mdPush('');
  for (const s of STRATEGIES) {
    const a = aggs.get(s.key)!;
    mdPush(`### ${a.name}`);
    if (a.samples.length === 0) { mdPush(`参加レースなし。`); mdPush(''); continue; }
    const samples = a.samples.map((x) => ({ ...x, total: x.sanfukuPayout + x.santanPayout }));
    const top5 = [...samples].sort((x, y) => y.total - x.total).slice(0, 5);
    const bot5 = [...samples].sort((x, y) => x.total - y.total).slice(0, 5);
    mdPush(`**TOP 5 (損益が大きかったレース)**:`);
    mdPush('');
    mdPush(`| raceId | レース名 | 選出馬 | 三連複損益 | 三連単損益 |`);
    mdPush(`|---|---|---|---|---|`);
    top5.forEach((r) => mdPush(`| ${r.raceId} | ${r.raceName} | ${r.selectedIds.join(',')} | ${r.sanfukuPayout >= 0 ? '+' : ''}${r.sanfukuPayout} | ${r.santanPayout >= 0 ? '+' : ''}${r.santanPayout} |`));
    mdPush('');
    mdPush(`**WORST 5 (損失が大きかったレース)**:`);
    mdPush('');
    mdPush(`| raceId | レース名 | 選出馬 | 三連複損益 | 三連単損益 |`);
    mdPush(`|---|---|---|---|---|`);
    bot5.forEach((r) => mdPush(`| ${r.raceId} | ${r.raceName} | ${r.selectedIds.join(',')} | ${r.sanfukuPayout} | ${r.santanPayout} |`));
    mdPush('');
  }

  mdPush(`---`);
  mdPush(`*再実行: \`pnpm tsx scripts/backtest_trifecta.ts\`*`);

  await fs.writeFile(REPORT_PATH, md.join('\n'), 'utf-8');
  log('\n' + '='.repeat(76));
  log(`Markdown レポート保存: ${REPORT_PATH}`);
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
