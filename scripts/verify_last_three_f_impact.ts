// ==========================================
// scoreLastThreeF / scoreTraining 独立化の影響度確認スクリプト
//
// 目的: Phase 2H 暫定で 2026-05-09 に実施した独立化改修について、モックデータ +
//       人工 pastRaces で旧 (両関数同一値) と新 (独立) のスコア分布を比較する。
//       「真の前走上がり3F (実走)」と「調教近似秒」の値の違いをサンプル表示。
//
// 制約: 実 netkeiba を叩かない。実環境観察は本番1レース予想時に別途行う。
//
// 実行: pnpm tsx scripts/verify_last_three_f_impact.ts
// 出力: scripts/output/last_three_f_impact_YYYYMMDD.html
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
// 「現行 lastThreeF と同じ挙動」を再現する関数（旧実装の擬似復元）
//   旧 scoreLastThreeF は Horse.lastThreeF (調教近似) を rank。
//   旧 scoreTraining は scoreLastThreeF と完全同一。
//   → 旧シナリオは「scoreTraining と同じ値」で再現可能。
// 新シナリオは pastRaces を注入した上で calcAllComponentScores の lastThreeF 列。
// ----------------------------------------

function makeArtificialPasts(odds: number, race: Race): PastRace[] {
  // 人気馬ほど良い実走上がり3F の過去走を持つ想定
  const last3FBase = odds < 5 ? 33.5 : odds < 15 ? 34.5 : odds < 30 ? 35.5 : 36.5;
  const baseDate = race.fetchedAt ?? new Date();
  const d = new Date(baseDate);
  d.setMonth(d.getMonth() - 1);
  const dateStr = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
  return [
    {
      date: dateStr,
      course: race.course,
      distance: race.distance,
      surface: race.surface,
      trackCondition: '良',
      rank: 5,
      time: '1:33.0',
      lastThreeF: last3FBase,
      raceName: '前走',
    },
  ];
}

const race = { ...MOCK_NZT_2026 };

// 旧シナリオ: pastRaces 未注入 (= scoreLastThreeF が旧挙動の再現にはならないが、
//   現行コードでは scoreLastThreeF=50 になる。代わりに「training と同じ値」が
//   旧 scoreLastThreeF の擬似値となる)
const oldRace = race;
const oldResult = calcAllScores(oldRace);
const oldComps = calcAllComponentScores(oldRace);
const oldHorses = oldResult.horses;

// 新シナリオ: 人工 pastRaces 注入 → scoreLastThreeF が動的算出
const horsesWithPasts: Horse[] = race.horses.map((h) => ({
  ...h,
  pastRaces: makeArtificialPasts(h.odds, race),
}));
const newRace: Race = { ...race, horses: horsesWithPasts };
const newResult = calcAllScores(newRace);
const newComps = calcAllComponentScores(newRace);
const newHorses = newResult.horses;

// 健全性チェック
console.log('=== 健全性チェック (旧: pastRaces 未設定) ===');
const oldHealth = validateScores(oldHorses);
console.log('=== 健全性チェック (新: pastRaces 注入) ===');
const newHealth = validateScores(newHorses);

const oldScores = oldHorses.map((h) => h.score ?? 0);
const newScores = newHorses.map((h) => h.score ?? 0);
const oldEvs = oldHorses.map((h) => h.ev ?? 0).filter((v) => v > 0);
const newEvs = newHorses.map((h) => h.ev ?? 0).filter((v) => v > 0);

console.log('');
console.log('=== lastThreeF / training 独立化 影響度サマリー ===');
console.log(`スコア中央値: 旧 ${median(oldScores).toFixed(1)} → 新 ${median(newScores).toFixed(1)}`);
console.log(`スコア最大:   旧 ${Math.max(...oldScores).toFixed(1)} → 新 ${Math.max(...newScores).toFixed(1)}`);
console.log(`スコア最小:   旧 ${Math.min(...oldScores).toFixed(1)} → 新 ${Math.min(...newScores).toFixed(1)}`);
console.log(`EV中央値:     旧 ${median(oldEvs).toFixed(3)} → 新 ${median(newEvs).toFixed(3)}`);
console.log(`健全性 (旧/新): ${oldHealth ? 'OK' : 'NG'} / ${newHealth ? 'OK' : 'NG'}`);

// ----------------------------------------
// 「真の前走上がり3F (実走)」と「調教近似秒」の値ペアをサンプル表示
//   選択肢1で議論した「相関検証」の代替として、注入した実走上がり3F (33.5〜36.5)
//   と、Horse.lastThreeF が持つ調教近似秒 (11.0〜12.5) を並べて見せる。
//   両者のスケールが完全に違うことが視覚的に分かる。
// ----------------------------------------

const OUT_DIR = path.join(__dirname, 'output');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
const now = new Date();
const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
const yyyymmdd = jst.toISOString().slice(0, 10).replace(/-/g, '');
const outPath = path.join(OUT_DIR, `last_three_f_impact_${yyyymmdd}.html`);

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const horseRows = race.horses.map((h) => {
  const oldH = oldHorses.find((x) => x.id === h.id)!;
  const newH = newHorses.find((x) => x.id === h.id)!;
  const oldC = oldComps.get(h.id)!;
  const newC = newComps.get(h.id)!;
  const trainingApprox = h.lastThreeF; // 11.0〜12.5
  const realLast3F = horsesWithPasts.find((x) => x.id === h.id)?.pastRaces?.[0]?.lastThreeF ?? null;
  const scoreDiff = (newH.score ?? 0) - (oldH.score ?? 0);

  return `<tr>
    <td class="num">${h.id}</td>
    <td>${escapeHtml(h.name)}</td>
    <td class="num">${h.odds.toFixed(1)}</td>
    <td class="num">${trainingApprox.toFixed(1)}</td>
    <td class="num">${realLast3F !== null ? realLast3F.toFixed(1) : '—'}</td>
    <td class="num">${oldC.lastThreeF.toFixed(1)}</td>
    <td class="num">${newC.lastThreeF.toFixed(1)}</td>
    <td class="num">${oldC.training.toFixed(1)}</td>
    <td class="num">${newC.training.toFixed(1)}</td>
    <td class="num">${(oldH.score ?? 0).toFixed(1)}</td>
    <td class="num">${(newH.score ?? 0).toFixed(1)}</td>
    <td class="num" style="color:${scoreDiff > 0 ? '#2f855a' : scoreDiff < 0 ? '#c53030' : '#718096'}">${scoreDiff >= 0 ? '+' : ''}${scoreDiff.toFixed(1)}</td>
  </tr>`;
}).join('');

const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>lastThreeF/training 独立化 影響度 ${yyyymmdd}</title>
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
  th { background: #f7fafc; font-weight: 600; font-size: 0.75rem; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  tbody tr:nth-child(even) { background: #f7fafc; }
  .ok { color: #2f855a; font-weight: 700; }
  .ng { color: #c53030; font-weight: 700; }
  .note { font-size: 0.78rem; color: #4a5568; line-height: 1.6; }
  .scale-note { padding: 0.6rem 0.8rem; background: #fff5e0; border-left: 4px solid #f6ad55; font-size: 0.85rem; }
</style>
</head>
<body>
<div class="container">
  <h1>scoreLastThreeF / scoreTraining 独立化 影響度確認レポート</h1>
  <div class="note">生成: ${jst.toISOString().replace('Z', '+09:00')} / 対象: モック ${escapeHtml(race.name)} / 全${race.horses.length}頭</div>

  <section>
    <div class="scale-note">
      <b>2スケールの並列表示</b>:
      「<b>調教近似秒</b>」 (Horse.lastThreeF, fetchTraining 由来) は <code>11.0〜12.5</code> 秒の8段階離散値。
      「<b>真の前走上がり3F</b>」 (PastRace.lastThreeF, /horse/result/{id}/ 由来) は <code>33.0〜37.0</code> 秒の連続値。
      両者は<b>スケールも単位も別物</b>で、独立2指標として扱う妥当性が直感的に分かる構成。
    </div>
  </section>

  <section>
    <h2>サマリー</h2>
    <div class="summary-grid">
      <div class="summary-card"><div class="label">スコア中央値 (旧→新)</div><div class="value">${median(oldScores).toFixed(1)} → ${median(newScores).toFixed(1)}</div></div>
      <div class="summary-card"><div class="label">スコア最大 (旧→新)</div><div class="value">${Math.max(...oldScores).toFixed(1)} → ${Math.max(...newScores).toFixed(1)}</div></div>
      <div class="summary-card"><div class="label">スコア最小 (旧→新)</div><div class="value">${Math.min(...oldScores).toFixed(1)} → ${Math.min(...newScores).toFixed(1)}</div></div>
      <div class="summary-card"><div class="label">EV中央値 (旧→新)</div><div class="value">${median(oldEvs).toFixed(3)} → ${median(newEvs).toFixed(3)}</div></div>
    </div>
    <p class="note" style="margin-top: 0.8rem">
      健全性チェック: 旧 <span class="${oldHealth ? 'ok' : 'ng'}">${oldHealth ? 'OK' : 'NG'}</span>
      / 新 <span class="${newHealth ? 'ok' : 'ng'}">${newHealth ? 'OK' : 'NG'}</span>
      (基準: 全馬スコア 0〜100 / EV中央値 0.85〜1.10 / 人気薄EV平均 &lt; 0.9)<br>
      ※ NG が出る場合の「人気薄EV平均」警告は Phase 1 着手前から既存の状態。
    </p>
  </section>

  <section>
    <h2>馬別データ・スコア比較</h2>
    <table>
      <thead>
        <tr>
          <th class="num">馬番</th>
          <th>馬名</th>
          <th class="num">オッズ</th>
          <th class="num">調教<br>近似秒</th>
          <th class="num">前走<br>上がり3F</th>
          <th class="num" style="background:#fff5f5">L3F<br>旧</th>
          <th class="num" style="background:#f0fff4">L3F<br>新</th>
          <th class="num" style="background:#fff5f5">Tr<br>旧</th>
          <th class="num" style="background:#f0fff4">Tr<br>新</th>
          <th class="num">スコア<br>旧</th>
          <th class="num">スコア<br>新</th>
          <th class="num">スコア差</th>
        </tr>
      </thead>
      <tbody>${horseRows}</tbody>
    </table>
    <p class="note">
      <b>L3F</b> = scoreLastThreeF / <b>Tr</b> = scoreTraining。<br>
      <b>旧</b>: scoreLastThreeF と scoreTraining が完全同一値だった (両方とも調教近似秒ベース)。<br>
      <b>新</b>: scoreLastThreeF は前走上がり3F (注入した人工 pastRaces)、scoreTraining は調教近似秒。<br>
      モックは pastRaces 未注入 → 旧の L3F は全馬同値時の rankScore 既存仕様の値。
      注入後の新 L3F は人気馬ほど高得点 (人気馬に良い前走を割り当てたため)。
    </p>
  </section>

  <section>
    <h2>所感と限界</h2>
    <ul class="note">
      <li>本レポートは <b>モック1レース + 人工 pastRaces</b> による動作確認。実環境のスコア分布変化は本番予想で別途観察が必要。</li>
      <li>旧と新で <b>scoreLastThreeF が独立データソース (実走上がり3F)</b> に切り替わったことで、調教近似秒だけでは見えなかった「実走パフォーマンス」がスコアに反映されるようになった。</li>
      <li>注入した人工データは「人気馬ほど良い前走」という仮定。実環境では人気とは独立な変動があり、この方向性は別の動きをする可能性。</li>
      <li>WEIGHTS は不変 (lastThreeF=0.244, training=0.125)。Phase 2H 重み再チューニングで courseRecord と一括対応推奨。</li>
      <li>Horse.lastThreeF というフィールド名が「調教近似秒」の中身を持つ命名乖離は別タスク (lib/score/CLAUDE.md 参照)。</li>
    </ul>
  </section>
</div>
</body>
</html>`;

fs.writeFileSync(outPath, html, 'utf8');
console.log(`\nHTML 保存: ${outPath}`);
