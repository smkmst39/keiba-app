// ==========================================
// prevClass 着順ブレンド + 組み合わせ確率の条件付き正規化テスト
// 実行: pnpm tsx scripts/test_prevclass_combo.ts
//
// 対象コミット:
//   - feat: scorePrevClass に着順ブレンドを追加（格60% + 着順40%）
//   - feat: 馬連/ワイド/三連複の組み合わせ確率を条件付き正規化に改善
// ==========================================

import 'dotenv/config';
import { calcAllComponentScores, calcComboEV } from '../lib/score/calculator';
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

function approx(a: number, b: number, tol = 0.01): boolean {
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
    raceName: '4歳以上1勝クラス',
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
    lastThreeF: 11.8,
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
    raceDate: '20260501',
    ...overrides,
  };
}

// =============================
// 1. prevClass 着順ブレンド
// =============================
console.log('\n=== 1. prevClass 着順ブレンド (格60% + 着順40%) ===');
{
  // 各ケース: [raceName, rank, 期待値]
  //   期待値 = classifyPrevRace(raceName) * 0.6 + rankToScore(rank) * 0.4
  const cases: Array<[string, number, number, string]> = [
    ['天皇賞(春)(GI)', 1, 100 * 0.6 + 100 * 0.4, 'G1 1着 → 100'],
    ['天皇賞(春)(GI)', 15, 100 * 0.6 + 10 * 0.4, 'G1 15着 → 64'],
    ['4歳以上1勝クラス', 1, 30 * 0.6 + 100 * 0.4, '1勝クラス 1着 → 58'],
    ['3歳未勝利', 1, 20 * 0.6 + 100 * 0.4, '未勝利 1着 → 52'],
    ['4歳以上2勝クラス', 3, 40 * 0.6 + 65 * 0.4, '2勝クラス 3着 → 50'],
    ['マイラーズC(GII)', 5, 85 * 0.6 + 50 * 0.4, 'G2 5着 → 71'],
  ];
  for (const [raceName, rank, expected, label] of cases) {
    const horse = makeHorse({
      id: 1,
      pastRaces: [makePast({ raceName, rank, date: '2026/04/01' })],
    });
    const comps = calcAllComponentScores(makeRace([horse]));
    const v = comps.get(1)!.prevClass;
    assert(approx(v, expected, 0.01), `1.x ${label} (期待 ${expected.toFixed(1)}, got ${v.toFixed(1)})`);
  }

  // 旧仕様の倒錯が解消されていること: G1 15着 (64) > 1勝1着 (58) は依然格優位だが、
  // 差が 100 vs 30 (70pt差) から 64 vs 58 (6pt差) に縮小
  const g1Last = makeHorse({ id: 1, pastRaces: [makePast({ raceName: '天皇賞(春)(GI)', rank: 15 })] });
  const c1Win = makeHorse({ id: 1, pastRaces: [makePast({ raceName: '4歳以上1勝クラス', rank: 1 })] });
  const vG1 = calcAllComponentScores(makeRace([g1Last])).get(1)!.prevClass;
  const vC1 = calcAllComponentScores(makeRace([c1Win])).get(1)!.prevClass;
  assert(vG1 - vC1 < 10, `1.7 G1惨敗 vs 1勝圧勝の差が10pt未満に縮小 (${vG1.toFixed(1)} vs ${vC1.toFixed(1)})`);

  // pastRaces 無し → プレーンなフォールバック
  const noPast = makeHorse({ id: 1 });
  const vNone = calcAllComponentScores(makeRace([noPast])).get(1)!.prevClass;
  assert(vNone === 50, `1.8 pastRaces 無し → 50 (got ${vNone})`);

  // pastRaces が prevRaceClass より優先されること
  const both = makeHorse({
    id: 1,
    prevRaceClass: 85, // G2 相当 (rank なし)
    pastRaces: [makePast({ raceName: '3歳未勝利', rank: 1 })], // ブレンド 52
  });
  const vBoth = calcAllComponentScores(makeRace([both])).get(1)!.prevClass;
  assert(approx(vBoth, 52, 0.01), `1.9 pastRaces が prevRaceClass より優先 (期待 52, got ${vBoth.toFixed(1)})`);

  // タイムリーキ防止: 自レース当日の過去走は除外
  const leaky = makeHorse({
    id: 1,
    pastRaces: [
      makePast({ raceName: '天皇賞(春)(GI)', rank: 1, date: '2026/05/01' }), // 自レース当日 → 除外
      makePast({ raceName: '4歳以上1勝クラス', rank: 2, date: '2026/04/01' }), // これが前走
    ],
  });
  const vLeaky = calcAllComponentScores(makeRace([leaky])).get(1)!.prevClass;
  const expectedLeaky = 30 * 0.6 + 80 * 0.4; // 1勝クラス 2着 = 50
  assert(approx(vLeaky, expectedLeaky, 0.01),
    `1.10 自レース除外で前走 = 1勝2着 (期待 ${expectedLeaky}, got ${vLeaky.toFixed(1)})`);
}

// =============================
// 2. 組み合わせ確率の条件付き正規化
// =============================
console.log('\n=== 2. 組み合わせ確率 (条件付き正規化) ===');
{
  // 4頭、odds 2/4/8/16、score 全馬同値 (=偏差0) → adjProb = (1/odds) × 0.98
  const horses: Horse[] = [
    makeHorse({ id: 1, odds: 2, score: 60 }),
    makeHorse({ id: 2, odds: 4, score: 60 }),
    makeHorse({ id: 3, odds: 8, score: 60 }),
    makeHorse({ id: 4, odds: 16, score: 60 }),
  ];

  // 手計算の期待値 (スコア偏差0 → corr = -0.02 一律):
  const p = [0.49, 0.245, 0.1225, 0.06125]; // (1/odds) × 0.98
  const S = p[0] + p[1] + p[2] + p[3];      // 0.91875

  // oddsVal=1 を渡すと EV = 確率そのもの
  const umatan12 = calcComboEV([horses[0], horses[1]], 1, 'umatan', horses);
  const expUmatan12 = p[0] * (p[1] / (S - p[0]));
  assert(approx(umatan12, expUmatan12, 0.001),
    `2.1 馬単 1→2 (既存ロジック回帰、期待 ${expUmatan12.toFixed(4)}, got ${umatan12.toFixed(4)})`);

  const umaren12 = calcComboEV([horses[0], horses[1]], 1, 'umaren', horses);
  const expUmaren12 = p[0] * (p[1] / (S - p[0])) + p[1] * (p[0] / (S - p[1]));
  assert(approx(umaren12, expUmaren12, 0.001),
    `2.2 馬連 1-2 = 馬単両順序の和 (期待 ${expUmaren12.toFixed(4)}, got ${umaren12.toFixed(4)})`);

  // 旧式 (p1×p2×2) と比較: 人気馬ペアは新式の方が大きい (過小評価の是正)
  const naive12 = 2 * p[0] * p[1];
  assert(umaren12 > naive12,
    `2.3 馬連新式 > 旧式ナイーブ (${umaren12.toFixed(4)} > ${naive12.toFixed(4)})`);

  // ワイド > 馬連 (ともに3着以内は 1-2着より的中範囲が広い)
  const wide12 = calcComboEV([horses[0], horses[1]], 1, 'wide', horses);
  assert(wide12 > umaren12,
    `2.4 ワイド 1-2 > 馬連 1-2 (${wide12.toFixed(4)} > ${umaren12.toFixed(4)})`);
  assert(wide12 / umaren12 > 1.5 && wide12 / umaren12 < 4,
    `2.5 ワイド/馬連 比が 1.5〜4 倍の妥当域 (${(wide12 / umaren12).toFixed(2)}倍)`);

  // 三連複 = 三連単6通りの和
  const sanfuku = calcComboEV([horses[0], horses[1], horses[2]], 1, 'sanfuku', horses);
  const perms: Array<[number, number, number]> = [
    [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0],
  ];
  const expSanfuku = perms.reduce((sum, [a, b, c]) => {
    const p1 = p[a];
    const p2 = p[b] / (S - p[a]);
    const p3 = p[c] / (S - p[a] - p[b]);
    return sum + p1 * p2 * p3;
  }, 0);
  assert(approx(sanfuku, expSanfuku, 0.001),
    `2.6 三連複 = 三連単6通りの和 (期待 ${expSanfuku.toFixed(4)}, got ${sanfuku.toFixed(4)})`);

  // 三連単 (既存ロジック回帰)
  const santan = calcComboEV([horses[0], horses[1], horses[2]], 1, 'santan', horses);
  const expSantan = p[0] * (p[1] / (S - p[0])) * (p[2] / (S - p[0] - p[1]));
  assert(approx(santan, expSantan, 0.001),
    `2.7 三連単 1→2→3 (既存ロジック回帰、期待 ${expSantan.toFixed(4)}, got ${santan.toFixed(4)})`);

  // NaN / 範囲チェック
  const allChecks = [umatan12, umaren12, wide12, sanfuku, santan];
  assert(allChecks.every((v) => !Number.isNaN(v) && v > 0 && v < 1.5),
    `2.8 全確率が NaN でなく (0, 1.5) の範囲`);

  // 4頭中3頭のワイド全ペア + α の総和チェック (発散していないこと)
  const widePairs = [
    calcComboEV([horses[0], horses[1]], 1, 'wide', horses),
    calcComboEV([horses[0], horses[2]], 1, 'wide', horses),
    calcComboEV([horses[0], horses[3]], 1, 'wide', horses),
    calcComboEV([horses[1], horses[2]], 1, 'wide', horses),
    calcComboEV([horses[1], horses[3]], 1, 'wide', horses),
    calcComboEV([horses[2], horses[3]], 1, 'wide', horses),
  ];
  const wideSum = widePairs.reduce((s, v) => s + v, 0);
  // 4頭立てで top3 に入るペア数は C(3,2)=3 → 全ペア確率の合計は理論上 3×(全体確率)
  // adjProb が未正規化 (Σ=0.919) なので厳密に3にはならないが、2〜4 の範囲なら健全
  assert(wideSum > 2 && wideSum < 4,
    `2.9 ワイド全ペア確率の総和が妥当域 (got ${wideSum.toFixed(3)}, 理論値≈3×Σp)`);
}

// =============================
console.log(`\n========================================`);
console.log(`合計: pass ${pass} / fail ${fail}`);
console.log(`========================================`);
process.exit(fail > 0 ? 1 : 0);
