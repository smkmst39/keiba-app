// ==========================================
// ワイド 戦略比較バックテスト
//
// scripts/verification/*.json を使って 5 戦略を比較する:
//   W1. EV上位3頭BOX (全レース参加)
//   W2. EV上位5頭BOX (全レース参加)
//   W3. スコア上位3頭BOX (全レース参加)
//   W4. ハイブリッド (軸 EV≥1.05, ひも EV≥0.95, 合計 3〜5 頭 BOX)
//   W5. EV≥1.05 の3頭BOX (3頭揃うレースのみ参加)
//
// ワイドは 3頭BOX で 3通り購入 (100円×3点=300円/R)。
// 3頭中2頭が3着以内で 1口的中、3頭中3頭なら 3口的中。
//
// ■ ワイド払戻の取り扱い
//   既存 JSON には ワイド払戻 (results.payouts.wide) が含まれない可能性が高い。
//   含まれている場合は実データを使用、含まれていない場合は umaren × 0.40 で推定する。
//   推定モードの場合は "推定回収率" として明示する。
//
// 実行: pnpm tsx scripts/backtest_wide.ts
// 出力: コンソール + scripts/verification/wide_strategies_report.md
// ==========================================

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { VerificationData } from '../lib/scraper/types';

const VERIFICATION_DIR = path.resolve(__dirname, 'verification');
const REPORT_PATH = path.join(VERIFICATION_DIR, 'wide_strategies_report.md');

const EV_AXIS_MIN   = 1.05;
const EV_SPOKE_MIN  = 0.95;

/** umaren から wide を推定する係数 (歴史的平均比率) */
const WIDE_ESTIMATE_RATIO = 0.40;

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
// ユーティリティ
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

function sameSet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  return [...a].sort((x, y) => x - y).join(',') === [...b].sort((x, y) => x - y).join(',');
}

const roi = (cost: number, payout: number): number =>
  cost > 0 ? (payout / cost) * 100 : 0;

const pct = (num: number, den: number): string =>
  den === 0 ? 'N/A' : `${((num / den) * 100).toFixed(1)}%`;

// ----------------------------------------
// ワイド払戻の取得 (実データ or 推定)
// ----------------------------------------

type WidePayouts = Array<{ combination: string; payout: number }>;

/**
 * 指定の pair (sorted) のワイド払戻を返す。
 * 1. JSON に payouts.wide があれば実データ (accurate)
 * 2. なければ umaren × WIDE_ESTIMATE_RATIO で推定 (estimated)
 *
 * ペアが top3 に含まれていなければ 0 (外れ)
 */
function getWidePayoutForPair(
  pair: number[],
  vd: VerificationData,
  top3Ids: number[],
): { payout: number; isEstimated: boolean } {
  // ペアが top3 に両方含まれているか？
  const hit = pair.every((id) => top3Ids.includes(id));
  if (!hit) return { payout: 0, isEstimated: false };

  // 実データ優先
  const wide = vd.results.payouts.wide;
  if (wide && wide.length > 0) {
    for (const w of wide) {
      const nums = w.combination.split('-').map(Number);
      if (sameSet(pair, nums)) return { payout: w.payout, isEstimated: false };
    }
    // wide 配列はあるがペアが見つからない場合は 0
    return { payout: 0, isEstimated: false };
  }

  // 推定モード: umaren × 0.40
  const umaren = vd.results.payouts.umaren[0]?.payout ?? 0;
  return { payout: Math.round(umaren * WIDE_ESTIMATE_RATIO), isEstimated: true };
}

// ----------------------------------------
// 戦略の馬選出
// ----------------------------------------

type Prediction = VerificationData['predictions'][number];

type StrategyPick = {
  /** 参加するか */
  participated: boolean;
  /** 選ばれた馬番 (BOX対象) */
  selectedIds: number[];
};

function strategyW1_EvTop3(preds: Prediction[]): StrategyPick {
  const sorted = [...preds].filter((p) => p.odds > 0).sort((a, b) => b.ev - a.ev).slice(0, 3);
  return { participated: sorted.length >= 3, selectedIds: sorted.map((p) => p.horseId) };
}

function strategyW2_EvTop5(preds: Prediction[]): StrategyPick {
  const sorted = [...preds].filter((p) => p.odds > 0).sort((a, b) => b.ev - a.ev).slice(0, 5);
  return { participated: sorted.length >= 3, selectedIds: sorted.map((p) => p.horseId) };
}

function strategyW3_ScoreTop3(preds: Prediction[]): StrategyPick {
  const sorted = [...preds].filter((p) => p.odds > 0).sort((a, b) => b.score - a.score).slice(0, 3);
  return { participated: sorted.length >= 3, selectedIds: sorted.map((p) => p.horseId) };
}

function strategyW4_Hybrid(preds: Prediction[]): StrategyPick {
  const sorted = [...preds].filter((p) => p.odds > 0).sort((a, b) => b.ev - a.ev);
  const axes   = sorted.filter((p) => p.ev >= EV_AXIS_MIN).slice(0, 2);
  const spokes = sorted.filter((p) => p.ev >= EV_SPOKE_MIN && p.ev < EV_AXIS_MIN).slice(0, 3);
  if (axes.length < 1) return { participated: false, selectedIds: [] };
  const all = [...axes, ...spokes];
  if (all.length < 3) return { participated: false, selectedIds: [] };
  return { participated: true, selectedIds: all.map((p) => p.horseId) };
}

/** W5: EV≥1.05 の3頭BOX (3頭揃うレースのみ参加) */
function strategyW5_Ev105Top3(preds: Prediction[]): StrategyPick {
  const sorted = preds.filter((p) => p.odds > 0 && p.ev >= 1.05).sort((a, b) => b.ev - a.ev).slice(0, 3);
  return { participated: sorted.length >= 3, selectedIds: sorted.map((p) => p.horseId) };
}

const STRATEGIES: Array<{ key: string; name: string; fn: (p: Prediction[]) => StrategyPick }> = [
  { key: 'w1', name: '戦略W1: EV上位3頭BOX',       fn: strategyW1_EvTop3 },
  { key: 'w2', name: '戦略W2: EV上位5頭BOX',       fn: strategyW2_EvTop5 },
  { key: 'w3', name: '戦略W3: スコア上位3頭BOX',   fn: strategyW3_ScoreTop3 },
  { key: 'w4', name: '戦略W4: ハイブリッド',       fn: strategyW4_Hybrid },
  { key: 'w5', name: '戦略W5: EV≥1.05 の3頭BOX',   fn: strategyW5_Ev105Top3 },
];

// ----------------------------------------
// 集計
// ----------------------------------------

type HitPattern = '3of3' | '2of3' | '1of3' | '0of3';

type StrategyAgg = {
  name: string;
  participatedRaces: number;
  totalRaces: number;
  /** 購入点数の合計 (全レース分 = ペア数の合計) */
  totalPoints: number;
  /** 的中口数の合計 (ワイドは1レースで最大3口的中) */
  hitTickets: number;
  /** 的中したレースの数 (最低1口的中) */
  hitRaces: number;
  totalCost: number;
  totalPayout: number;
  /** 的中パターン分布 (3頭BOXのときのみ意味あり) */
  hitPatterns: Record<HitPattern, number>;
  /** オッズ帯別の回収率集計 */
  bandStats: Record<Band, { races: number; hits: number; cost: number; payout: number }>;
  /** サンプル */
  samples: Array<{
    raceId: string;
    raceName: string;
    selectedIds: number[];
    pairs: number;
    hits: number;
    pnl: number;
  }>;
  /** 推定率 (推定モードに入ったペア数の割合) */
  estimatedCount: number;
  totalPairCount: number;
};

function emptyAgg(name: string): StrategyAgg {
  return {
    name,
    participatedRaces: 0, totalRaces: 0,
    totalPoints: 0, hitTickets: 0, hitRaces: 0,
    totalCost: 0, totalPayout: 0,
    hitPatterns: { '3of3': 0, '2of3': 0, '1of3': 0, '0of3': 0 },
    bandStats: {
      favorite: { races: 0, hits: 0, cost: 0, payout: 0 },
      middle:   { races: 0, hits: 0, cost: 0, payout: 0 },
      longshot: { races: 0, hits: 0, cost: 0, payout: 0 },
    },
    samples: [],
    estimatedCount: 0, totalPairCount: 0,
  };
}

function processRace(vd: VerificationData, pick: StrategyPick, agg: StrategyAgg): void {
  agg.totalRaces++;
  if (!pick.participated || pick.selectedIds.length < 3) return;

  agg.participatedRaces++;
  const ids = pick.selectedIds;
  const n = ids.length;

  // BOX = nC2 ペア
  const pairs = combinations(ids, 2);
  agg.totalPoints += pairs.length;
  agg.totalPairCount += pairs.length;

  const top3Ids = vd.results.results.filter((r) => r.rank <= 3).map((r) => r.horseId);

  let racePayout = 0;
  let raceHitTickets = 0;
  let hitCountInPick = 0; // ピック馬のうち top3 に入った頭数

  // 各ピック馬が top3 に入ったかカウント (hitPattern 分布用)
  for (const id of ids) {
    if (top3Ids.includes(id)) hitCountInPick++;
  }

  for (const pair of pairs) {
    const { payout, isEstimated } = getWidePayoutForPair(pair, vd, top3Ids);
    if (payout > 0) {
      racePayout += payout;
      raceHitTickets++;
    }
    if (isEstimated) agg.estimatedCount++;
  }

  const raceCost = pairs.length * 100;
  agg.totalCost += raceCost;
  agg.totalPayout += racePayout;
  agg.hitTickets += raceHitTickets;
  if (raceHitTickets > 0) agg.hitRaces++;

  // Hit pattern (3頭BOX限定で有意。5頭BOXでは参考値)
  if (n === 3) {
    if (hitCountInPick === 3) agg.hitPatterns['3of3']++;
    else if (hitCountInPick === 2) agg.hitPatterns['2of3']++;
    else if (hitCountInPick === 1) agg.hitPatterns['1of3']++;
    else agg.hitPatterns['0of3']++;
  }

  // オッズ帯分類 (選出馬の平均オッズ)
  const selPreds = vd.predictions.filter((p) => ids.includes(p.horseId));
  const avgOdds = selPreds.reduce((s, p) => s + p.odds, 0) / Math.max(1, selPreds.length);
  const band = bandOf(avgOdds);
  agg.bandStats[band].races++;
  if (raceHitTickets > 0) agg.bandStats[band].hits++;
  agg.bandStats[band].cost += raceCost;
  agg.bandStats[band].payout += racePayout;

  // サンプル
  if (agg.samples.length < 500) {
    agg.samples.push({
      raceId: vd.raceId, raceName: vd.raceName,
      selectedIds: ids, pairs: pairs.length, hits: raceHitTickets,
      pnl: racePayout - raceCost,
    });
  }
}

function aggregateAll(allData: VerificationData[]): Map<string, StrategyAgg> {
  const result = new Map<string, StrategyAgg>();
  for (const s of STRATEGIES) result.set(s.key, emptyAgg(s.name));

  for (const vd of allData) {
    if (vd.predictions.length < 3 || vd.results.results.length === 0) continue;
    for (const s of STRATEGIES) {
      const agg = result.get(s.key)!;
      processRace(vd, s.fn(vd.predictions), agg);
    }
  }
  return result;
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

  // モード判定: ワイド払戻を持つ JSON の割合
  const withWide = allData.filter((d) => (d.results.payouts.wide?.length ?? 0) > 0).length;
  const dataMode = withWide > 0 ? `実データ (${withWide}/${allData.length}件) + 不足分は推定` : '全件推定モード';

  const aggs = aggregateAll(allData);

  // コンソール出力
  const out: string[] = [];
  const log = (s = '') => { console.log(s); out.push(s); };

  log('='.repeat(80));
  log(`  ワイド 戦略比較バックテスト  (対象: ${allData.length} レース)`);
  log('='.repeat(80));
  log(`  データモード: ${dataMode}`);
  log(`  推定係数:    wide_estimate = umaren × ${WIDE_ESTIMATE_RATIO.toFixed(2)}`);
  log('');

  // セクション1: 全戦略の比較
  log('▼ 1. 戦略比較サマリー');
  log('-'.repeat(80));
  log('| 戦略                        | 参加 | 参加率| 的中口数 | 的中R | 的中率| 投資(円)   | 払戻(円)   | 回収率  |');
  log('|-----------------------------|------|-------|----------|-------|-------|------------|------------|---------|');
  for (const s of STRATEGIES) {
    const a = aggs.get(s.key)!;
    log(
      `| ${s.name.padEnd(27)} |` +
      ` ${a.participatedRaces.toString().padStart(4)} |` +
      ` ${pct(a.participatedRaces, a.totalRaces).padStart(5)} |` +
      ` ${a.hitTickets.toString().padStart(8)} |` +
      ` ${a.hitRaces.toString().padStart(5)} |` +
      ` ${pct(a.hitRaces, a.participatedRaces).padStart(5)} |` +
      ` ${a.totalCost.toLocaleString().padStart(10)} |` +
      ` ${a.totalPayout.toLocaleString().padStart(10)} |` +
      ` ${(roi(a.totalCost, a.totalPayout).toFixed(1) + '%').padStart(7)} |`
    );
  }
  log('');

  // 平均的中口数/R (的中時)
  log('▼ 1-B. 的中時の平均ヒット口数・平均払戻 (参加レース単位)');
  log('-'.repeat(80));
  for (const s of STRATEGIES) {
    const a = aggs.get(s.key)!;
    const avgHit = a.hitRaces > 0 ? a.hitTickets / a.hitRaces : 0;
    const avgPay = a.hitRaces > 0 ? a.totalPayout / a.hitRaces : 0;
    const avgTicketsAll = a.participatedRaces > 0 ? a.hitTickets / a.participatedRaces : 0;
    log(
      `  ${s.name.padEnd(27)} ` +
      `的中R当たり平均 ${avgHit.toFixed(2)}口 / ${avgPay.toLocaleString()}円  ` +
      `(全参加R平均 ${avgTicketsAll.toFixed(2)}口/R)`
    );
  }
  log('');

  // セクション2: 的中パターン分布 (3頭BOX戦略用)
  log('▼ 2. 的中パターン分布 (3頭BOX戦略のみ。5頭BOX戦略は N/A)');
  log('-'.repeat(80));
  log('| 戦略                        | 3頭top3(3口) | 2頭top3(1口) | 1頭以下 | 参加R |');
  log('|-----------------------------|--------------|--------------|---------|-------|');
  for (const s of STRATEGIES) {
    const a = aggs.get(s.key)!;
    const total3box = a.hitPatterns['3of3'] + a.hitPatterns['2of3'] + a.hitPatterns['1of3'] + a.hitPatterns['0of3'];
    if (total3box === 0) {
      log(`| ${s.name.padEnd(27)} |   N/A (BOX頭数が可変)                              | ${a.participatedRaces.toString().padStart(5)} |`);
    } else {
      log(
        `| ${s.name.padEnd(27)} | ${a.hitPatterns['3of3'].toString().padStart(12)} | ${a.hitPatterns['2of3'].toString().padStart(12)} | ${(a.hitPatterns['1of3'] + a.hitPatterns['0of3']).toString().padStart(7)} | ${total3box.toString().padStart(5)} |`
      );
    }
  }
  log('');

  // セクション3: オッズ帯別回収率
  log('▼ 3. オッズ帯別の回収率 (選出馬の平均オッズで分類)');
  log('-'.repeat(80));
  log('| 戦略                        | 帯        | 参加R | 的中R | 投資       | 払戻       | 回収率  |');
  log('|-----------------------------|-----------|-------|-------|------------|------------|---------|');
  for (const s of STRATEGIES) {
    const a = aggs.get(s.key)!;
    (['favorite', 'middle', 'longshot'] as Band[]).forEach((key, i) => {
      const r = a.bandStats[key];
      const name = i === 0 ? s.name.padEnd(27) : ''.padEnd(27);
      log(
        `| ${name} | ${ODDS_BAND[key].label.padEnd(9)} |` +
        ` ${r.races.toString().padStart(5)} |` +
        ` ${r.hits.toString().padStart(5)} |` +
        ` ${r.cost.toLocaleString().padStart(10)} |` +
        ` ${r.payout.toLocaleString().padStart(10)} |` +
        ` ${(roi(r.cost, r.payout).toFixed(1) + '%').padStart(7)} |`
      );
    });
  }
  log('');

  // セクション4: ランキングと判定
  const ranking = STRATEGIES.map((s) => {
    const a = aggs.get(s.key)!;
    return {
      key: s.key, name: s.name,
      roi:  roi(a.totalCost, a.totalPayout),
      participated: a.participatedRaces, totalRaces: a.totalRaces,
      hitRaces: a.hitRaces, hitTickets: a.hitTickets,
    };
  }).sort((x, y) => y.roi - x.roi);

  log('▼ 4. 総合回収率ランキング');
  log('-'.repeat(80));
  log('| 順位 | 戦略                        | 回収率 | 参加率 | 的中R | 的中口数 |');
  log('|------|-----------------------------|--------|--------|-------|----------|');
  ranking.forEach((r, i) => {
    log(
      `| ${(i + 1).toString().padStart(4)} | ${r.name.padEnd(27)} |` +
      ` ${(r.roi.toFixed(1) + '%').padStart(6)} |` +
      ` ${pct(r.participated, r.totalRaces).padStart(6)} |` +
      ` ${r.hitRaces.toString().padStart(5)} |` +
      ` ${r.hitTickets.toString().padStart(8)} |`
    );
  });
  log('');

  const qualified = ranking.filter((r) => r.roi >= 100 && r.hitRaces >= 50 && pct(r.participated, r.totalRaces) !== 'N/A' && r.participated / r.totalRaces >= 0.5);
  const above100  = ranking.filter((r) => r.roi >= 100);
  const best = qualified[0] ?? ranking[0];

  log('▼ 5. 評価基準判定');
  log('-'.repeat(80));
  log(`  回収率 100% 超え: ${above100.length} 戦略`);
  above100.forEach((r) => log(`    - ${r.name}: 回収率 ${r.roi.toFixed(1)}%, 参加${r.participated}R, 的中${r.hitRaces}R`));
  log('');
  log(`  全基準クリア (100% + 参加率≥50% + 的中≥50): ${qualified.length} 戦略`);
  qualified.forEach((r) => log(`    ✓ ${r.name}: 回収率 ${r.roi.toFixed(1)}%`));
  log(`\n  → 推奨: ${best.name} (回収率 ${best.roi.toFixed(1)}%)`);

  // ---- Markdown ----
  const md: string[] = [];
  const mdPush = (s = '') => md.push(s);

  mdPush(`# ワイド 戦略比較バックテスト`);
  mdPush('');
  mdPush(`- 生成日時: ${new Date().toISOString()}`);
  mdPush(`- 対象レース数: **${allData.length}**`);
  mdPush(`- データモード: **${dataMode}**`);
  mdPush(`- 推定係数: \`wide_estimate = umaren_payout × ${WIDE_ESTIMATE_RATIO.toFixed(2)}\``);
  mdPush('');

  if (withWide === 0) {
    mdPush(`> ⚠️ **注意**: 既存 JSON に \`payouts.wide\` が含まれていないため、すべてのワイド払戻を`);
    mdPush(`> \`umaren × ${WIDE_ESTIMATE_RATIO}\` で推定しています。実際の値は ±30% の誤差がありえます。`);
    mdPush(`> 正確な数値は再収集 (\`pnpm tsx scripts/collect-verification.ts\`) で得られます。`);
    mdPush(`> (scraper は Phase 2D で wide 取得に対応済み)`);
    mdPush('');
  }

  mdPush(`## 1. 戦略一覧`);
  mdPush('');
  mdPush(`| Key | 戦略 | 選出ロジック | 購入点数 |`);
  mdPush(`|---|---|---|---|`);
  mdPush(`| W1 | EV上位3頭BOX        | EV順で上位3頭                           | 3点 (300円) |`);
  mdPush(`| W2 | EV上位5頭BOX        | EV順で上位5頭                           | 10点 (1,000円) |`);
  mdPush(`| W3 | スコア上位3頭BOX    | score 順で上位3頭                       | 3点 |`);
  mdPush(`| W4 | ハイブリッド        | 軸=EV≥1.05 (≤2頭) + ひも=EV≥0.95 (≤3頭) | 3〜10点 |`);
  mdPush(`| W5 | EV≥1.05 の3頭BOX   | EV≥1.05 が3頭揃うレースのみ参加          | 3点 |`);
  mdPush('');

  mdPush(`## 2. 比較結果`);
  mdPush('');
  mdPush(`| 戦略 | 参加R | 参加率 | 総的中口数 | 平均的中口数/R(的中時) | 投資額 | 払戻額 | 回収率 |`);
  mdPush(`|---|---|---|---|---|---|---|---|`);
  for (const s of STRATEGIES) {
    const a = aggs.get(s.key)!;
    const avgHit = a.hitRaces > 0 ? (a.hitTickets / a.hitRaces).toFixed(2) : '0.00';
    mdPush(
      `| ${a.name} | ${a.participatedRaces}/${a.totalRaces} | ${pct(a.participatedRaces, a.totalRaces)} | ${a.hitTickets} | ${avgHit} | ${a.totalCost.toLocaleString()}円 | ${a.totalPayout.toLocaleString()}円 | **${roi(a.totalCost, a.totalPayout).toFixed(1)}%** |`
    );
  }
  mdPush('');

  mdPush(`## 3. 的中パターン分布 (3頭BOX 戦略のみ)`);
  mdPush('');
  mdPush(`| 戦略 | 3頭 top3 (3口) | 2頭 top3 (1口) | 1頭以下 (外れ) | 参加R |`);
  mdPush(`|---|---|---|---|---|`);
  for (const s of STRATEGIES) {
    const a = aggs.get(s.key)!;
    const total3box = a.hitPatterns['3of3'] + a.hitPatterns['2of3'] + a.hitPatterns['1of3'] + a.hitPatterns['0of3'];
    if (total3box === 0) {
      mdPush(`| ${a.name} | N/A (可変BOX) | N/A | N/A | ${a.participatedRaces} |`);
    } else {
      mdPush(
        `| ${a.name} | ${a.hitPatterns['3of3']} | ${a.hitPatterns['2of3']} | ${a.hitPatterns['1of3'] + a.hitPatterns['0of3']} | ${total3box} |`
      );
    }
  }
  mdPush('');

  mdPush(`## 4. オッズ帯別の回収率`);
  mdPush('');
  mdPush(`選出馬の平均オッズで帯分類。各戦略 × 各帯の回収率を示す。`);
  mdPush('');
  mdPush(`| 戦略 | 人気馬(〜5倍) | 中穴(5〜20倍) | 大穴(20倍〜) |`);
  mdPush(`|---|---|---|---|`);
  for (const s of STRATEGIES) {
    const a = aggs.get(s.key)!;
    const fmt = (r: typeof a.bandStats.favorite): string =>
      r.races === 0 ? '-' : `${roi(r.cost, r.payout).toFixed(1)}% (的中${r.hits}/${r.races}R)`;
    mdPush(`| ${a.name} | ${fmt(a.bandStats.favorite)} | ${fmt(a.bandStats.middle)} | ${fmt(a.bandStats.longshot)} |`);
  }
  mdPush('');

  mdPush(`## 5. 総合ランキング`);
  mdPush('');
  mdPush(`| 順位 | 戦略 | 回収率 | 参加率 | 的中R | 総的中口数 | 評価 |`);
  mdPush(`|---|---|---|---|---|---|---|`);
  ranking.forEach((r, i) => {
    const full = r.roi >= 100 && r.hitRaces >= 50 && r.participated / r.totalRaces >= 0.5;
    const over = r.roi >= 100;
    const badge = full ? '⭐ 全基準OK' : over ? '○ 回収率のみ' : '';
    mdPush(
      `| ${i + 1} | ${r.name} | **${r.roi.toFixed(1)}%** | ${pct(r.participated, r.totalRaces)} | ${r.hitRaces} | ${r.hitTickets} | ${badge} |`
    );
  });
  mdPush('');

  mdPush(`## 6. 推奨採用`);
  mdPush('');
  if (qualified.length > 0) {
    mdPush(`### ⭐ 全基準クリア`);
    qualified.forEach((r) => mdPush(`- **${r.name}**: 回収率 ${r.roi.toFixed(1)}%`));
    mdPush('');
    mdPush(`**本番採用**: \`${best.name}\``);
  } else {
    mdPush(`全基準をクリアする戦略なし。**暫定推奨**: \`${best.name}\` (回収率 ${best.roi.toFixed(1)}%)`);
    if (withWide === 0) {
      mdPush('');
      mdPush(`※ ワイド払戻を推定値で計算しているため、実際の数値には ±30% 程度の幅がある可能性。`);
      mdPush(`  正確な判定は再収集後に再実行してください。`);
    }
  }
  mdPush('');

  mdPush(`## 7. 戦略別サンプル (TOP5 / WORST5)`);
  mdPush('');
  for (const s of STRATEGIES) {
    const a = aggs.get(s.key)!;
    mdPush(`### ${a.name}`);
    if (a.samples.length === 0) { mdPush(`参加レースなし。`); mdPush(''); continue; }
    const top5 = [...a.samples].sort((x, y) => y.pnl - x.pnl).slice(0, 5);
    const bot5 = [...a.samples].sort((x, y) => x.pnl - y.pnl).slice(0, 5);
    mdPush(`**TOP 5 (損益大):**`);
    mdPush('');
    mdPush(`| raceId | レース名 | 選出馬 | ペア数 | 的中口数 | 損益 |`);
    mdPush(`|---|---|---|---|---|---|`);
    top5.forEach((r) => mdPush(`| ${r.raceId} | ${r.raceName} | ${r.selectedIds.join(',')} | ${r.pairs} | ${r.hits} | ${r.pnl >= 0 ? '+' : ''}${r.pnl} |`));
    mdPush('');
    mdPush(`**WORST 5:**`);
    mdPush('');
    mdPush(`| raceId | レース名 | 選出馬 | ペア数 | 的中口数 | 損益 |`);
    mdPush(`|---|---|---|---|---|---|`);
    bot5.forEach((r) => mdPush(`| ${r.raceId} | ${r.raceName} | ${r.selectedIds.join(',')} | ${r.pairs} | ${r.hits} | ${r.pnl} |`));
    mdPush('');
  }

  mdPush(`---`);
  mdPush(`*再実行: \`pnpm tsx scripts/backtest_wide.ts\`*`);

  await fs.writeFile(REPORT_PATH, md.join('\n'), 'utf-8');
  log('\n' + '='.repeat(80));
  log(`Markdown レポート保存: ${REPORT_PATH}`);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
