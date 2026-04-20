// ==========================================
// 複勝 (Fuku) 戦略比較バックテスト
//
// 複勝は 1 着・2 着・3 着 それぞれに独立した払戻 (= 1レースで最大3頭分の的中)。
// 戦略は「1頭を選んで100円を賭ける」前提で、各戦略がピックする馬番の
// top3 到達率 + 平均払戻を計測する。
//
// 戦略:
//   F1. EV1位 1点買い
//   F2. EV上位2頭 (2点 = 200円)
//   F3. EV上位3頭 (3点 = 300円)
//   F4. スコア1位 1点買い
//   F5. ハイブリッド (軸 EV≥1.05 の全頭 1点ずつ、最大2頭)
//
// 実行: pnpm tsx scripts/backtest_fuku.ts
// 出力: scripts/verification/fuku_strategies_report.md
// ==========================================

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { VerificationData } from '../lib/scraper/types';

const DIR = path.resolve(__dirname, 'verification');
const REPORT = path.join(DIR, 'fuku_strategies_report.md');

const EV_AXIS_MIN = 1.05;
const ODDS_BAND = {
  favorite: { label: '人気馬(〜5倍)', max: 5 },
  middle:   { label: '中穴(5〜20倍)', max: 20 },
  longshot: { label: '大穴(20倍〜)',  max: Infinity },
} as const;
type Band = keyof typeof ODDS_BAND;
const bandOf = (o: number): Band => o < 5 ? 'favorite' : o < 20 ? 'middle' : 'longshot';

const roi = (c: number, p: number): number => c > 0 ? (p / c) * 100 : 0;
const pct = (n: number, d: number): string => d === 0 ? 'N/A' : `${((n / d) * 100).toFixed(1)}%`;

type Prediction = VerificationData['predictions'][number];
type Pick = { participated: boolean; selectedIds: number[] };

function strF1(p: Prediction[]): Pick {
  const s = [...p].filter(x => x.odds > 0).sort((a, b) => b.ev - a.ev).slice(0, 1);
  return { participated: s.length === 1, selectedIds: s.map(x => x.horseId) };
}
function strF2(p: Prediction[]): Pick {
  const s = [...p].filter(x => x.odds > 0).sort((a, b) => b.ev - a.ev).slice(0, 2);
  return { participated: s.length === 2, selectedIds: s.map(x => x.horseId) };
}
function strF3(p: Prediction[]): Pick {
  const s = [...p].filter(x => x.odds > 0).sort((a, b) => b.ev - a.ev).slice(0, 3);
  return { participated: s.length === 3, selectedIds: s.map(x => x.horseId) };
}
function strF4(p: Prediction[]): Pick {
  const s = [...p].filter(x => x.odds > 0).sort((a, b) => b.score - a.score).slice(0, 1);
  return { participated: s.length === 1, selectedIds: s.map(x => x.horseId) };
}
function strF5(p: Prediction[]): Pick {
  const s = p.filter(x => x.odds > 0 && x.ev >= EV_AXIS_MIN).sort((a, b) => b.ev - a.ev).slice(0, 2);
  return { participated: s.length >= 1, selectedIds: s.map(x => x.horseId) };
}

const STRATS = [
  { key: 'f1', name: '戦略F1: EV1位',          fn: strF1 },
  { key: 'f2', name: '戦略F2: EV上位2頭',      fn: strF2 },
  { key: 'f3', name: '戦略F3: EV上位3頭',      fn: strF3 },
  { key: 'f4', name: '戦略F4: スコア1位',      fn: strF4 },
  { key: 'f5', name: '戦略F5: ハイブリッド軸', fn: strF5 },
];

type Agg = {
  name: string;
  participated: number; total: number;
  hits: number;        // 的中口数合計 (1頭 top3 = 1口)
  hitRaces: number;    // 最低1口的中のレース数
  cost: number; payout: number;
  bandStats: Record<Band, { races: number; hits: number; cost: number; payout: number }>;
  dataMode: { real: number; missing: number };
};

function emptyAgg(name: string): Agg {
  return {
    name, participated: 0, total: 0, hits: 0, hitRaces: 0, cost: 0, payout: 0,
    bandStats: {
      favorite: { races: 0, hits: 0, cost: 0, payout: 0 },
      middle:   { races: 0, hits: 0, cost: 0, payout: 0 },
      longshot: { races: 0, hits: 0, cost: 0, payout: 0 },
    },
    dataMode: { real: 0, missing: 0 },
  };
}

async function loadData(): Promise<VerificationData[]> {
  const files = (await fs.readdir(DIR)).filter(f => f.endsWith('.json'));
  const out: VerificationData[] = [];
  for (const f of files) {
    try { out.push(JSON.parse(await fs.readFile(path.join(DIR, f), 'utf-8'))); } catch {}
  }
  return out;
}

async function main(): Promise<void> {
  const allData = await loadData();
  if (allData.length === 0) { console.error('no data'); process.exit(1); }

  const withFuku = allData.filter(d => (d.results.payouts.fuku?.length ?? 0) > 0).length;
  const aggs = new Map<string, Agg>();
  for (const s of STRATS) aggs.set(s.key, emptyAgg(s.name));

  for (const vd of allData) {
    if (vd.predictions.length === 0 || vd.results.results.length === 0) continue;
    const top3 = vd.results.results.filter(r => r.rank <= 3).map(r => r.horseId);
    const fukuArr = vd.results.payouts.fuku ?? [];
    const hasReal = fukuArr.length > 0;

    for (const s of STRATS) {
      const agg = aggs.get(s.key)!;
      agg.total++;
      const pick = s.fn(vd.predictions);
      if (!pick.participated) continue;

      agg.participated++;
      if (hasReal) agg.dataMode.real++; else agg.dataMode.missing++;

      let raceHits = 0, racePay = 0;
      const costPerRace = pick.selectedIds.length * 100;

      for (const id of pick.selectedIds) {
        if (top3.includes(id)) {
          raceHits++;
          // 実データがあれば使用、なければ top3 到達=複勝300円平均で推定
          const real = fukuArr.find(f => f.horseId === id);
          racePay += real ? real.payout : 300;
        }
      }
      agg.cost += costPerRace;
      agg.payout += racePay;
      agg.hits += raceHits;
      if (raceHits > 0) agg.hitRaces++;

      // 帯別: 選出馬の平均オッズで分類
      const selPreds = vd.predictions.filter(p => pick.selectedIds.includes(p.horseId));
      const avgOdds = selPreds.reduce((s, p) => s + p.odds, 0) / Math.max(1, selPreds.length);
      const band = bandOf(avgOdds);
      agg.bandStats[band].races++;
      if (raceHits > 0) agg.bandStats[band].hits++;
      agg.bandStats[band].cost += costPerRace;
      agg.bandStats[band].payout += racePay;
    }
  }

  // 出力
  const log = (s = ''): void => console.log(s);
  const md: string[] = [];
  const mp = (s = ''): void => { md.push(s); };

  const dataMode = withFuku === allData.length ? `実データ 100% (${withFuku}R)`
    : withFuku > 0 ? `実データ ${withFuku}/${allData.length}R、残りは top3 到達 → 300円 で推定`
    : '全件「top3 到達なら300円」で推定 (payouts.fuku 不在)';

  log('='.repeat(78));
  log(`  複勝 戦略比較バックテスト (対象: ${allData.length}R)`);
  log('='.repeat(78));
  log(`  データモード: ${dataMode}`);
  log('');
  log('▼ 比較サマリー');
  log('-'.repeat(78));
  log('| 戦略                 | 参加 | 参加率| 的中口| 的中R| 投資   | 払戻   | 回収率  |');
  log('|----------------------|------|-------|-------|------|--------|--------|---------|');
  for (const s of STRATS) {
    const a = aggs.get(s.key)!;
    log(`| ${s.name.padEnd(20)} | ${a.participated.toString().padStart(4)} | ${pct(a.participated, a.total).padStart(5)} | ${a.hits.toString().padStart(5)} | ${a.hitRaces.toString().padStart(4)} | ${a.cost.toLocaleString().padStart(6)} | ${a.payout.toLocaleString().padStart(6)} | ${(roi(a.cost, a.payout).toFixed(1) + '%').padStart(7)} |`);
  }

  const ranking = STRATS.map(s => { const a = aggs.get(s.key)!; return { name: s.name, roi: roi(a.cost, a.payout), a }; }).sort((x, y) => y.roi - x.roi);
  log('\n▼ ランキング');
  log('-'.repeat(78));
  ranking.forEach((r, i) => log(`  ${i + 1}. ${r.name}: 回収率 ${r.roi.toFixed(1)}% (${r.a.hitRaces}/${r.a.participated}R 的中)`));

  // Markdown
  mp(`# 複勝 戦略比較バックテスト`);
  mp('');
  mp(`- 対象: **${allData.length}R**  / データモード: ${dataMode}`);
  mp('');
  mp(`## 比較結果`);
  mp('');
  mp(`| 戦略 | 参加R | 参加率 | 的中口数 | 的中R | 投資額 | 払戻額 | 回収率 |`);
  mp(`|---|---|---|---|---|---|---|---|`);
  for (const s of STRATS) {
    const a = aggs.get(s.key)!;
    mp(`| ${a.name} | ${a.participated}/${a.total} | ${pct(a.participated, a.total)} | ${a.hits} | ${a.hitRaces} | ${a.cost.toLocaleString()}円 | ${a.payout.toLocaleString()}円 | **${roi(a.cost, a.payout).toFixed(1)}%** |`);
  }
  mp('');
  mp(`## オッズ帯別回収率`);
  mp('');
  mp(`| 戦略 | 人気馬(〜5倍) | 中穴 | 大穴 |`);
  mp(`|---|---|---|---|`);
  for (const s of STRATS) {
    const a = aggs.get(s.key)!;
    const fmt = (r: typeof a.bandStats.favorite): string => r.races === 0 ? '-' : `${roi(r.cost, r.payout).toFixed(1)}% (${r.hits}/${r.races}R)`;
    mp(`| ${a.name} | ${fmt(a.bandStats.favorite)} | ${fmt(a.bandStats.middle)} | ${fmt(a.bandStats.longshot)} |`);
  }
  mp('');
  mp(`## ランキング`);
  mp('');
  ranking.forEach((r, i) => mp(`${i + 1}. **${r.name}**: 回収率 ${r.roi.toFixed(1)}%`));
  mp('');
  mp(`---`);
  mp(`*再実行: \`pnpm tsx scripts/backtest_fuku.ts\`*`);

  await fs.writeFile(REPORT, md.join('\n'), 'utf-8');
  log(`\nMarkdown: ${REPORT}`);
}
main().catch(e => { console.error(e); process.exit(1); });
