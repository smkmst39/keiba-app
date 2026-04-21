// ==========================================
// 検証 JSON の score / ev を現行 WEIGHTS で再計算する
//
// Phase 2E Stage 3 で WEIGHTS を変更したが、既存 JSON のスコアは
// 再収集時点の古い重みで計算されている。components が保存されているので
// オフラインで score/ev を再計算して上書きする。
//
// 実行: pnpm tsx scripts/recompute_scores.ts
// ==========================================

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { VerificationData } from '../lib/scraper/types';

const DIR = path.resolve(__dirname, 'verification');

/** lib/score/calculator.ts の WEIGHTS と同一 */
const WEIGHTS = {
  lastThreeF:   0.244,
  training:     0.125,
  courseRecord: 0.198,
  prevClass:    0.146,
  breeding:     0.158,
  weightChange: 0.071,
  jockey:       0.058,
} as const;

/** EV パラメータ (Stage 1 固定値 = 本番値) */
const EV_PARAMS = { cf: 0.20, offset: -0.02, max: 0.20 };

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const mean  = (a: number[]): number => a.length === 0 ? 0 : a.reduce((s, x) => s + x, 0) / a.length;

function getOddsWeight(odds: number): number {
  if (odds <= 5)  return 1.00;
  if (odds <= 10) return 0.80;
  if (odds <= 20) return 0.50;
  if (odds <= 50) return 0.20;
  return 0.05;
}

type Components = {
  lastThreeF: number; training: number; courseRecord: number;
  prevClass: number; breeding: number; weightChange: number; jockey: number;
};

function computeScore(c: Components): number {
  return clamp(
    c.lastThreeF   * WEIGHTS.lastThreeF   +
    c.training     * WEIGHTS.training     +
    c.courseRecord * WEIGHTS.courseRecord +
    c.prevClass    * WEIGHTS.prevClass    +
    c.breeding     * WEIGHTS.breeding     +
    c.weightChange * WEIGHTS.weightChange +
    c.jockey       * WEIGHTS.jockey,
    0, 100,
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PredWithComponents = VerificationData['predictions'][number] & { components?: Components | null; waku?: number };

async function processFile(file: string): Promise<{ changed: boolean; noComponents: boolean }> {
  const filePath = path.join(DIR, file);
  const raw = await fs.readFile(filePath, 'utf-8');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vd = JSON.parse(raw) as any as (VerificationData & { predictions: PredWithComponents[] });

  // components が無ければスキップ
  const hasComp = vd.predictions.every((p: PredWithComponents) => p.components);
  if (!hasComp) return { changed: false, noComponents: true };

  // 新 score を計算
  const newPreds: PredWithComponents[] = vd.predictions.map((p: PredWithComponents) => {
    if (!p.components) return p;
    return { ...p, score: computeScore(p.components) };
  });

  // EV を再計算: avgScore, dev, corr
  const validScores = newPreds.filter((p) => p.odds > 0).map((p) => p.score);
  const avg = mean(validScores);
  const updated: PredWithComponents[] = newPreds.map((p) => {
    if (p.odds <= 0 || avg === 0) return { ...p, ev: 0 };
    const dev   = (p.score - avg) / avg;
    const oddsW = getOddsWeight(p.odds);
    const corr  = clamp(
      dev * EV_PARAMS.cf * oddsW + EV_PARAMS.offset,
      -EV_PARAMS.max, EV_PARAMS.max,
    );
    return { ...p, ev: 1 + corr };
  });

  vd.predictions = updated;
  await fs.writeFile(filePath, JSON.stringify(vd, null, 2), 'utf-8');
  return { changed: true, noComponents: false };
}

async function main(): Promise<void> {
  const files = (await fs.readdir(DIR)).filter((f) => f.endsWith('.json'));
  console.log(`対象: ${files.length} JSON ファイル`);
  console.log(`新 WEIGHTS: 上3F=${WEIGHTS.lastThreeF}, 調教=${WEIGHTS.training}, 同コース=${WEIGHTS.courseRecord}, 前走=${WEIGHTS.prevClass}, 血統=${WEIGHTS.breeding}, 体重=${WEIGHTS.weightChange}, 騎手=${WEIGHTS.jockey}`);
  console.log('');

  let changed = 0, noComp = 0;
  for (const f of files) {
    const r = await processFile(f);
    if (r.changed) changed++;
    if (r.noComponents) noComp++;
  }
  console.log(`\n完了: ${changed} 件更新、${noComp} 件は components 無しでスキップ`);
}
main().catch((e) => { console.error(e); process.exit(1); });
