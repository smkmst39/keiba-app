// ==========================================
// 馬連本命 ∩ ワイド堅実 AND条件 組み合わせ戦略 検証
//
// 仮説: 両券種で推奨が同時に出るレース = 最も信頼性が高い本命
//       このレースだけに絞ることで更なる ROI 向上が期待できる。
//
// 検証パターン:
//   現行H: 各券種独立 (馬連 670R 265.4% / ワイド 780R 121.8%)
//   AND : 馬連本命 ∩ ワイド堅実 成立レースのみ (両券種購入)
//   AND_馬連のみ: 上記レースで馬連のみ
//   AND_ワイドのみ: 上記レースでワイドのみ
//
// 実行: pnpm tsx scripts/and_condition_analysis.ts
// 出力: scripts/verification/and_condition_report.md
// ==========================================

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { VerificationData } from '../lib/scraper/types';

const DIR = path.resolve(__dirname, 'verification');
const REPORT = path.join(DIR, 'and_condition_report.md');

// ----------------------------------------
// 本番と同じ除外ロジック (lib/score/calculator.ts を踏襲)
// ----------------------------------------

function isExcludedForUmarenUmatan(raceClass: string | undefined): boolean {
  if (!raceClass) return false;
  return /1勝|500万|2勝|1000万/.test(raceClass);
}
function isExcludedForWide(raceClass: string | undefined): boolean {
  if (!raceClass) return false;
  return /1勝|500万/.test(raceClass);
}

// ----------------------------------------
// 判定ロジック
// ----------------------------------------

type Prediction = VerificationData['predictions'][number];

function sortedByEV(preds: Prediction[]): Prediction[] {
  return [...preds].filter((p) => p.odds > 0).sort((a, b) => b.ev - a.ev);
}

function isUmarenHonmei(preds: Prediction[], raceClass?: string): boolean {
  if (isExcludedForUmarenUmatan(raceClass)) return false;
  const s = sortedByEV(preds);
  if (s.length < 2) return false;
  return s[0].ev >= 1.00 && s[1].ev >= 1.00 && s[0].score >= 65 && s[1].score >= 65;
}

function isWideKenjitsu(preds: Prediction[], raceClass?: string): boolean {
  if (isExcludedForWide(raceClass)) return false;
  const s = sortedByEV(preds);
  if (s.length < 2) return false;
  return s[0].ev >= 1.02 && s[1].ev >= 1.02 && s[0].score >= 65 && s[1].score >= 65
      && s[0].odds <= 10 && s[1].odds <= 10;
}

// ----------------------------------------
// 配当計算
// ----------------------------------------

const sameSet = (a: number[], b: number[]): boolean =>
  a.length === b.length && [...a].sort((x, y) => x - y).join(',') === [...b].sort((x, y) => x - y).join(',');

function payoutUmaren(vd: VerificationData, ids: number[]): number {
  for (const u of vd.results.payouts.umaren) {
    if (sameSet(ids, u.combination.split('-').map(Number))) return u.payout;
  }
  return 0;
}

function payoutWide(vd: VerificationData, ids: number[]): number {
  for (const w of vd.results.payouts.wide ?? []) {
    if (sameSet(ids, w.combination.split('-').map(Number))) return w.payout;
  }
  return 0;
}

// ----------------------------------------
// オッズ帯
// ----------------------------------------

type Band = 'favorite' | 'middle' | 'longshot';
const BAND_LABEL: Record<Band, string> = {
  favorite: '人気馬(〜5倍)',
  middle:   '中穴(5〜20倍)',
  longshot: '大穴(20倍〜)',
};
const bandOf = (o: number): Band => o < 5 ? 'favorite' : o < 20 ? 'middle' : 'longshot';

// ----------------------------------------
// メイン集計
// ----------------------------------------

type Stats = { races: number; hits: number; cost: number; payout: number };
const empty = (): Stats => ({ races: 0, hits: 0, cost: 0, payout: 0 });
const roi = (s: Stats): number => s.cost > 0 ? (s.payout / s.cost) * 100 : 0;
const pct = (n: number, d: number): string => d === 0 ? 'N/A' : `${((n / d) * 100).toFixed(1)}%`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getRaceClass(vd: any): string | undefined {
  return vd?.meta?.raceClass;
}

async function loadData(): Promise<VerificationData[]> {
  const files = (await fs.readdir(DIR)).filter((f) => f.endsWith('.json'));
  const out: VerificationData[] = [];
  for (const f of files) {
    try { out.push(JSON.parse(await fs.readFile(path.join(DIR, f), 'utf-8'))); } catch {}
  }
  return out;
}

async function main(): Promise<void> {
  const all = await loadData();
  if (all.length === 0) { console.error('no data'); process.exit(1); }

  // 各パターンの Stats
  const hOnly_umaren  = empty(); // 現行H 馬連本命のみ
  const hOnly_wide    = empty(); // 現行H ワイド堅実のみ
  const hOnly_both    = empty(); // 現行H 両方合算 (独立判定でどちらか成立)
  const andBoth_umaren = empty(); // AND 両方成立時の馬連
  const andBoth_wide   = empty(); // AND 両方成立時のワイド
  const andOnly_umaren = empty(); // AND時 馬連のみ買う (ワイドは買わない)
  const andOnly_wide   = empty(); // AND時 ワイドのみ買う (馬連は買わない)

  // AND条件レースのクラス・オッズ帯分布
  const andClassDist = new Map<string, number>();
  const andBandDist  = { favorite: 0, middle: 0, longshot: 0 };
  const andOddsList: number[] = [];
  const andHeadList: number[] = [];

  // 重複・単独カウント
  let umarenOnlyCount = 0;
  let wideOnlyCount   = 0;
  let bothCount       = 0;

  for (const vd of all) {
    if (vd.predictions.length < 2 || vd.results.results.length === 0) continue;
    const raceClass = getRaceClass(vd);
    const uRec = isUmarenHonmei(vd.predictions, raceClass);
    const wRec = isWideKenjitsu(vd.predictions, raceClass);

    const s = sortedByEV(vd.predictions);
    const p1 = s[0], p2 = s[1];
    if (!p1 || !p2) continue;
    const ids = [p1.horseId, p2.horseId];

    // 現行H 馬連本命
    if (uRec) {
      hOnly_umaren.races++;
      hOnly_umaren.cost += 100;
      const pay = payoutUmaren(vd, ids);
      hOnly_umaren.payout += pay;
      if (pay > 0) hOnly_umaren.hits++;
    }
    // 現行H ワイド堅実
    if (wRec) {
      hOnly_wide.races++;
      hOnly_wide.cost += 100;
      const pay = payoutWide(vd, ids);
      hOnly_wide.payout += pay;
      if (pay > 0) hOnly_wide.hits++;
    }
    // 現行H どちらか成立 (合算的な参考)
    if (uRec || wRec) {
      hOnly_both.races++;
      let c = 0, p = 0, hit = false;
      if (uRec) { c += 100; const pp = payoutUmaren(vd, ids); p += pp; if (pp > 0) hit = true; }
      if (wRec) { c += 100; const pp = payoutWide(vd, ids);   p += pp; if (pp > 0) hit = true; }
      hOnly_both.cost += c;
      hOnly_both.payout += p;
      if (hit) hOnly_both.hits++;
    }

    // AND条件
    if (uRec && wRec) {
      bothCount++;

      // AND 両方買う
      andBoth_umaren.races++;
      andBoth_umaren.cost += 100;
      const upay = payoutUmaren(vd, ids);
      andBoth_umaren.payout += upay;
      if (upay > 0) andBoth_umaren.hits++;

      andBoth_wide.races++;
      andBoth_wide.cost += 100;
      const wpay = payoutWide(vd, ids);
      andBoth_wide.payout += wpay;
      if (wpay > 0) andBoth_wide.hits++;

      // AND時 馬連のみ
      andOnly_umaren.races++;
      andOnly_umaren.cost += 100;
      andOnly_umaren.payout += upay;
      if (upay > 0) andOnly_umaren.hits++;

      // AND時 ワイドのみ
      andOnly_wide.races++;
      andOnly_wide.cost += 100;
      andOnly_wide.payout += wpay;
      if (wpay > 0) andOnly_wide.hits++;

      // クラス分布
      const cls = raceClass ?? '不明';
      andClassDist.set(cls, (andClassDist.get(cls) ?? 0) + 1);
      // オッズ帯分布 (top2の平均オッズ)
      const avgOdds = (p1.odds + p2.odds) / 2;
      andOddsList.push(avgOdds);
      andBandDist[bandOf(avgOdds)]++;
      // 頭数
      andHeadList.push(vd.predictions.length);
    } else if (uRec) {
      umarenOnlyCount++;
    } else if (wRec) {
      wideOnlyCount++;
    }
  }

  const avgOdds = andOddsList.length > 0 ? andOddsList.reduce((s, x) => s + x, 0) / andOddsList.length : 0;
  const avgHead = andHeadList.length > 0 ? andHeadList.reduce((s, x) => s + x, 0) / andHeadList.length : 0;

  // ---- 出力 ----
  const log = (s = ''): void => console.log(s);
  const md: string[] = [];
  const mp = (s = ''): void => { md.push(s); };

  log('='.repeat(88));
  log('  馬連本命 ∩ ワイド堅実 AND条件 組み合わせ戦略 検証');
  log('='.repeat(88));
  log('');
  log(`対象: ${all.length} R`);
  log(`馬連本命推奨: ${hOnly_umaren.races}R`);
  log(`ワイド堅実推奨: ${hOnly_wide.races}R`);
  log(`どちらか成立: ${hOnly_both.races}R`);
  log(`両方成立 (AND): ${bothCount}R`);
  log(`馬連のみ成立: ${umarenOnlyCount}R`);
  log(`ワイドのみ成立: ${wideOnlyCount}R`);
  log('');

  // 重複率
  const overlapOfUmaren = hOnly_umaren.races > 0 ? (bothCount / hOnly_umaren.races) * 100 : 0;
  const overlapOfWide   = hOnly_wide.races   > 0 ? (bothCount / hOnly_wide.races)   * 100 : 0;
  log('▼ 重複率');
  log(`  馬連本命 ${hOnly_umaren.races}R のうちワイド堅実も成立: ${bothCount}R (${overlapOfUmaren.toFixed(1)}%)`);
  log(`  ワイド堅実 ${hOnly_wide.races}R のうち馬連本命も成立:   ${bothCount}R (${overlapOfWide.toFixed(1)}%)`);
  log('');

  // パターン別 ROI
  log('▼ パターン別 ROI');
  log('-'.repeat(88));
  log('| パターン                     | 参加R | 的中 | 的中率 | 投資   | 払戻   | ROI    |');
  log('|------------------------------|-------|------|--------|--------|--------|--------|');
  const row = (label: string, s: Stats): void => {
    log(`| ${label.padEnd(28)} | ${s.races.toString().padStart(5)} | ${s.hits.toString().padStart(4)} | ${pct(s.hits, s.races).padStart(6)} | ${s.cost.toLocaleString().padStart(6)} | ${s.payout.toLocaleString().padStart(6)} | ${(roi(s).toFixed(1) + '%').padStart(6)} |`);
  };
  row('現行H 馬連本命',    hOnly_umaren);
  row('現行H ワイド堅実',  hOnly_wide);
  row('AND 馬連本命 (両方成立時)', andBoth_umaren);
  row('AND ワイド堅実 (両方成立時)', andBoth_wide);
  log('');

  // AND 合算 (馬連 + ワイド 両方買う)
  const andBothSum: Stats = {
    races: bothCount,
    hits: 0,
    cost: andBoth_umaren.cost + andBoth_wide.cost,
    payout: andBoth_umaren.payout + andBoth_wide.payout,
  };
  log('▼ AND 合算 (両方成立レースで馬連+ワイド両方購入、1レース 200円投資)');
  log(`  参加 ${bothCount}R / 投資 ${andBothSum.cost.toLocaleString()}円 / 払戻 ${andBothSum.payout.toLocaleString()}円 / ROI ${(roi(andBothSum)).toFixed(1)}%`);
  const avgPnl = bothCount > 0 ? (andBothSum.payout - andBothSum.cost) / bothCount : 0;
  log(`  1レース平均純益: ${avgPnl.toFixed(0)}円 (投資200円)`);
  log('');

  // 現行H 合算 (独立判定で馬連・ワイド両方買う、870R 程度)
  const hSum: Stats = {
    races: hOnly_both.races,
    hits: 0,
    cost: hOnly_umaren.cost + hOnly_wide.cost,
    payout: hOnly_umaren.payout + hOnly_wide.payout,
  };
  const hAvgPnl = hOnly_both.races > 0 ? (hSum.payout - hSum.cost) / hOnly_both.races : 0;
  log('▼ 現行H 合算 (独立判定、どちらか成立時に該当券種を買う)');
  log(`  参加 ${hOnly_both.races}R / 投資 ${hSum.cost.toLocaleString()}円 / 払戻 ${hSum.payout.toLocaleString()}円 / ROI ${(roi(hSum)).toFixed(1)}%`);
  log(`  1レース平均純益: ${hAvgPnl.toFixed(0)}円`);
  log('');

  // AND レースのクラス分布
  log('▼ AND レースのクラス分布');
  log('-'.repeat(88));
  const andClassArr = Array.from(andClassDist.entries()).sort((a, b) => b[1] - a[1]);
  for (const [cls, n] of andClassArr) {
    log(`  ${cls.padEnd(14)}: ${n.toString().padStart(3)} R (${((n / bothCount) * 100).toFixed(1)}%)`);
  }
  log('');

  log('▼ AND レースのオッズ帯分布 (上位2頭平均オッズ)');
  log(`  ${BAND_LABEL.favorite.padEnd(16)}: ${andBandDist.favorite} R (${((andBandDist.favorite / bothCount) * 100).toFixed(1)}%)`);
  log(`  ${BAND_LABEL.middle.padEnd(16)}: ${andBandDist.middle} R (${((andBandDist.middle / bothCount) * 100).toFixed(1)}%)`);
  log(`  ${BAND_LABEL.longshot.padEnd(16)}: ${andBandDist.longshot} R`);
  log(`  平均オッズ: ${avgOdds.toFixed(2)} / 平均頭数: ${avgHead.toFixed(1)}`);
  log('');

  // シナリオ比較
  const currentH_pnl_per_race = hAvgPnl;
  const and_pnl_per_race      = avgPnl;
  const andCombinedRoi = roi(andBothSum);
  const hCombinedRoi   = roi(hSum);

  log('▼ シナリオ比較');
  log('-'.repeat(88));
  log('| 指標              | 現行H           | AND-UW          |');
  log('|-------------------|-----------------|-----------------|');
  log(`| 参加R            | ${hOnly_both.races.toString().padEnd(15)} | ${bothCount.toString().padEnd(15)} |`);
  log(`| 投資/R           | ${((hSum.cost / Math.max(1, hOnly_both.races)).toFixed(0) + '円').padEnd(15)} | ${((andBothSum.cost / Math.max(1, bothCount)).toFixed(0) + '円').padEnd(15)} |`);
  log(`| 合計ROI          | ${(hCombinedRoi.toFixed(1) + '%').padEnd(15)} | ${(andCombinedRoi.toFixed(1) + '%').padEnd(15)} |`);
  log(`| 平均純益/R       | ${(hAvgPnl.toFixed(0) + '円').padEnd(15)} | ${(and_pnl_per_race.toFixed(0) + '円').padEnd(15)} |`);
  log(`| 機会損失 (不参加R) | ${(all.length - hOnly_both.races).toString().padEnd(15)} | ${(all.length - bothCount).toString().padEnd(15)} |`);
  log('');

  // 判断基準
  const meetRoi      = andCombinedRoi > hCombinedRoi;
  const meetVolume   = bothCount >= 300;
  const meetPnl      = and_pnl_per_race > currentH_pnl_per_race;
  log('▼ 判断基準');
  log('-'.repeat(88));
  log(`  ① AND合計ROI > 現行Hの合計ROI         : ${meetRoi ? '✅' : '❌'} (${andCombinedRoi.toFixed(1)}% vs ${hCombinedRoi.toFixed(1)}%)`);
  log(`  ② 参加R ≥ 300                         : ${meetVolume ? '✅' : '❌'} (${bothCount}R)`);
  log(`  ③ 平均純益/R > 現行Hの +${currentH_pnl_per_race.toFixed(0)}円 : ${meetPnl ? '✅' : '❌'} (${and_pnl_per_race.toFixed(0)}円)`);
  log('');

  const allMet = meetRoi && meetVolume && meetPnl;
  const verdict = allMet ? '✅ Go (本番適用推奨)' : '⚠️ 要検討 (基準未達)';
  log(`  総合判定: **${verdict}**`);
  log('');

  // ----------------------------------------
  // Markdown レポート
  // ----------------------------------------
  mp(`# AND 条件組み合わせ戦略 検証レポート`);
  mp('');
  mp(`- 生成日時: ${new Date().toISOString()}`);
  mp(`- 対象: **${all.length} R** (Phase 2G 930R データ)`);
  mp(`- 検証: 馬連本命 ∩ ワイド堅実 の AND 条件 (両券種共に推奨が出るレースに絞り込み)`);
  mp('');

  mp(`## 1. 重複率`);
  mp('');
  mp(`| 指標 | 数値 |`);
  mp(`|---|---|`);
  mp(`| 馬連本命推奨 | ${hOnly_umaren.races} R |`);
  mp(`| ワイド堅実推奨 | ${hOnly_wide.races} R |`);
  mp(`| 両方成立 (AND) | **${bothCount} R** |`);
  mp(`| 馬連本命のみ (ワイド不成立) | ${umarenOnlyCount} R |`);
  mp(`| ワイドのみ (馬連本命不成立) | ${wideOnlyCount} R |`);
  mp(`| 馬連本命 × ワイド 重複率 | **${overlapOfUmaren.toFixed(1)}%** (馬連ベース) |`);
  mp(`| ワイド × 馬連 重複率 | ${overlapOfWide.toFixed(1)}% (ワイドベース) |`);
  mp('');

  mp(`## 2. パターン別 ROI 比較`);
  mp('');
  mp(`| パターン | 参加R | 的中R | 的中率 | 投資額 | 払戻額 | **ROI** |`);
  mp(`|---|---|---|---|---|---|---|`);
  const mdRow = (label: string, s: Stats): void => {
    mp(`| ${label} | ${s.races} | ${s.hits} | ${pct(s.hits, s.races)} | ${s.cost.toLocaleString()}円 | ${s.payout.toLocaleString()}円 | **${roi(s).toFixed(1)}%** |`);
  };
  mdRow('現行H 馬連本命 (独立判定)',   hOnly_umaren);
  mdRow('現行H ワイド堅実 (独立判定)', hOnly_wide);
  mdRow('AND 馬連本命 (両方成立時)',  andBoth_umaren);
  mdRow('AND ワイド堅実 (両方成立時)', andBoth_wide);
  mdRow('**AND 合算** (馬連+ワイド両方購入)', andBothSum);
  mdRow('現行H 合算 (参照: 独立OR判定での合算)', hSum);
  mp('');

  mp(`## 3. AND レースの副次分析`);
  mp('');
  mp(`### クラス分布`);
  mp('');
  mp(`| クラス | レース数 | 占有率 |`);
  mp(`|---|---|---|`);
  for (const [cls, n] of andClassArr) {
    mp(`| ${cls} | ${n} | ${((n / bothCount) * 100).toFixed(1)}% |`);
  }
  mp('');
  mp(`### オッズ帯分布 (上位2頭平均オッズ)`);
  mp('');
  mp(`| 帯 | レース数 | 占有率 |`);
  mp(`|---|---|---|`);
  mp(`| ${BAND_LABEL.favorite} | ${andBandDist.favorite} | ${((andBandDist.favorite / bothCount) * 100).toFixed(1)}% |`);
  mp(`| ${BAND_LABEL.middle}   | ${andBandDist.middle}   | ${((andBandDist.middle / bothCount) * 100).toFixed(1)}% |`);
  mp(`| ${BAND_LABEL.longshot} | ${andBandDist.longshot} | ${((andBandDist.longshot / bothCount) * 100).toFixed(1)}% |`);
  mp('');
  mp(`- 平均オッズ (上位2頭): **${avgOdds.toFixed(2)}倍**`);
  mp(`- 平均頭数: **${avgHead.toFixed(1)}頭**`);
  mp('');

  mp(`## 4. シナリオ比較`);
  mp('');
  mp(`| 指標 | 現行H | AND-UW | 差分 |`);
  mp(`|---|---|---|---|`);
  mp(`| 参加R | ${hOnly_both.races} | ${bothCount} | ${bothCount - hOnly_both.races} |`);
  mp(`| 投資/R | ${(hSum.cost / Math.max(1, hOnly_both.races)).toFixed(0)}円 | ${(andBothSum.cost / Math.max(1, bothCount)).toFixed(0)}円 | — |`);
  mp(`| 合計ROI | ${hCombinedRoi.toFixed(1)}% | **${andCombinedRoi.toFixed(1)}%** | ${(andCombinedRoi - hCombinedRoi >= 0 ? '+' : '') + (andCombinedRoi - hCombinedRoi).toFixed(1)}pt |`);
  mp(`| 平均純益/R | ${hAvgPnl.toFixed(0)}円 | **${and_pnl_per_race.toFixed(0)}円** | ${(and_pnl_per_race - hAvgPnl >= 0 ? '+' : '') + (and_pnl_per_race - hAvgPnl).toFixed(0)}円 |`);
  mp(`| 機会損失 (不参加R) | ${all.length - hOnly_both.races} | ${all.length - bothCount} | — |`);
  mp('');

  mp(`## 5. 判断基準`);
  mp('');
  mp(`| 基準 | 判定 | 実測 |`);
  mp(`|---|---|---|`);
  mp(`| ① AND合計ROI > 現行Hの合計ROI | ${meetRoi ? '✅' : '❌'} | ${andCombinedRoi.toFixed(1)}% vs ${hCombinedRoi.toFixed(1)}% |`);
  mp(`| ② 参加R ≥ 300 | ${meetVolume ? '✅' : '❌'} | ${bothCount} R |`);
  mp(`| ③ 平均純益/R > 現行Hの ${currentH_pnl_per_race.toFixed(0)}円 | ${meetPnl ? '✅' : '❌'} | ${and_pnl_per_race.toFixed(0)}円 |`);
  mp('');
  mp(`### 総合判定: ${verdict}`);
  mp('');
  if (!allMet) {
    mp(`### 未達理由と派生パターン提案`);
    mp('');
    if (!meetRoi) mp(`- **ROI 未達**: AND で絞り込んだが ROI が現行H の合算を下回る。「両方推奨 = 信頼性高」仮説は ROI ベースでは棄却される可能性`);
    if (!meetVolume) mp(`- **参加R 不足**: ${bothCount}R は 300 未満。ワイド堅実がオッズ≤10 と厳しいため重複が少ない`);
    if (!meetPnl) mp(`- **純益 /R 未達**: 投資額が現行H より増える場合、ROI が同等でも絶対純益では不利`);
    mp('');
    mp(`#### 派生検証候補`);
    mp(`1. **AND-UW-片買**: AND 条件成立時に **馬連のみ** 買う (投資100円で済む)`);
    mp(`   - 馬連ROI (AND時): **${roi(andBoth_umaren).toFixed(1)}%**`);
    mp(`   - ワイドと分散投資せず高ROI馬券に集中できる`);
    mp(`2. **AND-U-Wide参考**: 馬連本命 AND ワイド「参考級 (EV≥0.95)」など条件緩和`);
    mp(`3. **OR 条件**: 馬連 OR ワイド (機会拡大戦略)`);
    mp(`4. **馬連 AND 馬単**: 順序感まで合致する超信頼シグナル`);
  }
  mp('');

  mp(`## 6. 参考: 個別買いシナリオ`);
  mp('');
  mp(`AND 条件成立レースで、どちらか 1 券種だけに絞った場合:`);
  mp('');
  mp(`| 戦略 | 参加R | ROI | 平均純益/R |`);
  mp(`|---|---|---|---|`);
  mp(`| AND-馬連のみ | ${andOnly_umaren.races} | **${roi(andOnly_umaren).toFixed(1)}%** | ${andOnly_umaren.races > 0 ? ((andOnly_umaren.payout - andOnly_umaren.cost) / andOnly_umaren.races).toFixed(0) : 0}円 |`);
  mp(`| AND-ワイドのみ | ${andOnly_wide.races} | **${roi(andOnly_wide).toFixed(1)}%** | ${andOnly_wide.races > 0 ? ((andOnly_wide.payout - andOnly_wide.cost) / andOnly_wide.races).toFixed(0) : 0}円 |`);
  mp('');

  mp(`## 7. 次の検証候補 (参考)`);
  mp('');
  mp(`- 馬連本命 AND 馬単本命 (3券種AND=より強い絞り込み)`);
  mp(`- ワイド堅実 AND 3連複 (3連複の top-3 一致)`);
  mp(`- OR 条件: 馬連 ∪ ワイド (機会拡大、純益総額ベース)`);
  mp(`- クラス限定 AND: 未勝利戦のみで AND 条件 (未勝利は本命級ROI 245%)`);
  mp('');
  mp(`---`);
  mp(`*再実行: \`pnpm tsx scripts/and_condition_analysis.ts\`*`);

  await fs.writeFile(REPORT, md.join('\n'), 'utf-8');
  log(`Markdown: ${REPORT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
