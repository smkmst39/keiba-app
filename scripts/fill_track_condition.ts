// ==========================================
// 馬場状態「不明」137R の補完スクリプト
//
// 原因: netkeiba shutuba.html は「朝一レース」(発走前) では馬場状態が HTML 上に無い。
//       後続レース (昼以降) で発表され、以降の shutuba には記載される。
//
// 対応: 再スクレイプせず、**同日・同競馬場 (raceId 先頭10文字一致) の他レース** から
//       最頻値を取って補完する。
//
// 補完不可 (全レースで未設定) の場合はそのまま残す。
//
// 実行: pnpm tsx scripts/fill_track_condition.ts
// 出力: 各 JSON の meta.trackCondition を更新、補完元を filledFrom フィールドに記録
// ==========================================

import { promises as fs } from 'node:fs';
import path from 'node:path';

const DIR = path.resolve(__dirname, 'verification');

// 最頻値 (優先順位あり): 最多値、同率なら 良 > 稍重 > 重 > 不良
const PRIORITY = ['良', '稍重', '重', '不良'];

async function main(): Promise<void> {
  const files = (await fs.readdir(DIR)).filter((f) => f.endsWith('.json'));

  // Pass 1: prefix ごとに馬場状態の分布を集計
  const prefixDist = new Map<string, Map<string, number>>();
  for (const f of files) {
    const raw = await fs.readFile(path.join(DIR, f), 'utf-8');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vd = JSON.parse(raw) as any;
    const tc: string | undefined = vd?.meta?.trackCondition;
    if (!tc || tc === '') continue;
    const prefix: string = vd.raceId.slice(0, 10);
    if (!prefixDist.has(prefix)) prefixDist.set(prefix, new Map());
    const m = prefixDist.get(prefix)!;
    m.set(tc, (m.get(tc) ?? 0) + 1);
  }

  // Pass 2: 不明レースを補完
  let filledCount = 0, cannotFillCount = 0, alreadySetCount = 0;
  const cannotFillSamples: string[] = [];

  for (const f of files) {
    const filePath = path.join(DIR, f);
    const raw = await fs.readFile(filePath, 'utf-8');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vd = JSON.parse(raw) as any;
    const meta = vd.meta ?? {};
    const tc: string | undefined = meta.trackCondition;

    if (tc && tc !== '') { alreadySetCount++; continue; }

    const prefix: string = vd.raceId.slice(0, 10);
    const dist = prefixDist.get(prefix);
    if (!dist || dist.size === 0) {
      cannotFillCount++;
      if (cannotFillSamples.length < 15) cannotFillSamples.push(vd.raceId);
      continue;
    }

    // 最頻値を採用
    let bestVal = '', bestCount = 0;
    for (const [val, cnt] of Array.from(dist.entries())) {
      if (cnt > bestCount) { bestVal = val; bestCount = cnt; }
      else if (cnt === bestCount) {
        const prioNew = PRIORITY.indexOf(val);
        const prioOld = PRIORITY.indexOf(bestVal);
        if (prioNew >= 0 && (prioOld < 0 || prioNew < prioOld)) bestVal = val;
      }
    }

    if (!bestVal) { cannotFillCount++; continue; }

    meta.trackCondition = bestVal;
    meta.trackConditionFilled = true;
    meta.trackConditionSource = `同日同場${bestCount}R 中の最頻値`;
    vd.meta = meta;

    await fs.writeFile(filePath, JSON.stringify(vd, null, 2), 'utf-8');
    filledCount++;
  }

  console.log('='.repeat(72));
  console.log('  馬場状態 補完結果');
  console.log('='.repeat(72));
  console.log(`既に取得済み: ${alreadySetCount} R`);
  console.log(`補完済み:     ${filledCount} R`);
  console.log(`補完不可:     ${cannotFillCount} R (同prefix全レース未設定)`);
  console.log('');
  if (cannotFillSamples.length > 0) {
    console.log('補完不可レース (サンプル):');
    cannotFillSamples.forEach((r) => console.log('  ' + r));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
