// ==========================================
// 開催スケジュール取得エンドポイント
// GET /api/schedule?date=20260411
// date: YYYYMMDD形式。省略時は本日。
// ==========================================

import { NextResponse } from 'next/server';
import axios from 'axios';
import * as cheerio from 'cheerio';
import type { Venue, RaceEntry, Grade, ScheduleResponse } from '@/lib/scraper/types';
import { getCache, setCache } from '@/lib/cache';
import {
  MOCK_SCHEDULE_20260411,
  MOCK_SCHEDULE_20260412,
  MOCK_SCHEDULE_20260418,
  MOCK_SCHEDULE_20260419,
} from '@/lib/scraper/__mocks__/schedule-20260411';

// キャッシュTTL: 30分
const CACHE_TTL_SCHEDULE = 1800;

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// netkeibaの場コード → 競馬場名
const COURSE_MAP: Record<string, string> = {
  '01': '札幌', '02': '函館', '03': '福島', '04': '新潟',
  '05': '東京', '06': '中山', '07': '中京', '08': '京都',
  '09': '阪神', '10': '小倉',
};

// グレードバッジクラス → Grade 型
const GRADE_MAP: Record<string, Grade> = {
  'Icon_GradeType1':  'G1',
  'Icon_GradeType2':  'G2',
  'Icon_GradeType3':  'G3',
  'Icon_GradeType5':  'L',
  'Icon_GradeType15': 'OP',
  'Icon_GradeType16': 'OP',
};

/** raceId から競馬場コードを取得 */
function courseCodeFromRaceId(raceId: string): string {
  return raceId.slice(4, 6);
}

/** race_list.html をスクレイピングして Venue[] を返す */
async function scrapeSchedule(date: string): Promise<Venue[] | null> {
  const url = `https://race.netkeiba.com/top/race_list.html?kaisai_date=${date}`;
  try {
    const res = await axios.get(url, {
      headers: { 'User-Agent': USER_AGENT, Referer: 'https://race.netkeiba.com/' },
      timeout: 10000,
      responseType: 'arraybuffer',
    });
    const html = new TextDecoder('euc-jp', { fatal: false }).decode(res.data);
    const $ = cheerio.load(html);

    const venueMap = new Map<string, Venue>();

    // 各競馬場ブロックを処理
    $('.RaceList_DataTitle').each((_i, titleEl) => {
      // 競馬場名はタイトルテキストから取得
      const titleText = $(titleEl).text().trim();
      // 競馬場名マップと照合
      const venueName = Object.values(COURSE_MAP).find((name) => titleText.includes(name));
      if (!venueName) return;

      const venueCode = Object.entries(COURSE_MAP).find(([, v]) => v === venueName)?.[0] ?? '';

      // このブロック配下のレース一覧
      const races: RaceEntry[] = [];
      $(titleEl).nextUntil('.RaceList_DataTitle', '.RaceList_DataItem').each((_j, itemEl) => {
        try {
          const href = $(itemEl).find('a[href*="race_id="]').attr('href') ?? '';
          const raceIdMatch = href.match(/race_id=(\d{12})/);
          if (!raceIdMatch) return;
          const raceId = raceIdMatch[1];

          const raceNum = parseInt($(itemEl).find('.RaceList_Num').text().trim(), 10) || 0;
          const startTime = $(itemEl).find('.RaceList_Itemtime').text().trim();
          const raceName = $(itemEl).find('.RaceList_ItemTitle').text().trim() || '不明';

          // グレードバッジ
          let grade: Grade = null;
          const gradeEl = $(itemEl).find('[class*="Icon_GradeType"]');
          if (gradeEl.length) {
            const cls = gradeEl.attr('class') ?? '';
            for (const [key, val] of Object.entries(GRADE_MAP)) {
              if (cls.includes(key)) { grade = val; break; }
            }
          }

          // 頭数: "16頭" 等のテキストから抽出
          const headText = $(itemEl).find('.RaceList_Item').text();
          const headMatch = headText.match(/(\d+)頭/);
          const headCount = headMatch ? parseInt(headMatch[1], 10) : 0;

          races.push({ raceId, raceNum, startTime, raceName, grade, headCount });
        } catch {
          // パース失敗は無視して継続
        }
      });

      if (races.length > 0) {
        races.sort((a, b) => a.startTime.localeCompare(b.startTime));
        venueMap.set(venueCode, { name: venueName, code: venueCode, races });
      }
    });

    // raceId から場コードを使ってフォールバック処理（タイトルが取れなかった場合）
    if (venueMap.size === 0) {
      // 別アプローチ: hrefa の raceId から場コードを逆引き
      $('a[href*="race_id="]').each((_i, a) => {
        const href = $(a).attr('href') ?? '';
        const m = href.match(/race_id=(\d{12})/);
        if (!m) return;
        const raceId = m[1];
        const code = courseCodeFromRaceId(raceId);
        const name = COURSE_MAP[code];
        if (!name) return;
        if (!venueMap.has(code)) venueMap.set(code, { name, code, races: [] });
      });

      if (venueMap.size === 0) return null;
    }

    return Array.from(venueMap.values());
  } catch (err) {
    console.error('[api/schedule] スクレイピング失敗:', err);
    return null;
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  // date パラメータ（省略時は今日）
  const today = new Date();
  const defaultDate = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  const date = searchParams.get('date') ?? defaultDate;

  // バリデーション
  if (!/^\d{8}$/.test(date)) {
    return NextResponse.json(
      { success: false, data: [], meta: { fetchedAt: new Date().toISOString(), cached: false, mock: false }, error: '日付はYYYYMMDD形式で指定してください' },
      { status: 400 }
    );
  }

  // キャッシュチェック
  const cacheKey = `schedule:${date}`;
  const cached = getCache<{ date: string; venues: Venue[] }>(cacheKey);
  if (cached) {
    const res: ScheduleResponse = {
      success: true,
      data: [cached],
      meta: { fetchedAt: new Date().toISOString(), cached: true, mock: false },
    };
    return NextResponse.json(res, { headers: { 'X-Cache': 'HIT' } });
  }

  // モックモード
  if (process.env.USE_MOCK === 'true') {
    // 土日（開催あり）の日付のみデータを返す。それ以外は空レスポンス（開催なし）
    const MOCK_MAP: Record<string, { date: string; venues: Venue[] }> = {
      '20260411': MOCK_SCHEDULE_20260411,
      '20260412': MOCK_SCHEDULE_20260412,
      '20260418': MOCK_SCHEDULE_20260418,
      '20260419': MOCK_SCHEDULE_20260419,
    };
    const mockData = MOCK_MAP[date];
    if (!mockData) {
      // 開催なしの日 → success: true, venues: [] を返す
      const res: ScheduleResponse = {
        success: true,
        data: [{ date, venues: [] }],
        meta: { fetchedAt: new Date().toISOString(), cached: false, mock: true },
      };
      return NextResponse.json(res);
    }
    const data = { ...mockData, date };
    setCache(cacheKey, data, CACHE_TTL_SCHEDULE);
    const res: ScheduleResponse = {
      success: true,
      data: [data],
      meta: { fetchedAt: new Date().toISOString(), cached: false, mock: true },
    };
    return NextResponse.json(res);
  }

  // 実データ取得
  const venues = await scrapeSchedule(date);
  if (!venues || venues.length === 0) {
    // スクレイピング失敗時は開催なしとして返す（モックへのフォールバックは廃止）
    console.warn(`[api/schedule] ${date}のスクレイピング失敗またはデータなし`);
    const res: ScheduleResponse = {
      success: true,
      data: [{ date, venues: [] }],
      meta: { fetchedAt: new Date().toISOString(), cached: false, mock: false },
    };
    return NextResponse.json(res);
  }

  const data = { date, venues };
  setCache(cacheKey, data, CACHE_TTL_SCHEDULE);
  const res: ScheduleResponse = {
    success: true,
    data: [data],
    meta: { fetchedAt: new Date().toISOString(), cached: false, mock: false },
  };
  return NextResponse.json(res);
}
