// ==========================================
// レース情報取得エンドポイント
// GET /api/race/[raceId]
// raceId: netkeibaのレースID（例: "202606030511"）
// ==========================================

import { NextResponse } from 'next/server';
import type { Race, RaceApiResponse } from '@/lib/scraper/types';
import { scrapeRace } from '@/lib/scraper/netkeiba';
import { calcAllScores, validateScores } from '@/lib/score/calculator';
import { getCache, setCache } from '@/lib/cache';
import { MOCK_NZT_2026 } from '@/lib/scraper/__mocks__/202606030511';

export async function GET(
  _req: Request,
  { params }: { params: { raceId: string } }
) {
  const { raceId } = params;

  // raceIdのバリデーション（netkeibaは12桁の数字）
  if (!/^\d{12}$/.test(raceId)) {
    const res: RaceApiResponse = {
      success: false,
      data: null,
      error: `無効なraceId: ${raceId}。12桁の数字を指定してください。`,
    };
    return NextResponse.json(res, { status: 400 });
  }

  try {
    // キャッシュHITチェック
    const cached = getCache<Race>(`race:${raceId}`);
    if (cached) {
      const res: RaceApiResponse = { success: true, data: cached };
      return NextResponse.json(res, {
        headers: { 'X-Cache': 'HIT' },
      });
    }

    // キャッシュMISS: データ取得
    let race: Race | null = null;

    if (process.env.USE_MOCK === 'true') {
      // モックモード: 15頭の本番相当モックデータを返す
      race = { ...MOCK_NZT_2026, raceId, fetchedAt: new Date() };
    } else {
      // 本番モード: netkeibaからスクレイピング
      race = await scrapeRace(raceId);
    }

    if (!race) {
      const res: RaceApiResponse = {
        success: false,
        data: null,
        error: `レース情報が取得できませんでした: raceId=${raceId}`,
      };
      return NextResponse.json(res, { status: 404 });
    }

    // スコア・EV計算（全馬分まとめて計算）
    race = calcAllScores(race);

    // 健全性チェック（コンソールに出力）
    validateScores(race.horses);

    // キャッシュに保存
    setCache(`race:${raceId}`, race);

    const res: RaceApiResponse = { success: true, data: race };
    return NextResponse.json(res, {
      headers: { 'X-Cache': 'MISS' },
    });
  } catch (err) {
    console.error('[api/race] エラー:', err);
    const res: RaceApiResponse = {
      success: false,
      data: null,
      error: 'サーバーエラーが発生しました。',
    };
    return NextResponse.json(res, { status: 500 });
  }
}
