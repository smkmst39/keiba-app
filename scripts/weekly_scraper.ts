// ==========================================
// 週次スクレイプスクリプト
//
// 毎週月曜朝に実行する想定で、未取得の最新レース (前週末〜実行日前日) を
// 自動検出して取得する。既存 JSON があればスキップ。
//
// 使い方:
//   pnpm run weekly-scrape              # デフォルト: 過去 14 日間を対象
//   pnpm run weekly-scrape -- --days 21 # 過去 21 日間に広げる
//
// 動作:
//   1. 実行日から過去 N 日間の日付を列挙
//   2. 各日付の schedule を scraper で取得
//   3. 既存 JSON と照合し、未取得レースのみ fetchRaceData + fetchRaceResult 実行
//   4. 既存の collect-verification.ts のロジックを再利用
//
// 関連ドキュメント: scripts/weekly_scraper_README.md
// ==========================================

import { promises as fs } from 'node:fs';
import path from 'node:path';

const DIR = path.resolve(__dirname, 'verification');
const LOG_PATH = path.join(DIR, 'weekly_scrape.log');

// collect-verification.ts を再利用するため、引数を組み立てて spawn する方式
import { spawn } from 'node:child_process';

// ----------------------------------------
// 日付生成
// ----------------------------------------

function formatDate(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function generateTargetDates(daysBack: number): string[] {
  const today = new Date();
  const dates: string[] = [];
  for (let i = 1; i <= daysBack; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    // 土日祝 + 月曜祝日を対象 (JRA 開催日)
    const day = d.getDay();
    if (day === 0 || day === 6 || day === 1) {
      dates.push(formatDate(d));
    }
  }
  // 古い日付順
  dates.sort();
  return dates;
}

// ----------------------------------------
// 既存ファイル数の変化を計測
// ----------------------------------------

async function countJsonFiles(): Promise<number> {
  const files = await fs.readdir(DIR);
  return files.filter((f) => f.endsWith('.json')).length;
}

// ----------------------------------------
// 事前チェック: netkeiba アクセス可否
// ----------------------------------------

async function checkAccess(): Promise<boolean> {
  try {
    const res = await fetch('https://race.netkeiba.com/race/shutuba.html?race_id=202506030811', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

// ----------------------------------------
// 深夜帯チェック (2-6時禁止)
// ----------------------------------------

function isForbiddenTime(): boolean {
  const h = new Date().getHours();
  return h >= 2 && h < 6;
}

// ----------------------------------------
// ログ出力
// ----------------------------------------

async function log(msg: string): Promise<void> {
  const stamped = `[${new Date().toISOString()}] ${msg}\n`;
  await fs.appendFile(LOG_PATH, stamped, 'utf-8');
  console.log(msg);
}

// ----------------------------------------
// メイン
// ----------------------------------------

async function main(): Promise<void> {
  // 引数解析
  const args = process.argv.slice(2);
  const daysIdx = args.indexOf('--days');
  const days = daysIdx >= 0 && args[daysIdx + 1] ? parseInt(args[daysIdx + 1], 10) : 14;

  await log(`===== 週次スクレイプ開始 (過去 ${days} 日) =====`);

  // 事前チェック
  if (isForbiddenTime()) {
    await log('⚠️  深夜帯 (2-6時) の実行は禁止されています');
    process.exit(1);
  }

  const accessible = await checkAccess();
  if (!accessible) {
    await log('⚠️  netkeiba にアクセスできません (HTTP 200 以外)。3 時間待機してから再実行してください');
    process.exit(1);
  }
  await log('✅ netkeiba アクセス確認 OK');

  // 対象日付
  const dates = generateTargetDates(days);
  if (dates.length === 0) {
    await log('対象日付がありません');
    return;
  }
  await log(`対象日付: ${dates.length} 日 (${dates[0]} 〜 ${dates[dates.length - 1]})`);

  // 既存ファイル数
  const beforeCount = await countJsonFiles();
  await log(`実行前の JSON 数: ${beforeCount}`);

  // collect-verification.ts を子プロセスで実行
  // 既存 JSON はスキップされるので、新規分のみ追加される
  const projectRoot = path.resolve(__dirname, '..');
  await log(`collect-verification.ts を起動 (--dates 形式で日付を渡す)`);

  const child = spawn('pnpm', [
    'tsx',
    path.join('scripts', 'collect-verification.ts'),
    '--dates', dates.join(','),
  ], {
    cwd: projectRoot,
    env: { ...process.env, USE_MOCK: 'false', DISABLE_SIRE: 'true' },
    stdio: 'inherit',
  });

  await new Promise<void>((resolve, reject) => {
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`collect-verification.ts 終了コード: ${code}`));
    });
    child.on('error', reject);
  });

  // 結果確認
  const afterCount = await countJsonFiles();
  const added = afterCount - beforeCount;
  await log(`実行後の JSON 数: ${afterCount} (新規 ${added})`);
  await log(`===== 週次スクレイプ完了 =====`);

  // 集計: 失敗レース確認
  // collect-verification.ts が collect.log に書き込むのでそちらを確認
  try {
    const collectLog = await fs.readFile(path.join(DIR, 'collect.log'), 'utf-8');
    const lastLines = collectLog.split('\n').slice(-20).join('\n');
    await log(`--- collect.log 末尾 20 行 ---\n${lastLines}`);
  } catch { /* log not found ok */ }
}

main().catch((e) => {
  console.error('FATAL:', e);
  void log(`FATAL: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
