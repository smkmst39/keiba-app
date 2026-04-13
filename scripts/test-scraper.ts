// ==========================================
// スクレイパー動作確認スクリプト
// 実行方法:
//   USE_MOCK=true  pnpm tsx scripts/test-scraper.ts 202606030511
//   USE_MOCK=false pnpm tsx scripts/test-scraper.ts 202606030511
// ==========================================

import 'dotenv/config';
import { scrapeRace, fetchRaceCard, fetchOdds, fetchTraining } from '../lib/scraper/netkeiba';

const raceId = process.argv[2] ?? '202606030511';
const useMock = process.env.USE_MOCK === 'true';

console.log('========================================');
console.log(`スクレイパーテスト開始`);
console.log(`  raceId  : ${raceId}`);
console.log(`  USE_MOCK: ${useMock}`);
console.log('========================================\n');

async function main() {
  if (useMock) {
    // --- モックモード: scrapeRace を一発呼び出し ---
    console.log('[MODE] モックデータを使用します\n');
    const race = await scrapeRace(raceId);
    printRace(race);
    return;
  }

  // --- 実データモード: 各関数を個別に確認 ---
  console.log('[MODE] 実ネットワークを使用します（USE_MOCK=false）\n');
  console.warn('⚠️  netkeibaへのアクセスが発生します。連続実行は控えてください。\n');

  // 1. 出馬表
  console.log('--- [1/3] 出馬表取得 ---');
  const card = await fetchRaceCard(raceId);
  if (!card) {
    console.error('✗ 出馬表の取得に失敗しました');
    process.exit(1);
  }
  console.log(`✓ レース名  : ${card.name}`);
  console.log(`✓ 競馬場    : ${card.course}`);
  console.log(`✓ 距離      : ${card.distance}m`);
  console.log(`✓ 馬場      : ${card.surface === 'turf' ? '芝' : 'ダート'}`);
  console.log(`✓ 取得頭数  : ${card.horseMap.size}頭`);
  console.log('');

  // 2. オッズ
  console.log('--- [2/3] オッズ取得 ---');
  const oddsMap = await fetchOdds(raceId);
  if (oddsMap.size === 0) {
    console.warn('△ オッズが取得できませんでした（セレクタを確認してください）');
  } else {
    console.log(`✓ オッズ取得: ${oddsMap.size}頭分`);
    // 先頭3頭を表示
    let count = 0;
    for (const [id, o] of Array.from(oddsMap.entries())) {
      if (count++ >= 3) break;
      console.log(
        `  馬番${String(id).padStart(2)}: 単勝=${o.odds} 複勝=${o.fukuOddsMin}-${o.fukuOddsMax}`
      );
    }
  }
  console.log('');

  // 3. 調教
  console.log('--- [3/3] 調教取得 ---');
  const trainingMap = await fetchTraining(raceId);
  if (trainingMap.size === 0) {
    console.warn('△ 調教タイムが取得できませんでした（セレクタを確認してください）');
  } else {
    console.log(`✓ 調教取得: ${trainingMap.size}頭分`);
    let count = 0;
    for (const [id, t] of Array.from(trainingMap.entries())) {
      if (count++ >= 3) break;
      console.log(`  馬番${String(id).padStart(2)}: ラスト1F=${t}秒`);
    }
  }
  console.log('');

  // 4. 統合 scrapeRace
  console.log('--- [統合] scrapeRace ---');
  const race = await scrapeRace(raceId);
  printRace(race);
}

function printRace(race: Awaited<ReturnType<typeof scrapeRace>>) {
  if (!race) {
    console.error('✗ レースデータの取得に失敗しました');
    process.exit(1);
  }

  console.log(`✓ レース: ${race.name}（${race.course} ${race.surface === 'turf' ? '芝' : 'ダート'}${race.distance}m）`);
  console.log(`✓ 出走頭数: ${race.horses.length}頭`);
  console.log(`✓ 取得時刻: ${race.fetchedAt.toLocaleString('ja-JP')}\n`);

  // 馬ごとの表示
  console.log('馬番 馬名                   単勝    複勝下限-上限  体重   上がり1F');
  console.log('---- ---------------------- ------- -------------- ------ --------');
  for (const h of race.horses) {
    const name = h.name.padEnd(10, '　');
    const odds = String(h.odds).padStart(7);
    const fuku = `${h.fukuOddsMin}-${h.fukuOddsMax}`.padEnd(14);
    const weight = `${h.weight}(${h.weightDiff >= 0 ? '+' : ''}${h.weightDiff})`.padEnd(6);
    const training = h.lastThreeF > 0 ? `${h.lastThreeF}秒` : '----';
    console.log(`  ${String(h.id).padStart(2)} ${name} ${odds} ${fuku} ${weight} ${training}`);
  }

  // 健全性チェック
  console.log('\n--- 健全性チェック ---');
  const missingOdds = race.horses.filter((h) => h.odds === 0);
  const missingTraining = race.horses.filter((h) => h.lastThreeF === 0);

  if (missingOdds.length === 0) {
    console.log('✓ 全馬のオッズが取得できています');
  } else {
    console.warn(`△ オッズ未取得: ${missingOdds.map((h) => `${h.id}番${h.name}`).join(', ')}`);
  }

  if (missingTraining.length === 0) {
    console.log('✓ 全馬の調教タイムが取得できています');
  } else {
    console.warn(`△ 調教タイム未取得: ${missingTraining.length}頭（Phase 1-B では許容）`);
  }

  console.log('\n========================================');
  console.log('テスト完了');
  console.log('========================================');
}

main().catch((err) => {
  console.error('予期しないエラー:', err);
  process.exit(1);
});
