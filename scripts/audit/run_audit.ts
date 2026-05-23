// ==========================================
// verification データ品質監査スクリプト (フェーズ1)
//
// 目的:
//   「スコア5要素が全件50固定で数ヶ月放置」事件 (2026-05-23 発見) の
//   再発防止。components の異常分布を継続的に検知する。
//
// 実装範囲 (フェーズ1):
//   AUD-1: components 各要素の distinct 値数
//   AUD-2: components 各要素の 50 占有率
//   AUD-3: lastThreeF === training の馬の割合 (旧ロジック残存検知)
//   AUD-4: pastRaces 保存率
//
// 設計仕様: docs/proposals/2026-05-23-audit-system-design.md
//
// 出力:
//   scripts/audit/reports/audit_YYYYMMDD.md (人間用)
//   scripts/audit/reports/audit_YYYYMMDD.json (機械可読)
//
// 実行:
//   pnpm tsx scripts/audit/run_audit.ts
//
// 異常検知時の exit code:
//   ERROR が 1件以上ある場合は exit 1 (CI で失敗扱い)
//   WARNING / NOTICE のみは exit 0
// ==========================================

import fs from 'node:fs';
import path from 'node:path';
import type { VerificationData } from '../../lib/scraper/types';

// ----------------------------------------
// 設定 (閾値は仮置き、運用後に調整)
// ----------------------------------------

/** AUD-1: distinct 値数の閾値 */
const DISTINCT_ERROR = 3;     // 3未満 → ERROR
const DISTINCT_WARNING = 10;
const DISTINCT_NOTICE = 50;

/** AUD-2: 50 占有率の閾値 (%) */
const FIFTY_RATIO_ERROR = 80;
const FIFTY_RATIO_WARNING = 50;
const FIFTY_RATIO_NOTICE = 30;

/** AUD-3: lastThreeF === training の同一割合閾値 (%) */
const SAME_RATIO_ERROR = 95;
const SAME_RATIO_WARNING = 50;

/** AUD-4: pastRaces 保存率の閾値 (%) */
const COVERAGE_RECENT_ERROR = 80;       // 直近100R で 80% 未満 → ERROR
const COVERAGE_RECENT_WARNING = 95;
const COVERAGE_FULL_NOTICE = 30;        // 全件で 30% 未満 → NOTICE (D-3 候補)

/** 直近 N 件として扱う件数 */
const RECENT_N = 100;

/** weightChange は離散値 (6段階) の性質上、AUD-2 (50占有率) の警告対象から除外 */
const COMPONENT_FIELDS = [
  'lastThreeF', 'training', 'courseRecord', 'prevClass',
  'breeding', 'weightChange', 'jockey',
] as const;
const FIFTY_RATIO_TARGETS = COMPONENT_FIELDS.filter((f) => f !== 'weightChange');

type ComponentField = (typeof COMPONENT_FIELDS)[number];
type Severity = 'ERROR' | 'WARNING' | 'NOTICE' | 'OK';

// ----------------------------------------
// 入力
// ----------------------------------------
const VERIFY_DIR = path.resolve(__dirname, '..', 'verification');
const OUTPUT_DIR = path.resolve(__dirname, 'reports');
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const files = fs.readdirSync(VERIFY_DIR)
  .filter((f) => f.endsWith('.json'))
  .sort(); // ファイル名 (日付プレフィックス) で時系列ソート

console.log(`[audit] 対象: ${files.length} ファイル`);

// 直近 N 件 = ソート済みファイルの末尾 N 件
const recentFiles = files.slice(-RECENT_N);
console.log(`[audit] 直近 ${recentFiles.length} 件: ${recentFiles[0]} 〜 ${recentFiles[recentFiles.length - 1]}`);

// ----------------------------------------
// 集計
// ----------------------------------------
type Bucket = {
  totalHorses: number;
  totalRaces: number;
  withPastRaces: number;
  componentDistinct: Record<ComponentField, Set<number>>;
  componentFifty: Record<ComponentField, number>;
  sameLastThreeFTraining: number;
};

function newBucket(): Bucket {
  const distinct = Object.fromEntries(
    COMPONENT_FIELDS.map((f) => [f, new Set<number>()]),
  ) as Record<ComponentField, Set<number>>;
  const fifty = Object.fromEntries(
    COMPONENT_FIELDS.map((f) => [f, 0]),
  ) as Record<ComponentField, number>;
  return {
    totalHorses: 0, totalRaces: 0, withPastRaces: 0,
    componentDistinct: distinct, componentFifty: fifty,
    sameLastThreeFTraining: 0,
  };
}

function aggregate(filenames: string[]): Bucket {
  const b = newBucket();
  for (const f of filenames) {
    let data: VerificationData;
    try {
      data = JSON.parse(fs.readFileSync(path.join(VERIFY_DIR, f), 'utf8'));
    } catch {
      continue;
    }
    if (!data.predictions || data.predictions.length === 0) continue;
    b.totalRaces++;

    for (const p of data.predictions) {
      b.totalHorses++;

      if (p.pastRaces && p.pastRaces.length > 0) {
        b.withPastRaces++;
      }

      const c = p.components;
      if (!c) continue;

      for (const field of COMPONENT_FIELDS) {
        const v = c[field];
        if (typeof v !== 'number') continue;
        // distinct: 小数誤差除去のため1桁丸め
        b.componentDistinct[field].add(Math.round(v * 10) / 10);
        if (v === 50) b.componentFifty[field]++;
      }

      if (typeof c.lastThreeF === 'number' && typeof c.training === 'number'
          && c.lastThreeF === c.training) {
        b.sameLastThreeFTraining++;
      }
    }
  }
  return b;
}

const bAll = aggregate(files);
const bRecent = aggregate(recentFiles);

// ----------------------------------------
// 判定
// ----------------------------------------
type Finding = {
  id: string;
  severity: Severity;
  message: string;
  detail?: string;
};

function severityIcon(s: Severity): string {
  return s === 'ERROR' ? '🔴' : s === 'WARNING' ? '🟡' : s === 'NOTICE' ? '🟠' : '🟢';
}

const findings: Finding[] = [];

// === AUD-1: distinct 値数 ===
for (const field of COMPONENT_FIELDS) {
  const dAll = bAll.componentDistinct[field].size;
  const dRecent = bRecent.componentDistinct[field].size;
  // weightChange は離散値 (6段階) の性質上、distinct=6 が正常なので閾値判定を緩める
  const isDiscrete = field === 'weightChange';
  const errorThreshold = isDiscrete ? 2 : DISTINCT_ERROR;
  const warningThreshold = isDiscrete ? 4 : DISTINCT_WARNING;

  let sev: Severity = 'OK';
  if (dRecent < errorThreshold) sev = 'ERROR';
  else if (dRecent < warningThreshold) sev = 'WARNING';
  else if (dRecent < DISTINCT_NOTICE && !isDiscrete) sev = 'NOTICE';

  if (sev !== 'OK') {
    findings.push({
      id: 'AUD-1',
      severity: sev,
      message: `${field}: 直近${recentFiles.length}R で distinct=${dRecent} (全件 ${dAll})`,
    });
  }
}

// === AUD-2: 50 占有率 ===
for (const field of FIFTY_RATIO_TARGETS) {
  const rAll = bAll.totalHorses > 0 ? (bAll.componentFifty[field] / bAll.totalHorses) * 100 : 0;
  const rRecent = bRecent.totalHorses > 0 ? (bRecent.componentFifty[field] / bRecent.totalHorses) * 100 : 0;
  let sev: Severity = 'OK';
  if (rRecent >= FIFTY_RATIO_ERROR) sev = 'ERROR';
  else if (rRecent >= FIFTY_RATIO_WARNING) sev = 'WARNING';
  else if (rRecent >= FIFTY_RATIO_NOTICE) sev = 'NOTICE';

  if (sev !== 'OK') {
    findings.push({
      id: 'AUD-2',
      severity: sev,
      message: `${field}: 直近${recentFiles.length}R で 50占有率=${rRecent.toFixed(1)}% (全件 ${rAll.toFixed(1)}%)`,
    });
  }
}

// === AUD-3: lastThreeF === training 同一割合 ===
{
  const rAll = bAll.totalHorses > 0 ? (bAll.sameLastThreeFTraining / bAll.totalHorses) * 100 : 0;
  const rRecent = bRecent.totalHorses > 0 ? (bRecent.sameLastThreeFTraining / bRecent.totalHorses) * 100 : 0;
  let sev: Severity = 'OK';
  if (rRecent >= SAME_RATIO_ERROR) sev = 'ERROR';
  else if (rRecent >= SAME_RATIO_WARNING) sev = 'WARNING';

  if (sev !== 'OK') {
    findings.push({
      id: 'AUD-3',
      severity: sev,
      message: `lastThreeF === training の馬: 直近${recentFiles.length}R で ${rRecent.toFixed(1)}% (全件 ${rAll.toFixed(1)}%)`,
      detail: 'Phase 2H D-1 で独立化済。95% 以上残っているなら旧 JSON のみ or 改修未反映',
    });
  }
}

// === AUD-4: pastRaces 保存率 ===
{
  const rAll = bAll.totalHorses > 0 ? (bAll.withPastRaces / bAll.totalHorses) * 100 : 0;
  const rRecent = bRecent.totalHorses > 0 ? (bRecent.withPastRaces / bRecent.totalHorses) * 100 : 0;

  let sevRecent: Severity = 'OK';
  if (rRecent < COVERAGE_RECENT_ERROR) sevRecent = 'ERROR';
  else if (rRecent < COVERAGE_RECENT_WARNING) sevRecent = 'WARNING';
  if (sevRecent !== 'OK') {
    findings.push({
      id: 'AUD-4',
      severity: sevRecent,
      message: `pastRaces 保存率: 直近${recentFiles.length}R で ${rRecent.toFixed(1)}% (${bRecent.withPastRaces}/${bRecent.totalHorses})`,
      detail: 'D-1 改修後 (5-26 火曜以降) の収集は 100% 近いはず',
    });
  }

  if (rAll < COVERAGE_FULL_NOTICE) {
    findings.push({
      id: 'AUD-4',
      severity: 'NOTICE',
      message: `pastRaces 保存率: 全件で ${rAll.toFixed(1)}% (${bAll.withPastRaces}/${bAll.totalHorses})`,
      detail: 'D-3 (全件再収集) の進捗指標',
    });
  }
}

// ----------------------------------------
// 出力
// ----------------------------------------
const now = new Date();
const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
const yyyymmdd = jst.toISOString().slice(0, 10).replace(/-/g, '');
const isoNow = jst.toISOString().replace('Z', '+09:00');

const errorCount = findings.filter((f) => f.severity === 'ERROR').length;
const warningCount = findings.filter((f) => f.severity === 'WARNING').length;
const noticeCount = findings.filter((f) => f.severity === 'NOTICE').length;

// === Markdown 出力 ===
const md: string[] = [];
md.push('# verification データ品質監査レポート');
md.push('');
md.push('| 項目 | 値 |');
md.push('|---|---|');
md.push(`| 実行日時 | ${isoNow} |`);
md.push(`| 対象 | scripts/verification/*.json 合計 ${files.length} ファイル |`);
md.push(`| 直近${recentFiles.length}R | ${recentFiles[0]?.replace('.json', '')} 〜 ${recentFiles[recentFiles.length - 1]?.replace('.json', '')} |`);
md.push(`| 全件 合計馬数 | ${bAll.totalHorses.toLocaleString()} |`);
md.push('');
md.push('## サマリ');
md.push('');
md.push(`- 🔴 ERROR: ${errorCount} 件`);
md.push(`- 🟡 WARNING: ${warningCount} 件`);
md.push(`- 🟠 NOTICE: ${noticeCount} 件`);
md.push('');

// AUD-1
md.push('## AUD-1: components distinct 値数');
md.push('');
md.push('| 要素 | 全件 distinct | 直近100R distinct | 判定 |');
md.push('|---|---|---|---|');
for (const field of COMPONENT_FIELDS) {
  const dAll = bAll.componentDistinct[field].size;
  const dRecent = bRecent.componentDistinct[field].size;
  const isDiscrete = field === 'weightChange';
  const errorThreshold = isDiscrete ? 2 : DISTINCT_ERROR;
  const warningThreshold = isDiscrete ? 4 : DISTINCT_WARNING;
  let sev: Severity = 'OK';
  if (dRecent < errorThreshold) sev = 'ERROR';
  else if (dRecent < warningThreshold) sev = 'WARNING';
  else if (dRecent < DISTINCT_NOTICE && !isDiscrete) sev = 'NOTICE';
  const note = isDiscrete ? ' (離散値で正常)' : '';
  md.push(`| ${field} | ${dAll} | ${dRecent} | ${severityIcon(sev)} ${sev}${note} |`);
}
md.push('');

// AUD-2
md.push('## AUD-2: 50 占有率');
md.push('');
md.push('| 要素 | 全件 占有率 | 直近100R 占有率 | 判定 |');
md.push('|---|---|---|---|');
for (const field of FIFTY_RATIO_TARGETS) {
  const rAll = bAll.totalHorses > 0 ? (bAll.componentFifty[field] / bAll.totalHorses) * 100 : 0;
  const rRecent = bRecent.totalHorses > 0 ? (bRecent.componentFifty[field] / bRecent.totalHorses) * 100 : 0;
  let sev: Severity = 'OK';
  if (rRecent >= FIFTY_RATIO_ERROR) sev = 'ERROR';
  else if (rRecent >= FIFTY_RATIO_WARNING) sev = 'WARNING';
  else if (rRecent >= FIFTY_RATIO_NOTICE) sev = 'NOTICE';
  md.push(`| ${field} | ${rAll.toFixed(1)}% | ${rRecent.toFixed(1)}% | ${severityIcon(sev)} ${sev} |`);
}
md.push('');
md.push(`(weightChange は離散値 [30,50,70,85,95,100] の性質上、50 占有率の判定対象から除外)`);
md.push('');

// AUD-3
md.push('## AUD-3: lastThreeF === training の馬');
md.push('');
{
  const rAll = bAll.totalHorses > 0 ? (bAll.sameLastThreeFTraining / bAll.totalHorses) * 100 : 0;
  const rRecent = bRecent.totalHorses > 0 ? (bRecent.sameLastThreeFTraining / bRecent.totalHorses) * 100 : 0;
  let sevAll: Severity = 'OK', sevRecent: Severity = 'OK';
  if (rAll >= SAME_RATIO_ERROR) sevAll = 'ERROR';
  else if (rAll >= SAME_RATIO_WARNING) sevAll = 'WARNING';
  if (rRecent >= SAME_RATIO_ERROR) sevRecent = 'ERROR';
  else if (rRecent >= SAME_RATIO_WARNING) sevRecent = 'WARNING';
  md.push('| 範囲 | 同一割合 | 判定 |');
  md.push('|---|---|---|');
  md.push(`| 全件 | ${rAll.toFixed(1)}% | ${severityIcon(sevAll)} ${sevAll} |`);
  md.push(`| 直近${recentFiles.length}R | ${rRecent.toFixed(1)}% | ${severityIcon(sevRecent)} ${sevRecent} |`);
}
md.push('');

// AUD-4
md.push('## AUD-4: pastRaces 保存率');
md.push('');
{
  const rAll = bAll.totalHorses > 0 ? (bAll.withPastRaces / bAll.totalHorses) * 100 : 0;
  const rRecent = bRecent.totalHorses > 0 ? (bRecent.withPastRaces / bRecent.totalHorses) * 100 : 0;
  let sevAll: Severity = rAll < COVERAGE_FULL_NOTICE ? 'NOTICE' : 'OK';
  let sevRecent: Severity = 'OK';
  if (rRecent < COVERAGE_RECENT_ERROR) sevRecent = 'ERROR';
  else if (rRecent < COVERAGE_RECENT_WARNING) sevRecent = 'WARNING';
  md.push('| 範囲 | 保存率 | 判定 |');
  md.push('|---|---|---|');
  md.push(`| 全件 | ${rAll.toFixed(1)}% (${bAll.withPastRaces}/${bAll.totalHorses}) | ${severityIcon(sevAll)} ${sevAll} |`);
  md.push(`| 直近${recentFiles.length}R | ${rRecent.toFixed(1)}% (${bRecent.withPastRaces}/${bRecent.totalHorses}) | ${severityIcon(sevRecent)} ${sevRecent} |`);
}
md.push('');

// Findings サマリ
md.push('## 検出された異常');
md.push('');
if (findings.length === 0) {
  md.push('(なし。OK)');
} else {
  for (const f of findings) {
    md.push(`- ${severityIcon(f.severity)} **${f.severity}** [${f.id}] ${f.message}`);
    if (f.detail) md.push(`  - ${f.detail}`);
  }
}
md.push('');

// 結論
md.push('## 結論');
md.push('');
if (errorCount > 0) {
  md.push(`🔴 直近${recentFiles.length}R で **${errorCount} 件** の ERROR を検知。要対応。`);
} else if (warningCount > 0) {
  md.push(`🟡 ${warningCount} 件 の WARNING あり。経過観察推奨。`);
} else if (noticeCount > 0) {
  md.push(`🟠 ${noticeCount} 件 の NOTICE のみ。当面の異常なし。`);
} else {
  md.push('🟢 全項目 OK。');
}
md.push('');
md.push('---');
md.push('');
md.push('閾値は仮置き (運用後に調整予定)。設計仕様: `docs/proposals/2026-05-23-audit-system-design.md`');
md.push('');

// 出力
const mdPath = path.join(OUTPUT_DIR, `audit_${yyyymmdd}.md`);
fs.writeFileSync(mdPath, md.join('\n'), 'utf8');
console.log(`[audit] Markdown: ${mdPath}`);

// JSON 出力
const jsonReport = {
  generatedAt: isoNow,
  fileCount: files.length,
  recentN: recentFiles.length,
  recentRange: {
    first: recentFiles[0],
    last: recentFiles[recentFiles.length - 1],
  },
  summary: { error: errorCount, warning: warningCount, notice: noticeCount },
  bAll: {
    totalRaces: bAll.totalRaces,
    totalHorses: bAll.totalHorses,
    withPastRaces: bAll.withPastRaces,
    componentDistinct: Object.fromEntries(
      COMPONENT_FIELDS.map((f) => [f, bAll.componentDistinct[f].size]),
    ),
    componentFifty: bAll.componentFifty,
    sameLastThreeFTraining: bAll.sameLastThreeFTraining,
  },
  bRecent: {
    totalRaces: bRecent.totalRaces,
    totalHorses: bRecent.totalHorses,
    withPastRaces: bRecent.withPastRaces,
    componentDistinct: Object.fromEntries(
      COMPONENT_FIELDS.map((f) => [f, bRecent.componentDistinct[f].size]),
    ),
    componentFifty: bRecent.componentFifty,
    sameLastThreeFTraining: bRecent.sameLastThreeFTraining,
  },
  findings,
  thresholds: {
    DISTINCT_ERROR, DISTINCT_WARNING, DISTINCT_NOTICE,
    FIFTY_RATIO_ERROR, FIFTY_RATIO_WARNING, FIFTY_RATIO_NOTICE,
    SAME_RATIO_ERROR, SAME_RATIO_WARNING,
    COVERAGE_RECENT_ERROR, COVERAGE_RECENT_WARNING,
    COVERAGE_FULL_NOTICE,
  },
};
const jsonPath = path.join(OUTPUT_DIR, `audit_${yyyymmdd}.json`);
fs.writeFileSync(jsonPath, JSON.stringify(jsonReport, null, 2), 'utf8');
console.log(`[audit] JSON: ${jsonPath}`);

// コンソール summary
console.log('');
console.log('========================================');
console.log(`合計: 🔴 ERROR ${errorCount} / 🟡 WARNING ${warningCount} / 🟠 NOTICE ${noticeCount}`);
console.log('========================================');

// GitHub Actions ログ用 annotation
for (const f of findings) {
  if (f.severity === 'ERROR') {
    console.log(`::error::[${f.id}] ${f.message}`);
  } else if (f.severity === 'WARNING') {
    console.log(`::warning::[${f.id}] ${f.message}`);
  } else if (f.severity === 'NOTICE') {
    console.log(`::notice::[${f.id}] ${f.message}`);
  }
}

// ERROR があれば exit 1
process.exit(errorCount > 0 ? 1 : 0);
