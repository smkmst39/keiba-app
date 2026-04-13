// ==========================================
// 組み合わせオッズ取得エンドポイント
// GET /api/race/[raceId]/combo-odds
// ==========================================

import { NextResponse } from 'next/server';
import type { Horse, ComboOddsData, ComboOddsApiResponse } from '@/lib/scraper/types';
import { fetchComboOdds } from '@/lib/scraper/netkeiba';
import { getCache, setCache } from '@/lib/cache';
import { MOCK_NZT_2026 } from '@/lib/scraper/__mocks__/202606030511';

const CACHE_TTL = 300; // 5分

// ==========================================
// モック用: 馬データからコンボオッズを計算
// ==========================================
function buildMockComboOdds(horses: Horse[]): ComboOddsData {
  const waku:    Record<string, number> = {};
  const umaren:  Record<string, number> = {};
  const umatan:  Record<string, number> = {};
  const wide:    Record<string, number> = {};
  const sanfuku: Record<string, number> = {};
  const santan:  Record<string, number> = {};

  const round1 = (v: number) => Math.round(v * 10) / 10;

  // 枠連（枠番ごとの平均オッズを使って計算）
  for (let w1 = 1; w1 <= 8; w1++) {
    for (let w2 = w1 + 1; w2 <= 8; w2++) {
      const h1s = horses.filter(h => h.waku === w1);
      const h2s = horses.filter(h => h.waku === w2);
      if (h1s.length === 0 || h2s.length === 0) continue;
      const avg1 = h1s.reduce((s, h) => s + h.odds, 0) / h1s.length;
      const avg2 = h2s.reduce((s, h) => s + h.odds, 0) / h2s.length;
      waku[`${w1}-${w2}`] = round1(avg1 * avg2 * 0.22);
    }
  }

  // 馬連・ワイド（順不同ペア）
  for (let i = 0; i < horses.length; i++) {
    for (let j = i + 1; j < horses.length; j++) {
      const h1 = horses[i], h2 = horses[j];
      const key = `${Math.min(h1.id, h2.id)}-${Math.max(h1.id, h2.id)}`;
      umaren[key] = round1(h1.odds * h2.odds * 0.20);
      wide[key]   = round1(h1.odds * h2.odds * 0.35);
    }
  }

  // 馬単（順序付きペア）
  for (const h1 of horses) {
    for (const h2 of horses) {
      if (h1.id === h2.id) continue;
      umatan[`${h1.id}-${h2.id}`] = round1(h1.odds * h2.odds * 0.12);
    }
  }

  // 三連複（順不同3頭組）
  for (let i = 0; i < horses.length; i++) {
    for (let j = i + 1; j < horses.length; j++) {
      for (let k = j + 1; k < horses.length; k++) {
        const hs = [horses[i], horses[j], horses[k]].sort((a, b) => a.id - b.id);
        sanfuku[`${hs[0].id}-${hs[1].id}-${hs[2].id}`] =
          round1(hs[0].odds * hs[1].odds * hs[2].odds * 0.08);
      }
    }
  }

  // 三連単（順序付き3頭組）
  for (const h1 of horses) {
    for (const h2 of horses) {
      if (h1.id === h2.id) continue;
      for (const h3 of horses) {
        if (h3.id === h1.id || h3.id === h2.id) continue;
        santan[`${h1.id}-${h2.id}-${h3.id}`] =
          round1(h1.odds * h2.odds * h3.odds * 0.10);
      }
    }
  }

  return { waku, umaren, umatan, wide, sanfuku, santan };
}

// ==========================================
// GET ハンドラ
// ==========================================
export async function GET(
  _req: Request,
  { params }: { params: { raceId: string } }
) {
  const { raceId } = params;

  if (!/^\d{12}$/.test(raceId)) {
    const res: ComboOddsApiResponse = {
      success: false,
      data: null,
      meta: { fetchedAt: new Date().toISOString(), cached: false },
      error: `無効なraceId: ${raceId}`,
    };
    return NextResponse.json(res, { status: 400 });
  }

  const cacheKey = `combo-odds:${raceId}`;

  try {
    // キャッシュ確認
    const cached = getCache<ComboOddsData>(cacheKey);
    if (cached) {
      const res: ComboOddsApiResponse = {
        success: true,
        data: cached,
        meta: { fetchedAt: new Date().toISOString(), cached: true },
      };
      return NextResponse.json(res, { headers: { 'X-Cache': 'HIT' } });
    }

    let data: ComboOddsData | null = null;

    if (process.env.USE_MOCK === 'true') {
      data = buildMockComboOdds(MOCK_NZT_2026.horses);
    } else {
      data = await fetchComboOdds(raceId);
    }

    if (!data) {
      const res: ComboOddsApiResponse = {
        success: false,
        data: null,
        meta: { fetchedAt: new Date().toISOString(), cached: false },
        error: 'オッズデータを取得できませんでした',
      };
      return NextResponse.json(res, { status: 502 });
    }

    setCache(cacheKey, data, CACHE_TTL);

    const res: ComboOddsApiResponse = {
      success: true,
      data,
      meta: { fetchedAt: new Date().toISOString(), cached: false },
    };
    return NextResponse.json(res, { headers: { 'X-Cache': 'MISS' } });
  } catch (err) {
    console.error('[api/combo-odds] エラー:', err);
    const res: ComboOddsApiResponse = {
      success: false,
      data: null,
      meta: { fetchedAt: new Date().toISOString(), cached: false },
      error: 'サーバーエラーが発生しました',
    };
    return NextResponse.json(res, { status: 500 });
  }
}
