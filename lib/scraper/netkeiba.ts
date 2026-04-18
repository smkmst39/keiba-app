// ==========================================
// netkeibaスクレイパー
// Phase 1-B: 出馬表・オッズ・調教ページから馬データを取得する
// セレクタ仕様・変更履歴は lib/scraper/CLAUDE.md を参照
// ==========================================

import axios from 'axios';
import * as cheerio from 'cheerio';
import type { Race, Horse, ComboOddsData } from './types';
import { MOCK_NZT_2026 } from './__mocks__/202606030511';

// ==========================================
// 定数
// ==========================================

const SCRAPE_INTERVAL_MS = Number(process.env.SCRAPE_INTERVAL_MS ?? 1000);
const RETRY_COUNT = 2;
const RETRY_INTERVAL_MS = 500;

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ベースURL
const BASE_RACE = 'https://race.netkeiba.com/race';
const BASE_API  = 'https://race.netkeiba.com/api';

// 出馬表セレクタ（最終確認: 2026-04）
// ※ 枠番・馬番は "Waku1", "Umaban1" のように数字サフィックスが付く
const SELECTORS = {
  raceTitle:   '.RaceName',
  raceData:    '.RaceData01',          // "芝1600m" / "ダート1200m" を含む
  horseRow:    'tr.HorseList',
  horseNumber: 'td[class^="Umaban"]', // Umaban1, Umaban2 ... に対応
  waku:        'td[class^="Waku"]',   // Waku1, Waku2 ... に対応
  horseName:   'td.HorseInfo',        // リンクではなくtd直下テキスト
  jockey:      'td.Jockey',
  trainer:     'td.Trainer',
  weight:      'td.Weight',
} as const;

// 調教セレクタ（最終確認: 2026-04）
// ※ oikiriページには数値タイムなし。評価テキスト（td.Training_Critic）から近似値を生成
const TRAINING_SELECTORS = {
  row:      'tr.HorseList',
  horseNum: 'td.Umaban',      // oikiriページは Umaban（サフィックスなし）
  critic:   'td.Training_Critic',
} as const;

// ==========================================
// ユーティリティ
// ==========================================

/** 指定ミリ秒スリープ */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 数値文字列をパース。失敗時は fallback を返す */
function parseFloat2(s: string | undefined, fallback = 0): number {
  const n = parseFloat((s ?? '').replace(/[^\d.]/g, ''));
  return isNaN(n) ? fallback : n;
}

function parseInt2(s: string | undefined, fallback = 0): number {
  const n = parseInt((s ?? '').replace(/[^\d]/g, ''), 10);
  return isNaN(n) ? fallback : n;
}

/**
 * オッズJSON APIを呼び出す（リトライ付き）
 * @param url APIエンドポイント
 */
async function fetchJson(url: string): Promise<unknown | null> {
  for (let attempt = 0; attempt <= RETRY_COUNT; attempt++) {
    try {
      const res = await axios.get(url, {
        headers: { 'User-Agent': USER_AGENT, Referer: 'https://race.netkeiba.com/' },
        timeout: 10000,
      });
      return res.data;
    } catch (err) {
      const isLast = attempt === RETRY_COUNT;
      console.error(`[scraper] fetchJson失敗 (attempt ${attempt + 1}/${RETRY_COUNT + 1}): ${url}`, isLast ? err : '');
      if (!isLast) await sleep(RETRY_INTERVAL_MS);
    }
  }
  return null;
}

/**
 * HTTPリクエストを実行する（リトライ付き）
 * @param url 取得先URL
 * @returns HTMLテキスト
 */
async function fetchHtml(url: string): Promise<string | null> {
  for (let attempt = 0; attempt <= RETRY_COUNT; attempt++) {
    try {
      const res = await axios.get<string>(url, {
        headers: {
          'User-Agent': USER_AGENT,
          // ページによってはRefererが必要
          Referer: 'https://race.netkeiba.com/',
        },
        timeout: 10000,
        responseType: 'arraybuffer',
      });

      // netkeiba は EUC-JP で配信されることがある。
      // axios の arraybuffer で受けて TextDecoder で変換する。
      const decoder = new TextDecoder('euc-jp', { fatal: false });
      const text = decoder.decode(res.data as unknown as ArrayBuffer);
      return text;
    } catch (err) {
      const isLast = attempt === RETRY_COUNT;
      console.error(
        `[scraper] fetchHtml失敗 (attempt ${attempt + 1}/${RETRY_COUNT + 1}): ${url}`,
        isLast ? err : ''
      );
      if (!isLast) await sleep(RETRY_INTERVAL_MS);
    }
  }
  return null;
}

// ==========================================
// 中間型定義（関数間のデータ受け渡し用）
// ==========================================

/** fetchRaceCard の返り値 */
type RaceCardResult = {
  name: string;
  course: string;
  distance: number;
  surface: 'turf' | 'dirt';
  /** 馬番をキーとした出馬表データ */
  horseMap: Map<number, {
    id: number;
    name: string;
    waku: number;
    jockey: string;
    trainer: string;
    weight: number;
    weightDiff: number;
  }>;
};

/** fetchOdds の返り値: 馬番 → オッズ */
type OddsMap = Map<number, {
  odds: number;
  fukuOddsMin: number;
  fukuOddsMax: number;
}>;

/** fetchTraining の返り値: 馬番 → ラスト1F秒 */
type TrainingMap = Map<number, number>;

// ==========================================
// 出馬表取得
// ==========================================

/**
 * 出馬表ページをスクレイピングして馬リストとレース基本情報を返す
 */
export async function fetchRaceCard(raceId: string): Promise<RaceCardResult | null> {
  const url = `${BASE_RACE}/shutuba.html?race_id=${raceId}`;
  const html = await fetchHtml(url);
  if (!html) return null;

  try {
    const $ = cheerio.load(html);

    // --- レース基本情報 ---
    const name = $(SELECTORS.raceTitle).first().text().trim() || '不明';

    // 距離・芝ダート: "芝1600m" or "ダート1200m" のような文字列を含む
    const raceDataText = $(SELECTORS.raceData).first().text();
    const distanceMatch = raceDataText.match(/(\d{3,4})m/);
    const distance = distanceMatch ? parseInt(distanceMatch[1], 10) : 0;
    const surface: 'turf' | 'dirt' = raceDataText.includes('ダート') ? 'dirt' : 'turf';

    // 競馬場名はURLの場コード（3〜4桁目）から逆引き
    const course = courseFromRaceId(raceId);

    // --- 馬ごとのデータ ---
    const horseMap = new Map<number, RaceCardResult['horseMap'] extends Map<number, infer V> ? V : never>();

    $(SELECTORS.horseRow).each((_i, row) => {
      try {
        const id = parseInt2($(row).find(SELECTORS.horseNumber).first().text());
        if (id === 0) return; // 除外馬など

        const waku = parseInt2($(row).find(SELECTORS.waku).first().text());

        // 馬名: td.HorseInfo のテキストに "前走" 等が混入する場合があるため最初の行だけ取る
        const horseNameRaw = $(row).find(SELECTORS.horseName).text().trim();
        const name = horseNameRaw.split(/\s/)[0] ?? horseNameRaw;

        // 騎手・調教師: リンクがある場合はそちら、なければtd直接
        const jockeyEl = $(row).find(SELECTORS.jockey);
        const jockey = (jockeyEl.find('a').text().trim() || jockeyEl.text().trim()).split(/\s/)[0];

        const trainerEl = $(row).find(SELECTORS.trainer);
        const trainerRaw = (trainerEl.find('a').text().trim() || trainerEl.text().trim()).trim();
        // "栗東奥村豊" のように所属込みの場合がある → 末尾2〜4文字が名前
        const trainer = trainerRaw.replace(/^(栗東|美浦|地方)/, '');

        // 馬体重: "432(0)" や "476(+2)" のような形式
        const weightText = $(row).find(SELECTORS.weight).text().trim();
        const weightMatch = weightText.match(/(\d+)\(([+\-]?\d+)\)/);
        const weight = weightMatch ? parseInt(weightMatch[1], 10) : 0;
        const weightDiff = weightMatch ? parseInt(weightMatch[2], 10) : 0;

        horseMap.set(id, { id, name, waku, jockey, trainer, weight, weightDiff });
      } catch (e) {
        console.error('[scraper] 馬行のパース失敗:', e);
      }
    });

    if (horseMap.size === 0) {
      console.error('[scraper] fetchRaceCard: 馬データが0件 — セレクタを確認してください');
      return null;
    }

    return { name, course, distance, surface, horseMap };
  } catch (e) {
    console.error('[scraper] fetchRaceCard: パース失敗:', e);
    return null;
  }
}

// ==========================================
// オッズ取得
// ==========================================

/**
 * 単複オッズをJSON APIから取得して馬番ごとに返す
 *
 * netkeibaオッズページはJavaScript経由でデータを描画するため、
 * HTMLスクレイピングではなく内部JSONエンドポイントを使用する。
 * - type=1: 単勝  → data.odds["1"]["01"] = [odds, "", rank]
 * - type=2: 複勝  → data.odds["2"]["01"] = [min, max, rank]
 */
export async function fetchOdds(raceId: string): Promise<OddsMap> {
  const map: OddsMap = new Map();

  // 単勝と複勝を並列取得
  // action=init を付けないと status="middle" になる（予想オッズが取れない）
  const [tanJson, fukuJson] = await Promise.all([
    fetchJson(`${BASE_API}/api_get_jra_odds.html?type=1&race_id=${raceId}&action=init`),
    fetchJson(`${BASE_API}/api_get_jra_odds.html?type=2&race_id=${raceId}&action=init`),
  ]);

  // 単勝パース
  const tanOdds = (tanJson as any)?.data?.odds?.['1'] as Record<string, string[]> | undefined;
  if (!tanOdds) {
    console.warn('[scraper] 単勝オッズの取得失敗（未発売またはAPIエラー）');
  }

  // 複勝パース
  const fukuOdds = (fukuJson as any)?.data?.odds?.['2'] as Record<string, string[]> | undefined;
  if (!fukuOdds) {
    console.warn('[scraper] 複勝オッズの取得失敗');
  }

  // 単勝キーは "01"〜"18"（零埋め2桁）
  if (tanOdds) {
    for (const [key, val] of Object.entries(tanOdds)) {
      try {
        const id = parseInt(key, 10);
        if (!id || !Array.isArray(val)) continue;
        const odds = parseFloat2(val[0]);
        const fukuVal = fukuOdds?.[key];
        const fukuOddsMin = fukuVal ? parseFloat2(fukuVal[0]) : 0;
        const fukuOddsMax = fukuVal ? parseFloat2(fukuVal[1]) : 0;
        map.set(id, { odds, fukuOddsMin, fukuOddsMax });
      } catch (e) {
        console.error('[scraper] オッズパース失敗 key=' + key, e);
      }
    }
  }

  return map;
}

// ==========================================
// 調教タイム取得
// ==========================================

/**
 * 調教ページから馬番ごとの近似lastThreeF値を返す
 *
 * netkeibaのoikiriページには数値タイムがなく、
 * 評価テキスト（手応勝る・キビキビ等）とランク（A/B/C）のみ表示される。
 * 評価テキストを下記テーブルで近似秒数に変換して返す。
 * Phase 1-D以降で実タイムページが特定できたら差し替える。
 */
export async function fetchTraining(raceId: string): Promise<TrainingMap> {
  const url = `${BASE_RACE}/oikiri.html?race_id=${raceId}`;
  const html = await fetchHtml(url);
  const map: TrainingMap = new Map();
  if (!html) return map;

  // 評価テキスト → 近似ラスト1F秒（速いほど小さい値）
  const CRITIC_TO_SEC: Record<string, number> = {
    '手応勝る': 11.0,
    'キビキビ': 11.2,
    '好気配':   11.4,
    '及第点':   11.6,
    '前走並み': 11.8,
    '並み':     11.9,
    '物足りず': 12.2,
    '動き鈍い': 12.5,
  };

  try {
    const $ = cheerio.load(html);

    $(TRAINING_SELECTORS.row).each((_i, row) => {
      try {
        const id = parseInt2($(row).find(TRAINING_SELECTORS.horseNum).text());
        if (id === 0) return;

        const critic = $(row).find(TRAINING_SELECTORS.critic).text().trim();
        const lastOneF = CRITIC_TO_SEC[critic] ?? 11.8; // デフォルト: 並み
        map.set(id, lastOneF);
      } catch (e) {
        console.error('[scraper] 調教行のパース失敗:', e);
      }
    });
  } catch (e) {
    console.error('[scraper] fetchTraining: パース失敗:', e);
  }

  return map;
}

// ==========================================
// 統合取得（メイン関数）
// ==========================================

/**
 * 出馬表・オッズ・調教を並列取得して Race 型に統合する
 * @param raceId netkeibaのレースID
 */
export async function fetchRaceData(raceId: string): Promise<Race | null> {
  // レート制限: 同一プロセス内での連続呼び出し抑制は呼び出し側の責務だが
  // 念のためリクエスト開始前に待機（初回は0ms、後続は SCRAPE_INTERVAL_MS）
  console.log(`[scraper] fetchRaceData 開始: raceId=${raceId}`);

  // 3ページを並列取得（同一raceIdの異なるページなので並列OK）
  const [cardResult, oddsMap, trainingMap] = await Promise.all([
    fetchRaceCard(raceId),
    fetchOdds(raceId),
    fetchTraining(raceId),
  ]);

  // 出馬表が取れなければ復元不可
  if (!cardResult || cardResult.horseMap.size === 0) {
    console.error('[scraper] 出馬表の取得に失敗しました');
    return null;
  }

  // 馬ごとにデータを統合
  const horses: Horse[] = [];
  for (const [id, card] of Array.from(cardResult.horseMap.entries())) {
    const odds = oddsMap.get(id) ?? { odds: 0, fukuOddsMin: 0, fukuOddsMax: 0 };
    const lastThreeF = trainingMap.get(id) ?? 0;

    if (odds.odds === 0) {
      console.warn(`[scraper] 馬番${id}のオッズが取得できませんでした`);
    }

    horses.push({
      ...card,
      odds: odds.odds,
      fukuOddsMin: odds.fukuOddsMin,
      fukuOddsMax: odds.fukuOddsMax,
      lastThreeF,
    });
  }

  // 馬番順にソート
  horses.sort((a, b) => a.id - b.id);

  return {
    raceId,
    name: cardResult.name,
    course: cardResult.course,
    distance: cardResult.distance,
    surface: cardResult.surface,
    horses,
    fetchedAt: new Date(),
  };
}

// ==========================================
// 組み合わせオッズ取得
// ==========================================

/**
 * APIキーの形式を内部形式に変換するヘルパー群
 *
 * netkeibaのJSONAPIは馬番を2桁ゼロ埋め結合で返す
 * 例: 馬連 "0102" → "1-2", 三連複 "010203" → "1-2-3"
 */
function parsePairKey(raw: string): string | null {
  if (raw.length !== 4) return null;
  const a = parseInt(raw.slice(0, 2), 10);
  const b = parseInt(raw.slice(2, 4), 10);
  if (isNaN(a) || isNaN(b) || a === 0 || b === 0) return null;
  return `${a}-${b}`;
}

function parseTripleKey(raw: string): string | null {
  if (raw.length !== 6) return null;
  const a = parseInt(raw.slice(0, 2), 10);
  const b = parseInt(raw.slice(2, 4), 10);
  const c = parseInt(raw.slice(4, 6), 10);
  if (isNaN(a) || isNaN(b) || isNaN(c)) return null;
  return `${a}-${b}-${c}`;
}

function parseWakuKey(raw: string): string | null {
  // 枠連は1桁ずつ結合: "12" = 枠1-枠2
  if (raw.length !== 2) return null;
  const a = parseInt(raw[0], 10);
  const b = parseInt(raw[1], 10);
  if (isNaN(a) || isNaN(b)) return null;
  return `${Math.min(a, b)}-${Math.max(a, b)}`;
}

/** JSONオブジェクトからオッズマップを構築する汎用パーサー */
function buildOddsMap(
  json: unknown,
  typeKey: string,
  keyParser: (k: string) => string | null,
  valueIndex = 0,
): Record<string, number> {
  const result: Record<string, number> = {};
  try {
    const raw = (json as any)?.data?.odds?.[typeKey] as Record<string, string[]> | undefined;
    if (!raw) return result;
    for (const [rawKey, val] of Object.entries(raw)) {
      const key = keyParser(rawKey);
      if (!key || !Array.isArray(val)) continue;
      const odds = parseFloat2(val[valueIndex]);
      if (odds > 0) result[key] = odds;
    }
  } catch (e) {
    console.error(`[scraper] buildOddsMap失敗 type=${typeKey}:`, e);
  }
  return result;
}

/**
 * 馬連・馬単・ワイド・三連複・三連単・枠連をJSONAPIから並列取得する
 *
 * netkeibaオッズJSON APIのtype番号（確認済み: 2026-04）
 *  type=3: 枠連  type=4: 馬連  type=5: 馬単
 *  type=6: ワイド type=7: 三連複 type=8: 三連単
 */
export async function fetchComboOdds(raceId: string): Promise<ComboOddsData | null> {
  // ⚠️ action=init が必須。付けないと status="middle" でデータが返らない（type=1,2と同じ）
  const urls = [3, 4, 5, 6, 7, 8].map(
    (t) => `${BASE_API}/api_get_jra_odds.html?type=${t}&race_id=${raceId}&action=init`
  );

  const [wakuJ, umarenJ, umatanJ, wideJ, sanfukuJ, santanJ] = await Promise.all(
    urls.map((u) => fetchJson(u))
  );

  return {
    waku:    buildOddsMap(wakuJ,    '3', parseWakuKey,   0),
    umaren:  buildOddsMap(umarenJ,  '4', parsePairKey,   0),
    umatan:  buildOddsMap(umatanJ,  '5', parsePairKey,   0),
    wide:    buildOddsMap(wideJ,    '6', parsePairKey,   0), // ワイドは中間値(index=0)
    sanfuku: buildOddsMap(sanfukuJ, '7', parseTripleKey, 0),
    santan:  buildOddsMap(santanJ,  '8', parseTripleKey, 0),
  };
}

// ==========================================
// 仮予想モード: 枠順確定前の登録馬リスト取得
// ==========================================

/**
 * shutuba_past.html から枠順確定前の登録馬リストを取得する
 *
 * 枠順確定前なのでwaku=0・lastThreeF=0。
 * 馬名はあいうえお順でソートし、1番から仮番号を振る。
 * 予想オッズは fetchOdds (action=init) で取得して registrationId で紐付ける。
 * - status="yoso" → 予想オッズあり、EVを計算する
 * - status="middle" → 未発売、odds=0のままUI側で非表示
 */
export async function fetchPreEntry(raceId: string): Promise<Race | null> {
  const url = `${BASE_RACE}/shutuba_past.html?race_id=${raceId}`;

  // 馬名スクレイピングと予想オッズ取得を並列実行
  // fetchOdds は action=init 付きで呼ぶため yoso オッズも取得できる
  const [html, oddsMap] = await Promise.all([
    fetchHtml(url),
    fetchOdds(raceId),
  ]);
  if (!html) return null;

  try {
    const $ = cheerio.load(html);

    // --- レース基本情報 ---
    const name = $(SELECTORS.raceTitle).first().text().trim() || '不明';
    const raceDataText = $(SELECTORS.raceData).first().text();
    const distanceMatch = raceDataText.match(/(\d{3,4})m/);
    const distance = distanceMatch ? parseInt(distanceMatch[1], 10) : 0;
    const surface: 'turf' | 'dirt' = raceDataText.includes('ダート') ? 'dirt' : 'turf';
    const course = courseFromRaceId(raceId);

    // --- 登録馬リスト（tr_N の N = 登録番号でオッズAPIと紐付け） ---
    type RawHorse = {
      registrationId: number;  // tr_N の N（オッズAPIキーと一致）
      name: string;
      jockey: string;
      trainer: string;
      jockeyCode: string;      // db.netkeiba.com 騎手コード（勝率取得に使用）
      trainerCode: string;     // db.netkeiba.com 調教師コード
    };
    const rawHorses: RawHorse[] = [];

    // id="tr_N" 形式の行のみが出走馬行（ヘッダ・フッタは除外）
    $('tr.HorseList[id^="tr_"]').each((_i, row) => {
      try {
        const rowId = $(row).attr('id') ?? '';            // "tr_2", "tr_15" など
        const registrationId = parseInt(rowId.replace('tr_', ''), 10);
        if (!registrationId) return;

        const h02 = $(row).find('.Horse02');
        const horseName = h02.find('a').first().text().trim() || h02.text().trim();
        if (!horseName) return;

        // 騎手名・騎手コード（href から抽出）
        const jockeyEl = $(row).find('.Jockey a').first();
        const jockey = jockeyEl.text().trim();
        const jockeyHref = jockeyEl.attr('href') ?? '';
        const jockeyCode = jockeyHref.match(/\/jockey\/result\/recent\/(\w+)/)?.[1] ?? '';

        // 調教師名・調教師コード
        const h05 = $(row).find('.Horse05');
        const trainerEl = h05.find('a').first();
        const trainerRaw = (trainerEl.text().trim() || h05.text().trim()).trim();
        const trainer = trainerRaw.replace(/^(栗東・|美浦・|地方・)/, '');
        const trainerHref = trainerEl.attr('href') ?? '';
        const trainerCode = trainerHref.match(/\/trainer\/result\/recent\/(\w+)/)?.[1] ?? '';

        rawHorses.push({ registrationId, name: horseName, jockey, trainer, jockeyCode, trainerCode });
      } catch {
        // パース失敗は無視
      }
    });

    if (rawHorses.length === 0) {
      console.warn(`[scraper] fetchPreEntry: 登録馬が0件 raceId=${raceId}`);
      return null;
    }

    // 予想オッズが取得できたか確認
    const hasEstimatedOdds = oddsMap.size > 0;
    if (hasEstimatedOdds) {
      console.log(`[scraper] fetchPreEntry: 予想オッズ取得成功 ${oddsMap.size}頭分 raceId=${raceId}`);
    } else {
      console.log(`[scraper] fetchPreEntry: 予想オッズ未発売 raceId=${raceId}`);
    }

    // あいうえお順でソートして仮番号を振る
    rawHorses.sort((a, b) => a.name.localeCompare(b.name, 'ja'));

    const horses: Horse[] = rawHorses.map((h, i) => {
      // registrationId で予想オッズを引く（なければ 0）
      const oddsData = oddsMap.get(h.registrationId);
      return {
        id: i + 1,
        name: h.name,
        waku: 0,
        odds: oddsData?.odds ?? 0,
        fukuOddsMin: oddsData?.fukuOddsMin ?? 0,
        fukuOddsMax: oddsData?.fukuOddsMax ?? 0,
        jockey: h.jockey,
        trainer: h.trainer,
        jockeyCode: h.jockeyCode,   // スコア計算で勝率取得に使用
        trainerCode: h.trainerCode,
        weight: 0,
        weightDiff: 0,
        lastThreeF: 0,
      };
    });

    console.log(`[scraper] fetchPreEntry: ${horses.length}頭取得 raceId=${raceId}`);
    return {
      raceId,
      name,
      course,
      distance,
      surface,
      horses,
      fetchedAt: new Date(),
      mode: 'pre-entry',
    };
  } catch (e) {
    console.error('[scraper] fetchPreEntry: パース失敗:', e);
    return null;
  }
}

// ==========================================
// 後方互換ラッパー（route.ts から呼ばれる）
// ==========================================

/**
 * レース情報をスクレイピングして返す（route.ts との互換ラッパー）
 * USE_MOCK=true のときはモックデータを返す
 */
export async function scrapeRace(raceId: string): Promise<Race | null> {
  if (process.env.USE_MOCK === 'true') {
    // モックデータを返す（raceId が異なる場合も NZT のデータで代替）
    return { ...MOCK_NZT_2026, raceId, fetchedAt: new Date() };
  }

  // リクエスト前にインターバルを入れる
  await sleep(SCRAPE_INTERVAL_MS);
  return fetchRaceData(raceId);
}

// ==========================================
// ヘルパー: 場コードから競馬場名を解決
// ==========================================

/** netkeibaの場コード（raceIdの5〜6桁目）→競馬場名 */
const COURSE_MAP: Record<string, string> = {
  '01': '札幌',
  '02': '函館',
  '03': '福島',
  '04': '新潟',
  '05': '東京',
  '06': '中山',
  '07': '中京',
  '08': '京都',
  '09': '阪神',
  '10': '小倉',
};

function courseFromRaceId(raceId: string): string {
  // raceId 例: 202606030511
  //            ↑4桁年 ↑2桁場 ↑2桁回 ↑2桁日 ↑2桁R
  const code = raceId.slice(4, 6);
  return COURSE_MAP[code] ?? '不明';
}
