// Unknown 判定されたレース名のサンプル抽出 + 分類不能パターン分析

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { VerificationData } from '../lib/scraper/types';

const DIR = path.resolve(__dirname, 'verification');

function classifyRace(name: string): string {
  const n = name;
  if (/G1|GⅠ|Ｇ１/.test(n)) return 'G1';
  if (/G2|GⅡ|Ｇ２/.test(n)) return 'G2';
  if (/G3|GⅢ|Ｇ３/.test(n)) return 'G3';
  if (/皐月賞|東京優駿|ダービー|菊花賞|桜花賞|オークス|優駿牝馬|秋華賞|天皇賞|有馬記念|宝塚記念|ジャパンカップ|NHKマイル|安田記念|スプリンターズ|マイルチャンピオン|エリザベス女王杯|ヴィクトリアマイル|高松宮記念|大阪杯|チャンピオンズカップ|フェブラリーステークス|朝日杯FS|阪神JF|ホープフル|帝王賞|JBC|東京大賞典/.test(n)) return 'G1';
  if (/\(L\)|（L）|リステッド/.test(n)) return 'OP';
  if (/オープン|ＯＰ|\(OP\)/.test(n)) return 'OP';
  if (/3勝|1600万/.test(n)) return 'C3';
  if (/2勝|1000万/.test(n)) return 'C2';
  if (/1勝|500万/.test(n)) return 'C1';
  if (/未勝利/.test(n)) return 'UW';
  if (/新馬/.test(n)) return 'NW';
  return 'Unknown';
}

async function main(): Promise<void> {
  const files = (await fs.readdir(DIR)).filter((f) => f.endsWith('.json'));
  const unknowns: Array<{ raceId: string; raceName: string; hasHeadCount: boolean; nameLen: number }> = [];
  let total = 0;
  let emptyName = 0;
  for (const f of files) {
    try {
      const vd = JSON.parse(await fs.readFile(path.join(DIR, f), 'utf-8')) as VerificationData;
      total++;
      if (!vd.raceName || vd.raceName.trim() === '') { emptyName++; unknowns.push({ raceId: vd.raceId, raceName: vd.raceName ?? '', hasHeadCount: vd.predictions.length > 0, nameLen: 0 }); continue; }
      if (classifyRace(vd.raceName) === 'Unknown') {
        unknowns.push({ raceId: vd.raceId, raceName: vd.raceName, hasHeadCount: vd.predictions.length > 0, nameLen: vd.raceName.length });
      }
    } catch {}
  }
  console.log(`総レース数: ${total}`);
  console.log(`Unknown: ${unknowns.length}`);
  console.log(`  内、レース名空: ${emptyName}`);
  console.log('');

  // 実例を頭から30件
  console.log('▼ Unknown レース名サンプル (先頭30件):');
  unknowns.slice(0, 30).forEach((u, i) => {
    console.log(`  ${(i + 1).toString().padStart(2)}: ${u.raceId}  |  "${u.raceName}"  (len=${u.nameLen})`);
  });
  console.log('');

  // レース名の頻度集計 (出現回数が多いものを特定)
  const nameFreq = new Map<string, number>();
  for (const u of unknowns) {
    nameFreq.set(u.raceName, (nameFreq.get(u.raceName) ?? 0) + 1);
  }
  const sortedFreq = [...nameFreq.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`▼ Unknown レース名の頻度 TOP 20 (ユニーク ${sortedFreq.length} 種):`);
  sortedFreq.slice(0, 20).forEach(([name, count]) => {
    console.log(`   ${count.toString().padStart(4)} × "${name}"`);
  });
  console.log('');

  // キーワード的なものを抽出してみる
  const keywords = ['ステークス', 'Ｓ', 'S', '特別', '賞', 'カップ', 'C', '杯', 'トロフィー', 'ダート', '芝', '歳', '以上', 'オープン', 'オ ー プ ン', 'GII', 'GIII', 'L'];
  const kwCount = new Map<string, number>();
  for (const u of unknowns) {
    for (const kw of keywords) {
      if (u.raceName.includes(kw)) kwCount.set(kw, (kwCount.get(kw) ?? 0) + 1);
    }
  }
  console.log('▼ Unknown 内のキーワード出現頻度:');
  for (const [kw, c] of [...kwCount.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${kw.padEnd(10)}: ${c}`);
  }
  console.log('');

  // "歳以上" / "2歳" / "3歳" で始まるパターン
  let ageOnly = 0;
  for (const u of unknowns) {
    if (/^[23]歳/.test(u.raceName) || /\d歳以上/.test(u.raceName)) ageOnly++;
  }
  console.log(`年齢条件のみのレース名: ${ageOnly} 件`);
}

main().catch(console.error);
