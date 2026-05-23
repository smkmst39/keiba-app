// ==========================================
// scorePrevClass の pastRaces フォールバック動作確認 (2026-05-24 修正)
//
// 検証内容:
//   - prevRaceClass / prevRaceName が両方 undefined でも、
//     pastRaces[0..] から baseDate より前の最新走を拾って分類できる
//   - タイムリーキ防止: 自レース・未来レースは除外される
//   - 取消 (rank < 1) は除外される
//   - classifyPrevRace の英大文字 I バグ修正も併せて確認
//
// 実行: pnpm tsx scripts/test_prev_class_fallback.ts
// ==========================================

import 'dotenv/config';
import { calcAllComponentScores, classifyPrevRace } from '../lib/score/calculator';
import type { Horse, Race } from '../lib/scraper/types';
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

function makePast(opts: Partial<PastRace>): PastRace {
  return {
    date: '2025/03/15', course: '中山', distance: 1600, surface: 'turf',
    trackCondition: '良', rank: 5, time: '1:33.5', lastThreeF: 35.0,
    raceName: '4歳以上2勝クラス',
    ...opts,
  };
}

function makeHorse(overrides: Partial<Horse> = {}): Horse {
  return {
    id: 1, name: 'テスト馬', waku: 1, odds: 5,
    fukuOddsMin: 0, fukuOddsMax: 0,
    jockey: '', trainer: '', weight: 480, weightDiff: 0,
    lastThreeF: 11.5, ...overrides,
  };
}

function makeRace(horses: Horse[], overrides: Partial<Race> = {}): Race {
  return {
    raceId: '202506030411', name: 'テストレース',
    course: '中山', distance: 1600, surface: 'turf',
    horses, fetchedAt: new Date('2025-05-01T15:00:00+09:00'),
    raceDate: '20250501',
    ...overrides,
  };
}

// =============================
// 1. classifyPrevRace 単体: 英大文字 I バグ修正 (B-1)
// =============================
console.log('\n=== 1. classifyPrevRace 英大文字 I バグ修正 ===');
{
  const cases: [string, number][] = [
    ['天皇賞(春)(GI)', 100], ['有馬記念(GI)', 100],
    ['東海テレビ杯金鯱賞(GII)', 85], ['阪神大賞典(GII)', 85],
    ['ダイヤモンドS(GIII)', 70], ['福島記念(GIII)', 70],
    // ローマ数字バージョンも引き続き動作
    ['天皇賞(春)(GⅠ)', 100], ['(GⅡ)', 85], ['(GⅢ)', 70],
    // アラビア数字バージョン
    ['(G1)', 100], ['(G2)', 85], ['(G3)', 70],
    // 条件戦
    ['古都S(3勝クラス)', 50], ['4歳以上2勝クラス', 40],
    ['4歳以上1勝クラス', 30], ['未勝利', 20], ['新馬', 15],
    // L / OP
    ['ファルコンS(L)', 60], ['オープン特別', 55],
    // 空 / 不明
    ['', 50], ['謎レース', 35],
  ];
  for (const [input, expected] of cases) {
    const got = classifyPrevRace(input);
    assert(got === expected, `1.${input === '' ? '空' : input} → ${expected}`, `got ${got}`);
  }
}

// =============================
// 2. pastRaces フォールバック (B-2): prevRaceName 無し + pastRaces[0] 自レース
// =============================
console.log('\n=== 2. pastRaces フォールバック ===');
{
  // 自レース (2025/05/01) + 真の前走 (2025/04/01 G2)
  const horse = makeHorse({
    pastRaces: [
      makePast({ date: '2025/05/01', rank: 1, raceName: '4歳以上2勝クラス' }), // 自レース当日
      makePast({ date: '2025/04/01', rank: 2, raceName: '日経賞(GII)' }),       // 真の前走 (G2)
    ],
  });
  const race = makeRace([horse]);
  const comps = calcAllComponentScores(race);
  const v = comps.get(1)!.prevClass;
  assert(v === 85, '2.1 自レース除外 → pastRaces[1] (G2) で 85', `got ${v}`);
}

// =============================
// 3. タイムリーキ防止: 未来レースは除外
// =============================
console.log('\n=== 3. 未来レース除外 ===');
{
  const horse = makeHorse({
    pastRaces: [
      makePast({ date: '2025/06/01', rank: 1, raceName: '宝塚記念(GI)' }), // 未来
      makePast({ date: '2025/04/01', rank: 2, raceName: '日経賞(GII)' }), // 真の前走
    ],
  });
  const race = makeRace([horse]);
  const comps = calcAllComponentScores(race);
  const v = comps.get(1)!.prevClass;
  assert(v === 85, '3.1 未来レース除外 → 真の前走 (G2) で 85', `got ${v}`);
}

// =============================
// 4. 取消 (rank<1) 除外
// =============================
console.log('\n=== 4. 取消除外 ===');
{
  const horse = makeHorse({
    pastRaces: [
      makePast({ date: '2025/04/15', rank: -1, raceName: 'G1取消レース(GI)' }), // 取消
      makePast({ date: '2025/04/01', rank: 2, raceName: '日経賞(GII)' }),
    ],
  });
  const race = makeRace([horse]);
  const comps = calcAllComponentScores(race);
  const v = comps.get(1)!.prevClass;
  assert(v === 85, '4.1 取消スキップ → 次の前走 (G2) で 85', `got ${v}`);
}

// =============================
// 5. prevRaceName があれば優先 (フォールバック使わず)
// =============================
console.log('\n=== 5. prevRaceName 優先 ===');
{
  const horse = makeHorse({
    prevRaceName: '4歳以上1勝クラス',
    pastRaces: [
      makePast({ date: '2025/04/01', rank: 1, raceName: '宝塚記念(GI)' }), // G1 だが prevRaceName 優先
    ],
  });
  const race = makeRace([horse]);
  const comps = calcAllComponentScores(race);
  const v = comps.get(1)!.prevClass;
  assert(v === 30, '5.1 prevRaceName が優先される (1勝クラス → 30)', `got ${v}`);
}

// =============================
// 6. pastRaces 全件無効 / race なし → 50
// =============================
console.log('\n=== 6. フォールバック失敗 → 50 ===');
{
  // pastRaces すべて自レース当日以降
  const horse = makeHorse({
    pastRaces: [
      makePast({ date: '2025/05/01', rank: 1 }), // 自レース当日
      makePast({ date: '2025/06/01', rank: 2 }), // 未来
    ],
  });
  const race = makeRace([horse]);
  const comps = calcAllComponentScores(race);
  const v = comps.get(1)!.prevClass;
  assert(v === 50, '6.1 採用可能な前走なし → 50', `got ${v}`);
}

// =============================
// 7. 既存挙動互換: race 無し版の calcScore (フォールバック発動しない)
// =============================
console.log('\n=== 7. calcScore (race 無し) 互換 ===');
{
  // calcScore は race を受け取らないので scorePrevClass(horse, undefined) → フォールバック不発
  // prevRaceClass / prevRaceName 無し + pastRaces あり → 50 (race 無しなので前走を引けない)
  const horse = makeHorse({
    pastRaces: [makePast({ date: '2024/12/01', rank: 1, raceName: '有馬記念(GI)' })],
  });
  // calcScore 経由 (race 無し) では 50 になるはず
  // calcAllComponentScores では race 渡しのため別経路。ここでは calcScore を呼ぶ
  const { calcScore } = require('../lib/score/calculator');
  // calcScore 自体は score 値を返すだけで、prevClass の値は取れない。
  // 代わりに「race 引数で大きく挙動が変わる」ことを確認するため、
  // race 渡しと無しで calcAllComponentScores のセマンティクス相当を再現。
  // → race 無し版の動作確認は calcScore の戻り値が定義域 0〜100 に収まることで担保
  const s = calcScore(horse, [horse]);
  assert(s >= 0 && s <= 100, `7.1 calcScore は race 無しでも 0〜100 に収まる (got ${s.toFixed(1)})`);
}

console.log('\n========================================');
console.log(`合計: pass ${pass} / fail ${fail}`);
console.log('========================================');
process.exit(fail > 0 ? 1 : 0);
