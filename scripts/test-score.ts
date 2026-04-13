// ==========================================
// スコア・期待値計算 健全性チェックスクリプト
// 実行方法:
//   USE_MOCK=true pnpm tsx scripts/test-score.ts
// ==========================================

import 'dotenv/config';
import { MOCK_NZT_2026 } from '../lib/scraper/__mocks__/202606030511';
import {
  calcAllScores,
  calcEV,
  validateScores,
  mean,
  median,
} from '../lib/score/calculator';
import type { Horse } from '../lib/scraper/types';

const raceId = process.argv[2] ?? '202606030511';

console.log('========================================');
console.log('スコア・期待値計算テスト');
console.log(`  raceId: ${raceId}`);
console.log('========================================\n');

function main() {
  // モックデータで Race を組み立てる
  const race = { ...MOCK_NZT_2026, raceId };

  // スコア・EV を一括計算
  const result = calcAllScores(race);
  const horses = result.horses;

  // =================================
  // スコア一覧（スコア降順）
  // =================================
  console.log('=== スコア計算結果 ===');
  const sorted = [...horses].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  for (const h of sorted) {
    if (h.odds <= 0) continue;
    const mktProb  = (1 / h.odds) * 100;
    const ev       = h.ev ?? calcEV(h, h.odds, 'tan', horses);
    // adjProb を逆算（ev = adjProb * odds）
    const adjProb  = (ev / h.odds) * 100;

    console.log(
      `${String(h.id).padStart(2)}番 ${h.name.padEnd(12)}: ` +
      `score=${(h.score ?? 0).toFixed(1).padStart(5)}, ` +
      `mktProb=${mktProb.toFixed(1).padStart(5)}%, ` +
      `adjProb=${adjProb.toFixed(1).padStart(5)}%, ` +
      `EV(単勝)=${ev.toFixed(3)}`
    );
  }

  // =================================
  // 期待値統計
  // =================================
  console.log('\n=== 期待値統計 ===');

  const evList        = horses.map((h) => h.ev ?? 0).filter((v) => v > 0);
  const favHorses     = horses.filter((h) => h.odds < 10  && (h.ev ?? 0) > 0);
  const longshotHorses = horses.filter((h) => h.odds > 30 && (h.ev ?? 0) > 0);

  const medEV       = median(evList);
  const favAvgEV    = mean(favHorses.map((h) => h.ev ?? 0));
  const longAvgEV   = mean(longshotHorses.map((h) => h.ev ?? 0));
  const maxEV       = Math.max(...evList);
  const maxEVHorse  = horses.find((h) => (h.ev ?? 0) === maxEV);

  console.log(`中央値EV            : ${medEV.toFixed(3)}`);
  console.log(`人気馬（〜10倍）平均EV: ${favAvgEV.toFixed(3)}（${favHorses.length}頭）`);
  console.log(`人気薄（30倍超）平均EV: ${longAvgEV.toFixed(3)}（${longshotHorses.length}頭）`);
  console.log(`最高EV              : ${maxEV.toFixed(3)}（${maxEVHorse?.id}番 ${maxEVHorse?.name}）`);

  // =================================
  // 健全性チェック
  // =================================
  console.log('\n=== 健全性チェック ===');
  const passed = validateScores(horses);

  // 追加チェック: 最高EVが1.5を超えていないか
  if (maxEV > 1.5) {
    console.error(`[check] 最高EVが1.5を超えています: ${maxEV.toFixed(3)}`);
  } else {
    console.log(`[calculator] ✓ 最高EV ${maxEV.toFixed(3)} は 1.5 以下`);
  }

  // =================================
  // 複勝EV も参考表示
  // =================================
  console.log('\n=== 複勝EV（参考） ===');
  const fukuSorted = [...horses]
    .filter((h) => h.fukuOddsMin > 0)
    .map((h): Horse & { fukuEV: number } => ({
      ...h,
      fukuEV: calcEV(h, (h.fukuOddsMin + h.fukuOddsMax) / 2, 'fuku', horses),
    }))
    .sort((a, b) => b.fukuEV - a.fukuEV)
    .slice(0, 5);

  for (const h of fukuSorted) {
    console.log(
      `${String(h.id).padStart(2)}番 ${h.name.padEnd(12)}: ` +
      `複勝EV=${h.fukuEV.toFixed(3)} ` +
      `（複勝オッズ ${h.fukuOddsMin}-${h.fukuOddsMax}）`
    );
  }

  console.log('\n========================================');
  console.log(passed && maxEV <= 1.5 ? '✓ 全チェック通過' : '✗ チェック失敗 — ロジックを見直してください');
  console.log('========================================');

  process.exit(passed && maxEV <= 1.5 ? 0 : 1);
}

main();
