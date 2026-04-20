// ==========================================
// 馬単 (Umatan) 戦略比較バックテスト
//
// 馬単は 1着→2着 の順序付き2頭当てる。的中率は低いが配当は高い。
//
// 戦略:
//   U1. EV上位2頭フォーメーション (EV1位 → EV2位)      1点=100円
//   U2. EV上位2頭BOX (順序両方)                        2点=200円
//   U3. EV上位3頭BOX (P(3,2)=6点=600円)
//   U4. ハイブリッド: 軸EV≥1.05を1着固定、ひもEV≥0.95を2着
//
// 実行: pnpm tsx scripts/backtest_umatan.ts
// ==========================================

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { VerificationData } from '../lib/scraper/types';

const DIR = path.resolve(__dirname, 'verification');
const REPORT = path.join(DIR, 'umatan_strategies_report.md');
const EV_AXIS = 1.05;
const EV_SPOKE = 0.95;

const roi = (c: number, p: number): number => c > 0 ? (p / c) * 100 : 0;
const pct = (n: number, d: number): string => d === 0 ? 'N/A' : `${((n / d) * 100).toFixed(1)}%`;

function permutations<T>(a: T[], k: number): T[][] {
  if (k === 0) return [[]];
  const r: T[][] = [];
  for (let i = 0; i < a.length; i++) {
    const rest = [...a.slice(0, i), ...a.slice(i + 1)];
    for (const p of permutations(rest, k - 1)) r.push([a[i], ...p]);
  }
  return r;
}

type Prediction = VerificationData['predictions'][number];
type Pick = { participated: boolean; perms: number[][] };

function strU1(p: Prediction[]): Pick {
  const s = [...p].filter(x => x.odds > 0).sort((a, b) => b.ev - a.ev).slice(0, 2);
  return { participated: s.length === 2, perms: s.length === 2 ? [[s[0].horseId, s[1].horseId]] : [] };
}
function strU2(p: Prediction[]): Pick {
  const s = [...p].filter(x => x.odds > 0).sort((a, b) => b.ev - a.ev).slice(0, 2);
  return { participated: s.length === 2, perms: s.length === 2 ? permutations(s.map(x => x.horseId), 2) : [] };
}
function strU3(p: Prediction[]): Pick {
  const s = [...p].filter(x => x.odds > 0).sort((a, b) => b.ev - a.ev).slice(0, 3);
  return { participated: s.length === 3, perms: s.length === 3 ? permutations(s.map(x => x.horseId), 2) : [] };
}
function strU4(p: Prediction[]): Pick {
  const sorted = [...p].filter(x => x.odds > 0).sort((a, b) => b.ev - a.ev);
  const axes   = sorted.filter(x => x.ev >= EV_AXIS).slice(0, 2);
  const spokes = sorted.filter(x => x.ev >= EV_SPOKE && x.ev < EV_AXIS).slice(0, 3);
  if (axes.length < 1 || spokes.length < 1) return { participated: false, perms: [] };
  const perms: number[][] = [];
  for (const a of axes) {
    const pool = [...axes.filter(x => x.horseId !== a.horseId), ...spokes];
    for (const p2 of pool) perms.push([a.horseId, p2.horseId]);
  }
  return { participated: true, perms };
}

const STRATS = [
  { key: 'u1', name: '戦略U1: EV上位2頭フォーメーション', fn: strU1 },
  { key: 'u2', name: '戦略U2: EV上位2頭BOX',              fn: strU2 },
  { key: 'u3', name: '戦略U3: EV上位3頭BOX (P(3,2)=6点)', fn: strU3 },
  { key: 'u4', name: '戦略U4: ハイブリッド(軸1着×ひも2着)', fn: strU4 },
];

type Agg = { name: string; participated: number; total: number; hits: number; cost: number; payout: number; points: number };
const emp = (name: string): Agg => ({ name, participated: 0, total: 0, hits: 0, cost: 0, payout: 0, points: 0 });

const sameSeq = (a: number[], b: number[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

async function loadData(): Promise<VerificationData[]> {
  const files = (await fs.readdir(DIR)).filter(f => f.endsWith('.json'));
  const out: VerificationData[] = [];
  for (const f of files) {
    try { out.push(JSON.parse(await fs.readFile(path.join(DIR, f), 'utf-8'))); } catch {}
  }
  return out;
}

async function main(): Promise<void> {
  const data = await loadData();
  const withUmatan = data.filter(d => (d.results.payouts.umatan?.length ?? 0) > 0).length;
  const mode = withUmatan === data.length ? `実データ 100%` : withUmatan > 0 ? `実データ ${withUmatan}/${data.length}` : '馬単データなし → 回収率計算不可 (umaren 値で代用推定)';

  const aggs = new Map<string, Agg>();
  for (const s of STRATS) aggs.set(s.key, emp(s.name));

  for (const vd of data) {
    if (vd.predictions.length < 2 || vd.results.results.length === 0) continue;
    const umatan = vd.results.payouts.umatan ?? [];
    const umaren = vd.results.payouts.umaren ?? [];
    // フォールバック: 馬単実データなしなら馬連×3 で推定
    const estimateFactor = umatan.length === 0 && umaren.length > 0 ? 3 : 1;

    for (const s of STRATS) {
      const agg = aggs.get(s.key)!;
      agg.total++;
      const pick = s.fn(vd.predictions);
      if (!pick.participated) continue;
      agg.participated++;
      agg.points += pick.perms.length;
      agg.cost += pick.perms.length * 100;

      let payout = 0, hits = 0;
      for (const perm of pick.perms) {
        if (umatan.length > 0) {
          for (const u of umatan) {
            const nums = u.combination.split('-').map(Number);
            if (sameSeq(perm, nums)) { payout += u.payout; hits++; break; }
          }
        } else if (umaren.length > 0) {
          for (const u of umaren) {
            const nums = u.combination.split('-').map(Number).sort((a, b) => a - b);
            const sorted = [...perm].sort((a, b) => a - b);
            if (nums.join(',') === sorted.join(',')) {
              payout += u.payout * estimateFactor;
              hits++;
              break;
            }
          }
        }
      }
      agg.payout += payout;
      agg.hits += hits > 0 ? 1 : 0;
    }
  }

  const log = (s = ''): void => console.log(s);
  log('='.repeat(78));
  log(`  馬単 戦略比較バックテスト (対象: ${data.length}R / ${mode})`);
  log('='.repeat(78));
  log('| 戦略                                     | 参加 | 参加率| 点数  | 的中R | 投資    | 払戻    | 回収率  |');
  log('|------------------------------------------|------|-------|-------|-------|---------|---------|---------|');
  for (const s of STRATS) {
    const a = aggs.get(s.key)!;
    log(`| ${s.name.padEnd(40)} | ${a.participated.toString().padStart(4)} | ${pct(a.participated, a.total).padStart(5)} | ${a.points.toString().padStart(5)} | ${a.hits.toString().padStart(5)} | ${a.cost.toLocaleString().padStart(7)} | ${a.payout.toLocaleString().padStart(7)} | ${(roi(a.cost, a.payout).toFixed(1) + '%').padStart(7)} |`);
  }
  const ranking = STRATS.map(s => { const a = aggs.get(s.key)!; return { name: s.name, roi: roi(a.cost, a.payout), a }; }).sort((x, y) => y.roi - x.roi);
  log('\n▼ ランキング');
  ranking.forEach((r, i) => log(`  ${i + 1}. ${r.name}: 回収率 ${r.roi.toFixed(1)}% (的中 ${r.a.hits}/${r.a.participated}R)`));

  // Markdown
  const md: string[] = [];
  md.push(`# 馬単 戦略比較バックテスト`);
  md.push('');
  md.push(`- 対象: **${data.length}R** / データモード: ${mode}`);
  md.push('');
  md.push(`| 戦略 | 参加R | 参加率 | 点数 | 的中R | 投資額 | 払戻額 | 回収率 |`);
  md.push(`|---|---|---|---|---|---|---|---|`);
  for (const s of STRATS) {
    const a = aggs.get(s.key)!;
    md.push(`| ${a.name} | ${a.participated}/${a.total} | ${pct(a.participated, a.total)} | ${a.points} | ${a.hits} | ${a.cost.toLocaleString()}円 | ${a.payout.toLocaleString()}円 | **${roi(a.cost, a.payout).toFixed(1)}%** |`);
  }
  md.push('');
  md.push(`## ランキング`);
  md.push('');
  ranking.forEach((r, i) => md.push(`${i + 1}. **${r.name}**: 回収率 ${r.roi.toFixed(1)}%`));

  await fs.writeFile(REPORT, md.join('\n'), 'utf-8');
  log(`\nMarkdown: ${REPORT}`);
}
main().catch(e => { console.error(e); process.exit(1); });
