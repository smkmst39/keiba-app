// ==========================================
// レース情報取得エンドポイント
// GET /api/race/[raceId]
// raceId: netkeibaのレースID（例: "202606030511"）
// ==========================================

import { NextResponse } from 'next/server';
import type { Race, RaceApiResponse } from '@/lib/scraper/types';
import { fetchRaceData, fetchPreEntry } from '@/lib/scraper/netkeiba';
import { calcAllScores, calcPreEntryScores, validateScores } from '@/lib/score/calculator';
import { fetchRacePersonStats } from '@/lib/scraper/stats';
import { getCache, setCache } from '@/lib/cache';
import { MOCK_NZT_2026 } from '@/lib/scraper/__mocks__/202606030511';

export const maxDuration = 30;
export const dynamic = 'force-dynamic';

// キャッシュTTL（秒）
const TTL_CONFIRMED  = 600;   // 通常モード: 10分
const TTL_PRE_ENTRY  = 1800;  // 仮予想モード: 30分（オッズ未発売のため長め）

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
      race = { ...MOCK_NZT_2026, raceId, fetchedAt: new Date(), mode: 'confirmed' };
    } else {
      // ステップ1: 枠順確定済みの出馬表をスクレイピング
      race = await fetchRaceData(raceId);

      // ステップ2: 確定データが取れなければ仮予想モード（登録馬リスト）を試みる
      if (!race) {
        console.warn(`[api/race] 出馬表取得失敗 raceId=${raceId}, 仮予想モードを試みます`);
        race = await fetchPreEntry(raceId);
      }

      // ステップ3: それも失敗したらモックにフォールバック
      if (!race) {
        console.warn(`[api/race] 仮予想モード取得失敗 raceId=${raceId}, モックにフォールバック`);
        race = { ...MOCK_NZT_2026, raceId, fetchedAt: new Date(), mode: 'confirmed' };
      }
    }

    // スコア計算
    if (race.mode === 'pre-entry') {
      // 仮予想モード: 騎手・調教師勝率ベースのスコア（フェーズA）
      // jockeyCode / trainerCode が Horse に付与済みのため、並列で勝率を取得する
      const { jockeyRates, trainerRates } = await fetchRacePersonStats(race.horses);
      race = calcPreEntryScores(race, jockeyRates, trainerRates);
    } else {
      // 通常モード: 上がり3F・調教・馬体重等によるスコア
      race = calcAllScores(race);
    }

    // 健全性チェック（通常モードのみ。仮予想モードはEVが全0または参考値のため除外）
    if (race.mode !== 'pre-entry') {
      validateScores(race.horses);
    }

    // キャッシュに保存（TTLはモードによって変える）
    const ttl = race.mode === 'pre-entry' ? TTL_PRE_ENTRY : TTL_CONFIRMED;
    setCache(`race:${raceId}`, race, ttl);

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
