// ==========================================
// 種牡馬（血統）統計スクレイパー
//
// 1. fetchFatherFromHorseId(horseId): db.netkeiba.com/horse/{horseId}/ から
//    父馬名・父馬ID を取得
// 2. fetchSireStats(sireId, sireName?): db.netkeiba.com/sire/{sireId}/
//    から 芝/ダート × 距離帯ごとの連対率・勝率を取得
//
// どちらも 7日間のキャッシュ付き。失敗時は null を返す (スコア計算側で 50 フォールバック)。
// ==========================================

import axios from 'axios';
import * as cheerio from 'cheerio';
import type { Horse, SireStats, DistanceBand } from './types';
import { getCache, setCache } from '../cache';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** 7日間 (血統成績は短期で変わらない) */
const CACHE_TTL_SIRE = 7 * 24 * 60 * 60;

/** EUC-JP で配信されるページを GET */
async function fetchEucHtml(url: string): Promise<string | null> {
  try {
    const res = await axios.get<ArrayBuffer>(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Referer: 'https://db.netkeiba.com/',
      },
      timeout: 10000,
      responseType: 'arraybuffer',
    });
    const decoder = new TextDecoder('euc-jp', { fatal: false });
    return decoder.decode(res.data as unknown as ArrayBuffer);
  } catch {
    return null;
  }
}

// ==========================================
// 距離帯の分類
// ==========================================

/**
 * レース距離 → 距離帯
 *   sprint:       〜1400m
 *   mile:         1500〜1700m
 *   intermediate: 1800〜2100m
 *   long:         2200m〜
 */
export function getDistanceBand(distance: number): DistanceBand {
  if (distance <= 1400) return 'sprint';
  if (distance <= 1700) return 'mile';
  if (distance <= 2100) return 'intermediate';
  return 'long';
}

// ==========================================
// 1. 競走馬ページから父馬を取得
// ==========================================

/**
 * https://db.netkeiba.com/horse/{horseId}/ から父馬名・父馬ID を取得
 * 返り値: { name, id? } もしくは null (取得失敗)
 */
export async function fetchFatherFromHorseId(
  horseId: string,
): Promise<{ name: string; id?: string } | null> {
  if (!/^\w{8,12}$/.test(horseId)) return null;
  const cacheKey = `father:${horseId}`;
  const cached = getCache<{ name: string; id?: string }>(cacheKey);
  if (cached) return cached;

  const html = await fetchEucHtml(`https://db.netkeiba.com/horse/${horseId}/`);
  if (!html) return null;

  try {
    const $ = cheerio.load(html);

    // 血統テーブルは table.blood_table が典型。父は1行目。
    // 複数の構造に対応するため、sire リンクを直接探索する。
    let fatherName = '';
    let fatherId: string | undefined;

    // 優先: blood_table の先頭セル
    const firstBloodCell = $('table.blood_table tr').first().find('td').first();
    const fatherLink = firstBloodCell.find('a[href*="/horse/"]').first();
    if (fatherLink.length > 0) {
      fatherName = fatherLink.text().trim().split(/\s/)[0];
      const href = fatherLink.attr('href') ?? '';
      fatherId = href.match(/\/horse\/(\w+)/)?.[1];
    }

    // フォールバック: ページ内任意の /sire/ リンク
    if (!fatherName) {
      const sireLink = $('a[href*="/sire/"]').first();
      if (sireLink.length > 0) {
        fatherName = sireLink.text().trim();
        fatherId = sireLink.attr('href')?.match(/\/sire\/(\w+)/)?.[1];
      }
    }

    if (!fatherName) return null;

    const result = { name: fatherName, id: fatherId };
    setCache(cacheKey, result, CACHE_TTL_SIRE);
    return result;
  } catch (e) {
    console.warn(`[sire] fetchFatherFromHorseId パース失敗 horseId=${horseId}:`, e);
    return null;
  }
}

// ==========================================
// 2. 種牡馬統計の取得
// ==========================================

/**
 * 距離ラベル (netkeiba の種牡馬ページ見出し) → DistanceBand
 * 例: "〜1300", "1400〜1600", "1700〜1900", "2000〜2200", "2300〜"
 *     実際のラベルは表記揺れがあるため数値で判定する。
 */
function labelToBand(label: string): DistanceBand | null {
  const nums = label.match(/\d{3,4}/g)?.map(Number) ?? [];
  if (nums.length === 0) return null;
  const mid = nums.length === 1 ? nums[0] : (nums[0] + nums[nums.length - 1]) / 2;
  return getDistanceBand(mid);
}

/**
 * https://db.netkeiba.com/sire/{sireId}/ から種牡馬統計を取得
 *
 * 種牡馬ページはコース (芝/ダート) × 距離帯の集計テーブルを含む。
 * 典型的な構造: table.race_table_01 または class="..." が付いた summary 表。
 * 表の各行から「勝率」「連対率」を取得する。
 *
 * 取得できないセルはスキップし、取得できた範囲で SireStats を返す。
 */
export async function fetchSireStats(
  sireId: string,
  sireName?: string,
): Promise<SireStats | null> {
  if (!sireId) return null;
  const cacheKey = `sire-stats:${sireId}`;
  const cached = getCache<SireStats>(cacheKey);
  if (cached) return cached;

  const html = await fetchEucHtml(`https://db.netkeiba.com/sire/${sireId}/`);
  if (!html) return null;

  try {
    const $ = cheerio.load(html);

    const stats: SireStats = {
      sireName: sireName ?? $('h1').first().text().trim().split(/\s/)[0] ?? '',
      sireId,
      turf: {},
      dirt: {},
    };

    // 芝/ダート別の集計テーブル:
    //   典型的に <table> が「コース別成績」「距離別成績」の2系統ある。
    //   行構造:  <tr><th>条件</th><td>着別度数</td><td>勝率</td><td>連対率</td><td>複勝率</td></tr>
    //   表記揺れに耐えるため: (a) ヘッダから距離列と連対率列の位置を検出
    //                       (b) コース列のセル文言で芝/ダートを判別
    $('table').each((_i, tbl) => {
      const $tbl = $(tbl);
      const headers = $tbl.find('tr').first().find('th,td').map((_j, th) => $(th).text().trim()).get();
      if (headers.length < 3) return;
      const placeIdx = headers.findIndex((h) => /連対率/.test(h));
      const winIdx   = headers.findIndex((h) => /勝率/.test(h));
      if (placeIdx < 0 || winIdx < 0) return;

      $tbl.find('tr').slice(1).each((_j, row) => {
        const cells = $(row).find('td,th').map((_k, c) => $(c).text().trim()).get();
        if (cells.length <= Math.max(placeIdx, winIdx)) return;
        // 先頭セルに条件が入る想定: "芝 1400" / "ダート 1800" 等
        const header = cells[0] ?? '';
        const isTurf = /芝/.test(header);
        const isDirt = /ダ|砂/.test(header);
        if (!isTurf && !isDirt) return;
        const band = labelToBand(header);
        if (!band) return;

        const parsePct = (s: string): number => {
          const n = parseFloat(s.replace(/[^\d.]/g, ''));
          if (isNaN(n)) return 0;
          return n > 1 ? n / 100 : n; // 18.5 or 0.185 どちらでも対応
        };
        const placeRate = parsePct(cells[placeIdx]);
        const winRate   = parsePct(cells[winIdx]);

        // 出走数: 着別度数 "N-N-N-N" の合計
        const raceCount = cells[1]?.match(/\d+/g)?.map(Number).reduce((a, b) => a + b, 0) ?? 0;

        const target = isTurf ? stats.turf : stats.dirt;
        // 既存があれば出走数が多い方を採用
        const existing = target[band];
        if (!existing || raceCount > existing.samples) {
          target[band] = { placeRate, winRate, samples: raceCount };
        }
      });
    });

    // どちらも空なら失敗とみなす
    if (Object.keys(stats.turf).length === 0 && Object.keys(stats.dirt).length === 0) {
      return null;
    }

    setCache(cacheKey, stats, CACHE_TTL_SIRE);
    return stats;
  } catch (e) {
    console.warn(`[sire] fetchSireStats パース失敗 sireId=${sireId}:`, e);
    return null;
  }
}

// ==========================================
// 3. レース馬リストに対する父情報 + 種牡馬統計の一括取得
// ==========================================

export type SireStatsByHorseNum = Map<
  number,
  { father?: string; fatherId?: string; stats?: SireStats }
>;

/**
 * レース出走馬のそれぞれについて、
 *   - 父馬名・父馬ID を取得 (競走馬ページ経由)
 *   - 父馬の種牡馬統計を取得
 * を並列実行してマップ化する。
 *
 * 取得に失敗した馬はマップに空レコードを入れる (スコア側で 50 フォールバック)。
 */
/** sire 取得の HTTP バースト抑制のためのスリープ (ms)。キャッシュヒットならスキップされる想定 */
const SIRE_INTRA_DELAY_MS = Number(process.env.SIRE_INTRA_DELAY_MS ?? 300);

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function fetchSireStatsForHorses(
  horses: Pick<Horse, 'id' | 'horseId'>[],
): Promise<SireStatsByHorseNum> {
  const result: SireStatsByHorseNum = new Map();

  // 直列処理: キャッシュヒットなら即座、ミスなら HTTP + 短い sleep で次の馬へ
  // → 18頭 × 2 HTTP を Promise.all すると WAF に burst と判定されかねないため
  for (const h of horses) {
    if (!h.horseId) { result.set(h.id, {}); continue; }
    try {
      const father = await fetchFatherFromHorseId(h.horseId);
      if (!father) { result.set(h.id, {}); }
      else if (!father.id) { result.set(h.id, { father: father.name }); }
      else {
        const stats = await fetchSireStats(father.id, father.name);
        result.set(h.id, { father: father.name, fatherId: father.id, stats: stats ?? undefined });
      }
    } catch (e) {
      console.warn(`[sire] fetchSireStatsForHorses: 馬番${h.id} 失敗:`, e);
      result.set(h.id, {});
    }
    // キャッシュヒット時でも軽量な遅延を入れて連続アクセスを抑制
    if (SIRE_INTRA_DELAY_MS > 0) await sleep(SIRE_INTRA_DELAY_MS);
  }

  return result;
}
