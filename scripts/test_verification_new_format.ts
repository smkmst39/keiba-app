// ==========================================
// 新形式 JSON での calcAllScores smoke test (Phase 2H D-1 / C3)
//
// 目的:
//   コミット 877438d (collect-verification.ts で pastRaces 保存) で作られる
//   新形式 JSON が、JSON ラウンドトリップを経ても calcAllScores で正しく
//   動作することを実証する。
//
// テスト内容:
//   C3-1: 人工 VerificationData を JSON 書き出し → 読み戻しでフィールド復元
//   C3-2: 復元した predictions から Horse 再構築 → calcAllScores が
//         courseRecord/lastThreeF を 50 フォールバックではなく動的算出
//
// 実 netkeiba は叩かない (オフライン smoke test)。
//
// 実行: pnpm tsx scripts/test_verification_new_format.ts
// ==========================================

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { calcAllComponentScores } from '../lib/score/calculator';
import type { VerificationData, Horse, Race, RaceResult } from '../lib/scraper/types';
import type { PastRace } from '../lib/scraper/horse_history';

let pass = 0;
let fail = 0;

function assert(cond: boolean, name: string, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function pastTemplate(last3F: number, rank: number): PastRace {
  return {
    date: '2025/03/15',
    course: '中山',
    distance: 1600,
    surface: 'turf',
    trackCondition: '良',
    rank,
    time: '1:33.0',
    lastThreeF: last3F,
    raceName: '4歳以上1勝クラス',
  };
}

// 人工 VerificationData (新形式 = pastRaces 込み)
function makeArtificialVerification(): VerificationData {
  const emptyResult: RaceResult = {
    raceId: '202506030411',
    results: [],
    payouts: { tan: [], umaren: [], sanfuku: [], santan: [] },
  };
  return {
    raceId: '202506030411',
    raceName: '4歳以上2勝クラス',
    date: '2025-04-19',
    predictions: [
      {
        horseId: 1, horseName: '速い馬', score: 70, ev: 1.0, odds: 3.5,
        waku: 1, jockey: '武豊',
        pastRaces: [pastTemplate(33.0, 1), pastTemplate(33.5, 2)],
      },
      {
        horseId: 2, horseName: '中央', score: 60, ev: 0.95, odds: 5.0,
        waku: 2, jockey: '川田',
        pastRaces: [pastTemplate(35.0, 3)],
      },
      {
        horseId: 3, horseName: '遅い馬', score: 50, ev: 0.85, odds: 8.0,
        waku: 3, jockey: '吉田',
        pastRaces: [pastTemplate(37.0, 10)],
      },
    ],
    results: emptyResult,
    accuracy: { top1ScoreRank: 0, top3EVCount: 0, recommendedHits: [] },
  };
}

// =============================
// C3-1: JSON ラウンドトリップ (書き出し → 読み戻し)
// =============================
console.log('\n=== C3-1: JSON ラウンドトリップ ===');
const tmpFile = path.join(os.tmpdir(), 'test_verification_new_format.json');
const original = makeArtificialVerification();
fs.writeFileSync(tmpFile, JSON.stringify(original, null, 2), 'utf8');

const reloaded: VerificationData = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
assert(reloaded.predictions.length === 3, 'C3-1.1 predictions 3頭を保持');
assert(reloaded.predictions[0].pastRaces?.length === 2, 'C3-1.2 1頭目の pastRaces 2走を復元');
assert(reloaded.predictions[0].pastRaces?.[0].lastThreeF === 33.0,
  'C3-1.3 pastRaces[0].lastThreeF=33.0 を復元');
assert(reloaded.predictions[2].pastRaces?.[0].rank === 10,
  'C3-1.4 pastRaces[0].rank=10 を復元');
assert(reloaded.predictions[0].waku === 1, 'C3-1.5 waku 復元');
assert(reloaded.predictions[0].jockey === '武豊', 'C3-1.6 jockey 復元');

// =============================
// C3-2: 新形式 JSON で calcAllScores が courseRecord/lastThreeF を動的算出
// =============================
console.log('\n=== C3-2: 新形式 JSON で動的算出 ===');
const horses: Horse[] = reloaded.predictions.map((p) => ({
  id: p.horseId, name: p.horseName,
  waku: p.waku ?? 1, odds: p.odds,
  fukuOddsMin: 0, fukuOddsMax: 0,
  jockey: p.jockey ?? '', trainer: '',
  weight: 0, weightDiff: 0,
  lastThreeF: 11.5, // 調教近似秒 (scoreTraining 用)
  pastRaces: p.pastRaces,
}));
const race: Race = {
  raceId: reloaded.raceId,
  name: reloaded.raceName,
  course: '中山',
  distance: 1600,
  surface: 'turf',
  horses,
  fetchedAt: new Date(),
  raceDate: reloaded.date.replace(/-/g, ''),
};

const comps = calcAllComponentScores(race);
const c1 = comps.get(1)!;
const c3 = comps.get(3)!;

// 1頭目: 同条件過去走2走 (rank=1,2 + 上3F 33.0,33.5) → courseRecord 高い
assert(c1.courseRecord !== 50,
  `C3-2.1 馬1 courseRecord != 50 (動的算出された) — got ${c1.courseRecord.toFixed(2)}`);
assert(c1.courseRecord > 60,
  `C3-2.2 馬1 courseRecord > 60 (好走馬) — got ${c1.courseRecord.toFixed(2)}`);

// 3頭目: 過去1走のみ rank=10 上3F=37.0 → courseRecord 低い
assert(c3.courseRecord !== 50,
  `C3-2.3 馬3 courseRecord != 50 — got ${c3.courseRecord.toFixed(2)}`);
assert(c3.courseRecord < c1.courseRecord,
  `C3-2.4 馬3 courseRecord < 馬1 courseRecord — got ${c3.courseRecord.toFixed(2)} < ${c1.courseRecord.toFixed(2)}`);

// scoreLastThreeF: pastRaces[0].lastThreeF ベース
// 馬1=33.0 (最速→100), 馬3=37.0 (最遅→0)
assert(c1.lastThreeF === 100, `C3-2.5 馬1 lastThreeF = 100 (最速) — got ${c1.lastThreeF}`);
assert(c3.lastThreeF === 0, `C3-2.6 馬3 lastThreeF = 0 (最遅) — got ${c3.lastThreeF}`);

console.log(`\n[C3] 一時 JSON: ${tmpFile}`);

console.log('\n========================================');
console.log(`合計: pass ${pass} / fail ${fail}`);
console.log('========================================');
process.exit(fail > 0 ? 1 : 0);
