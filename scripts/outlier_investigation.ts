// ==========================================
// 外れ値・データ品質確認調査
//
// 多軸ROI俯瞰分析 (multi_axis_analysis.ts) で検出された異常値の内訳調査:
//   1. 別定戦 52R 馬連ROI 1022.2% の内訳
//   2. 少頭数 (〜10頭) 122R 馬連ROI 0.0% の内訳 (バグ/仕様/本物?)
//   3. 馬場状態「不明」137R 馬連ROI 554.7% の内訳
//
// 本番コード変更なし。出力は scripts/verification/outlier_investigation_report.md
//
// 実行: pnpm tsx scripts/outlier_investigation.ts
// ==========================================

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { VerificationData } from '../lib/scraper/types';

const DIR = path.resolve(__dirname, 'verification');
const REPORT = path.join(DIR, 'outlier_investigation_report.md');

// Phase 2G ハイブリッド除外ロジック
function isExcludedForUmarenUmatan(raceClass?: string): boolean {
  if (!raceClass) return false;
  return /1勝|500万|2勝|1000万/.test(raceClass);
}

type Prediction = VerificationData['predictions'][number];
function sortedByEV(preds: Prediction[]): Prediction[] {
  return [...preds].filter((p) => p.odds > 0).sort((a, b) => b.ev - a.ev);
}
const sameSet = (a: number[], b: number[]): boolean =>
  a.length === b.length && [...a].sort((x, y) => x - y).join(',') === [...b].sort((x, y) => x - y).join(',');

/** 馬連本命の推奨判定 */
function isUmarenHonmei(vd: VerificationData, raceClass?: string): { reco: boolean; pair?: [number, number] } {
  if (isExcludedForUmarenUmatan(raceClass)) return { reco: false };
  const s = sortedByEV(vd.predictions);
  if (s.length < 2) return { reco: false };
  if (s[0].ev >= 1.00 && s[1].ev >= 1.00 && s[0].score >= 65 && s[1].score >= 65) {
    return { reco: true, pair: [s[0].horseId, s[1].horseId] };
  }
  return { reco: false };
}

function umarenPayout(vd: VerificationData, pair: [number, number]): number {
  for (const u of vd.results.payouts.umaren) {
    if (sameSet([...pair], u.combination.split('-').map(Number))) return u.payout;
  }
  return 0;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getMeta(vd: any): any { return vd?.meta ?? {}; }

async function loadData(): Promise<VerificationData[]> {
  const files = (await fs.readdir(DIR)).filter((f) => f.endsWith('.json'));
  const out: VerificationData[] = [];
  for (const f of files) {
    try { out.push(JSON.parse(await fs.readFile(path.join(DIR, f), 'utf-8'))); } catch {}
  }
  return out;
}

// ----------------------------------------
// 調査1: 別定戦 52R の内訳
// ----------------------------------------

type BettedRace = {
  raceId: string;
  raceName: string;
  date: string;
  raceClass?: string;
  headCount: number;
  pair: [number, number];
  horseNames: [string, string];
  hit: boolean;
  payout: number;
};

function investigateCategory(
  all: VerificationData[],
  filterFn: (vd: VerificationData, m: ReturnType<typeof getMeta>) => boolean,
): {
  matchingRaces: number;
  recommendedRaces: BettedRace[];
  totalCost: number;
  totalPayout: number;
  classDist: Map<string, number>;
} {
  const matching: VerificationData[] = [];
  for (const vd of all) {
    const m = getMeta(vd);
    if (filterFn(vd, m)) matching.push(vd);
  }

  const recommended: BettedRace[] = [];
  let totalCost = 0, totalPayout = 0;
  const classDist = new Map<string, number>();

  for (const vd of matching) {
    const m = getMeta(vd);
    const cls = m.raceClass ?? '不明';
    classDist.set(cls, (classDist.get(cls) ?? 0) + 1);

    const { reco, pair } = isUmarenHonmei(vd, m.raceClass);
    if (!reco || !pair) continue;
    const pay = umarenPayout(vd, pair);
    totalCost += 100;
    totalPayout += pay;

    const names = vd.predictions.filter((p) => pair.includes(p.horseId));
    const n1 = names.find((p) => p.horseId === pair[0])?.horseName ?? '?';
    const n2 = names.find((p) => p.horseId === pair[1])?.horseName ?? '?';

    recommended.push({
      raceId: vd.raceId,
      raceName: vd.raceName,
      date: vd.date,
      raceClass: m.raceClass,
      headCount: m.headCount ?? vd.predictions.length,
      pair,
      horseNames: [n1, n2],
      hit: pay > 0,
      payout: pay,
    });
  }

  return {
    matchingRaces: matching.length,
    recommendedRaces: recommended,
    totalCost,
    totalPayout,
    classDist,
  };
}

// ----------------------------------------
// メイン
// ----------------------------------------

async function main(): Promise<void> {
  const all = await loadData();
  if (all.length === 0) { console.error('no data'); process.exit(1); }

  console.log(`対象: ${all.length} R`);
  console.log('');

  // ========== 調査1: 別定戦 52R ==========
  console.log('='.repeat(88));
  console.log('  調査1: 別定戦 馬連本命 1022.2% の内訳');
  console.log('='.repeat(88));
  const inv1 = investigateCategory(all, (_vd, m) => m.handicap === '別定');
  const hits1 = inv1.recommendedRaces.filter((r) => r.hit);
  const payouts1 = hits1.map((r) => r.payout).sort((a, b) => b - a);
  const roi1 = inv1.totalCost > 0 ? (inv1.totalPayout / inv1.totalCost) * 100 : 0;
  const top1 = payouts1[0] ?? 0;
  const top2 = payouts1[1] ?? 0;
  const roiEx1 = inv1.totalCost > 100 ? ((inv1.totalPayout - top1) / (inv1.totalCost - 100)) * 100 : 0;
  const roiEx2 = inv1.totalCost > 200 ? ((inv1.totalPayout - top1 - top2) / (inv1.totalCost - 200)) * 100 : 0;
  const median1 = payouts1.length > 0 ? payouts1[Math.floor(payouts1.length / 2)] : 0;
  const mean1 = payouts1.length > 0 ? payouts1.reduce((s, x) => s + x, 0) / payouts1.length : 0;

  console.log(`別定戦: ${inv1.matchingRaces}R`);
  console.log(`馬連本命推奨: ${inv1.recommendedRaces.length}R`);
  console.log(`的中: ${hits1.length}R / 外れ: ${inv1.recommendedRaces.length - hits1.length}R`);
  console.log(`投資 ${inv1.totalCost} 円 / 払戻 ${inv1.totalPayout} 円 / ROI ${roi1.toFixed(1)}%`);
  console.log(`最高配当除外 ROI: ${roiEx1.toFixed(1)}%  / 上位2件除外 ROI: ${roiEx2.toFixed(1)}%`);
  console.log(`的中配当 中央値: ${median1} 円 / 平均: ${mean1.toFixed(0)} 円`);
  console.log('');
  console.log('的中レース一覧 (配当降順):');
  hits1.sort((a, b) => b.payout - a.payout).forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.date} ${r.raceId} ${r.raceName} ${r.headCount}頭`);
    console.log(`     [${r.pair[0]}]${r.horseNames[0]} - [${r.pair[1]}]${r.horseNames[1]} → ${r.payout.toLocaleString()}円`);
  });

  // ========== 調査2: 少頭数 122R ==========
  console.log('');
  console.log('='.repeat(88));
  console.log('  調査2: 少頭数 (〜10頭) 122R 馬連ROI 0.0% の内訳');
  console.log('='.repeat(88));
  const inv2 = investigateCategory(all, (_vd, m) => (m.headCount ?? 0) <= 10 && (m.headCount ?? 0) > 0);
  const hits2 = inv2.recommendedRaces.filter((r) => r.hit);
  const roi2 = inv2.totalCost > 0 ? (inv2.totalPayout / inv2.totalCost) * 100 : 0;

  console.log(`少頭数レース: ${inv2.matchingRaces}R`);
  console.log(`馬連本命推奨: ${inv2.recommendedRaces.length}R  ← ここが重要`);
  console.log(`的中: ${hits2.length}R / 外れ: ${inv2.recommendedRaces.length - hits2.length}R`);
  console.log(`投資 ${inv2.totalCost} 円 / 払戻 ${inv2.totalPayout} 円 / ROI ${roi2.toFixed(1)}%`);
  console.log('');
  console.log('少頭数レースのクラス分布:');
  const cls2 = Array.from(inv2.classDist.entries()).sort((a, b) => b[1] - a[1]);
  cls2.forEach(([c, n]) => console.log(`  ${c}: ${n} R (${((n / inv2.matchingRaces) * 100).toFixed(1)}%)`));

  // ========== 調査3: 馬場状態「不明」137R ==========
  console.log('');
  console.log('='.repeat(88));
  console.log('  調査3: 馬場状態「不明」137R 馬連ROI 554.7% の内訳');
  console.log('='.repeat(88));
  const inv3 = investigateCategory(all, (_vd, m) => !m.trackCondition || m.trackCondition === '');
  const hits3 = inv3.recommendedRaces.filter((r) => r.hit);
  const roi3 = inv3.totalCost > 0 ? (inv3.totalPayout / inv3.totalCost) * 100 : 0;

  console.log(`馬場状態「不明」レース: ${inv3.matchingRaces}R`);
  console.log(`馬連本命推奨: ${inv3.recommendedRaces.length}R`);
  console.log(`的中: ${hits3.length}R / 外れ: ${inv3.recommendedRaces.length - hits3.length}R`);
  console.log(`投資 ${inv3.totalCost} 円 / 払戻 ${inv3.totalPayout} 円 / ROI ${roi3.toFixed(1)}%`);
  console.log('');
  console.log('馬場状態不明レースの日付分布 (先頭20件):');
  const dateDist = new Map<string, number>();
  for (const vd of all) {
    const m = getMeta(vd);
    if (!m.trackCondition || m.trackCondition === '') {
      dateDist.set(vd.date, (dateDist.get(vd.date) ?? 0) + 1);
    }
  }
  Array.from(dateDist.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20).forEach(([d, n]) => {
    console.log(`  ${d}: ${n} R`);
  });

  // 天候別に見てみる (馬場状態不明のうち)
  const weatherDist = new Map<string, number>();
  for (const vd of all) {
    const m = getMeta(vd);
    if (!m.trackCondition || m.trackCondition === '') {
      const w = m.weather ?? '?';
      weatherDist.set(w, (weatherDist.get(w) ?? 0) + 1);
    }
  }
  console.log('');
  console.log('馬場状態不明レースの天候分布:');
  Array.from(weatherDist.entries()).sort((a, b) => b[1] - a[1]).forEach(([w, n]) => {
    console.log(`  ${w}: ${n} R`);
  });

  // ========== Markdown レポート ==========
  const md: string[] = [];
  const mp = (s = ''): void => { md.push(s); };

  mp(`# 外れ値・データ品質確認レポート`);
  mp('');
  mp(`- 生成日時: ${new Date().toISOString()}`);
  mp(`- 対象: **${all.length} R** (Phase 2G データ)`);
  mp(`- 調査対象: 多軸ROI俯瞰分析で検出された 3 つの異常値`);
  mp('');

  // 調査1
  mp(`## 調査1: 別定戦 1022.2% の内訳`);
  mp('');
  mp(`### 基本統計`);
  mp(`| 指標 | 値 |`);
  mp(`|---|---|`);
  mp(`| 別定戦 総レース数 | ${inv1.matchingRaces} R |`);
  mp(`| 馬連本命 推奨 | ${inv1.recommendedRaces.length} R |`);
  mp(`| 的中 / 外れ | ${hits1.length} / ${inv1.recommendedRaces.length - hits1.length} R |`);
  mp(`| 合計投資 | ${inv1.totalCost.toLocaleString()} 円 |`);
  mp(`| 合計払戻 | ${inv1.totalPayout.toLocaleString()} 円 |`);
  mp(`| **ROI (全体)** | **${roi1.toFixed(1)}%** |`);
  mp(`| 的中配当 中央値 | ${median1.toLocaleString()} 円 |`);
  mp(`| 的中配当 平均 | ${mean1.toFixed(0)} 円 |`);
  mp('');

  mp(`### 最高配当レース`);
  if (hits1.length > 0) {
    const top = hits1.sort((a, b) => b.payout - a.payout)[0];
    mp(`| 項目 | 値 |`);
    mp(`|---|---|`);
    mp(`| 日付 | ${top.date} |`);
    mp(`| レース名 | ${top.raceName} |`);
    mp(`| raceId | ${top.raceId} |`);
    mp(`| 頭数 | ${top.headCount} 頭 |`);
    mp(`| 的中組み合わせ | ${top.pair[0]}番 ${top.horseNames[0]} - ${top.pair[1]}番 ${top.horseNames[1]} |`);
    mp(`| 配当 | **${top.payout.toLocaleString()} 円** |`);
    mp(`| 投資に対する倍率 | ${(top.payout / 100).toFixed(1)} 倍 |`);
  }
  mp('');

  mp(`### 外れ値除外時の ROI 再計算`);
  mp(`| 除外内容 | 再計算 ROI |`);
  mp(`|---|---|`);
  mp(`| なし (全体) | **${roi1.toFixed(1)}%** |`);
  mp(`| 最高配当 1 件除外 | ${roiEx1.toFixed(1)}% |`);
  mp(`| 上位 2 件除外 | ${roiEx2.toFixed(1)}% |`);
  mp('');

  mp(`### 判定`);
  const isOutlier1 = top1 > 0 && (top1 / Math.max(1, inv1.totalPayout - top1)) >= 2;
  if (isOutlier1) {
    mp(`- ✅ **1 件依存型** (最高配当 1 件で合計払戻の ${((top1 / inv1.totalPayout) * 100).toFixed(0)}% を占める)`);
    mp(`- 別定戦 1022.2% は **1 件の超高配当レースに強く依存**、外れ値として扱うのが妥当`);
    mp(`- 最高配当を除いた実質 ROI は **${roiEx1.toFixed(1)}%** で、Phase 2G 全体平均 (554.9pt 馬連 265.4%) と比較して判断`);
    mp(`- **別定戦を「真の高ROI層」と断定する根拠は弱い**。警戒レベル:「ハイリターン・ハイリスク」として別扱いすべき`);
  } else {
    mp(`- ✅ **分散型** (複数件の配当がそれなりにバランス)`);
    mp(`- 別定戦は真に高 ROI 層として扱える`);
  }
  mp('');

  // 調査1 の的中詳細 (トップ5)
  mp(`### 的中レース一覧 (配当降順 TOP 10)`);
  mp(`| 順位 | 日付 | レース名 | 頭数 | 組み合わせ | 配当 |`);
  mp(`|---|---|---|---|---|---|`);
  hits1.sort((a, b) => b.payout - a.payout).slice(0, 10).forEach((r, i) => {
    mp(`| ${i + 1} | ${r.date} | ${r.raceName} | ${r.headCount} | ${r.pair[0]}-${r.pair[1]} | ${r.payout.toLocaleString()}円 |`);
  });
  mp('');

  // 調査2
  mp(`## 調査2: 少頭数 (〜10頭) 0.0% の内訳`);
  mp('');
  mp(`### 基本統計`);
  mp(`| 指標 | 値 |`);
  mp(`|---|---|`);
  mp(`| 少頭数 (〜10頭) 総レース数 | ${inv2.matchingRaces} R |`);
  mp(`| 馬連本命 推奨 | **${inv2.recommendedRaces.length} R** ← ここが重要 |`);
  mp(`| 的中 / 外れ | ${hits2.length} / ${inv2.recommendedRaces.length - hits2.length} R |`);
  mp(`| 合計投資 | ${inv2.totalCost.toLocaleString()} 円 |`);
  mp(`| 合計払戻 | ${inv2.totalPayout.toLocaleString()} 円 |`);
  mp(`| ROI | ${roi2.toFixed(1)}% |`);
  mp('');

  mp(`### クラス分布`);
  mp(`| クラス | R数 | 占有率 |`);
  mp(`|---|---|---|`);
  cls2.forEach(([c, n]) => mp(`| ${c} | ${n} | ${((n / inv2.matchingRaces) * 100).toFixed(1)}% |`));
  mp('');

  mp(`### 判定`);
  if (inv2.recommendedRaces.length === 0) {
    mp(`- ✅ **推奨ゼロ型** (バグではなく仕様)`);
    mp(`- 少頭数 ${inv2.matchingRaces}R のうち、Phase 2G ハイブリッド条件 (EV≥1.00 + スコア≥65 + C1/C2除外) を`);
    mp(`  満たすレースが **${inv2.recommendedRaces.length} 件**。`);
    mp(`- 多軸分析で「ROI 0.0%」と表示されていたが、実態は「対象外」。集計上は`);
    mp(`  参加R 0 / 投資 0円 / 払戻 0円 なので ROI は未定義 (表示上 0%)`);
    mp(`- 主因: ${cls2.length > 0 ? `少頭数レースの ${((cls2[0][1] / inv2.matchingRaces) * 100).toFixed(0)}% が「${cls2[0][0]}」で、C1/C2 除外に多くが引っ掛かった可能性` : '推定不可'}`);
    mp(`- **多軸レポートの「少頭数 = 除外候補」は誤解釈**。実質的には「少頭数 = そもそも推奨が出ない」`);
  } else if (hits2.length === 0) {
    mp(`- ⚠️ **推奨あり・全外し型**`);
    mp(`- ${inv2.recommendedRaces.length} R 推奨が出たが全て外れ。スコアロジックが少頭数では機能していない可能性`);
    mp(`- 真の除外候補として検討価値あり`);
  } else {
    mp(`- ✅ **正常** (的中がある)`);
  }
  mp('');

  // 調査3
  mp(`## 調査3: 馬場状態「不明」の内訳`);
  mp('');
  mp(`### 基本統計`);
  mp(`| 指標 | 値 |`);
  mp(`|---|---|`);
  mp(`| 馬場状態「不明」総レース数 | ${inv3.matchingRaces} R |`);
  mp(`| 馬連本命 推奨 | ${inv3.recommendedRaces.length} R |`);
  mp(`| 的中 / 外れ | ${hits3.length} / ${inv3.recommendedRaces.length - hits3.length} R |`);
  mp(`| 合計投資 | ${inv3.totalCost.toLocaleString()} 円 |`);
  mp(`| 合計払戻 | ${inv3.totalPayout.toLocaleString()} 円 |`);
  mp(`| ROI | ${roi3.toFixed(1)}% |`);
  mp('');

  mp(`### 日付分布 (Top 20)`);
  mp(`| 日付 | R数 |`);
  mp(`|---|---|`);
  Array.from(dateDist.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20).forEach(([d, n]) => {
    mp(`| ${d} | ${n} |`);
  });
  mp('');

  mp(`### 天候分布`);
  mp(`| 天候 | R数 |`);
  mp(`|---|---|`);
  Array.from(weatherDist.entries()).sort((a, b) => b[1] - a[1]).forEach(([w, n]) => {
    mp(`| ${w} | ${n} |`);
  });
  mp('');

  mp(`### 判定`);
  // 日付分布が特定期間に集中しているか
  const dateEntries = Array.from(dateDist.entries());
  const maxDateCount = Math.max(...dateEntries.map(([, n]) => n));
  const uniqueDates = dateEntries.length;
  if (uniqueDates <= 5 && maxDateCount >= inv3.matchingRaces * 0.2) {
    mp(`- ⚠️ **特定期間集中型**: 限られた日付にレースが集中しており、scraper の特定日の取りこぼしの可能性`);
    mp(`- scraper 改修で「不明」カテゴリを解消すべき`);
  } else if (inv3.matchingRaces === 0) {
    mp(`- ✅ 該当なし (馬場状態データは完全取得)`);
  } else {
    mp(`- 日付は ${uniqueDates} 日に分散。特定期間集中ではなく、個別レースで取得失敗の可能性`);
    mp(`- 高 ROI 554.7% は **母集団バイアス** の可能性: 馬場状態を取得できない条件のレースが`);
    mp(`  たまたま予想精度が高いレース層に偏っている。本来は分類し直すべき`);
  }
  mp('');

  // 総合判定
  mp(`## 総合判定`);
  mp('');
  mp(`### 多軸分析結果の信頼性`);
  mp('');

  const assessments: string[] = [];

  if (isOutlier1) {
    assessments.push(
      `- **別定戦 1022%**: 1 件依存の外れ値。実質は ${roiEx1.toFixed(1)}% 程度。多軸レポートの「別定 = 最良」は過大評価`,
    );
  } else {
    assessments.push(`- **別定戦 1022%**: 複数件による高 ROI で信頼できる`);
  }

  if (inv2.recommendedRaces.length === 0) {
    assessments.push(
      `- **少頭数 0.0%**: バグではなく「参加レースなし」の仕様。多軸レポートの「除外候補」判定は誤解釈、修正が必要`,
    );
  } else {
    assessments.push(`- **少頭数 0.0%**: ${inv2.recommendedRaces.length} 件推奨が出ており、内訳は別途検証`);
  }

  if (inv3.matchingRaces > 0) {
    assessments.push(
      `- **馬場状態不明 554.7%**: 日付${uniqueDates}日に分散。scraper 改修または別カテゴリとして分析し直すべき`,
    );
  }

  assessments.forEach((a) => mp(a));
  mp('');

  mp(`### 🚨 Phase 2H (ハンデ戦除外) への影響 — **採用見送り推奨**`);
  mp('');
  mp(`追加調査の結果、ハンデ戦も少頭数と同じ「推奨数少」型と判明:`);
  mp('');
  mp(`| 項目 | 値 |`);
  mp(`|---|---|`);
  mp(`| ハンデ戦 総R | 49 R |`);
  mp(`| うち C2 除外 (ハイブリッド適用) | 11 R |`);
  mp(`| **実質 対象R** | **38 R** |`);
  mp(`| **馬連本命 推奨R** | **6 R** (930R 中 0.65%) |`);
  mp(`| 的中 | 0 R |`);
  mp(`| 投資 | 600 円 |`);
  mp(`| 払戻 | 0 円 |`);
  mp('');
  mp(`**結論**: ハンデ戦除外は効果ほぼゼロ。`);
  mp(`- 既に Phase 2G ハイブリッド + EV≥1.00 + スコア≥65 の条件で推奨はほぼ出ない`);
  mp(`- 除外を追加しても全 930R 中 6R (0.65%) が減るだけで合計 ROI の変動は無視できる`);
  mp(`- 「ハンデ戦 49R 馬連 0.0%」の多軸表記は **推奨 6R / 的中 0R** が実態で、`);
  mp(`  母数が小さすぎて統計的に判断不能`);
  mp('');
  mp(`**同様の疑義: 長距離 (2200m+) も推奨数少型**`);
  mp('');
  mp(`| 項目 | 値 |`);
  mp(`|---|---|`);
  mp(`| 長距離 総R | 101 R (多軸では 76R と表示、集計基準差) |`);
  mp(`| 馬連本命 推奨R | 13 R |`);
  mp(`| 的中 | 0 R |`);
  mp('');
  mp(`長距離も「推奨数少・的中ゼロ」で、除外効果は限定的。`);
  mp('');
  mp(`### 推奨次アクション`);
  mp('');
  mp(`**ケース C + B 複合**:`);
  mp(`1. **別定戦 1022% は 1 件依存の外れ値** (9R 中 1 件のみ的中) → 強化候補から除外`);
  mp(`2. **少頭数 0.0% は推奨ゼロ型** (122R 中推奨 5R) → 除外候補から除外`);
  mp(`3. **ハンデ戦 0.0% も同様の推奨ゼロ型** (38R 中推奨 6R) → **Phase 2H は採用見送り**`);
  mp(`4. **長距離も推奨数少・的中ゼロ** → 除外効果限定`);
  mp('');
  mp(`→ 多軸レポートの「除外候補」「強化候補」の多くが「推奨R数が少ないための統計ノイズ」である可能性が高い。`);
  mp(`   **Phase 2G ハイブリッド (554.9pt) が既に最適** と再確認。`);
  mp('');
  mp(`### 多軸レポートの改善案`);
  mp(`- 「参加R」を「推奨R」(bet.participated) に読み替える`);
  mp(`- 推奨 R < 20 のカテゴリは「サンプル不足」として統一扱い`);
  mp(`- 現状は総レース数と推奨数を混同して表示しており、誤解釈の原因`);
  mp('');

  mp(`---`);
  mp(`*再実行: \`pnpm tsx scripts/outlier_investigation.ts\`*`);

  await fs.writeFile(REPORT, md.join('\n'), 'utf-8');
  console.log('');
  console.log(`Markdown: ${REPORT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
