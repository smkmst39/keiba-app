// ==========================================
// 騎手・調教師 勝率取得モジュール
// db.netkeiba.com から当年成績を取得してキャッシュする
// ==========================================

import axios from 'axios';
import * as cheerio from 'cheerio';
import { getCache, setCache } from '../cache';
import type { Horse } from './types';

// ==========================================
// 定数
// ==========================================

const TTL_STATS = 86400; // 24時間キャッシュ
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const BASE_DB = 'https://db.netkeiba.com';
const CURRENT_YEAR = new Date().getFullYear().toString(); // "2026"

// ==========================================
// 共通HTML取得（EUC-JP対応）
// ==========================================

async function fetchDbPage(url: string): Promise<string | null> {
  try {
    const res = await axios.get<ArrayBuffer>(url, {
      headers: { 'User-Agent': USER_AGENT, Referer: `${BASE_DB}/` },
      timeout: 10000,
      responseType: 'arraybuffer',
    });
    const decoder = new TextDecoder('euc-jp', { fatal: false });
    return decoder.decode(res.data as unknown as ArrayBuffer);
  } catch (err) {
    console.error(`[stats] fetchDbPage失敗: ${url}`, err);
    return null;
  }
}

// ==========================================
// 共通パーサー: 年度別成績テーブルから当年勝率を取得
// ==========================================

/**
 * db.netkeiba.com の騎手/調教師ページから当年の勝率を返す
 * テーブル構造: 年度 | 順位 | 1着 | 2着 | 3着 | 4着〜 | 騎乗回数 | 重賞出走 | 重賞勝利 | 勝率 | ...
 * 勝率は index 9（0始まり）
 */
function parseWinRate(html: string): number {
  const $ = cheerio.load(html);
  let winRate = 0;

  $('tr').each((_i, row) => {
    if (winRate > 0) return; // 最初に見つかった当年行で終了
    const cells = $(row).find('td');
    if (cells.first().text().trim() !== CURRENT_YEAR) return;

    const rateText = cells.eq(9).text().trim(); // "16.8％"
    const parsed = parseFloat(rateText.replace(/[^\d.]/g, ''));
    if (!isNaN(parsed) && parsed > 0) {
      winRate = parsed / 100; // 0.168
    }
  });

  return winRate;
}

// ==========================================
// 騎手勝率取得
// ==========================================

/**
 * 騎手の当年勝率（中央）を取得する（TTL=24h）
 * @param code db.netkeiba.com 騎手コード（例: "01171"）
 * @returns 当年勝率 0.0〜1.0（取得失敗時は 0）
 */
export async function fetchJockeyWinRate(code: string): Promise<number> {
  const cacheKey = `jockey-stats:${code}`;
  const cached = getCache<number>(cacheKey);
  if (cached !== undefined) return cached;

  const url = `${BASE_DB}/jockey/${code}/`;
  const html = await fetchDbPage(url);
  if (!html) {
    setCache(cacheKey, 0, TTL_STATS);
    return 0;
  }

  const rate = parseWinRate(html);
  console.log(`[stats] 騎手コード${code}: 当年勝率 ${(rate * 100).toFixed(1)}%`);
  setCache(cacheKey, rate, TTL_STATS);
  return rate;
}

// ==========================================
// 調教師勝率取得
// ==========================================

/**
 * 調教師の当年勝率（中央）を取得する（TTL=24h）
 * @param code db.netkeiba.com 調教師コード（例: "01146"）
 * @returns 当年勝率 0.0〜1.0（取得失敗時は 0）
 */
export async function fetchTrainerWinRate(code: string): Promise<number> {
  const cacheKey = `trainer-stats:${code}`;
  const cached = getCache<number>(cacheKey);
  if (cached !== undefined) return cached;

  const url = `${BASE_DB}/trainer/${code}/`;
  const html = await fetchDbPage(url);
  if (!html) {
    setCache(cacheKey, 0, TTL_STATS);
    return 0;
  }

  const rate = parseWinRate(html);
  console.log(`[stats] 調教師コード${code}: 当年勝率 ${(rate * 100).toFixed(1)}%`);
  setCache(cacheKey, rate, TTL_STATS);
  return rate;
}

// ==========================================
// 一括取得: レース内全騎手・調教師の勝率
// ==========================================

/**
 * レース内全馬の騎手・調教師勝率を並列取得する
 * キャッシュヒット時はHTTPリクエストなし（24h有効）
 *
 * @returns
 *   jockeyRates: 騎手名 → 勝率（0.0〜1.0）
 *   trainerRates: 調教師名 → 勝率（0.0〜1.0）
 */
export async function fetchRacePersonStats(horses: Horse[]): Promise<{
  jockeyRates: Map<string, number>;
  trainerRates: Map<string, number>;
}> {
  const jockeyRates  = new Map<string, number>();
  const trainerRates = new Map<string, number>();

  // 重複コードを除いてユニーク化
  const jockeys  = new Map<string, string>(); // name → code
  const trainers = new Map<string, string>(); // name → code
  for (const h of horses) {
    if (h.jockeyCode  && !jockeys.has(h.jockey))  jockeys.set(h.jockey, h.jockeyCode);
    if (h.trainerCode && !trainers.has(h.trainer)) trainers.set(h.trainer, h.trainerCode);
  }

  // 騎手・調教師を並列取得
  await Promise.all([
    ...Array.from(jockeys.entries()).map(async ([name, code]) => {
      const rate = await fetchJockeyWinRate(code);
      jockeyRates.set(name, rate);
      console.log(`[stats] 騎手: ${name} 勝率: ${(rate * 100).toFixed(1)}%`);
    }),
    ...Array.from(trainers.entries()).map(async ([name, code]) => {
      const rate = await fetchTrainerWinRate(code);
      trainerRates.set(name, rate);
    }),
  ]);

  return { jockeyRates, trainerRates };
}
