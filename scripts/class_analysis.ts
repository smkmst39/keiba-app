// ==========================================
// クラス別回収率分析・下位クラス除外の効果検証
//
// 仮説: 新馬・未勝利・1勝クラスは実績データ不足で予想精度が低く、
//       これらを除外すると全体の回収率が上がる可能性がある。
//
// 分析1: クラス別の回収率 (7券種 × 本命級3券種)
// 分析2: 除外パターン A〜E での総合回収率比較
//
// 実行: pnpm tsx scripts/class_analysis.ts
// 出力: scripts/verification/class_analysis_report.md
// ==========================================

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { VerificationData } from '../lib/scraper/types';

const DIR = path.resolve(__dirname, 'verification');
const REPORT = path.join(DIR, 'class_analysis_report.md');

// ----------------------------------------
// クラス分類
// ----------------------------------------

type RaceClass =
  | 'G1' | 'G2' | 'G3' | 'OP' | 'SP'
  | 'C3' | 'C2' | 'C1' | 'UW' | 'NW' | 'Unknown';

const CLASS_ORDER: RaceClass[] = ['NW', 'UW', 'C1', 'C2', 'C3', 'SP', 'OP', 'G3', 'G2', 'G1', 'Unknown'];

const CLASS_LABEL: Record<RaceClass, string> = {
  NW:      '新馬戦',
  UW:      '未勝利戦',
  C1:      '1勝クラス',
  C2:      '2勝クラス',
  C3:      '3勝クラス',
  SP:      '特別レース(クラス不明)',
  OP:      'OP/L',
  G3:      'G3',
  G2:      'G2',
  G1:      'G1',
  Unknown: 'Unknown',
};

/**
 * Phase 2G 版: race.meta.raceClass / race.meta.raceGrade を優先使用。
 * 欠損時はレース名パターンマッチにフォールバック。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function classifyRace(vd: any): RaceClass {
  const meta = vd?.meta;
  const raceName: string = vd?.raceName ?? '';

  // Phase 2G: meta フィールド優先
  if (meta) {
    const grade: string | undefined = meta.raceGrade ?? undefined;
    if (grade === 'G1') return 'G1';
    if (grade === 'G2') return 'G2';
    if (grade === 'G3') return 'G3';
    if (grade === 'L')  return 'OP'; // リステッドは OP 扱い

    const rc: string | undefined = meta.raceClass;
    if (rc) {
      if (/3勝|1600万/.test(rc)) return 'C3';
      if (/2勝|1000万/.test(rc)) return 'C2';
      if (/1勝|500万/.test(rc))  return 'C1';
      if (/未勝利/.test(rc))      return 'UW';
      if (/新馬/.test(rc))        return 'NW';
      if (/オープン|OP|リステッド/.test(rc)) return 'OP';
    }
  }

  // --- フォールバック: レース名パターンマッチ (Phase 2E/2F 版) ---
  return classifyRaceByName(raceName);
}

/** レース名から推測する旧ロジック (meta 欠損時のフォールバック) */
function classifyRaceByName(raceName: string): RaceClass {
  const n = raceName.trim();
  if (!n) return 'Unknown';

  // --- 1. 明示的な G グレード表記 ---
  if (/G1|GⅠ|Ｇ１/.test(n)) return 'G1';
  if (/G2|GⅡ|Ｇ２/.test(n)) return 'G2';
  if (/G3|GⅢ|Ｇ３/.test(n)) return 'G3';

  // --- 2. 著名 G1 ---
  if (/皐月賞|東京優駿|ダービー|菊花賞|桜花賞|オークス|優駿牝馬|秋華賞|天皇賞|有馬記念|宝塚記念|ジャパンカップ|NHKマイル|安田記念|スプリンターズ|マイルチャンピオン|エリザベス女王杯|ヴィクトリアマイル|高松宮記念|大阪杯|チャンピオンズカップ|フェブラリーステークス|朝日杯FS|阪神JF|ホープフル|帝王賞|JBC|東京大賞典/.test(n)) return 'G1';

  // --- 3. 著名 G2 / G3 (代表的なもの。ここを充実させると分類精度が上がる) ---
  // G2 (春): 日経新春杯, 京都記念, 金鯱賞, 弥生賞, スプリングS, 日経賞, 阪神大賞典, 産経大阪杯 (G1に昇格済のは除外), アメリカJCC, 中山記念, フィリーズレビュー
  if (/日経新春杯|京都記念|金鯱賞|弥生賞|スプリングS|スプリングステークス|日経賞|阪神大賞典|アメリカJCC|アメリカジョッキー|中山記念|フィリーズレビュー|ダービー卿|ニュージーランドトロフィー|ニュージーランドT|東京新聞杯|京王杯2歳S/.test(n)) return 'G2';
  // G3 (春まで): 中山金杯, 京都金杯, フェアリーS, シンザン記念, 日経新春杯(G2), 京成杯, 東海S(G2), AJCC(G2), 根岸S, 東京新聞杯, きさらぎ賞, 共同通信杯, クイーンC, ダイヤモンドS, 京都牝馬S, 小倉大賞典, 阪急杯, 中山牝馬S, フィリーズR(G2), チューリップ賞, オーシャンS, 弥生賞(G2), 中山牝馬, フラワーC, ファルコンS, アーリントンC, ニュージーランドT(G2), 京王杯SC, 新潟大賞典, 青葉賞, 京都新聞杯, 京王杯SC
  if (/中山金杯|京都金杯|フェアリーS|フェアリーステークス|シンザン記念|京成杯|根岸S|根岸ステークス|きさらぎ賞|共同通信杯|クイーンC|クイーンカップ|ダイヤモンドS|ダイヤモンドステークス|京都牝馬S|京都牝馬ステークス|小倉大賞典|阪急杯|中山牝馬S|中山牝馬ステークス|チューリップ賞|オーシャンS|オーシャンステークス|フラワーC|フラワーカップ|ファルコンS|ファルコンステークス|アーリントンC|アーリントンカップ|京王杯SC|京王杯スプリングカップ|新潟大賞典|青葉賞|京都新聞杯/.test(n)) return 'G3';

  // --- 4. リステッド / オープン特別 ---
  if (/\(L\)|（L）|リステッド/.test(n)) return 'OP';
  if (/オープン|ＯＰ|\(OP\)/.test(n)) return 'OP';

  // --- 5. 条件戦 (明示的) ---
  if (/3勝|1600万/.test(n)) return 'C3';
  if (/2勝|1000万/.test(n)) return 'C2';
  if (/1勝|500万/.test(n)) return 'C1';
  if (/未勝利/.test(n)) return 'UW';
  if (/新馬/.test(n)) return 'NW';

  // --- 6. 愛称レース (クラス情報なし) ---
  //   〜S / 〜ステークス / 〜特別 / 〜賞 / 〜杯 / 〜C / 〜カップ / 〜JS / 〜HC 等
  if (/(ステークス|Ｓ$|S$|特別|賞$|杯$|カップ|C$|Ｃ$|JS$|HC$|ＪＳ$|ＨＣ$)/.test(n)) return 'SP';
  if (/\S+S\b|\S+C\b/.test(n)) return 'SP'; // 末尾が S/C (アルファベット略称)

  return 'Unknown';
}

// ----------------------------------------
// ユーティリティ
// ----------------------------------------

const roi = (c: number, p: number): number => c > 0 ? (p / c) * 100 : 0;
const pct = (n: number, d: number): string => d === 0 ? 'N/A' : `${((n / d) * 100).toFixed(1)}%`;

function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [h, ...rest] = arr;
  return [...combinations(rest, k - 1).map((c) => [h, ...c]), ...combinations(rest, k)];
}
function permutations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  const r: T[][] = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const p of permutations(rest, k - 1)) r.push([arr[i], ...p]);
  }
  return r;
}
const sameSet = (a: number[], b: number[]): boolean =>
  a.length === b.length && [...a].sort((x, y) => x - y).join(',') === [...b].sort((x, y) => x - y).join(',');
const sameSeq = (a: number[], b: number[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

// ----------------------------------------
// 戦略シミュレーション
// ----------------------------------------

type Prediction = VerificationData['predictions'][number];
type BetOutcome = { cost: number; payout: number; hit: boolean };

function sortedByEV(preds: Prediction[]): Prediction[] {
  return [...preds].filter((p) => p.odds > 0).sort((a, b) => b.ev - a.ev);
}

/** 通常戦略群 (現行本番同等) */
function betsForRace(vd: VerificationData): {
  tan: BetOutcome; fuku: BetOutcome; umaren: BetOutcome;
  umatan: BetOutcome; wide: BetOutcome; sanfuku: BetOutcome; santan: BetOutcome;
} {
  const sorted = sortedByEV(vd.predictions);
  const p1 = sorted[0], p2 = sorted[1], p3 = sorted[2];

  // 単勝
  const tanWin = p1 ? vd.results.payouts.tan.find((t) => t.horseId === p1.horseId) : undefined;
  const tan: BetOutcome = { cost: p1 ? 100 : 0, payout: tanWin?.payout ?? 0, hit: !!tanWin };

  // 複勝 (F2: 上位2頭)
  let fukuCost = 0, fukuPay = 0, fukuHit = false;
  for (const pick of [p1, p2]) {
    if (!pick) continue;
    fukuCost += 100;
    const win = (vd.results.payouts.fuku ?? []).find((f) => f.horseId === pick.horseId);
    if (win) { fukuHit = true; fukuPay += win.payout; }
  }
  const fuku: BetOutcome = { cost: fukuCost, payout: fukuPay, hit: fukuHit };

  // 馬連 (top-2 BOX)
  let umarenHit = false, umarenPay = 0;
  if (p1 && p2) {
    for (const u of vd.results.payouts.umaren) {
      if (sameSet([p1.horseId, p2.horseId], u.combination.split('-').map(Number))) {
        umarenHit = true; umarenPay = u.payout; break;
      }
    }
  }
  const umaren: BetOutcome = { cost: p1 && p2 ? 100 : 0, payout: umarenPay, hit: umarenHit };

  // 馬単 (top-2 BOX = 2点)
  let umatanHit = false, umatanPay = 0;
  if (p1 && p2) {
    for (const perm of permutations([p1.horseId, p2.horseId], 2)) {
      for (const u of vd.results.payouts.umatan ?? []) {
        if (sameSeq(perm, u.combination.split('-').map(Number))) {
          umatanHit = true; umatanPay += u.payout; break;
        }
      }
    }
  }
  const umatan: BetOutcome = { cost: p1 && p2 ? 200 : 0, payout: umatanPay, hit: umatanHit };

  // ワイド (top-2 BOX = 1点)
  let wideHit = false, widePay = 0;
  if (p1 && p2) {
    for (const w of vd.results.payouts.wide ?? []) {
      if (sameSet([p1.horseId, p2.horseId], w.combination.split('-').map(Number))) {
        wideHit = true; widePay = w.payout; break;
      }
    }
  }
  const wide: BetOutcome = { cost: p1 && p2 ? 100 : 0, payout: widePay, hit: wideHit };

  // 三連複 (top-3 BOX = 1点)
  let sfHit = false, sfPay = 0;
  if (p1 && p2 && p3) {
    for (const s of vd.results.payouts.sanfuku) {
      if (sameSet([p1.horseId, p2.horseId, p3.horseId], s.combination.split('-').map(Number))) {
        sfHit = true; sfPay = s.payout; break;
      }
    }
  }
  const sanfuku: BetOutcome = { cost: p3 ? 100 : 0, payout: sfPay, hit: sfHit };

  // 三連単 (top-3 BOX = 6点)
  let stHit = false, stPay = 0;
  if (p1 && p2 && p3) {
    for (const perm of permutations([p1.horseId, p2.horseId, p3.horseId], 3)) {
      for (const s of vd.results.payouts.santan) {
        if (sameSeq(perm, s.combination.split('-').map(Number))) {
          stHit = true; stPay += s.payout; break;
        }
      }
    }
  }
  const santan: BetOutcome = { cost: p3 ? 600 : 0, payout: stPay, hit: stHit };

  return { tan, fuku, umaren, umatan, wide, sanfuku, santan };
}

/** 本命級戦略群 (参加条件グリッドサーチ結果) */
function honmeiBetsForRace(vd: VerificationData): {
  umarenHonmei: BetOutcome; umatanHonmei: BetOutcome; wideKenjitsu: BetOutcome;
} {
  const sorted = sortedByEV(vd.predictions);
  const p1 = sorted[0], p2 = sorted[1];

  // 馬連 本命: EV≥1.00 + スコア≥65 両馬
  let umarenHit = false, umarenPay = 0, umarenCost = 0;
  if (p1 && p2 && p1.ev >= 1.00 && p2.ev >= 1.00 && p1.score >= 65 && p2.score >= 65) {
    umarenCost = 100;
    for (const u of vd.results.payouts.umaren) {
      if (sameSet([p1.horseId, p2.horseId], u.combination.split('-').map(Number))) {
        umarenHit = true; umarenPay = u.payout; break;
      }
    }
  }

  // 馬単 本命: EV≥1.00 + スコア≥65 + オッズ≤15 両馬
  let umatanHit = false, umatanPay = 0, umatanCost = 0;
  if (p1 && p2 && p1.ev >= 1.00 && p2.ev >= 1.00 && p1.score >= 65 && p2.score >= 65 && p1.odds <= 15 && p2.odds <= 15) {
    umatanCost = 200;
    for (const perm of permutations([p1.horseId, p2.horseId], 2)) {
      for (const u of vd.results.payouts.umatan ?? []) {
        if (sameSeq(perm, u.combination.split('-').map(Number))) {
          umatanHit = true; umatanPay += u.payout; break;
        }
      }
    }
  }

  // ワイド 堅実: EV≥1.02 + スコア≥65 + オッズ≤10 両馬
  let wideHit = false, widePay = 0, wideCost = 0;
  if (p1 && p2 && p1.ev >= 1.02 && p2.ev >= 1.02 && p1.score >= 65 && p2.score >= 65 && p1.odds <= 10 && p2.odds <= 10) {
    wideCost = 100;
    for (const w of vd.results.payouts.wide ?? []) {
      if (sameSet([p1.horseId, p2.horseId], w.combination.split('-').map(Number))) {
        wideHit = true; widePay = w.payout; break;
      }
    }
  }

  return {
    umarenHonmei: { cost: umarenCost, payout: umarenPay, hit: umarenHit },
    umatanHonmei: { cost: umatanCost, payout: umatanPay, hit: umatanHit },
    wideKenjitsu: { cost: wideCost, payout: widePay, hit: wideHit },
  };
}

// ----------------------------------------
// 集計
// ----------------------------------------

type Stats = { cost: number; payout: number; hits: number; participated: number; races: number };
const empty = (): Stats => ({ cost: 0, payout: 0, hits: 0, participated: 0, races: 0 });

type ClassStats = {
  races: number;
  normal: Record<'tan' | 'fuku' | 'umaren' | 'umatan' | 'wide' | 'sanfuku' | 'santan', Stats>;
  honmei: Record<'umarenHonmei' | 'umatanHonmei' | 'wideKenjitsu', Stats>;
};

function emptyClassStats(): ClassStats {
  return {
    races: 0,
    normal: {
      tan: empty(), fuku: empty(), umaren: empty(), umatan: empty(),
      wide: empty(), sanfuku: empty(), santan: empty(),
    },
    honmei: {
      umarenHonmei: empty(), umatanHonmei: empty(), wideKenjitsu: empty(),
    },
  };
}

function accumulate(stats: Stats, outcome: BetOutcome): void {
  stats.races++;
  if (outcome.cost > 0) {
    stats.participated++;
    stats.cost += outcome.cost;
    stats.payout += outcome.payout;
    if (outcome.hit) stats.hits++;
  }
}

// ----------------------------------------
// メイン
// ----------------------------------------

async function loadData(): Promise<VerificationData[]> {
  const files = (await fs.readdir(DIR)).filter((f) => f.endsWith('.json'));
  const out: VerificationData[] = [];
  for (const f of files) {
    try { out.push(JSON.parse(await fs.readFile(path.join(DIR, f), 'utf-8'))); } catch {}
  }
  return out;
}

async function main(): Promise<void> {
  const all = await loadData();
  if (all.length === 0) { console.error('no data'); process.exit(1); }

  // クラス別集計
  const byClass: Record<RaceClass, ClassStats> = {
    NW: emptyClassStats(), UW: emptyClassStats(), C1: emptyClassStats(), C2: emptyClassStats(),
    C3: emptyClassStats(), SP: emptyClassStats(), OP: emptyClassStats(),
    G3: emptyClassStats(), G2: emptyClassStats(), G1: emptyClassStats(),
    Unknown: emptyClassStats(),
  };

  // レース名→クラスの一覧も記録 (デバッグ用)
  const classList: Array<{ raceId: string; raceName: string; cls: RaceClass }> = [];

  for (const vd of all) {
    if (vd.predictions.length < 2 || vd.results.results.length === 0) continue;
    const cls = classifyRace(vd);
    classList.push({ raceId: vd.raceId, raceName: vd.raceName, cls });
    const b = betsForRace(vd);
    const h = honmeiBetsForRace(vd);
    const s = byClass[cls];
    s.races++;
    accumulate(s.normal.tan,     b.tan);
    accumulate(s.normal.fuku,    b.fuku);
    accumulate(s.normal.umaren,  b.umaren);
    accumulate(s.normal.umatan,  b.umatan);
    accumulate(s.normal.wide,    b.wide);
    accumulate(s.normal.sanfuku, b.sanfuku);
    accumulate(s.normal.santan,  b.santan);
    accumulate(s.honmei.umarenHonmei, h.umarenHonmei);
    accumulate(s.honmei.umatanHonmei, h.umatanHonmei);
    accumulate(s.honmei.wideKenjitsu, h.wideKenjitsu);
  }

  // 除外パターン集計
  const EXCLUDE_PATTERNS: Array<{ key: string; label: string; exclude: RaceClass[] }> = [
    { key: 'A', label: '除外なし (現状維持)',     exclude: [] },
    { key: 'B', label: '新馬戦のみ除外',         exclude: ['NW'] },
    { key: 'C', label: '新馬戦+未勝利戦 除外',    exclude: ['NW', 'UW'] },
    { key: 'D', label: '新馬戦+未勝利戦+1勝C 除外', exclude: ['NW', 'UW', 'C1'] },
    { key: 'E', label: '2勝クラス以上のみ',       exclude: ['NW', 'UW', 'C1'] },
    { key: 'F', label: '1勝クラスのみ除外',       exclude: ['C1'] },
    { key: 'G', label: '1勝クラス+SP除外',       exclude: ['C1', 'SP'] },
    // E は D と同じだが Unknown も除外
  ];

  type PatternStats = Record<string, { label: string; totals: ClassStats['normal']; honmei: ClassStats['honmei']; totalRaces: number }>;
  const patternStats: PatternStats = {};

  for (const pat of EXCLUDE_PATTERNS) {
    const total = emptyClassStats();
    for (const cls of CLASS_ORDER) {
      if (pat.exclude.includes(cls)) continue;
      // Pattern E: Unknown も除外
      if (pat.key === 'E' && cls === 'Unknown') continue;
      const cs = byClass[cls];
      total.races += cs.races;
      for (const k of Object.keys(total.normal) as (keyof ClassStats['normal'])[]) {
        total.normal[k].cost          += cs.normal[k].cost;
        total.normal[k].payout        += cs.normal[k].payout;
        total.normal[k].hits          += cs.normal[k].hits;
        total.normal[k].participated  += cs.normal[k].participated;
        total.normal[k].races         += cs.normal[k].races;
      }
      for (const k of Object.keys(total.honmei) as (keyof ClassStats['honmei'])[]) {
        total.honmei[k].cost          += cs.honmei[k].cost;
        total.honmei[k].payout        += cs.honmei[k].payout;
        total.honmei[k].hits          += cs.honmei[k].hits;
        total.honmei[k].participated  += cs.honmei[k].participated;
        total.honmei[k].races         += cs.honmei[k].races;
      }
    }
    patternStats[pat.key] = {
      label: pat.label,
      totals: total.normal,
      honmei: total.honmei,
      totalRaces: total.races,
    };
  }

  // ---- コンソール出力 ----
  const log = (s = ''): void => console.log(s);
  const md: string[] = [];
  const mp = (s = ''): void => { md.push(s); };

  log('='.repeat(100));
  log(`  クラス別回収率分析  (対象: ${all.length} R)`);
  log('='.repeat(100));
  log('');

  log('▼ 分析1: クラス別の現状回収率 (全券種、通常戦略)');
  log('-'.repeat(100));
  log('| クラス    | R数 |  単勝  |  複勝  |  馬連  |  馬単  | ワイド | 三連複 | 三連単 |');
  log('|-----------|-----|--------|--------|--------|--------|--------|--------|--------|');
  for (const cls of CLASS_ORDER) {
    const s = byClass[cls];
    if (s.races === 0) continue;
    const r = (key: keyof ClassStats['normal']): string =>
      (roi(s.normal[key].cost, s.normal[key].payout).toFixed(1) + '%').padStart(6);
    log(`| ${CLASS_LABEL[cls].padEnd(9)} | ${s.races.toString().padStart(3)} | ${r('tan')} | ${r('fuku')} | ${r('umaren')} | ${r('umatan')} | ${r('wide')} | ${r('sanfuku')} | ${r('santan')} |`);
  }
  log('');

  log('▼ 分析1-B: クラス別の本命級戦略 (参加条件グリッドサーチ結果)');
  log('-'.repeat(100));
  log('| クラス    | R数 | 馬連_本命 参加/的中/ROI  | 馬単_本命 参加/的中/ROI  | ワイド_堅実 参加/的中/ROI|');
  log('|-----------|-----|---------------------------|---------------------------|---------------------------|');
  for (const cls of CLASS_ORDER) {
    const s = byClass[cls];
    if (s.races === 0) continue;
    const h = (key: keyof ClassStats['honmei']): string => {
      const st = s.honmei[key];
      const r = roi(st.cost, st.payout);
      return `${st.participated.toString().padStart(3)}/${st.hits.toString().padStart(2)}/${(r.toFixed(1) + '%').padStart(6)}`;
    };
    log(`| ${CLASS_LABEL[cls].padEnd(9)} | ${s.races.toString().padStart(3)} | ${h('umarenHonmei').padEnd(25)} | ${h('umatanHonmei').padEnd(25)} | ${h('wideKenjitsu').padEnd(25)} |`);
  }
  log('');

  log('▼ 分析2: 除外パターン別の総合回収率 (通常戦略)');
  log('-'.repeat(100));
  log('| パターン | 内容                        |  参加R |  単勝  |  複勝  |  馬連  |  馬単  | ワイド | 三複   | 三単   |');
  log('|----------|-----------------------------|--------|--------|--------|--------|--------|--------|--------|--------|');
  for (const pat of EXCLUDE_PATTERNS) {
    const ps = patternStats[pat.key];
    const r = (key: keyof ClassStats['normal']): string =>
      (roi(ps.totals[key].cost, ps.totals[key].payout).toFixed(1) + '%').padStart(6);
    log(`|    ${pat.key}     | ${pat.label.padEnd(27)} | ${ps.totalRaces.toString().padStart(6)} | ${r('tan')} | ${r('fuku')} | ${r('umaren')} | ${r('umatan')} | ${r('wide')} | ${r('sanfuku')} | ${r('santan')} |`);
  }
  log('');

  log('▼ 分析2-B: 除外パターン別の本命級戦略');
  log('-'.repeat(100));
  log('| パターン | 参加R | 馬連_本命 参加/的中/ROI  | 馬単_本命 参加/的中/ROI  | ワイド_堅実 参加/的中/ROI|');
  log('|----------|-------|---------------------------|---------------------------|---------------------------|');
  for (const pat of EXCLUDE_PATTERNS) {
    const ps = patternStats[pat.key];
    const h = (key: keyof ClassStats['honmei']): string => {
      const st = ps.honmei[key];
      const r = roi(st.cost, st.payout);
      return `${st.participated.toString().padStart(3)}/${st.hits.toString().padStart(2)}/${(r.toFixed(1) + '%').padStart(6)}`;
    };
    log(`|    ${pat.key}     | ${ps.totalRaces.toString().padStart(5)} | ${h('umarenHonmei').padEnd(25)} | ${h('umatanHonmei').padEnd(25)} | ${h('wideKenjitsu').padEnd(25)} |`);
  }
  log('');

  // ---- Markdown レポート ----
  mp(`# クラス別回収率分析・下位クラス除外の効果検証`);
  mp('');
  mp(`- 生成日時: ${new Date().toISOString()}`);
  mp(`- 対象: **${all.length} R** (2026-01-04〜04-19)`);
  mp('');
  mp(`## クラス分布`);
  mp('');
  mp(`| クラス | レース数 |`);
  mp(`|---|---|`);
  for (const cls of CLASS_ORDER) {
    const n = byClass[cls].races;
    if (n > 0) mp(`| ${CLASS_LABEL[cls]} | ${n} |`);
  }
  mp('');

  mp(`## 1. クラス別 × 全券種 現状回収率 (通常戦略)`);
  mp('');
  mp(`各券種の戦略:`);
  mp(`- 単勝: EV1位 1点`);
  mp(`- 複勝: EV上位2頭 各100円 (F2)`);
  mp(`- 馬連/馬単/ワイド: top-2 BOX`);
  mp(`- 三連複/三連単: top-3 BOX`);
  mp('');
  mp(`| クラス | R数 | 単勝 | 複勝 | 馬連 | 馬単 | ワイド | 三連複 | 三連単 |`);
  mp(`|---|---|---|---|---|---|---|---|---|`);
  for (const cls of CLASS_ORDER) {
    const s = byClass[cls];
    if (s.races === 0) continue;
    const r = (key: keyof ClassStats['normal']): string =>
      roi(s.normal[key].cost, s.normal[key].payout).toFixed(1) + '%';
    const lowSample = s.races < 10 ? ' ⚠️' : '';
    mp(`| ${CLASS_LABEL[cls]}${lowSample} | ${s.races} | ${r('tan')} | ${r('fuku')} | ${r('umaren')} | ${r('umatan')} | ${r('wide')} | ${r('sanfuku')} | ${r('santan')} |`);
  }
  mp('');
  mp(`⚠️ サンプル数 10R 未満のクラスは信頼性低`);
  mp('');

  mp(`## 2. クラス別 × 本命級戦略 (参加条件グリッドサーチ結果)`);
  mp('');
  mp(`- 馬連_本命: 両馬 EV≥1.00 + スコア≥65`);
  mp(`- 馬単_本命: 両馬 EV≥1.00 + スコア≥65 + オッズ≤15`);
  mp(`- ワイド_堅実: 両馬 EV≥1.02 + スコア≥65 + オッズ≤10`);
  mp('');
  mp(`| クラス | R数 | 馬連_本命 参加/的中/ROI | 馬単_本命 参加/的中/ROI | ワイド_堅実 参加/的中/ROI |`);
  mp(`|---|---|---|---|---|`);
  for (const cls of CLASS_ORDER) {
    const s = byClass[cls];
    if (s.races === 0) continue;
    const h = (key: keyof ClassStats['honmei']): string => {
      const st = s.honmei[key];
      const r = roi(st.cost, st.payout);
      return `${st.participated}R / ${st.hits}hit / **${r.toFixed(1)}%**`;
    };
    mp(`| ${CLASS_LABEL[cls]} | ${s.races} | ${h('umarenHonmei')} | ${h('umatanHonmei')} | ${h('wideKenjitsu')} |`);
  }
  mp('');

  mp(`## 3. 除外パターン別の総合回収率 (通常戦略)`);
  mp('');
  mp(`| パターン | 内容 | 参加R | 単勝 | 複勝 | 馬連 | 馬単 | ワイド | 三連複 | 三連単 |`);
  mp(`|---|---|---|---|---|---|---|---|---|---|`);
  for (const pat of EXCLUDE_PATTERNS) {
    const ps = patternStats[pat.key];
    const r = (key: keyof ClassStats['normal']): string =>
      roi(ps.totals[key].cost, ps.totals[key].payout).toFixed(1) + '%';
    mp(`| **${pat.key}** | ${pat.label} | ${ps.totalRaces} | ${r('tan')} | ${r('fuku')} | ${r('umaren')} | ${r('umatan')} | ${r('wide')} | ${r('sanfuku')} | ${r('santan')} |`);
  }
  mp('');

  mp(`## 4. 除外パターン別の本命級戦略`);
  mp('');
  mp(`| パターン | 参加R | 馬連_本命 ROI (参加/的中) | 馬単_本命 ROI (参加/的中) | ワイド_堅実 ROI (参加/的中) |`);
  mp(`|---|---|---|---|---|`);
  for (const pat of EXCLUDE_PATTERNS) {
    const ps = patternStats[pat.key];
    const h = (key: keyof ClassStats['honmei']): string => {
      const st = ps.honmei[key];
      const r = roi(st.cost, st.payout);
      return `**${r.toFixed(1)}%** (${st.participated}R/${st.hits}hit)`;
    };
    mp(`| **${pat.key}** | ${ps.totalRaces} | ${h('umarenHonmei')} | ${h('umatanHonmei')} | ${h('wideKenjitsu')} |`);
  }
  mp('');

  // ---- 推奨判定 ----
  mp(`## 5. 推奨される除外ロジック`);
  mp('');

  // 現状 (パターン A) と各除外パターンを比較
  const roiA_umarenH = roi(patternStats.A.honmei.umarenHonmei.cost, patternStats.A.honmei.umarenHonmei.payout);
  const roiA_umatanH = roi(patternStats.A.honmei.umatanHonmei.cost, patternStats.A.honmei.umatanHonmei.payout);
  const roiA_wideK   = roi(patternStats.A.honmei.wideKenjitsu.cost, patternStats.A.honmei.wideKenjitsu.payout);

  let bestPattern = 'A';
  let bestScore = roiA_umarenH + roiA_umatanH + roiA_wideK;
  for (const pat of EXCLUDE_PATTERNS) {
    const ps = patternStats[pat.key];
    const score = roi(ps.honmei.umarenHonmei.cost, ps.honmei.umarenHonmei.payout)
      + roi(ps.honmei.umatanHonmei.cost, ps.honmei.umatanHonmei.payout)
      + roi(ps.honmei.wideKenjitsu.cost, ps.honmei.wideKenjitsu.payout);
    if (score > bestScore) {
      bestScore = score;
      bestPattern = pat.key;
    }
  }

  mp(`本命級3戦略 (馬連_本命 + 馬単_本命 + ワイド_堅実) の合算 ROI で比較:`);
  mp('');
  for (const pat of EXCLUDE_PATTERNS) {
    const ps = patternStats[pat.key];
    const a = roi(ps.honmei.umarenHonmei.cost, ps.honmei.umarenHonmei.payout);
    const b = roi(ps.honmei.umatanHonmei.cost, ps.honmei.umatanHonmei.payout);
    const c = roi(ps.honmei.wideKenjitsu.cost, ps.honmei.wideKenjitsu.payout);
    const total = a + b + c;
    const mark = pat.key === bestPattern ? ' ⭐最良' : '';
    mp(`- **${pat.key}** ${pat.label}: 馬連 ${a.toFixed(1)}% + 馬単 ${b.toFixed(1)}% + ワイド ${c.toFixed(1)}% = 合計 ${total.toFixed(1)}pt${mark}`);
  }
  mp('');
  mp(`→ **推奨: パターン ${bestPattern}** (${EXCLUDE_PATTERNS.find((p) => p.key === bestPattern)?.label})`);
  mp('');

  mp(`## 6. 本番反映の判断`);
  mp('');
  const bestPat = EXCLUDE_PATTERNS.find((p) => p.key === bestPattern)!;
  const a = roi(patternStats[bestPattern].honmei.umarenHonmei.cost, patternStats[bestPattern].honmei.umarenHonmei.payout);
  const b = roi(patternStats[bestPattern].honmei.umatanHonmei.cost, patternStats[bestPattern].honmei.umatanHonmei.payout);
  const c = roi(patternStats[bestPattern].honmei.wideKenjitsu.cost, patternStats[bestPattern].honmei.wideKenjitsu.payout);

  if (bestPattern === 'A') {
    mp(`現状維持 (下位クラス除外せず) が最適。本命級戦略は全クラスで有効。`);
  } else {
    mp(`**${bestPat.label}** を適用すると本命級戦略の回収率が向上:`);
    mp(`- 馬連_本命: ${roiA_umarenH.toFixed(1)}% → ${a.toFixed(1)}% (${a >= roiA_umarenH ? '+' : ''}${(a - roiA_umarenH).toFixed(1)}pt)`);
    mp(`- 馬単_本命: ${roiA_umatanH.toFixed(1)}% → ${b.toFixed(1)}% (${b >= roiA_umatanH ? '+' : ''}${(b - roiA_umatanH).toFixed(1)}pt)`);
    mp(`- ワイド_堅実: ${roiA_wideK.toFixed(1)}% → ${c.toFixed(1)}% (${c >= roiA_wideK ? '+' : ''}${(c - roiA_wideK).toFixed(1)}pt)`);
    mp('');
    mp(`### 本番反映候補`);
    mp(`\`RaceReport.tsx\` の Section 5A で、\`classifyRace(race.name)\` が除外対象なら`);
    mp(`「下位クラス戦のため本命級推奨を見送り」表示を追加する。`);
  }
  mp('');

  mp(`---`);
  mp(`*再実行: \`pnpm tsx scripts/class_analysis.ts\`*`);

  await fs.writeFile(REPORT, md.join('\n'), 'utf-8');
  log('='.repeat(100));
  log(`Markdown: ${REPORT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
