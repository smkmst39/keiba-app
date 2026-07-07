// ==========================================
// 既存3341件 verification JSON の後方互換 smoke test (Phase 2H D-1)
//
// 目的:
//   コミット 32c2ec9 (VerificationData 型に pastRaces 追加) 改修後でも、
//   既存JSON (pastRaces 未保存) が正常に読み込め、calcAllScores が
//   クラッシュせず動作し、courseRecord/lastThreeF が 50 にフォールバック
//   することを 3341 件全件で実証する。
//
// テスト内容:
//   C1: JSON.parse → VerificationData 型受け、必須フィールド存在チェック
//       pastRaces が含まれていないこと (3341件は未保存)
//   C2: 既存 predictions から Horse 再構築 → calcAllScores 実行
//       全馬で courseRecord=50 / lastThreeF=50 (フォールバック)
//
// 異常時の挙動:
//   いずれか1件でも fail があれば exit 1。改修着手停止のシグナル。
//
// 実行: pnpm tsx scripts/test_verification_backward_compat.ts
// ==========================================

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { calcAllScores, calcAllComponentScores } from '../lib/score/calculator';
import type { VerificationData, Horse, Race } from '../lib/scraper/types';

const VERIFY_DIR = path.join(__dirname, 'verification');
const files = fs.readdirSync(VERIFY_DIR).filter((f) => f.endsWith('.json'));

console.log(`[smoke-test] 対象: ${files.length} ファイル`);

let pass = 0;
let fail = 0;
const errors: { file: string; msg: string }[] = [];

// 健全性チェックのログを抑制 (期待される警告でログが埋まるため)
const origLog = console.log;
const origWarn = console.warn;
const origError = console.error;
function silence() {
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
}
function restore() {
  console.log = origLog;
  console.warn = origWarn;
  console.error = origError;
}

for (let i = 0; i < files.length; i++) {
  const f = files[i];
  const filePath = path.join(VERIFY_DIR, f);
  try {
    // C1: JSON.parse + 必須フィールド
    const data: VerificationData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!data.raceId) throw new Error('raceId 欠落');
    if (!Array.isArray(data.predictions) || data.predictions.length === 0) {
      throw new Error('predictions 欠落 or 空');
    }
    if (!data.results || !Array.isArray(data.results.results)) {
      throw new Error('results.results 欠落');
    }

    // 形式判定 (2026-05-28 更新):
    //   D-1 改修後の週次スクレイプ (2026-05-23 収集分〜) は pastRaces キーを
    //   保存する新形式。旧形式 (キーなし) と新形式が混在するのが正常な状態に
    //   なったため、「pastRaces を含んではいけない」という旧アサーションは廃止。
    //   代わりに「実データを持つ馬がいるか」で動的算出/フォールバックの期待を分岐。
    const hasNonEmptyPastRaces = data.predictions.some(
      (p) => Array.isArray(p.pastRaces) && p.pastRaces.length > 0,
    );

    // C2: Horse 再構築 + calcAllScores (保存されている pastRaces はそのまま渡す)
    const horses: Horse[] = data.predictions.map((p) => ({
      id: p.horseId,
      name: p.horseName,
      waku: p.waku ?? 1,
      odds: p.odds,
      fukuOddsMin: 0,
      fukuOddsMax: 0,
      jockey: p.jockey ?? '',
      trainer: '',
      weight: 0,
      weightDiff: 0,
      lastThreeF: 0, // 旧JSONには無いのでフォールバック発動を狙う
      pastRaces: p.pastRaces, // 旧形式: undefined / 新形式: 配列 (空含む)
    }));

    const ymd = (data.date ?? '').replace(/-/g, '');
    const race: Race = {
      raceId: data.raceId,
      name: data.raceName ?? '',
      course: '',
      distance: 1600,
      surface: 'turf',
      horses,
      fetchedAt: new Date(),
      raceDate: ymd || undefined,
    };

    // 期待される警告ログを抑制
    silence();
    const scored = calcAllScores(race);
    const comps = calcAllComponentScores(race);
    restore();

    // 期待値の分岐:
    //   pastRaces 実データなし (旧形式 or 新形式で全馬空配列)
    //     → 全馬で courseRecord=50 / lastThreeF=50 (フォールバック)
    //   pastRaces 実データあり (新形式で取得成功)
    //     → 動的算出されるため 50 固定は要求しない (NaN/レンジチェックのみ)
    if (!hasNonEmptyPastRaces) {
      let allFallback = true;
      let firstBadId = -1;
      let firstBadFields = '';
      for (const h of scored.horses) {
        const c = comps.get(h.id);
        if (!c) continue;
        if (c.courseRecord !== 50 || c.lastThreeF !== 50) {
          allFallback = false;
          firstBadId = h.id;
          firstBadFields = `courseRecord=${c.courseRecord}, lastThreeF=${c.lastThreeF}`;
          break;
        }
      }
      if (!allFallback) {
        throw new Error(`フォールバック値違反: 馬${firstBadId} (${firstBadFields})`);
      }
    }

    // スコアが NaN でないこと
    for (const h of scored.horses) {
      if (Number.isNaN(h.score) || Number.isNaN(h.ev ?? 0)) {
        throw new Error(`NaN 検出: 馬${h.id} score=${h.score}, ev=${h.ev}`);
      }
    }

    pass++;
  } catch (e) {
    restore();
    fail++;
    const msg = e instanceof Error ? e.message : String(e);
    errors.push({ file: f, msg });
    if (errors.length <= 5) console.error(`✗ ${f}: ${msg}`);
  }

  if ((i + 1) % 500 === 0) {
    console.log(`[smoke-test] 進捗: ${i + 1}/${files.length} (pass=${pass}, fail=${fail})`);
  }
}

console.log('\n========================================');
console.log(`合計: pass ${pass} / fail ${fail}`);
if (errors.length > 5) {
  console.log(`(エラー全 ${errors.length} 件、先頭5件のみ表示)`);
}
console.log('========================================');
process.exit(fail > 0 ? 1 : 0);
