// ==========================================
// アプローチ2 軸1: 騎手コース別勝率の集計
//
// scripts/verification/ の JSON から、1着になった馬の騎手 × コース × 芝ダ
// を集計。各馬の騎手を results.results[i].horseId → predictions[].jockey で解決する。
//
// 出力: public/jockey_course_stats.json
// {
//   "stats": [{ jockey, course, surface, totalRaces, wins, top3, winRate, top3Rate }],
//   "overall": { averageWinRate, averageTop3Rate },
//   "generatedAt": "..."
// }
//
// 重要: 2026-04-24 以前に収集された verification JSON は predictions に
// jockey を保存していないため、それ以前のレースは集計から除外される。
// 週次スクレイプ (火曜 08:00 JST) で 2026-04-24 以降のデータが蓄積される。
//
// 実行: pnpm tsx scripts/build_jockey_course_stats.ts
// ==========================================

import { promises as fs } from 'node:fs';
import path from 'node:path';

const DIR = path.resolve(__dirname, 'verification');
const OUT = path.resolve(__dirname, '..', 'public', 'jockey_course_stats.json');

// raceId の 5-6 桁目 → 競馬場名 (lib/scraper/CLAUDE.md と同期)
const COURSE_MAP: Record<string, string> = {
  '01': '札幌', '02': '函館', '03': '福島', '04': '新潟', '05': '東京',
  '06': '中山', '07': '中京', '08': '京都', '09': '阪神', '10': '小倉',
};

function courseFromRaceId(raceId: string): string {
  const code = raceId.substring(4, 6);
  return COURSE_MAP[code] ?? '不明';
}

type Key = string; // jockey | course | surface
type Stat = { jockey: string; course: string; surface: string; totalRaces: number; wins: number; top3: number };

async function main(): Promise<void> {
  const files = (await fs.readdir(DIR)).filter((f) => f.endsWith('.json'));

  const stats = new Map<Key, Stat>();
  const get = (k: Key, j: string, c: string, s: string): Stat => {
    let v = stats.get(k);
    if (!v) { v = { jockey: j, course: c, surface: s, totalRaces: 0, wins: 0, top3: 0 }; stats.set(k, v); }
    return v;
  };

  let totalProcessed = 0, totalSkippedNoJockey = 0, totalHorseRecords = 0;

  for (const f of files) {
    let j: any;
    try { j = JSON.parse(await fs.readFile(path.join(DIR, f), 'utf-8')); } catch { continue; }
    const preds = j.predictions ?? [];
    const res   = j.results?.results ?? [];
    const surface: string = j.meta?.surface ?? 'unknown';
    const course = courseFromRaceId(j.raceId ?? f.substring(9, 21));
    if (preds.length === 0 || res.length === 0) continue;

    // jockey 保存済みか (2026-04-24 以降のデータ)
    const hasJockey = preds[0]?.jockey != null && typeof preds[0].jockey === 'string';
    if (!hasJockey) { totalSkippedNoJockey++; continue; }

    // horseId → jockey
    const horseIdToJockey = new Map<number, string>();
    for (const p of preds) {
      if (typeof p.jockey === 'string' && p.jockey.trim()) {
        horseIdToJockey.set(p.horseId, p.jockey.trim());
      }
    }

    totalProcessed++;

    for (const r of res) {
      const jockey = horseIdToJockey.get(r.horseId);
      if (!jockey) continue;
      totalHorseRecords++;
      const key = `${jockey}|${course}|${surface}`;
      const st = get(key, jockey, course, surface);
      st.totalRaces++;
      if (r.rank === 1) st.wins++;
      if (r.rank >= 1 && r.rank <= 3) st.top3++;
    }
  }

  // 全騎手平均 (フォールバック用)
  let totalWinNumer = 0, totalTop3Numer = 0, totalDenom = 0;
  for (const s of Array.from(stats.values())) {
    totalDenom += s.totalRaces;
    totalWinNumer += s.wins;
    totalTop3Numer += s.top3;
  }
  const avgWin = totalDenom > 0 ? totalWinNumer / totalDenom : 0.07;
  const avgTop3 = totalDenom > 0 ? totalTop3Numer / totalDenom : 0.23;

  const out = {
    generatedAt: new Date().toISOString(),
    sourceNote: '2026-04-24 以降に収集された verification JSON のみ jockey が保存されている',
    processedRaces: totalProcessed,
    skippedNoJockey: totalSkippedNoJockey,
    horseRecords: totalHorseRecords,
    overall: {
      averageWinRate: avgWin,
      averageTop3Rate: avgTop3,
    },
    stats: Array.from(stats.values())
      .map((s) => ({
        ...s,
        winRate:  s.totalRaces > 0 ? s.wins / s.totalRaces : 0,
        top3Rate: s.totalRaces > 0 ? s.top3 / s.totalRaces : 0,
      }))
      .sort((a, b) => b.totalRaces - a.totalRaces),
  };

  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(out, null, 2), 'utf-8');

  console.log('=============================================');
  console.log('  騎手コース別勝率 集計完了');
  console.log('=============================================');
  console.log(`  総 JSON 数:        ${files.length}`);
  console.log(`  jockey あり R数:   ${totalProcessed}`);
  console.log(`  jockey なし(skip): ${totalSkippedNoJockey}`);
  console.log(`  集計対象 馬記録:   ${totalHorseRecords}`);
  console.log(`  騎手×コース組数:   ${stats.size}`);
  console.log(`  全体平均勝率:      ${(avgWin * 100).toFixed(2)}%`);
  console.log(`  全体平均複勝率:    ${(avgTop3 * 100).toFixed(2)}%`);
  console.log(`  出力:              ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
