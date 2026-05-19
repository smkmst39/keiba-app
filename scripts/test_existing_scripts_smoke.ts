// ==========================================
// 既存スクリプト smoke test (Phase 2H D-1 / C4)
//
// 目的:
//   Phase 2H D-1 の型変更 (VerificationData に pastRaces 等を追加) で
//   既存の verification 読み込みスクリプトが壊れていないことを実証する。
//
// 対象 (5-8件のうち代表4件):
//   1. backtest.ts                — 単勝/複勝/馬連 ROI 検証
//   2. class_analysis.ts          — クラス別精度差分析
//   3. backtest_trifecta.ts       — 三連複/三連単 ROI
//   4. verify_kiken_popular.ts    — 危険人気馬検証 (Phase 2H 暫定最新)
//
//   build_dashboard_data.ts は public/dashboard-data.json を書き換える
//   副作用が大きいため対象外。他のスクリプト (grid_search, multi_axis 等) は
//   現状未活用または特定 Phase 用のため smoke 対象から除外。
//
// 副作用:
//   各スクリプトが scripts/verification/*.md や scripts/output/*.{html,json}
//   を上書きする。レポート系で再生成容易なため許容。
//
// 実行: pnpm tsx scripts/test_existing_scripts_smoke.ts
// ==========================================

import { spawn } from 'node:child_process';
import path from 'node:path';

const TARGETS = [
  { name: 'backtest.ts',           script: 'scripts/backtest.ts',           timeoutMs: 600_000 },
  { name: 'class_analysis.ts',     script: 'scripts/class_analysis.ts',     timeoutMs: 600_000 },
  { name: 'backtest_trifecta.ts',  script: 'scripts/backtest_trifecta.ts',  timeoutMs: 600_000 },
  { name: 'verify_kiken_popular.ts', script: 'scripts/verify_kiken_popular.ts', timeoutMs: 600_000 },
];

const PROJECT_ROOT = path.resolve(__dirname, '..');

interface RunResult {
  name: string;
  exitCode: number | null;
  durationMs: number;
  ok: boolean;
  errorTail: string;
}

function runScript(name: string, script: string, timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    let stdoutTail = '';
    let stderrTail = '';
    const child = spawn('npx', ['tsx', script], {
      cwd: PROJECT_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, USE_MOCK: 'false' },
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout?.on('data', (chunk) => {
      stdoutTail = (stdoutTail + chunk.toString()).slice(-2000);
    });
    child.stderr?.on('data', (chunk) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-2000);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const durationMs = Date.now() - start;
      const exitCode = timedOut ? -1 : code;
      const ok = exitCode === 0;
      const errorTail = ok ? '' : (stderrTail || stdoutTail).slice(-500);
      resolve({ name, exitCode, durationMs, ok, errorTail });
    });
  });
}

async function main() {
  console.log(`[smoke-c4] 対象: ${TARGETS.length}スクリプト`);
  console.log(`[smoke-c4] 各タイムアウト: 600秒`);
  console.log('');

  const results: RunResult[] = [];

  for (const t of TARGETS) {
    console.log(`[smoke-c4] === ${t.name} 実行中... ===`);
    const r = await runScript(t.name, t.script, t.timeoutMs);
    results.push(r);
    if (r.ok) {
      console.log(`  ✓ ${r.name} 正常終了 (exit=0, ${(r.durationMs / 1000).toFixed(1)}秒)`);
    } else {
      console.error(`  ✗ ${r.name} 失敗 (exit=${r.exitCode}, ${(r.durationMs / 1000).toFixed(1)}秒)`);
      if (r.errorTail) {
        console.error(`    エラー末尾:\n${r.errorTail.split('\n').map((l) => '      ' + l).join('\n')}`);
      }
    }
    console.log('');
  }

  const pass = results.filter((r) => r.ok).length;
  const fail = results.length - pass;

  console.log('========================================');
  console.log(`合計: pass ${pass} / fail ${fail}`);
  console.log('========================================');
  console.log('');
  console.log('実行時間:');
  for (const r of results) {
    console.log(`  ${r.name.padEnd(30)} ${(r.durationMs / 1000).toFixed(1)}秒 ${r.ok ? '✓' : '✗'}`);
  }

  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
