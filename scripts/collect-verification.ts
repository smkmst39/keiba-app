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
import { calcAllScores, calcAllComponentScores } from '../lib/score/calculator';

// ----------------------------------------
// 定数
// ----------------------------------------

/**
 * デフォルトの収集対象日付 (過去約 5 ヶ月の土日・約30日分 ≒ 1080レース)
 * 2026年4月〜2025年12月の JRA 開催日（土日）
 */
const DEFAULT_TARGET_DATES = [
  // 2026-04
  '20260404', '20260405', '20260412', '20260418', '20260419',
  // 2026-03
  '20260328', '20260329',
  '20260321', '20260322',
  '20260314', '20260315',
  '20260307', '20260308',
  // 2026-02
  '20260228', '20260301',
  '20260221', '20260222',
  '20260214', '20260215',
  '20260207', '20260208',
  '20260201', '20260202',
  // 2026-01
  '20260125', '20260126',
  '20260118', '20260119',
  '20260111', '20260112',
  '20260105',
  // 2025-12
  '20251228',
  '20251221', '20251222',
  '20251214', '20251215',
  '20251207', '20251208',
] as const;

// netkeiba アクセス間隔（ミリ秒）— Phase 2E: 2.0秒以上に変更
const REQUEST_INTERVAL_MS = Number(process.env.SCRAPE_INTERVAL_MS ?? 2000);

/** 1バッチあたりの最大レース数 (200超えると WAF 検知リスク) */
const BATCH_MAX_SIZE = 200;

/** バッチ間の休憩時間（ミリ秒、10分） */
const BATCH_REST_MS = 10 * 60 * 1000;

/** 403/400 エラー検出時の停止待機 (3時間) */
const BLOCK_RECOVERY_MS = 3 * 60 * 60 * 1000;

const OUT_DIR = path.resolve(__dirname, 'verification');
const LOG_PATH = path.join(OUT_DIR, 'collect.log');

/** 進捗ログ出力のインターバル (レース数) */
const PROGRESS_LOG_EVERY = 30;

/** 深夜帯チェック（2-6時は実行禁止） */
function isForbiddenTime(): boolean {
  const hour = new Date().getHours();
  return hour >= 2 && hour < 6;
}

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
    let componentsMap: ReturnType<typeof calcAllComponentScores>;
    try {
      const { jockeyRates } = await fetchRacePersonStats(rawRace.horses);
      scoredRace    = calcAllScores(rawRace, jockeyRates);
      componentsMap = calcAllComponentScores(rawRace, jockeyRates);
    } catch (e) {
      console.warn(`  [${raceId}] 勝率取得失敗、空マップでスコア計算: ${e instanceof Error ? e.message : e}`);
      scoredRace    = calcAllScores(rawRace, new Map());
      componentsMap = calcAllComponentScores(rawRace, new Map());
    }
    await sleep(REQUEST_INTERVAL_MS);

    // ---- レース結果取得 ----
    const result = await fetchRaceResult(raceId);
    if (!result) {
      return { status: 'error', reason: 'fetchRaceResult returned null（レース前または結果未公開）' };
    }
    await sleep(REQUEST_INTERVAL_MS);

    // ---- VerificationData 構築 & 保存 ----
    //   predictions に components (Stage 3 重み最適化用) も追加する
    const vd = buildVerificationData(scoredRace, result, toIsoDate(date));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (vd as any).predictions = vd.predictions.map((p) => ({
      ...p,
      components: componentsMap.get(p.horseId) ?? null,
    }));

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

/** CLI 引数から収集対象日付を解決する (--dates 20260412,20260418 形式。未指定はデフォルト) */
function resolveTargetDates(): string[] {
  const args = process.argv.slice(2);
  const idx = args.indexOf('--dates');
  if (idx >= 0 && args[idx + 1]) {
    const dates = args[idx + 1].split(',').map((s) => s.trim()).filter((s) => /^\d{8}$/.test(s));
    if (dates.length === 0) {
      console.error('--dates に有効なYYYYMMDD形式の日付がありません');
      process.exit(1);
    }
    return dates;
  }
  return [...DEFAULT_TARGET_DATES];
}

/** 既に保存済みかチェック (raceId 単位で存在するか) */
async function isAlreadySaved(date: string, raceId: string): Promise<boolean> {
  try {
    await fs.access(path.join(OUT_DIR, `${date}_${raceId}.json`));
    return true;
  } catch {
    return false;
  }
}

/** ログファイルに1行追記 */
async function appendLog(line: string): Promise<void> {
  const stamped = `[${new Date().toISOString()}] ${line}\n`;
  await fs.appendFile(LOG_PATH, stamped, 'utf-8');
}

async function main(): Promise<void> {
  // 深夜帯禁止チェック
  if (isForbiddenTime()) {
    console.error('⚠️  現在 2-6 時は実行禁止時間帯です (CLAUDE.md 参照)。処理を中断します。');
    process.exit(1);
  }

  await fs.mkdir(OUT_DIR, { recursive: true });
  const targetDates = resolveTargetDates();

  await appendLog(`=== 収集開始 対象 ${targetDates.length} 日 / アクセス間隔 ${REQUEST_INTERVAL_MS}ms / バッチ${BATCH_MAX_SIZE}R+休憩${BATCH_REST_MS/60000}分 ===`);

  const summary = {
    savedCount:   0,
    skippedDone:  0, // 既存ファイルによるスキップ
    errorSkipped: [] as Array<{ raceId: string; date: string; reason: string }>,
    consecutive400: 0, // 連続 400/403 カウンタ (サーキットブレーカ用)
  };

  // ---- Pass 1: 全日付のスケジュールを集めて総レース数を算出 ----
  type Task = { raceId: string; date: string; venue: string; raceNum: number; raceName: string };
  const allTasks: Task[] = [];

  for (const date of targetDates) {
    console.log(`\n=== ${date} のスケジュール取得中… ===`);
    const venues = await scrapeSchedule(date);
    await sleep(REQUEST_INTERVAL_MS);
    if (!venues || venues.length === 0) {
      console.log(`  → ${date}: 開催なし or 取得失敗。スキップ`);
      await appendLog(`SCHEDULE_EMPTY ${date}`);
      continue;
    }
    for (const v of venues) {
      for (const r of v.races) {
        allTasks.push({ raceId: r.raceId, date, venue: v.name, raceNum: r.raceNum, raceName: r.raceName });
      }
    }
    console.log(`  → ${date}: ${venues.length}競馬場 / ${venues.reduce((s, v) => s + v.races.length, 0)}レース`);
  }

  const total = allTasks.length;
  console.log(`\n==========================================`);
  console.log(`  ${targetDates.length} 日分 / 合計 ${total} レースを処理します`);
  console.log(`==========================================\n`);
  await appendLog(`TOTAL_TASKS ${total}`);

  // ---- Pass 2: 各レースを処理（既存はスキップ）----
  const startMs = Date.now();
  let processedThisRun = 0;
  let batchCounter = 0; // バッチ内カウンタ (BATCH_MAX_SIZE で休憩)

  for (let i = 0; i < allTasks.length; i++) {
    const t = allTasks[i];
    const idx = i + 1;

    // 既存ファイルはスキップ（再開可能にする）
    if (await isAlreadySaved(t.date, t.raceId)) {
      summary.skippedDone++;
      continue;
    }

    // バッチ休憩: BATCH_MAX_SIZE レース処理したら 10 分休憩
    if (batchCounter > 0 && batchCounter % BATCH_MAX_SIZE === 0) {
      const restMin = BATCH_REST_MS / 60000;
      console.log(`\n💤 バッチ休憩中... (${restMin} 分)  現在 ${summary.savedCount} R 保存済み`);
      await appendLog(`BATCH_REST start for ${restMin}min at race ${idx}/${total}`);
      await sleep(BATCH_REST_MS);
      console.log(`再開: [${idx}/${total}]`);
      await appendLog(`BATCH_REST end, resuming at ${idx}/${total}`);
    }

    processedThisRun++;
    batchCounter++;

    const outcome = await processRace(t.raceId, t.date);

    if (outcome.status === 'saved') {
      summary.savedCount++;
      summary.consecutive400 = 0;
      await appendLog(`SAVED ${t.date} ${t.raceId} ${t.venue}${t.raceNum}R ${t.raceName}`);
    } else {
      summary.errorSkipped.push({ raceId: t.raceId, date: t.date, reason: outcome.reason });
      await appendLog(`ERROR ${t.date} ${t.raceId}: ${outcome.reason}`);
      console.log(`  [${idx}/${total}] ${t.date} ${t.raceId} ✗ ${outcome.reason}`);

      // サーキットブレーカ: 連続 10回エラーなら WAF ブロックと判断して停止
      const isBlockish = /400|403|Request failed/i.test(outcome.reason);
      if (isBlockish) {
        summary.consecutive400++;
        if (summary.consecutive400 >= 10) {
          console.error(`\n🚫 連続10回の 400/403 エラーを検知。netkeiba からブロックされた可能性が高い。`);
          console.error(`   3時間後の再開のため処理を中断します。残り ${total - idx} レース。`);
          await appendLog(`CIRCUIT_BREAKER_TRIP at ${idx}/${total} — 10 consecutive 4xx errors`);
          break;
        }
      } else {
        summary.consecutive400 = 0;
      }
    }

    // 30レースごとに進捗ログ
    if (processedThisRun % PROGRESS_LOG_EVERY === 0) {
      const elapsedMs = Date.now() - startMs;
      const avgMsPerRace = elapsedMs / processedThisRun;
      const remaining = total - idx;
      const etaMin = Math.round((remaining * avgMsPerRace) / 60000);
      const elapsedMin = Math.round(elapsedMs / 60000);
      console.log(
        `[${idx}/${total}] ${t.date} ${t.raceId} を処理中... ` +
        `経過${elapsedMin}分 / 残り約${etaMin}分 / 保存${summary.savedCount} / 既存スキップ${summary.skippedDone} / エラー${summary.errorSkipped.length}`,
      );
      await appendLog(
        `PROGRESS ${idx}/${total} saved=${summary.savedCount} existing=${summary.skippedDone} errors=${summary.errorSkipped.length} eta=${etaMin}min`,
      );
    }
  }

  // ----------------------------------------
  // 集計レポート
  // ----------------------------------------
  const totalMin = Math.round((Date.now() - startMs) / 60000);
  console.log('\n==========================================');
  console.log('  集計');
  console.log('==========================================');
  console.log(`処理対象           : ${total} レース (${targetDates.length} 日)`);
  console.log(`今回新規保存        : ${summary.savedCount} レース`);
  console.log(`既存ファイルでスキップ: ${summary.skippedDone} レース`);
  console.log(`エラーでスキップ    : ${summary.errorSkipped.length} レース`);
  console.log(`実行時間           : 約 ${totalMin} 分`);
  if (summary.errorSkipped.length > 0) {
    console.log('\nエラー内訳:');
    for (const s of summary.errorSkipped) {
      console.log(`  - ${s.date} ${s.raceId}: ${s.reason}`);
    }
  }

  // 保存済みファイル総数
  const files = (await fs.readdir(OUT_DIR))
    .filter((f) => f.endsWith('.json') && f !== 'backtest_report.md');
  console.log(`\nscripts/verification/ 内の総ファイル数: ${files.length} 件`);
  await appendLog(`=== 収集終了 saved=${summary.savedCount} existing=${summary.skippedDone} errors=${summary.errorSkipped.length} total_files=${files.length} ===`);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
