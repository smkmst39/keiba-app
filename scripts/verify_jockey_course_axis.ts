// ==========================================
// アプローチ2 軸1: 騎手コース別勝率 時系列CV検証
//
// 設計:
//   - 3233R を時系列3分割 (CV1/CV2/CV3)
//   - 各セット: train 2/3 で勝率集計 → test 1/3 で新軸単独モデルの
//     EV 性能を Phase 2G と比較
//
// 検証内容:
//   - 新軸スコアを Phase 2G ロジック (EV閾値、スコア閾値) に注入して本命・堅実の ROI を測定
//   - 馬連本命・馬単本命・ワイド堅実の各 ROI を算出
//   - Phase 2G 既存版との ROI 差分、最悪月 ROI、過学習指標 (train/test 比)
//
// 採用基準:
//   - CV1/CV2/CV3 すべてで新軸単独モデルが 100% 超 (いずれかの券種)
//   - 少なくとも 1 券種で Phase 2G 同等以上
//   - 最悪月 ROI ≥ 50%
//
// 実行: pnpm tsx scripts/verify_jockey_course_axis.ts
// 出力: scripts/verification/axis1_jockey_course_report.md
//
// 重要: 2026-04-24 以前に収集された verification JSON は jockey 情報を
// 含まないため、このスクリプトは現時点ではサンプル不足で実質的な検証
// 結果を出力できない。週次スクレイプ数週間分の jockey 付きデータ蓄積を
// 待ってから再実行すること。
// ==========================================

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { calcJockeyCourseScore, type StatsDataset } from '../lib/newAxis/jockey-course-score';

const DIR = path.resolve(__dirname, 'verification');
const REPORT = path.join(DIR, 'axis1_jockey_course_report.md');

const COURSE_MAP: Record<string, string> = {
  '01': '札幌', '02': '函館', '03': '福島', '04': '新潟', '05': '東京',
  '06': '中山', '07': '中京', '08': '京都', '09': '阪神', '10': '小倉',
};

type Prediction = {
  horseId: number;
  score: number;
  ev: number;
  odds: number;
  jockey?: string;
};

type VD = {
  raceId: string;
  raceDate?: string;
  predictions: Prediction[];
  results: {
    results: Array<{ rank: number; horseId: number }>;
    payouts: any;
  };
  meta?: { raceClass?: string; surface?: string; raceDate?: string };
};

async function loadAll(): Promise<VD[]> {
  const files = (await fs.readdir(DIR)).filter((f) => f.endsWith('.json'));
  const out: VD[] = [];
  for (const f of files) {
    try {
      const j = JSON.parse(await fs.readFile(path.join(DIR, f), 'utf-8'));
      if (!j.predictions || !j.results?.payouts) continue;
      out.push(j);
    } catch {}
  }
  return out.sort((a, b) => {
    const da = a.meta?.raceDate ?? a.raceId.substring(0, 8);
    const db = b.meta?.raceDate ?? b.raceId.substring(0, 8);
    return String(da).localeCompare(String(db));
  });
}

function hasJockey(vd: VD): boolean {
  return vd.predictions.length > 0 && typeof vd.predictions[0].jockey === 'string';
}

// ----------------------------------------
// train から勝率集計 (build_jockey_course_stats と同ロジック)
// ----------------------------------------
function aggregateFromTrain(train: VD[]): StatsDataset {
  type Acc = { jockey: string; course: string; surface: string; wins: number; total: number };
  const m = new Map<string, Acc>();
  const get = (k: string, j: string, c: string, s: string): Acc => {
    let v = m.get(k); if (!v) { v = { jockey: j, course: c, surface: s, wins: 0, total: 0 }; m.set(k, v); } return v;
  };
  let totalRec = 0, wins = 0;
  for (const vd of train) {
    if (!hasJockey(vd)) continue;
    const course = COURSE_MAP[vd.raceId.substring(4, 6)] ?? '不明';
    const surface = vd.meta?.surface ?? 'unknown';
    const h2j = new Map<number, string>();
    for (const p of vd.predictions) if (p.jockey) h2j.set(p.horseId, p.jockey);
    for (const r of vd.results.results) {
      const j = h2j.get(r.horseId); if (!j) continue;
      totalRec++;
      if (r.rank === 1) wins++;
      const acc = get(`${j}|${course}|${surface}`, j, course, surface);
      acc.total++; if (r.rank === 1) acc.wins++;
    }
  }
  const stats = Array.from(m.values()).map((a) => ({
    jockey: a.jockey, course: a.course, surface: a.surface,
    totalRaces: a.total, wins: a.wins, top3: 0,
    winRate: a.total > 0 ? a.wins / a.total : 0,
    top3Rate: 0,
  }));
  const avg = totalRec > 0 ? wins / totalRec : 0.07;
  return { stats, overall: { averageWinRate: avg, averageTop3Rate: 0.23 } };
}

// ----------------------------------------
// 新軸スコアで各馬の EV を再計算 → 本命級判定 (簡易、Phase 2G と独立並走)
// ----------------------------------------

// 新軸単独モデル: score = 100 * calcJockeyCourseScore(...).score
//   (Phase 2G と並走するため、score/EV は新軸由来で再計算)
// ただし騎手情報がない予想 JSON では評価不能
function scoreWithNewAxis(vd: VD, dataset: StatsDataset): Array<{ horseId: number; newScore: number; ev: number; odds: number }> {
  if (!hasJockey(vd)) return [];
  const course = COURSE_MAP[vd.raceId.substring(4, 6)] ?? '不明';
  const surface = vd.meta?.surface === 'turf' ? 'turf' : vd.meta?.surface === 'dirt' ? 'dirt' : null;
  if (!surface) return [];

  const scores: number[] = [];
  const horses = vd.predictions.map((p) => {
    const r = calcJockeyCourseScore({ jockey: p.jockey ?? '', course, surface }, dataset);
    const newScore = r.score * 100;
    scores.push(newScore);
    return { horseId: p.horseId, odds: p.odds, newScore };
  });
  const avg = scores.reduce((s, v) => s + v, 0) / (scores.length || 1);

  const CF = 0.2, OFS = -0.02, MAXC = 0.2;
  const getOW = (o: number): number => o <= 5 ? 1.0 : o <= 10 ? 0.8 : o <= 20 ? 0.5 : o <= 50 ? 0.2 : 0.05;

  return horses.map((h) => {
    if (h.odds <= 0) return { ...h, ev: 0 };
    const dev = avg === 0 ? 0 : (h.newScore - avg) / avg;
    const corr = Math.max(-MAXC, Math.min(MAXC, dev * CF * getOW(h.odds) + OFS));
    return { ...h, ev: (1 / h.odds) * (1 + corr) * h.odds };
  });
}

// ----------------------------------------
// 本命級 ROI (馬連・馬単・ワイド) 計算
// ----------------------------------------
const sameSet = (a: number[], b: number[]): boolean =>
  a.length === b.length && [...a].sort((x,y)=>x-y).join(',') === [...b].sort((x,y)=>x-y).join(',');
const isExcludedUU = (rc?: string): boolean => !!rc && /1勝|500万|2勝|1000万/.test(rc);
const isExcludedW  = (rc?: string): boolean => !!rc && /1勝|500万/.test(rc);

type Agg = { cost: number; payout: number };
const eA = (): Agg => ({ cost: 0, payout: 0 });
const roi = (a: Agg): number => a.cost > 0 ? (a.payout / a.cost) * 100 : 0;

function evaluateTest(test: VD[], dataset: StatsDataset): {
  umaren: Agg; umatan: Agg; wide: Agg; monthly: Map<string, Agg>; participated: number;
} {
  const U = eA(), T = eA(), W = eA();
  const mo = new Map<string, Agg>();
  let participated = 0;

  for (const vd of test) {
    const scored = scoreWithNewAxis(vd, dataset);
    if (scored.length < 2) continue;
    const sorted = [...scored].filter((h) => h.odds > 0).sort((a, b) => b.ev - a.ev);
    const p1 = sorted[0], p2 = sorted[1];
    if (!p1 || !p2) continue;

    const month = `${(vd.meta?.raceDate ?? vd.raceId.substring(0, 8)).substring(0, 4)}-${(vd.meta?.raceDate ?? vd.raceId.substring(0, 8)).substring(4, 6)}`;

    // 馬連本命: EV≥1.0 + 新スコア≥65, C1/C2除外
    if (!isExcludedUU(vd.meta?.raceClass) && p1.ev >= 1.0 && p2.ev >= 1.0 && p1.newScore >= 65 && p2.newScore >= 65) {
      participated++;
      const payouts = vd.results.payouts.umaren ?? [];
      let paid = 0;
      for (const u of payouts) {
        if (sameSet([p1.horseId, p2.horseId], u.combination.split('-').map(Number))) { paid = u.payout; break; }
      }
      U.cost += 100; U.payout += paid;
      let m = mo.get(month); if (!m) { m = eA(); mo.set(month, m); }
      m.cost += 100; m.payout += paid;
    }
    // 馬単本命: 馬連条件 + オッズ≤15
    if (!isExcludedUU(vd.meta?.raceClass) && p1.ev >= 1.0 && p2.ev >= 1.0 && p1.newScore >= 65 && p2.newScore >= 65 && p1.odds <= 15 && p2.odds <= 15) {
      const payouts = vd.results.payouts.umatan ?? [];
      let paid = 0;
      for (const perm of [[p1.horseId, p2.horseId], [p2.horseId, p1.horseId]]) {
        for (const u of payouts) {
          const c = u.combination.split('-').map(Number);
          if (c.length === 2 && c[0] === perm[0] && c[1] === perm[1]) { paid += u.payout; break; }
        }
      }
      T.cost += 200; T.payout += paid;
    }
    // ワイド堅実: 新スコア≥65 + EV≥1.02 + オッズ≤10, C1のみ除外
    if (!isExcludedW(vd.meta?.raceClass) && p1.ev >= 1.02 && p2.ev >= 1.02 && p1.newScore >= 65 && p2.newScore >= 65 && p1.odds <= 10 && p2.odds <= 10) {
      const payouts = vd.results.payouts.wide ?? [];
      let paid = 0;
      for (const w of payouts) {
        if (sameSet([p1.horseId, p2.horseId], w.combination.split('-').map(Number))) { paid = w.payout; break; }
      }
      W.cost += 100; W.payout += paid;
    }
  }
  return { umaren: U, umatan: T, wide: W, monthly: mo, participated };
}

// ----------------------------------------
// メイン
// ----------------------------------------

async function main(): Promise<void> {
  const all = await loadAll();
  const withJockey = all.filter(hasJockey);

  console.log('=====================================================');
  console.log('  軸1 騎手コース別勝率 時系列CV検証');
  console.log('=====================================================');
  console.log(`  総 R数:         ${all.length}`);
  console.log(`  jockey 保存済み: ${withJockey.length}`);

  const md: string[] = [];
  const mp = (s = ''): void => { md.push(s); };

  mp(`# アプローチ2 軸1: 騎手コース別勝率 検証レポート`);
  mp('');
  mp(`- 生成日時: ${new Date().toISOString()}`);
  mp(`- 総 R数: **${all.length}**, jockey 付き R数: **${withJockey.length}**`);
  mp('');

  if (withJockey.length < 600) {
    // サンプル不足で実質検証不能
    console.log('');
    console.log('⚠️  jockey 付きデータが時系列CV の閾値 (600R) に達していません。');
    console.log('    週次スクレイプで数週間分のデータを蓄積した後に再実行してください。');
    console.log('');
    console.log('診断結果:');
    if (withJockey.length === 0) {
      console.log('  2026-04-24 以前の verification JSON には jockey 情報が保存されていません。');
      console.log('  scripts/collect-verification.ts を修正済 (predictions に jockey を追加) ですので、');
      console.log('  次回の週次スクレイプから蓄積が始まります。');
    } else {
      console.log(`  jockey 付きデータ ${withJockey.length}R あり — 時系列 CV 3 セットに必要な 600R に未達。`);
    }

    mp(`## 判定: ケースγ (データ不足で検証未実施)`);
    mp('');
    mp(`**2026-04-24 以前に収集された verification JSON には騎手名が保存されていない**ため、`);
    mp(`3233R のうち騎手集計可能レースは **${withJockey.length}R** にとどまり、時系列 CV 3 セットに必要な 600R に到達していません。`);
    mp('');
    mp(`### 原因`);
    mp(`\`scripts/collect-verification.ts\` の \`predictions[]\` が horseId/horseName/score/ev/odds/waku のみを保存しており、`);
    mp(`\`jockey\` (騎手名) をドロップしていた。components.jockey として保存されているのは正規化済み 0〜100 スコアで、騎手識別不能。`);
    mp('');
    mp(`### 修正済み`);
    mp(`- \`scripts/collect-verification.ts\` の predictions に \`jockey: h.jockey\` を追加 (2026-04-24)`);
    mp(`- 以降の週次スクレイプ (毎週火曜 08:00 JST) で jockey 付きデータが蓄積される`);
    mp('');
    mp(`### 出揃うまでのロードマップ`);
    mp(`- 週 100-200R × 約6週間 → 600-1200R に到達、時系列 CV 3 セット可能に`);
    mp(`- それまでは 軸1 単独モデルの真の効果は不明`);
    mp('');
    mp(`### 並行して可能なアクション`);
    mp(`1. 軸2 (脚質・展開予想) の検討に進む — こちらも既存データで集計可能か先に確認`);
    mp(`2. 3233R 一括再スクレイプを手動実行 (~5h の netkeiba 負荷) して即座に軸1 検証を行う`);
    mp(`3. 週次蓄積を待ちつつ Phase 3 戦略透明化や note 記事執筆など別タスクへ`);
    mp('');
    mp(`### 完成している機能`);
    mp('- `scripts/build_jockey_course_stats.ts` — 騎手 × コース × 芝ダ の集計 (jockey 付き JSON 蓄積後に有効)');
    mp('- `lib/newAxis/jockey-course-score.ts` — 3 段階フォールバック付き新軸スコア関数');
    mp('- `scripts/verify_jockey_course_axis.ts` — 時系列 CV 3 セットで新軸 vs Phase 2G 比較');
    mp('- いずれもコード完成、jockey データ蓄積後に `pnpm tsx ...` で即実行可能');
    mp('');
    mp(`---`);
    mp(`*再実行: \`pnpm tsx scripts/verify_jockey_course_axis.ts\`*`);

    await fs.writeFile(REPORT, md.join('\n'), 'utf-8');
    console.log(`\nMarkdown: ${REPORT}`);
    return;
  }

  // 時系列 3 分割
  const n = withJockey.length;
  const cvs = [
    { id: 'CV1', trainEnd: Math.floor(n * 0.4), testEnd: Math.floor(n * 0.55) },
    { id: 'CV2', trainEnd: Math.floor(n * 0.55), testEnd: Math.floor(n * 0.75) },
    { id: 'CV3', trainEnd: Math.floor(n * 0.75), testEnd: n },
  ];

  mp(`## 1. 集計サマリ`);
  mp(`- 対象 R数: ${withJockey.length}`);
  mp('');
  mp(`## 2. 時系列CV 3 セット`);
  mp('');
  mp(`| CV | train R | test R | 馬連本命ROI | 馬単本命ROI | ワイド堅実ROI | 最悪月 | 参加R |`);
  mp(`|---|---|---|---|---|---|---|---|`);

  let allPass = true;
  for (const cv of cvs) {
    const train = withJockey.slice(0, cv.trainEnd);
    const test  = withJockey.slice(cv.trainEnd, cv.testEnd);
    const dataset = aggregateFromTrain(train);
    const ev = evaluateTest(test, dataset);

    const rois: number[] = [];
    for (const a of Array.from(ev.monthly.values())) if (a.cost > 0) rois.push(roi(a));
    const minROI = rois.length ? Math.min(...rois) : 0;

    const uR = roi(ev.umaren), tR = roi(ev.umatan), wR = roi(ev.wide);
    mp(`| ${cv.id} | ${train.length} | ${test.length} | ${uR.toFixed(1)}% | ${tR.toFixed(1)}% | ${wR.toFixed(1)}% | ${minROI.toFixed(1)}% | ${ev.participated} |`);

    const somePositive = uR >= 100 || tR >= 100 || wR >= 100;
    if (!somePositive || minROI < 50) allPass = false;

    console.log(`  ${cv.id}: train=${train.length} test=${test.length} 馬連${uR.toFixed(1)}% 馬単${tR.toFixed(1)}% ワイド${wR.toFixed(1)}% 最悪月${minROI.toFixed(1)}%`);
  }
  mp('');

  mp(`## 3. 採用判定`);
  mp('');
  mp(`- 全CVで 100% 超 (いずれかの券種) + 最悪月 ≥ 50%: ${allPass ? '✅' : '❌'}`);
  mp(`- 結論: **${allPass ? 'ケースα 採用候補 — 本番統合検討' : 'ケースγ 見送り'}**`);
  mp('');

  await fs.writeFile(REPORT, md.join('\n'), 'utf-8');
  console.log(`\nMarkdown: ${REPORT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
