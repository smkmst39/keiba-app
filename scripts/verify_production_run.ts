// ==========================================
// 本番動作確認スクリプト (Phase 2H 暫定)
//
// 目的: courseRecord 実装 + lastThreeF/training 独立化が実 netkeiba で
//       正しく動くかを最終確認する。
//
// 対象レース:
//   - 平場: 4歳以上2勝クラス (202608030212、14頭、2026/4/26)
//   - 重賞: 天皇賞(春) 2025 (202508020411、18頭、G1)
//           前年同名レース (天皇賞春 2024) 補正の発動を実機検証
//
// 旧/新比較戦略: HTTP は1セットで完結、calc 側で pastRaces を外して旧挙動シミュレート
// 制約: SCRAPE_INTERVAL_MS=1500、深夜2-6時禁止、HTTP 400/coverage 低下で中断
//
// 実行: pnpm tsx scripts/verify_production_run.ts
// ==========================================

// ★ import より前に環境変数を設定（netkeiba.ts L18 が module load 時に読むため）
process.env.SCRAPE_INTERVAL_MS = '1500';

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fetchRaceData } from '../lib/scraper/netkeiba';
import { fetchRacePersonStats } from '../lib/scraper/stats';
import { normalizeRaceName, parseRaceDate, parseHistoryDate } from '../lib/scraper/horse_history';
import {
  calcAllScores,
  calcAllComponentScores,
  validateScores,
  median,
  mean,
} from '../lib/score/calculator';
import type { Horse, Race } from '../lib/scraper/types';
import type { ScoreComponents } from '../lib/score/calculator';

// =====================================================
// 深夜帯チェック (JST 2-6時 禁止)
// =====================================================
function checkHourGate() {
  const now = new Date();
  const jstHour = (now.getUTCHours() + 9) % 24;
  if (jstHour >= 2 && jstHour < 6) {
    console.error(`[verify_prod] 深夜帯 (JST ${jstHour}時) のため実行禁止。中断します。`);
    process.exit(1);
  }
  console.log(`[verify_prod] 時刻チェック OK (JST ${jstHour}時)`);
}
checkHourGate();

// =====================================================
// 対象レース
// =====================================================
const RACES = [
  { type: '平場', label: '4歳以上2勝クラス (中山12R 2026/4/26)', raceId: '202608030212' },
  { type: '重賞', label: '天皇賞(春) 2025 G1', raceId: '202508020411' },
];

// =====================================================
// メイン処理
// =====================================================
type ProcessResult = {
  type: string;
  label: string;
  raceId: string;
  fetchMs: number;
  race: Race;
  pastRacesCoverage: { total: number; withPastRaces: number; rate: number; missingHorseIds: number[] };
  newScored: Race;
  oldScored: Race;
  newComps: Map<number, ScoreComponents>;
  oldComps: Map<number, ScoreComponents>;
  newHealth: boolean;
  oldHealth: boolean;
  prevYearStakesNote: string;
};

async function processRace(label: string, type: string, raceId: string): Promise<ProcessResult | null> {
  console.log(`\n[verify_prod] === ${type}: ${label} (${raceId}) ===`);
  const start = Date.now();

  let race: Race | null = null;
  try {
    race = await fetchRaceData(raceId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[verify_prod] fetchRaceData 失敗 (catch): ${msg}`);
    return null;
  }
  if (!race) {
    console.error(`[verify_prod] fetchRaceData が null を返却 raceId=${raceId}`);
    return null;
  }
  const fetchMs = Date.now() - start;
  console.log(`[verify_prod] fetchRaceData 完了: ${(fetchMs / 1000).toFixed(1)}秒`);

  // pastRaces 取得状況
  const total = race.horses.length;
  const withPast = race.horses.filter((h) => (h.pastRaces?.length ?? 0) > 0).length;
  const missingHorseIds = race.horses.filter((h) => !h.pastRaces?.length).map((h) => h.id);
  const coverageRate = total === 0 ? 0 : withPast / total;
  console.log(`[verify_prod] pastRaces 取得率: ${withPast}/${total} (${(coverageRate * 100).toFixed(1)}%)`);
  if (missingHorseIds.length > 0) {
    console.log(`[verify_prod]   未取得馬番: [${missingHorseIds.join(', ')}]`);
  }

  // 重賞補正の前年同レース観測（コード上のログ）
  //   - 正規化は normalizeRaceName を流用 (季節区分は保持)
  //   - baseDate は race.raceDate (YYYYMMDD) 優先で構築し、自レース・未来レースを除外
  //     (タイムリーキ防止、コミット 3801986 と同基準)
  let prevYearStakesNote = '';
  if (race.raceGrade === 'G1' || race.raceGrade === 'G2' || race.raceGrade === 'G3' || race.raceGrade === 'L') {
    const target = normalizeRaceName(race.name);
    const baseDate = parseRaceDate(race.raceDate) ?? race.fetchedAt ?? new Date();
    const matchPredicate = (p: { raceName: string; date: string }) => {
      if (normalizeRaceName(p.raceName) !== target) return false;
      const d = parseHistoryDate(p.date);
      if (d === null) return false;
      return d < baseDate; // 自レース・未来レース除外
    };
    const found = race.horses.filter((h) => (h.pastRaces ?? []).some(matchPredicate));
    prevYearStakesNote = `重賞 (${race.raceGrade})。レース名 "${race.name}" 正規化="${target}"。前年同名所有馬: ${found.length}/${total}頭 (自/未来レース除外後)`;
    console.log(`[verify_prod] ${prevYearStakesNote}`);
    if (found.length > 0) {
      console.log(`[verify_prod]   該当馬の馬番: [${found.map((h) => h.id).join(', ')}]`);
      for (const h of found) {
        const matched = (h.pastRaces ?? []).filter(matchPredicate);
        for (const p of matched) {
          console.log(`[verify_prod]     馬${h.id}: ${p.date} "${p.raceName}" 着${p.rank} 上3F=${p.lastThreeF}`);
        }
      }
    }
  } else {
    prevYearStakesNote = `平場 (raceGrade=${race.raceGrade ?? '未設定'})。重賞補正は素通し`;
  }

  // 騎手勝率
  let jockeyRates: Map<string, number>;
  try {
    const stats = await fetchRacePersonStats(race.horses);
    jockeyRates = stats.jockeyRates;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[verify_prod] fetchRacePersonStats 失敗 (続行): ${msg}`);
    jockeyRates = new Map();
  }

  // 新挙動
  console.log(`[verify_prod] === 新挙動 (pastRaces 有効) の健全性チェック ===`);
  const newScored = calcAllScores(race, jockeyRates);
  const newComps = calcAllComponentScores(race, jockeyRates);
  const newHealth = validateScores(newScored.horses);

  // 旧挙動シミュレート
  console.log(`[verify_prod] === 旧挙動 (pastRaces 外す) の健全性チェック ===`);
  const raceWithoutPasts: Race = {
    ...race,
    horses: race.horses.map((h) => ({ ...h, pastRaces: undefined })),
  };
  const oldScored = calcAllScores(raceWithoutPasts, jockeyRates);
  const oldComps = calcAllComponentScores(raceWithoutPasts, jockeyRates);
  const oldHealth = validateScores(oldScored.horses);

  return {
    type, label, raceId, fetchMs, race,
    pastRacesCoverage: { total, withPastRaces: withPast, rate: coverageRate, missingHorseIds },
    newScored, oldScored, newComps, oldComps,
    newHealth, oldHealth, prevYearStakesNote,
  };
}

// =====================================================
// メイン
// =====================================================
async function main() {
  console.log('[verify_prod] === 本番動作確認スクリプト 開始 ===');
  console.log(`[verify_prod] SCRAPE_INTERVAL_MS=${process.env.SCRAPE_INTERVAL_MS}ms`);
  console.log(`[verify_prod] USE_MOCK=${process.env.USE_MOCK ?? '(未設定)'}`);
  console.log(`[verify_prod] 対象: ${RACES.map((r) => r.raceId).join(', ')}`);

  const results: ProcessResult[] = [];
  for (const r of RACES) {
    const result = await processRace(r.label, r.type, r.raceId);
    if (!result) {
      console.error(`[verify_prod] ${r.raceId} 取得失敗。残りレースは続行せず中断（HTTP 問題の可能性）`);
      break;
    }
    // coverage が極端に低い場合は HTTP 問題の可能性で中断
    if (result.pastRacesCoverage.rate < 0.5) {
      results.push(result);
      console.error(`[verify_prod] pastRaces 取得率 ${(result.pastRacesCoverage.rate * 100).toFixed(1)}% (< 50%)。HTTP問題の可能性で中断`);
      break;
    }
    results.push(result);
  }

  if (results.length === 0) {
    console.error('[verify_prod] 全レース取得失敗。レポート生成スキップ');
    process.exit(1);
  }

  const OUT_DIR = path.join(__dirname, 'output');
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const yyyymmdd = jst.toISOString().slice(0, 10).replace(/-/g, '');
  const isoNow = jst.toISOString().replace('Z', '+09:00');

  const jsonReport = buildJsonReport(results, isoNow);
  const jsonPath = path.join(OUT_DIR, `production_verification_${yyyymmdd}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(jsonReport, null, 2), 'utf8');
  console.log(`\n[verify_prod] JSON 保存: ${jsonPath}`);

  const html = buildHtml(results, isoNow);
  const htmlPath = path.join(OUT_DIR, `production_verification_${yyyymmdd}.html`);
  fs.writeFileSync(htmlPath, html, 'utf8');
  console.log(`[verify_prod] HTML 保存: ${htmlPath}`);

  console.log('\n[verify_prod] === 完了 ===');
}

// =====================================================
// 出力
// =====================================================
function buildJsonReport(results: ProcessResult[], isoNow: string) {
  return {
    generatedAt: isoNow,
    config: { SCRAPE_INTERVAL_MS: process.env.SCRAPE_INTERVAL_MS },
    races: results.map((r) => ({
      type: r.type,
      label: r.label,
      raceId: r.raceId,
      raceName: r.race.name,
      raceGrade: r.race.raceGrade ?? null,
      fetchMs: r.fetchMs,
      pastRacesCoverage: r.pastRacesCoverage,
      prevYearStakesNote: r.prevYearStakesNote,
      newHealth: r.newHealth,
      oldHealth: r.oldHealth,
      horses: r.race.horses.map((h) => {
        const newH = r.newScored.horses.find((x) => x.id === h.id);
        const oldH = r.oldScored.horses.find((x) => x.id === h.id);
        const newC = r.newComps.get(h.id);
        const oldC = r.oldComps.get(h.id);
        return {
          id: h.id,
          name: h.name,
          jockey: h.jockey,
          odds: h.odds,
          trainingApprox: h.lastThreeF,
          firstPastLastThreeF: h.pastRaces?.[0]?.lastThreeF ?? null,
          firstPastDate: h.pastRaces?.[0]?.date ?? null,
          firstPastRaceName: h.pastRaces?.[0]?.raceName ?? null,
          pastRacesCount: h.pastRaces?.length ?? 0,
          // 全 pastRaces を保存 (オフライン再評価用、HTTP不要での再分析を可能に)
          pastRaces: h.pastRaces ?? [],
          oldScore: oldH?.score, newScore: newH?.score,
          oldEv: oldH?.ev, newEv: newH?.ev,
          oldCourseRecord: oldC?.courseRecord, newCourseRecord: newC?.courseRecord,
          oldLastThreeF: oldC?.lastThreeF, newLastThreeF: newC?.lastThreeF,
          oldTraining: oldC?.training, newTraining: newC?.training,
        };
      }),
    })),
  };
}

function escapeHtml(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function std(arr: number[]): number {
  if (arr.length === 0) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
}

function buildHtml(results: ProcessResult[], isoNow: string): string {
  const sections = results.map((r) => buildRaceSection(r)).join('\n');
  const totalFetchSec = (results.reduce((s, r) => s + r.fetchMs, 0) / 1000).toFixed(1);

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>本番動作確認 ${isoNow.slice(0, 10)}</title>
<style>
  body { font-family: system-ui, "Hiragino Sans", "Yu Gothic", sans-serif; padding: 1.5rem; background: #f7fafc; color: #1a202c; line-height: 1.5; }
  .container { max-width: 1400px; margin: 0 auto; }
  h1 { font-size: 1.5rem; margin: 0 0 0.5rem; }
  h2 { font-size: 1.15rem; margin: 1.5rem 0 0.6rem; padding-bottom: 0.3rem; border-bottom: 2px solid #2b6cb0; color: #2b6cb0; }
  h3 { font-size: 0.95rem; margin: 1rem 0 0.5rem; color: #4a5568; }
  section { background: #fff; border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
  .meta-line { color: #4a5568; font-size: 0.85rem; margin-bottom: 1rem; }
  .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.8rem; }
  .summary-card { padding: 0.8rem; background: #f7fafc; border: 1px solid #e2e8f0; border-radius: 4px; }
  .summary-card .label { font-size: 0.7rem; color: #718096; }
  .summary-card .value { font-size: 1.05rem; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; font-size: 0.78rem; }
  th, td { padding: 0.35rem 0.5rem; border-bottom: 1px solid #e2e8f0; text-align: left; }
  th { background: #f7fafc; font-weight: 600; font-size: 0.72rem; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  tbody tr:nth-child(even) { background: #f7fafc; }
  .ok { color: #2f855a; font-weight: 700; }
  .ng { color: #c53030; font-weight: 700; }
  .stakes-note { padding: 0.8rem 1rem; background: #fff5e0; border-left: 4px solid #f6ad55; font-size: 0.85rem; margin-bottom: 1rem; }
  .note { font-size: 0.78rem; color: #4a5568; line-height: 1.6; }
</style>
</head>
<body>
<div class="container">
  <h1>本番動作確認レポート (Phase 2H 暫定)</h1>
  <div class="meta-line">
    生成: ${isoNow} / SCRAPE_INTERVAL_MS=${process.env.SCRAPE_INTERVAL_MS}ms / 対象 ${results.length} レース / 取得合計 ${totalFetchSec}秒
  </div>
  ${sections}
  <section>
    <h2>次フェーズ提案</h2>
    <ul class="note">
      <li>本番取得が機能しているなら <b>Phase 2H 本格チューニング (WEIGHTS 再最適化)</b> に進める状態。
        ただしバックテストはタイムリーキ問題があるため週次収集の蓄積が必要。</li>
      <li>pastRaces 取得率 &lt; 90% / 健全性 NG / 重賞補正未発動 等が観察された場合は別途対処。</li>
    </ul>
  </section>
</div>
</body>
</html>`;
}

function buildRaceSection(r: ProcessResult): string {
  const newScores = r.newScored.horses.map((h) => h.score ?? 0);
  const oldScores = r.oldScored.horses.map((h) => h.score ?? 0);
  const newEvs = r.newScored.horses.map((h) => h.ev ?? 0).filter((v) => v > 0);
  const oldEvs = r.oldScored.horses.map((h) => h.ev ?? 0).filter((v) => v > 0);

  const horseRows = r.race.horses.map((h) => {
    const newH = r.newScored.horses.find((x) => x.id === h.id)!;
    const oldH = r.oldScored.horses.find((x) => x.id === h.id)!;
    const newC = r.newComps.get(h.id)!;
    const oldC = r.oldComps.get(h.id)!;
    const realLast3F = h.pastRaces?.[0]?.lastThreeF;
    const scoreDiff = (newH.score ?? 0) - (oldH.score ?? 0);
    return `<tr>
      <td class="num">${h.id}</td>
      <td>${escapeHtml(h.name)}</td>
      <td class="num">${h.odds.toFixed(1)}</td>
      <td class="num">${h.lastThreeF.toFixed(1)}</td>
      <td class="num">${realLast3F !== undefined ? realLast3F.toFixed(1) : '—'}</td>
      <td class="num">${h.pastRaces?.length ?? 0}</td>
      <td class="num">${oldC.courseRecord.toFixed(1)}</td>
      <td class="num">${newC.courseRecord.toFixed(1)}</td>
      <td class="num">${oldC.lastThreeF.toFixed(1)}</td>
      <td class="num">${newC.lastThreeF.toFixed(1)}</td>
      <td class="num">${oldC.training.toFixed(1)}</td>
      <td class="num">${newC.training.toFixed(1)}</td>
      <td class="num">${(oldH.score ?? 0).toFixed(1)}</td>
      <td class="num">${(newH.score ?? 0).toFixed(1)}</td>
      <td class="num" style="color:${scoreDiff > 0 ? '#2f855a' : scoreDiff < 0 ? '#c53030' : '#718096'}">${scoreDiff >= 0 ? '+' : ''}${scoreDiff.toFixed(1)}</td>
      <td class="num">${(oldH.ev ?? 0).toFixed(3)}</td>
      <td class="num">${(newH.ev ?? 0).toFixed(3)}</td>
    </tr>`;
  }).join('');

  return `<section>
    <h2>${escapeHtml(r.type)}: ${escapeHtml(r.label)}</h2>
    <div class="meta-line">raceId=${r.raceId} / レース名=${escapeHtml(r.race.name)} / グレード=${r.race.raceGrade ?? '未設定'} / 取得時間=${(r.fetchMs / 1000).toFixed(1)}秒</div>

    <div class="stakes-note"><b>重賞補正</b>: ${escapeHtml(r.prevYearStakesNote)}</div>

    <h3>取得サマリ</h3>
    <div class="summary-grid">
      <div class="summary-card"><div class="label">pastRaces 取得率</div><div class="value">${r.pastRacesCoverage.withPastRaces}/${r.pastRacesCoverage.total} (${(r.pastRacesCoverage.rate * 100).toFixed(1)}%)</div></div>
      <div class="summary-card"><div class="label">未取得馬番</div><div class="value" style="font-size:0.85rem">${r.pastRacesCoverage.missingHorseIds.length === 0 ? 'なし' : '[' + r.pastRacesCoverage.missingHorseIds.join(', ') + ']'}</div></div>
      <div class="summary-card"><div class="label">スコア中央値 (旧→新)</div><div class="value">${median(oldScores).toFixed(1)} → ${median(newScores).toFixed(1)}</div></div>
      <div class="summary-card"><div class="label">スコア最大 (旧→新)</div><div class="value">${Math.max(...oldScores).toFixed(1)} → ${Math.max(...newScores).toFixed(1)}</div></div>
      <div class="summary-card"><div class="label">スコア最小 (旧→新)</div><div class="value">${Math.min(...oldScores).toFixed(1)} → ${Math.min(...newScores).toFixed(1)}</div></div>
      <div class="summary-card"><div class="label">スコア標準偏差 (旧→新)</div><div class="value">${std(oldScores).toFixed(2)} → ${std(newScores).toFixed(2)}</div></div>
      <div class="summary-card"><div class="label">EV中央値 (旧→新)</div><div class="value">${median(oldEvs).toFixed(3)} → ${median(newEvs).toFixed(3)}</div></div>
      <div class="summary-card"><div class="label">健全性 (旧/新)</div><div class="value"><span class="${r.oldHealth ? 'ok' : 'ng'}">${r.oldHealth ? 'OK' : 'NG'}</span> / <span class="${r.newHealth ? 'ok' : 'ng'}">${r.newHealth ? 'OK' : 'NG'}</span></div></div>
    </div>

    <h3>馬別比較 (旧 = pastRaces 無効, 新 = pastRaces 有効)</h3>
    <table>
      <thead><tr>
        <th class="num">馬番</th><th>馬名</th><th class="num">オッズ</th>
        <th class="num">調教<br>近似秒</th><th class="num">前走<br>上3F</th><th class="num">過去<br>走数</th>
        <th class="num">CR旧</th><th class="num">CR新</th>
        <th class="num">L3F旧</th><th class="num">L3F新</th>
        <th class="num">Tr旧</th><th class="num">Tr新</th>
        <th class="num">スコア<br>旧</th><th class="num">スコア<br>新</th><th class="num">差</th>
        <th class="num">EV旧</th><th class="num">EV新</th>
      </tr></thead>
      <tbody>${horseRows}</tbody>
    </table>
    <p class="note">CR=courseRecord, L3F=scoreLastThreeF (前走実走上3F由来), Tr=scoreTraining (調教近似秒由来)。</p>
  </section>`;
}

main().catch((e) => {
  console.error('[verify_prod] 致命的エラー:', e);
  process.exit(1);
});
