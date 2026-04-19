// ==========================================
// 検証データ一括収集スクリプト
//
// 指定日付群のすべての JRA レースについて、
//  - レースデータ（/api/race/[raceId] 相当）
//  - レース結果（/api/race/[raceId]/result 相当）
// を取得し VerificationData 形式で保存する。
//
// 実行: pnpm tsx scripts/collect-verification.ts
// 保存先: scripts/verification/YYYYMMDD_{raceId}.json
// ==========================================

import { promises as fs } from 'node:fs';
import path from 'node:path';
import axios from 'axios';
import * as cheerio from 'cheerio';

import type {
  Race,
  RaceResult,
  Venue,
  RaceEntry,
  Grade,
  VerificationData,
} from '../lib/scraper/types';
import { fetchRaceData, fetchRaceResult } from '../lib/scraper/netkeiba';
import { fetchRacePersonStats } from '../lib/scraper/stats';
import { calcAllScores } from '../lib/score/calculator';

// ----------------------------------------
// 定数
// ----------------------------------------

const TARGET_DATES = ['20260412', '20260418', '20260419'];

// netkeiba アクセス間隔（ミリ秒）— 1秒以上を厳守
const REQUEST_INTERVAL_MS = 1500;

const OUT_DIR = path.resolve(__dirname, 'verification');

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ----------------------------------------
// ユーティリティ
// ----------------------------------------

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** YYYYMMDD → "2026-04-12" 形式 */
function toIsoDate(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

// ----------------------------------------
// スケジュール取得（app/api/schedule/route.ts の scrapeSchedule 相当）
// ----------------------------------------

const COURSE_MAP: Record<string, string> = {
  '01': '札幌', '02': '函館', '03': '福島', '04': '新潟',
  '05': '東京', '06': '中山', '07': '中京', '08': '京都',
  '09': '阪神', '10': '小倉',
};

const GRADE_MAP: Record<string, Grade> = {
  'Icon_GradeType1':  'G1',
  'Icon_GradeType2':  'G2',
  'Icon_GradeType3':  'G3',
  'Icon_GradeType5':  'L',
  'Icon_GradeType15': 'OP',
  'Icon_GradeType16': 'OP',
};

async function scrapeSchedule(date: string): Promise<Venue[] | null> {
  const url = `https://race.netkeiba.com/top/race_list_sub.html?kaisai_date=${date}`;
  try {
    const res = await axios.get<string>(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ja,en-US;q=0.7,en;q=0.3',
        'Referer': 'https://race.netkeiba.com/',
      },
      timeout: 20000,
      responseType: 'text',
    });
    const html = res.data;
    const $ = cheerio.load(html);

    const venueMap = new Map<string, Venue>();

    $('.RaceList_DataHeader').each((_i, headerEl) => {
      const titleText = $(headerEl).find('.RaceList_DataTitle').text().trim();
      const venueName = Object.values(COURSE_MAP).find((name) => titleText.includes(name));
      if (!venueName) return;

      const venueCode = Object.entries(COURSE_MAP).find(([, v]) => v === venueName)?.[0] ?? '';

      const races: RaceEntry[] = [];
      $(headerEl).next('dd.RaceList_Data').find('.RaceList_DataItem').each((_j, itemEl) => {
        try {
          const href = $(itemEl).find('a[href*="race_id="]').first().attr('href') ?? '';
          const raceIdMatch = href.match(/race_id=(\d{12})/);
          if (!raceIdMatch) return;
          const raceId = raceIdMatch[1];

          const raceNumText = $(itemEl).find('.Race_Num span').first().text().trim();
          const raceNum = parseInt(raceNumText.replace('R', ''), 10) || parseInt(raceId.slice(10, 12), 10);

          const startTime = $(itemEl).find('.RaceList_Itemtime').text().trim();
          const raceName = $(itemEl).find('.ItemTitle').text().trim() || '不明';

          let grade: Grade = null;
          const gradeEl = $(itemEl).find('[class*="Icon_GradeType"]');
          if (gradeEl.length) {
            const cls = gradeEl.attr('class') ?? '';
            for (const [key, val] of Object.entries(GRADE_MAP)) {
              if (cls.includes(key)) { grade = val; break; }
            }
          }

          const headText = $(itemEl).find('.RaceList_Itemnumber').text();
          const headMatch = headText.match(/(\d+)頭/);
          const headCount = headMatch ? parseInt(headMatch[1], 10) : 0;

          races.push({ raceId, raceNum, startTime, raceName, grade, headCount });
        } catch {
          // 個別行のパース失敗は無視して継続
        }
      });

      if (races.length > 0) {
        races.sort((a, b) => a.startTime.localeCompare(b.startTime));
        venueMap.set(venueCode, { name: venueName, code: venueCode, races });
      }
    });

    if (venueMap.size === 0) return null;
    return Array.from(venueMap.values());
  } catch (err) {
    console.error(`  [schedule] ${date} 取得失敗:`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

// ----------------------------------------
// VerificationData 構築
// （app/components/RaceVerification.tsx の buildVerificationData を踏襲）
// ----------------------------------------

function scoreRankOf(horseId: number, horses: Race['horses']): number {
  const sorted = [...horses].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const idx = sorted.findIndex((h) => h.id === horseId);
  return idx >= 0 ? idx + 1 : 99;
}

function buildVerificationData(race: Race, result: RaceResult, dateIso: string): VerificationData {
  const top3ids = result.results.filter((r) => r.rank <= 3).map((r) => r.horseId);
  const highEVHorses = race.horses.filter((h) => (h.ev ?? 0) >= 1.0);
  const top3EVCount = highEVHorses.filter((h) => top3ids.includes(h.id)).length;

  const winner = result.results.find((r) => r.rank === 1);
  const top1ScoreRank = winner ? scoreRankOf(winner.horseId, race.horses) : 99;

  const scoreSorted = [...race.horses].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const top1 = scoreSorted[0];
  const top2 = scoreSorted[1];
  const top3 = scoreSorted[2];

  const top3IdsSorted = [top1?.id, top2?.id, top3?.id]
    .filter(Boolean).map(String).sort().join('-');

  const tanHit = result.payouts.tan.some((t) => t.horseId === top1?.id);
  const umarenHit = result.payouts.umaren.some((u) => {
    const ids = u.combination.split('-').map(Number).sort().join('-');
    return ids === [top1?.id, top2?.id].filter(Boolean).map(String).sort().join('-');
  });
  const sanfukuHit = result.payouts.sanfuku.some((s) => {
    const ids = s.combination.split('-').map(Number).sort().join('-');
    return ids === top3IdsSorted;
  });
  const santanHit = result.payouts.santan.some(
    (s) => s.combination === [top1?.id, top2?.id, top3?.id].join('-'),
  );

  const recommendedHits = [
    { type: '単勝',   hit: tanHit,     payout: tanHit     ? (result.payouts.tan[0]?.payout     ?? 0) : 0 },
    { type: '馬連',   hit: umarenHit,  payout: umarenHit  ? (result.payouts.umaren[0]?.payout  ?? 0) : 0 },
    { type: '三連複', hit: sanfukuHit, payout: sanfukuHit ? (result.payouts.sanfuku[0]?.payout ?? 0) : 0 },
    { type: '三連単', hit: santanHit,  payout: santanHit  ? (result.payouts.santan[0]?.payout  ?? 0) : 0 },
  ];

  return {
    raceId: race.raceId,
    raceName: race.name,
    date: dateIso,
    predictions: race.horses.map((h) => ({
      horseId: h.id,
      horseName: h.name,
      score: h.score ?? 0,
      ev: h.ev ?? 0,
      odds: h.odds,
    })),
    results: result,
    accuracy: { top1ScoreRank, top3EVCount, recommendedHits },
  };
}

// ----------------------------------------
// 1レース分のデータ取得→JSON保存
// ----------------------------------------

type ProcessOutcome =
  | { status: 'saved'; path: string }
  | { status: 'error'; reason: string };

async function processRace(raceId: string, date: string): Promise<ProcessOutcome> {
  try {
    // ---- レースデータ取得（出馬表・オッズ・調教）----
    const rawRace = await fetchRaceData(raceId);
    if (!rawRace) {
      return { status: 'error', reason: 'fetchRaceData returned null（出馬表の取得に失敗）' };
    }
    await sleep(REQUEST_INTERVAL_MS);

    // ---- 騎手・調教師勝率取得 & スコア計算 ----
    let scoredRace: Race;
    try {
      const { jockeyRates } = await fetchRacePersonStats(rawRace.horses);
      scoredRace = calcAllScores(rawRace, jockeyRates);
    } catch (e) {
      // 勝率取得に失敗してもスコア計算は走らせる（空の勝率マップで）
      console.warn(`  [${raceId}] 勝率取得失敗、空マップでスコア計算: ${e instanceof Error ? e.message : e}`);
      scoredRace = calcAllScores(rawRace, new Map());
    }
    await sleep(REQUEST_INTERVAL_MS);

    // ---- レース結果取得 ----
    const result = await fetchRaceResult(raceId);
    if (!result) {
      return { status: 'error', reason: 'fetchRaceResult returned null（レース前または結果未公開）' };
    }
    await sleep(REQUEST_INTERVAL_MS);

    // ---- VerificationData 構築 & 保存 ----
    const vd = buildVerificationData(scoredRace, result, toIsoDate(date));
    const outPath = path.join(OUT_DIR, `${date}_${raceId}.json`);
    await fs.writeFile(outPath, JSON.stringify(vd, null, 2), 'utf-8');
    return { status: 'saved', path: outPath };
  } catch (e) {
    return {
      status: 'error',
      reason: `例外発生: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

// ----------------------------------------
// メイン
// ----------------------------------------

async function main(): Promise<void> {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const summary = {
    savedCount: 0,
    skipped: [] as Array<{ raceId: string; date: string; reason: string }>,
  };

  for (const date of TARGET_DATES) {
    console.log(`\n=== ${date} のスケジュール取得中… ===`);
    const venues = await scrapeSchedule(date);
    await sleep(REQUEST_INTERVAL_MS);

    if (!venues || venues.length === 0) {
      console.log(`  → ${date}: 開催なし or 取得失敗。スキップ`);
      continue;
    }

    const raceIds = venues.flatMap((v) =>
      v.races.map((r) => ({ raceId: r.raceId, venue: v.name, raceNum: r.raceNum, raceName: r.raceName })),
    );
    console.log(`  → ${date}: ${venues.length}競馬場 / 全${raceIds.length}レース`);

    for (const { raceId, venue, raceNum, raceName } of raceIds) {
      const label = `${date} ${venue}${raceNum}R ${raceName} (raceId=${raceId})`;
      process.stdout.write(`  [${label}] 処理中… `);

      const outcome = await processRace(raceId, date);

      if (outcome.status === 'saved') {
        summary.savedCount++;
        console.log(`✓ 保存`);
      } else {
        summary.skipped.push({ raceId, date, reason: outcome.reason });
        console.log(`✗ スキップ (${outcome.reason})`);
      }
    }
  }

  // ----------------------------------------
  // 集計レポート
  // ----------------------------------------
  console.log('\n==========================================');
  console.log('  集計');
  console.log('==========================================');
  console.log(`保存できたレース数: ${summary.savedCount}`);
  console.log(`スキップしたレース数: ${summary.skipped.length}`);
  if (summary.skipped.length > 0) {
    console.log('\nスキップ内訳:');
    for (const s of summary.skipped) {
      console.log(`  - ${s.date} ${s.raceId}: ${s.reason}`);
    }
  }

  // 保存済みファイル一覧
  const files = (await fs.readdir(OUT_DIR))
    .filter((f) => f.endsWith('.json'))
    .sort();
  console.log(`\nscripts/verification/ 内のファイル (${files.length}件):`);
  for (const f of files) console.log(`  - ${f}`);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
