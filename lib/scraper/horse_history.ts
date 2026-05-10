// ==========================================
// 競走馬の過去戦績スクレイパー
//
// fetchHorseResults(horseId): db.netkeiba.com/horse/result/{horseId}/ から
// 全戦績（着順・タイム・上がり3F・距離・馬場など）を取得する。
//
// 用途: scoreCourseRecord (同条件過去走の集約) のデータ供給。
//
// 7日間キャッシュ。失敗時は空配列を返す（呼び出し側で 50 フォールバック）。
//
// 構造調査の根拠:
//   /tmp/courserecord-probe/horse_result_2021106164.html を実HTMLで確認 (2026-05-07)。
//   table.db_h_race_results.nk_tb_common 1行=1戦の表形式。33列構成。
// ==========================================

import axios from 'axios';
import * as cheerio from 'cheerio';
import { getCache, setCache } from '../cache';
import { getDistanceBand } from './sire';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** 7日間キャッシュ（馬の過去戦績は短期で増えない） */
const CACHE_TTL_HISTORY = 7 * 24 * 60 * 60;
const REQUEST_TIMEOUT_MS = 15000;

/** 1走分の戦績データ */
export type PastRace = {
  date: string;            // "2026/04/26"
  course: string;          // "京都" (開催文字列の数字以外を抽出)
  distance: number;        // 1800
  surface: 'turf' | 'dirt';
  trackCondition: string;  // "良" / "稍重" / "重" / "不"
  rank: number;            // 着順 (取消・中止・除外・失格は -1)
  time: string;            // "1:52.3"
  lastThreeF: number;      // 37.9 (取得失敗時 0)
  raceName: string;        // "天ケ瀬特別(2勝クラス)" / "天皇賞(春)(G1)" 等
};

/** EUC-JP デコード GET。失敗時 null */
async function fetchEucHtml(url: string): Promise<string | null> {
  try {
    const res = await axios.get<ArrayBuffer>(url, {
      headers: { 'User-Agent': USER_AGENT, Referer: 'https://db.netkeiba.com/' },
      timeout: REQUEST_TIMEOUT_MS,
      responseType: 'arraybuffer',
    });
    return new TextDecoder('euc-jp', { fatal: false }).decode(res.data as unknown as ArrayBuffer);
  } catch {
    return null;
  }
}

/** 開催文字列 "3京都2" → "京都" を抽出（先頭・末尾の数字を除いた中央テキスト） */
function parseCourseName(kaisaiText: string): string {
  // 先頭の開催回数字、末尾の開催日数字を除く
  const m = kaisaiText.replace(/^\d+/, '').replace(/\d+$/, '').trim();
  return m;
}

/** 距離文字列 "ダ1800" / "芝2400" → { surface, distance } */
function parseDistance(text: string): { surface: 'turf' | 'dirt'; distance: number } | null {
  const m = text.match(/^(芝|ダ)(\d+)/);
  if (!m) return null;
  return { surface: m[1] === '芝' ? 'turf' : 'dirt', distance: parseInt(m[2], 10) };
}

/** 着順 "7" → 7、"取消" "中止" "除外" "失格" "降" 等 → -1 */
function parseRank(text: string): number {
  const t = text.trim();
  const n = parseInt(t, 10);
  if (Number.isFinite(n) && n > 0) return n;
  return -1;
}

/**
 * 競走馬IDから全戦績を取得する。
 * @param horseId db.netkeiba.com の競走馬ID（10桁数字想定）
 */
export async function fetchHorseResults(horseId: string): Promise<PastRace[]> {
  if (!/^\w{8,12}$/.test(horseId)) return [];

  const cacheKey = `horse-results:${horseId}`;
  const cached = getCache<PastRace[]>(cacheKey);
  if (cached) return cached;

  const html = await fetchEucHtml(`https://db.netkeiba.com/horse/result/${horseId}/`);
  if (!html) return [];

  try {
    const $ = cheerio.load(html);
    const $tbl = $('table.db_h_race_results').first();
    if ($tbl.length === 0) {
      console.warn(`[horse_history] 戦績テーブルなし horseId=${horseId}`);
      return [];
    }

    // 列インデックスは 2026-05-07 時点の構造に基づく（合計33列）:
    //   0=日付 1=開催 2=天気 3=R 4=レース名 5=映像
    //   6=頭数 7=枠番 8=馬番 9=オッズ 10=人気 11=着順
    //   12=騎手 13=斤量 14=距離 15=水分量 16=馬場 17=馬場指数
    //   18=タイム 19=着差 20=ﾀｲﾑ指数 21=ﾀｲﾑ指数M 22=ｽﾀｰﾄ指数
    //   23=追走指数 24=上がり指数 25=通過 26=ペース 27=上り
    //   28=馬体重 29=厩舎ｺﾒﾝﾄ 30=備考 31=勝ち馬 32=賞金
    const past: PastRace[] = [];
    $tbl.find('tr').slice(1).each((_, row) => {
      const cells = $(row).find('td');
      if (cells.length < 28) return;

      const date = cells.eq(0).text().trim();
      const kaisai = cells.eq(1).text().trim();
      const raceName = cells.eq(4).text().replace(/\s+/g, ' ').trim();
      const rank = parseRank(cells.eq(11).text());
      const distInfo = parseDistance(cells.eq(14).text().trim());
      if (!distInfo) return;
      const trackCondition = cells.eq(16).text().trim();
      const time = cells.eq(18).text().trim();
      const lastThreeF = parseFloat(cells.eq(27).text().trim()) || 0;

      past.push({
        date,
        course: parseCourseName(kaisai),
        distance: distInfo.distance,
        surface: distInfo.surface,
        trackCondition,
        rank,
        time,
        lastThreeF,
        raceName,
      });
    });

    setCache(cacheKey, past, CACHE_TTL_HISTORY);
    return past;
  } catch (e) {
    console.warn(`[horse_history] パース失敗 horseId=${horseId}:`, e);
    return [];
  }
}

/**
 * 過去1年・同条件 (同競馬場 + 同距離カテゴリ + 同芝/ダ) でフィルタ。
 * 取消・中止 (rank<1) や日付パース失敗は除外。
 *
 * 2026-05-09 (タイムリーキ防止): baseDate 以降の過去走 (= 検証対象レース当日や
 * baseDate より未来のレース) も除外。事後収集された /horse/result/{id}/ には
 * 検証対象レース自身や、それより新しいレースまで含まれているため、これらを
 * 「過去走」として扱うのは誤り (本来見られるはずのない情報の混入)。
 */
export function filterCourseRecord(
  pasts: PastRace[],
  baseDate: Date,
  course: string,
  surface: 'turf' | 'dirt',
  distance: number,
): PastRace[] {
  const oneYearAgo = new Date(baseDate);
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const band = getDistanceBand(distance);
  return pasts.filter((p) => {
    if (p.rank < 1) return false;
    const d = parseHistoryDate(p.date);
    if (d === null) return false;
    if (d < oneYearAgo) return false;
    if (d >= baseDate) return false; // 自レース・未来レース除外
    if (p.course !== course) return false;
    if (p.surface !== surface) return false;
    if (getDistanceBand(p.distance) !== band) return false;
    return true;
  });
}

/**
 * 同名レースの過去2年分のうち最新を1走返す（重賞前年同レース補正用）。
 *
 * レース名の正規化方針:
 *   - グレード表記の括弧のみ削除: (G1) (GI) (GⅠ) (G2) (GII) (GⅡ) (G3) (GIII) (GⅢ) (L) (LISTED)
 *   - クラス表記の括弧のみ削除: (1勝クラス) (2勝クラス) (3勝クラス) (500万下) (1000万下) (1600万下)
 *   - 季節区分・コース区分など意味的識別子の括弧は **保持する**: (春) (秋) (中央) (短距離) etc.
 *   例:
 *     "天皇賞(春)(G1)" と "天皇賞(春)" は同一視（→ "天皇賞(春)"）
 *     "天皇賞(春)(GI)" と "天皇賞(秋)(GI)" は **別レース**（→ "天皇賞(春)" / "天皇賞(秋)"）
 *
 * 2026-05-09: 旧実装は `\([^)]*\)` で**全括弧を一括削除**しており、季節区分まで
 * 失われて「天皇賞(春)」と「天皇賞(秋)」が同一視される重大バグがあった。本番動作確認
 * 時に「15/15頭が前年同名レース所有」という異常検出で発覚したため厳密化。
 *
 * 該当なしは null。
 */
export function findPreviousYearSameRace(
  pasts: PastRace[],
  baseDate: Date,
  raceName: string,
): PastRace | null {
  const twoYearsAgo = new Date(baseDate);
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
  const target = normalizeRaceName(raceName);
  if (!target) return null;
  for (const p of pasts) {
    if (p.rank < 1) continue;
    const d = parseHistoryDate(p.date);
    if (d === null) continue;
    if (d < twoYearsAgo) continue;
    if (d >= baseDate) continue; // タイムリーキ防止: 自レース・未来レース除外
    if (normalizeRaceName(p.raceName) === target) return p;
  }
  return null;
}

/**
 * 過去走の日付文字列 "YYYY/MM/DD" を Date (ローカルタイム 0:00) に変換。
 * パース失敗 (空・形式不一致) は null を返す。
 *
 * Date(y, m-1, d) を使用してローカルタイム 0:00 で構築する。
 * `new Date("YYYY-MM-DD")` だと UTC 0:00 として解釈されるため、JST 環境では
 * 日付がずれて見える。同様にローカルタイムで baseDate (parseRaceDate) と
 * 比較できるようにここで揃える。
 */
export function parseHistoryDate(s: string): Date | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10) - 1;
  const d = parseInt(m[3], 10);
  if (Number.isNaN(y) || Number.isNaN(mo) || Number.isNaN(d)) return null;
  return new Date(y, mo, d);
}

/**
 * Race.raceDate ("YYYYMMDD") を Date (ローカルタイム 0:00) に変換。
 * 不正フォーマットの場合は null を返す (呼び出し側でフォールバック)。
 *
 * parseHistoryDate と同じくローカルタイム 0:00 で構築する。
 */
export function parseRaceDate(raceDate: string | undefined): Date | null {
  if (!raceDate || !/^\d{8}$/.test(raceDate)) return null;
  const y = parseInt(raceDate.slice(0, 4), 10);
  const mo = parseInt(raceDate.slice(4, 6), 10) - 1;
  const d = parseInt(raceDate.slice(6, 8), 10);
  return new Date(y, mo, d);
}

/**
 * レース名の正規化。グレード/クラス括弧のみ削除し、意味的識別子の括弧は保持する。
 * 重賞前年同レース補正の比較で使用。テスト容易化のため export している。
 */
export function normalizeRaceName(s: string): string {
  return s
    // グレード表記: (G1)(G2)(G3)(GI)(GII)(GIII) (半角ローマ数字)
    .replace(/\(G[123IⅠⅡⅢ]+\)/gi, '')
    // リステッド: (L) (LISTED) (Listed)
    .replace(/\(L\)|\(LISTED\)/gi, '')
    // 旧クラス表記: (500万下) (1000万下) (1600万下)
    .replace(/\(\d+万下\)/g, '')
    // 新クラス表記: (1勝クラス) (2勝クラス) (3勝クラス)
    .replace(/\(\d+勝クラス\)/g, '')
    // 余分な空白の正規化
    .replace(/\s+/g, ' ')
    .trim();
}
