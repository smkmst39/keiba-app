// ==========================================
// scoreCourseRecord 影響度確認スクリプト
//
// 目的: courseRecord 旧 (全馬50固定) vs 新 (実装版) でスコア分布の変化、
//       kikenHorses 数の変化、健全性チェックの維持を可視化する。
//
// 制約: 実 netkeiba を叩かず、モックデータ (NZT 2026) + 人工 pastRaces
//       で動作確認する。実環境での確認は本番1レース予想時に別途行う。
//
// 実行: pnpm tsx scripts/verify_course_record_impact.ts
// 出力: scripts/output/course_record_impact_YYYYMMDD.html
// ==========================================

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { MOCK_NZT_2026 } from '../lib/scraper/__mocks__/202606030511';
import {
  calcAllScores,
  calcAllComponentScores,
  validateScores,
  median,
  mean,
} from '../lib/score/calculator';
import type { Horse, Race } from '../lib/scraper/types';
import type { PastRace } from '../lib/scraper/horse_history';

// ----------------------------------------
// 人工 pastRaces 生成
//   オッズ低い (人気馬) ほど好成績の過去走を持つ想定。
//   モックデータでスコアの動きを観察するための合成データ。
// ----------------------------------------
function makeArtificialPasts(odds: number, race: Race): PastRace[] {
  const rankBase = odds < 5 ? 2 : odds < 15 ? 3 : odds < 30 ? 5 : 8;
  const last3FBase = odds < 5 ? 33.0 : odds < 15 ? 34.0 : odds < 30 ? 35.0 : 36.5;
  const baseDate = race.fetchedAt ?? new Date();
  return [0, 1, 2].map((i) => {
    const d = new Date(baseDate);
    d.setMonth(d.getMonth() - (i + 1) * 2);
    const dateStr = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
    return {
      date: dateStr,
      course: race.course,
      distance: race.distance,
      surface: race.surface,
      trackCondition: '良',
      rank: rankBase + (i % 2),
      time: '1:33.0',
      lastThreeF: last3FBase + i * 0.2,
      raceName: '同条件・条件戦',
    };
  });
}

// ----------------------------------------
// 集計
// ----------------------------------------
function calcPopRanks(horses: Horse[]): Map<number, number> {
  const sorted = [...horses].filter((h) => h.odds > 0).sort((a, b) => a.odds - b.odds);
  const m = new Map<number, number>();
  sorted.forEach((h, i) => m.set(h.id, i + 1));
  return m;
}

function isKiken(h: Horse, pop: number): boolean {
  return pop <= 3 && ((h.ev ?? 0) < 0.85 || (h.score ?? 0) < 55);
}

const race = { ...MOCK_NZT_2026 };

// 旧: pastRaces 未設定 (= courseRecord 50固定)
const oldRace = race;
const oldResult = calcAllScores(oldRace);
const oldHorses = oldResult.horses;
const oldComps = calcAllComponentScores(oldRace);

// 新: 人工 pastRaces 注入
const horsesWithPasts: Horse[] = race.horses.map((h) => ({
  ...h,
  pastRaces: makeArtificialPasts(h.odds, race),
}));
const newRace: Race = { ...race, horses: horsesWithPasts };
const newResult = calcAllScores(newRace);
const newHorses = newResult.horses;
const newComps = calcAllComponentScores(newRace);

const oldPops = calcPopRanks(oldHorses);
const newPops = calcPopRanks(newHorses);

const oldKiken = oldHorses.filter((h) => isKiken(h, oldPops.get(h.id) ?? 99));
const newKiken = newHorses.filter((h) => isKiken(h, newPops.get(h.id) ?? 99));

// 健全性チェック (旧/新)
console.log('=== 健全性チェック (旧) ===');
const oldHealth = validateScores(oldHorses);
console.log('=== 健全性チェック (新) ===');
const newHealth = validateScores(newHorses);

// 統計
const oldScores = oldHorses.map((h) => h.score ?? 0);
const newScores = newHorses.map((h) => h.score ?? 0);
const oldEvs = oldHorses.map((h) => h.ev ?? 0).filter((v) => v > 0);
const newEvs = newHorses.map((h) => h.ev ?? 0).filter((v) => v > 0);

// ----------------------------------------
// レポート出力
// ----------------------------------------
const now = new Date();
const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
const yyyymmdd = jst.toISOString().slice(0, 10).replace(/-/g, '');

console.log('');
console.log('=== courseRecord 影響度サマリー ===');
console.log(`スコア中央値:  旧 ${median(oldScores).toFixed(1)} → 新 ${median(newScores).toFixed(1)}`);
console.log(`スコア平均:    旧 ${mean(oldScores).toFixed(1)} → 新 ${mean(newScores).toFixed(1)}`);
console.log(`スコア最大:    旧 ${Math.max(...oldScores).toFixed(1)} → 新 ${Math.max(...newScores).toFixed(1)}`);
console.log(`スコア最小:    旧 ${Math.min(...oldScores).toFixed(1)} → 新 ${Math.min(...newScores).toFixed(1)}`);
console.log(`EV中央値:      旧 ${median(oldEvs).toFixed(3)} → 新 ${median(newEvs).toFixed(3)}`);
console.log(`kikenHorses 数: 旧 ${oldKiken.length}頭 → 新 ${newKiken.length}頭`);
console.log(`健全性 (旧/新): ${oldHealth ? 'OK' : 'NG'} / ${newHealth ? 'OK' : 'NG'}`);

const OUT_DIR = path.join(__dirname, 'output');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
const outPath = path.join(OUT_DIR, `course_record_impact_${yyyymmdd}.html`);

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const horseRows = race.horses.map((h, _i) => {
  const oldH = oldHorses.find((x) => x.id === h.id)!;
  const newH = newHorses.find((x) => x.id === h.id)!;
  const oldC = oldComps.get(h.id)!;
  const newC = newComps.get(h.id)!;
  const oldPop = oldPops.get(h.id) ?? 99;
  const newPop = newPops.get(h.id) ?? 99;
  const oldKikenFlag = isKiken(oldH, oldPop);
  const newKikenFlag = isKiken(newH, newPop);
  const scoreDiff = (newH.score ?? 0) - (oldH.score ?? 0);
  const courseRecDiff = newC.courseRecord - oldC.courseRecord;
  return `<tr>
    <td class="num">${h.id}</td>
    <td>${escapeHtml(h.name)}</td>
    <td class="num">${h.odds.toFixed(1)}</td>
    <td class="num">${oldPop}</td>
    <td class="num">${oldC.courseRecord.toFixed(1)}</td>
    <td class="num">${newC.courseRecord.toFixed(1)}</td>
    <td class="num" style="color:${courseRecDiff > 0 ? '#2f855a' : courseRecDiff < 0 ? '#c53030' : '#718096'}">${courseRecDiff >= 0 ? '+' : ''}${courseRecDiff.toFixed(1)}</td>
    <td class="num">${(oldH.score ?? 0).toFixed(1)}</td>
    <td class="num">${(newH.score ?? 0).toFixed(1)}</td>
    <td class="num" style="color:${scoreDiff > 0 ? '#2f855a' : scoreDiff < 0 ? '#c53030' : '#718096'}">${scoreDiff >= 0 ? '+' : ''}${scoreDiff.toFixed(1)}</td>
    <td class="num">${(oldH.ev ?? 0).toFixed(3)}</td>
    <td class="num">${(newH.ev ?? 0).toFixed(3)}</td>
    <td class="kiken">${oldKikenFlag ? '⚠️' : ''}</td>
    <td class="kiken">${newKikenFlag ? '⚠️' : ''}</td>
  </tr>`;
}).join('');

const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>courseRecord 影響度確認 ${yyyymmdd}</title>
<style>
  body { font-family: system-ui, "Hiragino Sans", "Yu Gothic", sans-serif; padding: 1.5rem; background: #f7fafc; color: #1a202c; }
  .container { max-width: 1200px; margin: 0 auto; }
  h1 { font-size: 1.4rem; margin: 0 0 0.5rem; }
  h2 { font-size: 1.05rem; margin: 1.2rem 0 0.6rem; padding-bottom: 0.3rem; border-bottom: 2px solid #2b6cb0; color: #2b6cb0; }
  section { background: #fff; border-radius: 8px; padding: 1.2rem; margin-bottom: 1rem; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
  .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.8rem; }
  .summary-card { padding: 0.8rem; background: #f7fafc; border: 1px solid #e2e8f0; border-radius: 4px; }
  .summary-card .label { font-size: 0.7rem; color: #718096; }
  .summary-card .value { font-size: 1.1rem; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
  th, td { padding: 0.4rem 0.6rem; border-bottom: 1px solid #e2e8f0; text-align: left; }
  th { background: #f7fafc; font-weight: 600; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.kiken { text-align: center; }
  tbody tr:nth-child(even) { background: #f7fafc; }
  .ok { color: #2f855a; font-weight: 700; }
  .ng { color: #c53030; font-weight: 700; }
  .note { font-size: 0.78rem; color: #4a5568; line-height: 1.6; }
</style>
</head>
<body>
<div class="container">
  <h1>courseRecord 影響度確認レポート</h1>
  <div class="note">生成: ${jst.toISOString().replace('Z', '+09:00')} / 対象: モック ${escapeHtml(race.name)} / 全${race.horses.length}頭</div>

  <section>
    <h2>サマリー</h2>
    <div class="summary-grid">
      <div class="summary-card"><div class="label">スコア中央値 (旧→新)</div><div class="value">${median(oldScores).toFixed(1)} → ${median(newScores).toFixed(1)}</div></div>
      <div class="summary-card"><div class="label">スコア最大 (旧→新)</div><div class="value">${Math.max(...oldScores).toFixed(1)} → ${Math.max(...newScores).toFixed(1)}</div></div>
      <div class="summary-card"><div class="label">EV中央値 (旧→新)</div><div class="value">${median(oldEvs).toFixed(3)} → ${median(newEvs).toFixed(3)}</div></div>
      <div class="summary-card"><div class="label">危険人気馬数 (旧→新)</div><div class="value">${oldKiken.length} → ${newKiken.length}頭</div></div>
    </div>
    <p class="note" style="margin-top: 0.8rem">
      健全性チェック: 旧 <span class="${oldHealth ? 'ok' : 'ng'}">${oldHealth ? 'OK' : 'NG'}</span>
      / 新 <span class="${newHealth ? 'ok' : 'ng'}">${newHealth ? 'OK' : 'NG'}</span>
      (基準: 全馬スコア 0〜100 / EV中央値 0.85〜1.10 / 人気薄EV平均 &lt; 0.9)
    </p>
  </section>

  <section>
    <h2>馬別比較 (旧 = pastRaces 未設定 / 新 = 人工 pastRaces 注入)</h2>
    <table>
      <thead>
        <tr>
          <th class="num">馬番</th><th>馬名</th><th class="num">オッズ</th><th class="num">人気</th>
          <th class="num">CR旧</th><th class="num">CR新</th><th class="num">CR差</th>
          <th class="num">スコア旧</th><th class="num">スコア新</th><th class="num">差</th>
          <th class="num">EV旧</th><th class="num">EV新</th>
          <th>危旧</th><th>危新</th>
        </tr>
      </thead>
      <tbody>${horseRows}</tbody>
    </table>
    <p class="note">
      <b>CR</b> = courseRecord (重み 19.8%)。<br>
      <b>注入した人工データ</b>: 各馬3走、オッズ低い (人気) 馬ほど着順・上がり3F が良好な構成。
    </p>
  </section>

  <section>
    <h2>所感と限界</h2>
    <ul class="note">
      <li>本レポートは <b>モック1レース + 人工 pastRaces</b> による動作確認。実環境のスコア分布変化は本番予想で別途観察が必要。</li>
      <li>CR新の値は注入した人工 pastRaces で決まる: 人気馬ほど高得点・人気薄ほど低得点となる構成のため、score の人気間ギャップが拡大する方向。</li>
      <li>実環境では同条件マッチ率が下がる (= 多くの馬で CR=50 のまま) 可能性があり、本レポートほど大きな変化は出ない見込み。</li>
      <li>WEIGHTS は不変。courseRecord (0.198) の重みで CR 差分は最終 score の差分に乗る。Phase 2H で重み再チューニングが推奨。</li>
      <li>kikenHorses 増減: ${oldKiken.length === newKiken.length ? '変化なし' : (newKiken.length > oldKiken.length ? `増加 (+${newKiken.length - oldKiken.length})` : `減少 (-${oldKiken.length - newKiken.length})`)}。</li>
    </ul>
  </section>
</div>
</body>
</html>`;

fs.writeFileSync(outPath, html, 'utf8');
console.log(`\nHTML 保存: ${outPath}`);
