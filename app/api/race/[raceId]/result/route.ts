// ==========================================
// レース結果取得エンドポイント
// GET /api/race/[raceId]/result
//
// レース終了後に着順・払戻金をスクレイピングして返す。
// レース前・レース中は null を返す（fetchRaceResult が null を返す）。
// ==========================================

import { NextResponse } from 'next/server';
import type { RaceResultApiResponse } from '@/lib/scraper/types';
import { fetchRaceResult } from '@/lib/scraper/netkeiba';
import { getCache, setCache } from '@/lib/cache';
import { MOCK_RESULT } from '@/lib/scraper/__mocks__/result';

export const maxDuration = 30;
export const dynamic = 'force-dynamic';

// 結果は変わらないので長めにキャッシュ
const CACHE_TTL = 1800; // 30分

export async function GET(
  _req: Request,
  { params }: { params: { raceId: string } }
) {
  const { raceId } = params;

  if (!/^\d{12}$/.test(raceId)) {
    const res: RaceResultApiResponse = {
      success: false,
      data: null,
      error: `無効なraceId: ${raceId}`,
    };
    return NextResponse.json(res, { status: 400 });
  }

  const cacheKey = `result:${raceId}`;

  try {
    // キャッシュ確認
    const cached = getCache<RaceResultApiResponse['data']>(cacheKey);
    if (cached) {
      const res: RaceResultApiResponse = { success: true, data: cached };
      return NextResponse.json(res, { headers: { 'X-Cache': 'HIT' } });
    }

    let data: RaceResultApiResponse['data'] = null;

    if (process.env.USE_MOCK === 'true') {
      // モックモード: サンプル結果データを返す
      data = { ...MOCK_RESULT, raceId };
    } else {
      data = await fetchRaceResult(raceId);
    }

    if (!data) {
      // レース前 or スクレイピング失敗 → 204 No Content
      const res: RaceResultApiResponse = {
        success: false,
        data: null,
        error: 'レース結果が取得できませんでした（レース前またはデータ未公開）',
      };
      return NextResponse.json(res, { status: 404 });
    }

    setCache(cacheKey, data, CACHE_TTL);

    const res: RaceResultApiResponse = { success: true, data };
    return NextResponse.json(res, { headers: { 'X-Cache': 'MISS' } });

  } catch (err) {
    console.error('[api/result] エラー:', err);
    const res: RaceResultApiResponse = {
      success: false,
      data: null,
      error: 'サーバーエラーが発生しました',
    };
    return NextResponse.json(res, { status: 500 });
  }
}
