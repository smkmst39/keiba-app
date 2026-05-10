// ==========================================
// レース名正規化（findPreviousYearSameRace）の網羅テスト
//
// 2026-05-09 のバグ修正に対応する回帰テスト。本番動作確認で「天皇賞(春) と
// 天皇賞(秋) が同一視される」異常を検出した教訓から、季節区分・コース区分
// など意味的識別子は保持されること、グレード/クラス表記のみ削除されることを
// 網羅的に検証する。
//
// 実行: pnpm tsx scripts/test_race_name_normalization.ts
// ==========================================

import { normalizeRaceName, findPreviousYearSameRace } from '../lib/scraper/horse_history';
import type { PastRace } from '../lib/scraper/horse_history';

let pass = 0;
let fail = 0;

function eq(a: string, b: string, name: string) {
  const ok = a === b;
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name} — got "${a}", expected "${b}"`); }
}
function assert(cond: boolean, name: string, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

// =============================
// 1. 季節区分の保持（最重要・今回のバグ）
// =============================
console.log('\n=== 1. 季節区分の保持（最重要・今回のバグ） ===');
{
  const a = normalizeRaceName('天皇賞(春)(GI)');
  const b = normalizeRaceName('天皇賞(秋)(GI)');
  eq(a, '天皇賞(春)', '1.1 天皇賞(春)(GI) → 天皇賞(春)');
  eq(b, '天皇賞(秋)', '1.2 天皇賞(秋)(GI) → 天皇賞(秋)');
  assert(a !== b, '1.3 天皇賞(春) と 天皇賞(秋) は別レース', `a=${a} b=${b}`);

  // 他の季節分割があるレース
  eq(normalizeRaceName('スプリンターズステークス(GI)'), 'スプリンターズステークス',
    '1.4 季節区分のないG1');
}

// =============================
// 2. グレード表記の同一視（半角 / 全角ローマ数字 / 1-3 数字 すべて削除）
// =============================
console.log('\n=== 2. グレード表記の同一視 ===');
{
  // (G1) 系
  eq(normalizeRaceName('天皇賞(春)(G1)'), '天皇賞(春)', '2.1 (G1) 削除');
  eq(normalizeRaceName('マイラーズC(G2)'), 'マイラーズC', '2.2 (G2) 削除');
  eq(normalizeRaceName('青葉賞(G3)'), '青葉賞', '2.3 (G3) 削除');

  // (GI) 系（半角ローマ数字）
  eq(normalizeRaceName('天皇賞(春)(GI)'), '天皇賞(春)', '2.4 (GI) 削除');
  eq(normalizeRaceName('マイラーズC(GII)'), 'マイラーズC', '2.5 (GII) 削除');
  eq(normalizeRaceName('青葉賞(GIII)'), '青葉賞', '2.6 (GIII) 削除');

  // (GⅠ) 系（全角ローマ数字）
  eq(normalizeRaceName('天皇賞(春)(GⅠ)'), '天皇賞(春)', '2.7 (GⅠ) 削除');
  eq(normalizeRaceName('マイラーズC(GⅡ)'), 'マイラーズC', '2.8 (GⅡ) 削除');
  eq(normalizeRaceName('青葉賞(GⅢ)'), '青葉賞', '2.9 (GⅢ) 削除');

  // 同一視: グレード有無
  assert(
    normalizeRaceName('天皇賞(春)(GI)') === normalizeRaceName('天皇賞(春)'),
    '2.10 天皇賞(春)(GI) ≡ 天皇賞(春)'
  );
  assert(
    normalizeRaceName('NHKマイルカップ(GI)') === normalizeRaceName('NHKマイルカップ'),
    '2.11 NHKマイルカップ(GI) ≡ NHKマイルカップ'
  );
}

// =============================
// 3. クラス表記の削除（新表記）
// =============================
console.log('\n=== 3. クラス表記の削除（新表記）===');
{
  eq(normalizeRaceName('4歳以上(1勝クラス)'), '4歳以上', '3.1 (1勝クラス) 削除');
  eq(normalizeRaceName('葉月S(2勝クラス)'), '葉月S', '3.2 (2勝クラス) 削除');
  eq(normalizeRaceName('御堂筋S(3勝クラス)'), '御堂筋S', '3.3 (3勝クラス) 削除');
}

// =============================
// 4. 旧クラス表記の削除（500万下 / 1000万下 / 1600万下）
// =============================
console.log('\n=== 4. 旧クラス表記の削除 ===');
{
  eq(normalizeRaceName('葉月S(500万下)'), '葉月S', '4.1 (500万下) 削除');
  eq(normalizeRaceName('葉月S(1000万下)'), '葉月S', '4.2 (1000万下) 削除');
  eq(normalizeRaceName('御堂筋S(1600万下)'), '御堂筋S', '4.3 (1600万下) 削除');
  // 同一視: 新旧表記の互換
  assert(
    normalizeRaceName('葉月S(2勝クラス)') === normalizeRaceName('葉月S(1000万下)'),
    '4.4 葉月S(2勝クラス) ≡ 葉月S(1000万下) (新旧互換)'
  );
}

// =============================
// 5. リステッド表記
// =============================
console.log('\n=== 5. リステッド表記 ===');
{
  eq(normalizeRaceName('ファルコンS(L)'), 'ファルコンS', '5.1 (L) 削除');
  eq(normalizeRaceName('ファルコンS(LISTED)'), 'ファルコンS', '5.2 (LISTED) 削除');
  eq(normalizeRaceName('ファルコンS(Listed)'), 'ファルコンS', '5.3 (Listed) 削除（大小文字無視）');
  assert(
    normalizeRaceName('ファルコンS(L)') === normalizeRaceName('ファルコンS(LISTED)'),
    '5.4 ファルコンS(L) ≡ ファルコンS(LISTED)'
  );
}

// =============================
// 6. 複合パターン（複数括弧を持つレース）
// =============================
console.log('\n=== 6. 複合パターン ===');
{
  eq(normalizeRaceName('朝日杯フューチュリティステークス(GI)'), '朝日杯フューチュリティステークス',
    '6.1 朝日杯FS(GI)');
  eq(normalizeRaceName('桜花賞(GI)'), '桜花賞', '6.2 桜花賞(GI)');
  // 季節区分 + グレード両方
  eq(normalizeRaceName('天皇賞(春)(GI)'), '天皇賞(春)', '6.3 季節区分+グレード');
  // クラス + 別表記
  eq(normalizeRaceName('青葉賞(G2)(L)'), '青葉賞', '6.4 想定外2グレード混在 (G2)+(L)');
}

// =============================
// 7. 区別すべきものが区別されることの再確認（核心）
// =============================
console.log('\n=== 7. 区別すべきものは区別される ===');
{
  // 春/秋
  assert(
    normalizeRaceName('天皇賞(春)(GI)') !== normalizeRaceName('天皇賞(秋)(GI)'),
    '7.1 天皇賞(春) と 天皇賞(秋) は別'
  );
  // 朝日杯フューチュリティ vs 朝日杯（架空、過度の類似）
  assert(
    normalizeRaceName('朝日杯フューチュリティステークス(GI)') !== normalizeRaceName('朝日杯(GI)'),
    '7.2 朝日杯FS と 朝日杯（仮）は別'
  );
}

// =============================
// 8. findPreviousYearSameRace の挙動 (実関数)
// =============================
console.log('\n=== 8. findPreviousYearSameRace E2E ===');
{
  const baseDate = new Date('2026-05-04');
  const pasts: PastRace[] = [
    // 春天 過去3年
    { date: '2025/05/04', course: '京都', distance: 3200, surface: 'turf', trackCondition: '良',
      rank: 2, time: '3:14.0', lastThreeF: 34.9, raceName: '天皇賞(春)(GI)' },
    // 秋天 過去2年（春天と同名視されてしまう旧バグ対象）
    { date: '2024/10/27', course: '東京', distance: 2000, surface: 'turf', trackCondition: '良',
      rank: 4, time: '1:58.0', lastThreeF: 33.0, raceName: '天皇賞(秋)(GI)' },
    { date: '2023/10/29', course: '東京', distance: 2000, surface: 'turf', trackCondition: '良',
      rank: 2, time: '1:58.5', lastThreeF: 33.7, raceName: '天皇賞(秋)(GI)' },
    // 春天 3年前（過去2年外なので拾わない想定）
    { date: '2023/04/30', course: '京都', distance: 3200, surface: 'turf', trackCondition: '良',
      rank: 1, time: '3:14.5', lastThreeF: 34.9, raceName: '天皇賞(春)(GI)' },
  ];

  // ターゲット: 天皇賞(春)
  const found = findPreviousYearSameRace(pasts, baseDate, '天皇賞(春)');
  assert(found !== null, '8.1 春天の前年同名レースが見つかる');
  assert(found?.date === '2025/05/04', '8.2 拾われたのは 2025年春天 (秋天ではない)',
    `got date=${found?.date} raceName=${found?.raceName}`);
  assert(found?.rank === 2, '8.3 着順が 2 (2025春天の値)');

  // ターゲット: 天皇賞(秋)
  const foundAutumn = findPreviousYearSameRace(pasts, baseDate, '天皇賞(秋)(GI)');
  assert(foundAutumn !== null, '8.4 秋天の前年同名レースが見つかる');
  assert(foundAutumn?.date === '2024/10/27', '8.5 拾われたのは 2024年秋天',
    `got date=${foundAutumn?.date} raceName=${foundAutumn?.raceName}`);

  // ターゲット: 過去2年外しか持たない名 (天皇賞(春) で baseDate を 2026/05/04 → 過去2年=2024/05/04 以降)
  // 2025/05/04 が拾われるが、もしそれを除外したら null か旧記録のみのはずだが、
  // このテストは twoYearsAgo の境界を確認するもの (現コードは setFullYear で2年遡る)
  const baseDateOld = new Date('2026/05/04');
  baseDateOld.setFullYear(baseDateOld.getFullYear() + 1); // baseDate=2027/5/4 なら境界は2025/5/4
  // 期待: 2025/05/04 が境界ぴったり (>=)、ヒットするか確認用 (実装上 d < twoYearsAgo で除外)
}

console.log(`\n========================================`);
console.log(`合計: pass ${pass} / fail ${fail}`);
console.log(`========================================`);
process.exit(fail > 0 ? 1 : 0);
