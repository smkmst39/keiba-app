// ==========================================
// scoreCourseRecord 単体・統合テスト
// 実行: pnpm tsx scripts/test_course_record.ts
//
// 既存 test-score.ts と同様、assert ベースで pass/fail カウント表示。
// vitest 等のテストフレームワーク未導入のため軽量実装。
// ==========================================

import 'dotenv/config';
import {
  filterCourseRecord,
  findPreviousYearSameRace,
  type PastRace,
} from '../lib/scraper/horse_history';
import { calcAllComponentScores } from '../lib/score/calculator';
import type { Horse, Race } from '../lib/scraper/types';

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

function makePast(opts: Partial<PastRace>): PastRace {
  return {
    date: '2025/06/01',
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
    lastThreeF: 34.5,
    ...overrides,
  };
}

function makeRace(overrides: Partial<Race> = {}): Race {
  return {
    raceId: '202506030511',
    name: 'テストレース',
    course: '中山',
    distance: 1600,
    surface: 'turf',
    horses: [],
    fetchedAt: new Date('2026-05-01T15:00:00+09:00'),
    ...overrides,
  };
}

// =============================
// 1. filterCourseRecord (純関数)
// =============================
console.log('\n=== 1. filterCourseRecord ===');
{
  const baseDate = new Date('2026-05-01');
  const pasts: PastRace[] = [
    makePast({ date: '2026/04/01', course: '中山', surface: 'turf', distance: 1600, rank: 3 }), // ✓ match (mile=1500-1700)
    makePast({ date: '2026/03/01', course: '東京', surface: 'turf', distance: 1600, rank: 1 }), // ✗ different course
    makePast({ date: '2026/02/01', course: '中山', surface: 'dirt', distance: 1600, rank: 2 }), // ✗ different surface
    makePast({ date: '2025/12/01', course: '中山', surface: 'turf', distance: 2400, rank: 1 }), // ✗ different distance band (long)
    makePast({ date: '2024/12/01', course: '中山', surface: 'turf', distance: 1600, rank: 1 }), // ✗ over 1 year ago
    makePast({ date: '2026/01/01', course: '中山', surface: 'turf', distance: 1600, rank: -1 }), // ✗ cancelled
    makePast({ date: '2025/06/01', course: '中山', surface: 'turf', distance: 1700, rank: 4 }), // ✓ match (mile)
  ];

  const matched = filterCourseRecord(pasts, baseDate, '中山', 'turf', 1600);
  assert(matched.length === 2, `1.1 同条件抽出 (mile band): expected 2 matches, got ${matched.length}`);
  assert(matched.every(p => p.course === '中山'), '1.2 すべて中山');
  assert(matched.every(p => p.surface === 'turf'), '1.3 すべて芝');
  assert(matched.every(p => p.rank > 0), '1.4 取消は除外');
}

// =============================
// 2. findPreviousYearSameRace (純関数)
// =============================
console.log('\n=== 2. findPreviousYearSameRace ===');
{
  const baseDate = new Date('2026-05-01');
  const pasts: PastRace[] = [
    makePast({ date: '2025/05/05', raceName: '天皇賞(春)(G1)', rank: 3 }), // ✓ 前年同レース (括弧無視)
    makePast({ date: '2024/05/05', raceName: '天皇賞(春)(G1)', rank: 5 }), // 前々年も match だが最初のヒットを返す
    makePast({ date: '2023/05/05', raceName: '天皇賞(春)(G1)', rank: 8 }), // ✗ 過去2年外
    makePast({ date: '2025/04/01', raceName: '大阪杯(G1)', rank: 1 }),     // ✗ 別レース
  ];

  const found = findPreviousYearSameRace(pasts, baseDate, '天皇賞(春)');
  assert(found !== null, '2.1 前年同レースが見つかる');
  assert(found?.date === '2025/05/05', `2.2 最新の同名レース (got ${found?.date})`);

  const notFound = findPreviousYearSameRace(pasts, baseDate, '宝塚記念');
  assert(notFound === null, '2.3 該当なしは null');

  // 過去2年外 (3年前) のみ → null
  const oldOnly = findPreviousYearSameRace(
    [makePast({ date: '2022/05/05', raceName: '天皇賞(春)(G1)' })],
    baseDate,
    '天皇賞(春)',
  );
  assert(oldOnly === null, '2.4 過去2年超えは null');
}

// =============================
// 3. scoreCourseRecord (calcAllComponentScores 経由)
// =============================
console.log('\n=== 3. scoreCourseRecord (統合) ===');

// 3.1 経験ゼロ → 50
{
  const race = makeRace();
  const horse = makeHorse({ id: 1, pastRaces: [] });
  const comps = calcAllComponentScores({ ...race, horses: [horse] });
  const v = comps.get(1)!.courseRecord;
  assert(v === 50, `3.1 経験ゼロ → 50 (got ${v})`);
}

// 3.2 race 無しの calcAllComponentScores → 50 (フォールバック)
//   ※ calcAllComponentScores は race を受けるので、race 無し挙動は計算ロジックの protect
{
  const horse = makeHorse({ id: 1, pastRaces: [makePast({ rank: 1 })] });
  // race を渡すが pastRaces の course/surface が一致するケース
  const race = makeRace({ course: '中山', surface: 'turf', distance: 1600 });
  const comps = calcAllComponentScores({ ...race, horses: [horse] });
  const v = comps.get(1)!.courseRecord;
  // 1走しか該当しないので trust = 1/3 → score * (1/3) + 50 * (2/3)
  // scoreOnePastRace(rank=1, lastThreeF=35.0): 100*0.6 + 50*0.4 = 80
  // 80 * (1/3) + 50 * (2/3) ≈ 60.0
  assert(approx(v, 60, 1.5), `3.2 1走経験 (rank1, last3F=35) → 約60 (got ${v.toFixed(2)})`);
}

// 3.3 3走経験で全1着・上がり3F=33.0 → 高得点
{
  const race = makeRace({ course: '中山', surface: 'turf', distance: 1600 });
  const horse = makeHorse({ id: 1, pastRaces: [
    makePast({ date: '2026/04/01', course: '中山', surface: 'turf', distance: 1600, rank: 1, lastThreeF: 33.0 }),
    makePast({ date: '2026/03/01', course: '中山', surface: 'turf', distance: 1600, rank: 1, lastThreeF: 33.0 }),
    makePast({ date: '2026/02/01', course: '中山', surface: 'turf', distance: 1600, rank: 1, lastThreeF: 33.0 }),
  ]});
  const comps = calcAllComponentScores({ ...race, horses: [horse] });
  const v = comps.get(1)!.courseRecord;
  // scoreOnePastRace(rank=1, last3F=33.0) = 100*0.6 + 100*0.4 = 100
  // 3走 trust=1 → 100
  assert(approx(v, 100, 0.5), `3.3 3走全勝・最速末脚 → 100 (got ${v.toFixed(2)})`);
}

// 3.4 5走経験で全10着・上がり3F=37.0 → 低得点
{
  const race = makeRace({ course: '中山', surface: 'turf', distance: 1600 });
  const past = (date: string) => makePast({ date, course: '中山', surface: 'turf', distance: 1600, rank: 10, lastThreeF: 37.0 });
  const horse = makeHorse({ id: 1, pastRaces: [
    past('2026/04/01'), past('2026/03/01'), past('2026/02/01'), past('2026/01/01'), past('2025/12/01'),
  ]});
  const comps = calcAllComponentScores({ ...race, horses: [horse] });
  const v = comps.get(1)!.courseRecord;
  // scoreOnePastRace(rank=10, last3F=37.0): 10*0.6 + 0*0.4 = 6 (lastThreeFScore = 100-(37-33)*25 = 0)
  // trust=1 → 6
  assert(approx(v, 6, 1), `3.4 5走全10着・遅い末脚 → 約6 (got ${v.toFixed(2)})`);
}

// 3.5 重賞 (G1) + 前年同レース1着 → 補正で底上げ
{
  const race = makeRace({ course: '東京', surface: 'turf', distance: 2400, name: '日本ダービー', raceGrade: 'G1' });
  const horse = makeHorse({ id: 1, pastRaces: [
    // 同条件過去走なし → baseScore = 50
    // 前年同レースで1着・上がり3F=33.0
    makePast({ date: '2025/06/01', course: '東京', surface: 'turf', distance: 2400, rank: 1, lastThreeF: 33.0, raceName: '日本ダービー(G1)' }),
  ]});
  const comps = calcAllComponentScores({ ...race, horses: [horse] });
  const v = comps.get(1)!.courseRecord;
  // baseScore = 50 (同条件0走) ※ 前年同レース1走は filterCourseRecord に含まれる:
  //   2025/06/01 vs baseDate 2026/05/01 → 約11ヶ月前なのでフィルタ通過
  //   3.2 と同じく 1走 (rank=1, last3F=33.0): scoreOnePastRace=100, trust=1/3 → ≈ 66.67
  //   prevYearScore = 100, base*0.7 + 100*0.3 = 66.67*0.7 + 100*0.3 = 76.67
  assert(approx(v, 76.67, 2), `3.5 G1 + 前年同レース1着 → 約76.7 (got ${v.toFixed(2)})`);
}

// 3.6 重賞 (G1) + 前年同レースなし → 50 ブレンド
{
  const race = makeRace({ course: '中山', surface: 'turf', distance: 1600, name: '皐月賞', raceGrade: 'G1' });
  const horse = makeHorse({ id: 1, pastRaces: [] });
  const comps = calcAllComponentScores({ ...race, horses: [horse] });
  const v = comps.get(1)!.courseRecord;
  // baseScore = 50 (経験ゼロ), prevYearScore = 50 (該当なし)
  // 50 * 0.7 + 50 * 0.3 = 50
  assert(approx(v, 50, 0.5), `3.6 G1 + 前年なし → 50 (got ${v.toFixed(2)})`);
}

// 3.7 条件戦 (raceGrade なし) → 重賞補正なし
{
  const race = makeRace({ course: '中山', surface: 'turf', distance: 1600 }); // raceGrade 未指定
  const horse = makeHorse({ id: 1, pastRaces: [
    // 直近の条件戦に該当しない、前年同名レースだけある状態
    makePast({ date: '2025/05/01', course: '東京', surface: 'turf', distance: 2400, rank: 1, lastThreeF: 33.0, raceName: 'テストレース' }),
  ]});
  const comps = calcAllComponentScores({ ...race, horses: [horse] });
  const v = comps.get(1)!.courseRecord;
  // 同条件過去走なし → baseScore=50。重賞でないので補正なしで 50 返す
  assert(approx(v, 50, 0.5), `3.7 条件戦は前年補正なしで 50 (got ${v.toFixed(2)})`);
}

// =============================
// 4. scoreOnePastRace の境界値（calcAllComponentScores 経由で間接確認）
// =============================
console.log('\n=== 4. 着順マッピング境界値 ===');

const cases: Array<[number, number, number]> = [
  // [rank, expected rankPart, label index]
  [1, 100, 1],
  [2, 80, 2],
  [3, 65, 3],
  [4, 50, 4],
  [5, 50, 5],
  [6, 30, 6],
  [9, 30, 7],
  [10, 10, 8],
];

for (const [rank, expected, i] of cases) {
  const race = makeRace({ course: '中山', surface: 'turf', distance: 1600 });
  // 3走全て同 rank・上がり3F=35.0 (scoreLastThreeFScore=50) で trust=1
  const past = makePast({ course: '中山', surface: 'turf', distance: 1600, rank, lastThreeF: 35.0 });
  const horse = makeHorse({ id: 1, pastRaces: [
    { ...past, date: '2026/04/01' },
    { ...past, date: '2026/03/01' },
    { ...past, date: '2026/02/01' },
  ]});
  const comps = calcAllComponentScores({ ...race, horses: [horse] });
  const v = comps.get(1)!.courseRecord;
  // expected = expected*0.6 + 50*0.4
  const want = expected * 0.6 + 50 * 0.4;
  assert(approx(v, want, 0.5), `4.${i} rank=${rank} → ${want} (got ${v.toFixed(2)})`);
}

// =============================
// 5. タイムリーキ防止 (2026-05-09 第二バグ対応)
//    /horse/result/{id}/ の競走成績は事後収集なので「検証対象レース当日」や
//    「baseDate より新しいレース」が混入する。これらを過去走として扱わないこと。
// =============================
console.log('\n=== 5. タイムリーキ防止 ===');
{
  const baseDate = new Date(2025, 4, 4); // 2025/05/04 (天皇賞春当日)

  // 5.1-5.2: 自レース除外 (同日)
  // 注: filterCourseRecord は「過去1年以内」フィルタ。前年同レース (1年と数日前) は範囲外のため
  //     ここでは「半年前」を採用してフィルタ単体の挙動を検証する。前年同名レース補正は
  //     findPreviousYearSameRace 側 (5.7-5.10) で別途検証。
  {
    const pasts: PastRace[] = [
      makePast({ date: '2025/05/04', course: '京都', surface: 'turf', distance: 3200, rank: 15, raceName: '天皇賞(春)(GI)' }),
      makePast({ date: '2024/12/01', course: '京都', surface: 'turf', distance: 3200, rank: 2 }), // 半年前 (1年以内)
    ];
    const filtered = filterCourseRecord(pasts, baseDate, '京都', 'turf', 3200);
    assert(filtered.length === 1, '5.1 自レース (同日) は除外される', `got ${filtered.length}走 (期待: 1)`);
    assert(filtered[0]?.date === '2024/12/01', '5.2 残ったのは半年前のレース',
      `got date=${filtered[0]?.date}`);
  }

  // 5.3-5.4: 未来レース除外
  {
    const pasts: PastRace[] = [
      makePast({ date: '2026/05/03', course: '京都', surface: 'turf', distance: 3200, rank: 5 }), // 1年後
      makePast({ date: '2024/12/01', course: '京都', surface: 'turf', distance: 3200, rank: 2 }), // 半年前 (1年以内)
    ];
    const filtered = filterCourseRecord(pasts, baseDate, '京都', 'turf', 3200);
    assert(filtered.length === 1, '5.3 未来レース (1年後) は除外される', `got ${filtered.length}走`);
    assert(filtered[0]?.date === '2024/12/01', '5.4 残ったのは半年前のレース');
  }

  // 5.5: 翌日のレースも除外
  {
    const pasts: PastRace[] = [
      makePast({ date: '2025/05/05', course: '京都', surface: 'turf', distance: 3200, rank: 1 }),
    ];
    const filtered = filterCourseRecord(pasts, baseDate, '京都', 'turf', 3200);
    assert(filtered.length === 0, '5.5 翌日 (baseDate+1日) のレースも除外');
  }

  // 5.6: 1日前は採用される (境界)
  {
    const pasts: PastRace[] = [
      makePast({ date: '2025/05/03', course: '京都', surface: 'turf', distance: 3200, rank: 3 }),
    ];
    const filtered = filterCourseRecord(pasts, baseDate, '京都', 'turf', 3200);
    assert(filtered.length === 1, '5.6 baseDate-1日 (前日) は採用');
  }

  // 5.7-5.9: findPreviousYearSameRace の自レース・未来レース除外
  {
    const pasts: PastRace[] = [
      makePast({ date: '2025/05/04', course: '京都', surface: 'turf', distance: 3200, rank: 15, raceName: '天皇賞(春)(GI)' }),
      makePast({ date: '2024/04/28', course: '京都', surface: 'turf', distance: 3200, rank: 2, raceName: '天皇賞(春)(GI)' }),
    ];
    const found = findPreviousYearSameRace(pasts, baseDate, '天皇賞(春)');
    assert(found !== null, '5.7 自レース除外後でも前年同名が見つかる');
    assert(found?.date === '2024/04/28', '5.8 拾われたのは前年 (自レースではない)',
      `got date=${found?.date} rank=${found?.rank}`);
  }
  {
    const pasts: PastRace[] = [
      makePast({ date: '2025/05/04', course: '京都', surface: 'turf', distance: 3200, rank: 15, raceName: '天皇賞(春)(GI)' }),
    ];
    const found = findPreviousYearSameRace(pasts, baseDate, '天皇賞(春)');
    assert(found === null, '5.9 自レースしか持たない → null (補正対象なし)');
  }
  {
    const pasts: PastRace[] = [
      makePast({ date: '2026/05/03', course: '京都', surface: 'turf', distance: 3200, rank: 5, raceName: '天皇賞(春)(GI)' }),
    ];
    const found = findPreviousYearSameRace(pasts, baseDate, '天皇賞(春)');
    assert(found === null, '5.10 未来レースしか持たない → null (補正対象なし)');
  }
}

// =============================
// 6. raceDate ベースの baseDate 構築 (parseRaceDate)
// =============================
console.log('\n=== 6. raceDate ベース baseDate ===');
{
  // race.raceDate (YYYYMMDD) が優先されることで、過去レース検証時でも
  // 当時の時間軸でフィルタが効くこと
  const horse = makeHorse({
    id: 1,
    pastRaces: [
      // 自レース (検証対象 raceDate=2025/05/04 と同日) → 除外されるべき
      makePast({ date: '2025/05/04', course: '京都', surface: 'turf', distance: 3200, rank: 15, lastThreeF: 38.0 }),
      // 前年 (1年以内) → 採用されるべき
      makePast({ date: '2024/05/05', course: '京都', surface: 'turf', distance: 3200, rank: 1, lastThreeF: 35.0 }),
    ],
  });
  const race: Race = {
    ...makeRace({ course: '京都', surface: 'turf', distance: 3200 }),
    raceDate: '20250504',
    // fetchedAt はあえて1年後に設定: raceDate が優先されることの確認
    fetchedAt: new Date('2026-05-11T15:00:00+09:00'),
  };
  const comps = calcAllComponentScores({ ...race, horses: [horse] });
  const cr = comps.get(1)!.courseRecord;
  // 期待:
  //   - 自レース (rank=15) は除外 → matched は前年1走のみ
  //   - 前年 rank=1 → 100点, 上3F=35.0 → 50点, scoreOnePastRace = 100*0.6 + 50*0.4 = 80
  //   - trust = 1/3, baseScore = 80*(1/3) + 50*(2/3) ≈ 60
  //   - 平場 raceGrade なし → 重賞補正なし、baseScore がそのまま courseRecord
  assert(cr > 55 && cr < 65,
    '6.1 raceDate 基準で自レース除外、前年のみ採用 → courseRecord ≈ 60',
    `got courseRecord=${cr.toFixed(2)}`);
}

// =============================
// 結果集計
// =============================
console.log(`\n========================================`);
console.log(`合計: pass ${pass} / fail ${fail}`);
console.log(`========================================`);
process.exit(fail > 0 ? 1 : 0);
