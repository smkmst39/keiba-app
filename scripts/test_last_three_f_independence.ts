// ==========================================
// scoreLastThreeF / scoreTraining 独立性テスト
// 実行: pnpm tsx scripts/test_last_three_f_independence.ts
//
// Phase 2H 暫定で 2026-05-09 に実施した「scoreLastThreeF を pastRaces[0]
// ベースに移行、scoreTraining は Horse.lastThreeF (調教近似秒) を直接使う」
// 改修の動作確認。両関数が独立データソースで動き、適切に異なる値を返すか
// 検証する。
// ==========================================

import 'dotenv/config';
import { calcAllComponentScores } from '../lib/score/calculator';
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

function approx(a: number, b: number, tol = 0.5): boolean {
  return Math.abs(a - b) <= tol;
}

function makePast(opts: Partial<PastRace> = {}): PastRace {
  return {
    date: '2026/04/01',
    course: '中山',
    distance: 1600,
    surface: 'turf',
    trackCondition: '良',
    rank: 5,
    time: '1:33.0',
    lastThreeF: 35.0,
    raceName: '条件戦',
    ...opts,
  };
}

function makeHorse(overrides: Partial<Horse> = {}): Horse {
  return {
    id: 1,
    name: 'テスト馬',
    waku: 1,
    odds: 5.0,
    fukuOddsMin: 1.5,
    fukuOddsMax: 2.5,
    jockey: 'テスト騎手',
    trainer: 'テスト調教師',
    weight: 480,
    weightDiff: 0,
    lastThreeF: 11.8, // 調教近似秒（並み）
    ...overrides,
  };
}

function makeRace(horses: Horse[], overrides: Partial<Race> = {}): Race {
  return {
    raceId: '202506030511',
    name: 'テストレース',
    course: '中山',
    distance: 1600,
    surface: 'turf',
    horses,
    fetchedAt: new Date('2026-05-01T15:00:00+09:00'),
    ...overrides,
  };
}

// =============================
// 1. pastRaces[0].lastThreeF が 33.0〜37.0 の範囲で適切にスコア化される
// =============================
console.log('\n=== 1. pastRaces[0].lastThreeF のスコア化 ===');
{
  const horses: Horse[] = [
    // 速い (33.0) → 高得点 (rank=最上位 → 100)
    makeHorse({ id: 1, lastThreeF: 11.8, pastRaces: [makePast({ lastThreeF: 33.0 })] }),
    // 中央 (35.0)
    makeHorse({ id: 2, lastThreeF: 11.8, pastRaces: [makePast({ lastThreeF: 35.0 })] }),
    // 遅い (37.0) → 低得点 (rank=最下位 → 0)
    makeHorse({ id: 3, lastThreeF: 11.8, pastRaces: [makePast({ lastThreeF: 37.0 })] }),
  ];
  const race = makeRace(horses);
  const comps = calcAllComponentScores(race);
  const v1 = comps.get(1)!.lastThreeF;
  const v2 = comps.get(2)!.lastThreeF;
  const v3 = comps.get(3)!.lastThreeF;
  assert(v1 === 100, `1.1 33.0秒の馬 → 100 (got ${v1})`);
  assert(v2 === 50, `1.2 35.0秒の馬 → 50 (got ${v2})`);
  assert(v3 === 0, `1.3 37.0秒の馬 → 0 (got ${v3})`);
}

// =============================
// 2. pastRaces 未取得時に全員 50 (フォールバック)
// =============================
console.log('\n=== 2. pastRaces 未取得時のフォールバック ===');
{
  const horses: Horse[] = [
    makeHorse({ id: 1, lastThreeF: 11.0 }), // pastRaces 無し
    makeHorse({ id: 2, lastThreeF: 11.5 }),
    makeHorse({ id: 3, lastThreeF: 12.0 }),
  ];
  const race = makeRace(horses);
  const comps = calcAllComponentScores(race);
  assert(comps.get(1)!.lastThreeF === 50, `2.1 全馬 pastRaces 未取得 → 50 (馬1: ${comps.get(1)!.lastThreeF})`);
  assert(comps.get(2)!.lastThreeF === 50, `2.2 全馬 pastRaces 未取得 → 50 (馬2: ${comps.get(2)!.lastThreeF})`);
  assert(comps.get(3)!.lastThreeF === 50, `2.3 全馬 pastRaces 未取得 → 50 (馬3: ${comps.get(3)!.lastThreeF})`);
}

// =============================
// 3. scoreLastThreeF と scoreTraining が異なる値を返す（核心）
// =============================
console.log('\n=== 3. 両関数が独立した値を返すこと（核心テスト）===');
{
  const horses: Horse[] = [
    // 馬1: 調教評価は最良 (11.0=手応勝る) だが、前走上がり3F は最遅 (37.0)
    makeHorse({ id: 1, lastThreeF: 11.0, pastRaces: [makePast({ lastThreeF: 37.0 })] }),
    // 馬2: 調教評価は普通 (11.8=並み)、前走上がり3F も普通 (35.0)
    makeHorse({ id: 2, lastThreeF: 11.8, pastRaces: [makePast({ lastThreeF: 35.0 })] }),
    // 馬3: 調教評価は最悪 (12.5=動き鈍い) だが、前走上がり3F は最速 (33.0)
    makeHorse({ id: 3, lastThreeF: 12.5, pastRaces: [makePast({ lastThreeF: 33.0 })] }),
  ];
  const race = makeRace(horses);
  const comps = calcAllComponentScores(race);

  // training は lastThreeF (調教近似) ベース: 馬1=最速→100, 馬2=中央→50, 馬3=最遅→0
  assert(comps.get(1)!.training === 100, `3.1 馬1の training (調教最良) → 100 (got ${comps.get(1)!.training})`);
  assert(comps.get(2)!.training === 50, `3.2 馬2の training → 50 (got ${comps.get(2)!.training})`);
  assert(comps.get(3)!.training === 0, `3.3 馬3の training (調教最悪) → 0 (got ${comps.get(3)!.training})`);

  // lastThreeF は pastRaces[0].lastThreeF ベース: 馬1=最遅→0, 馬2=中央→50, 馬3=最速→100
  assert(comps.get(1)!.lastThreeF === 0, `3.4 馬1の lastThreeF (前走最遅) → 0 (got ${comps.get(1)!.lastThreeF})`);
  assert(comps.get(2)!.lastThreeF === 50, `3.5 馬2の lastThreeF → 50 (got ${comps.get(2)!.lastThreeF})`);
  assert(comps.get(3)!.lastThreeF === 100, `3.6 馬3の lastThreeF (前走最速) → 100 (got ${comps.get(3)!.lastThreeF})`);

  // 馬1: training=100, lastThreeF=0 → 値が完全に異なる (重複解消の核心)
  assert(comps.get(1)!.training !== comps.get(1)!.lastThreeF,
    `3.7 馬1で training と lastThreeF が異なる値`);
  assert(comps.get(3)!.training !== comps.get(3)!.lastThreeF,
    `3.8 馬3で training と lastThreeF が異なる値`);
}

// =============================
// 4. 全馬同値時のフォールバック挙動
// =============================
console.log('\n=== 4. 全馬同値時の挙動 ===');
{
  // 全馬の pastRaces[0].lastThreeF が同じ → rankScore は機械的に 0..100 を割り振るが、
  // 値としては「同条件」のため意味は薄い。挙動を文書化する目的のテスト。
  const horses: Horse[] = [
    makeHorse({ id: 1, lastThreeF: 11.8, pastRaces: [makePast({ lastThreeF: 35.0 })] }),
    makeHorse({ id: 2, lastThreeF: 11.8, pastRaces: [makePast({ lastThreeF: 35.0 })] }),
    makeHorse({ id: 3, lastThreeF: 11.8, pastRaces: [makePast({ lastThreeF: 35.0 })] }),
  ];
  const race = makeRace(horses);
  const comps = calcAllComponentScores(race);
  // 全馬同値時、現行 rankScore は 100/50/0 を機械的に割り振る (安定ソート由来)
  // この挙動は scoreLastThreeF / scoreTraining 共通の既存仕様で本改修の範囲外
  const lastThreeFVals = [comps.get(1)!.lastThreeF, comps.get(2)!.lastThreeF, comps.get(3)!.lastThreeF];
  const trainingVals = [comps.get(1)!.training, comps.get(2)!.training, comps.get(3)!.training];
  assert(lastThreeFVals.includes(100) && lastThreeFVals.includes(0),
    `4.1 全馬同値時の lastThreeF: 100 と 0 が含まれる (rankScore 既存仕様)`);
  assert(trainingVals.includes(100) && trainingVals.includes(0),
    `4.2 全馬同値時の training: 100 と 0 が含まれる (rankScore 既存仕様)`);
}

// =============================
// 5. 一部馬のみ pastRaces 未取得 → avg-fallback で補完
// =============================
console.log('\n=== 5. 一部欠損時の avg-fallback ===');
{
  const horses: Horse[] = [
    makeHorse({ id: 1, lastThreeF: 11.8, pastRaces: [makePast({ lastThreeF: 33.0 })] }), // 速い
    makeHorse({ id: 2, lastThreeF: 11.8, pastRaces: [makePast({ lastThreeF: 37.0 })] }), // 遅い
    makeHorse({ id: 3, lastThreeF: 11.8 }), // pastRaces 無し → avg=35.0 で補完
  ];
  const race = makeRace(horses);
  const comps = calcAllComponentScores(race);
  // 馬1=33.0(最速)→100, 馬3=35.0(平均で補完)→50, 馬2=37.0(最遅)→0
  assert(comps.get(1)!.lastThreeF === 100, `5.1 馬1 (33.0) → 100 (got ${comps.get(1)!.lastThreeF})`);
  assert(comps.get(2)!.lastThreeF === 0, `5.2 馬2 (37.0) → 0 (got ${comps.get(2)!.lastThreeF})`);
  assert(comps.get(3)!.lastThreeF === 50, `5.3 馬3 (avg補完=35.0) → 50 (got ${comps.get(3)!.lastThreeF})`);
}

// =============================
console.log(`\n========================================`);
console.log(`合計: pass ${pass} / fail ${fail}`);
console.log(`========================================`);
process.exit(fail > 0 ? 1 : 0);
