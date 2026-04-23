// ==========================================
// 個別予想の信頼度計算ロジック
//
// public/dashboard-data.json の byCategory 集計から、
// 表示中レースと類似条件の過去実績を抽出して
// 信頼度レベル (high/mid/caution/low/excluded/unknown) を判定する。
//
// フォールバック: tight (class+surface+band) → medium (class+surface) → classOnly
// のいずれかで umarenParticipated >= 20 を満たす最も細粒度のバケットを採用。
// ==========================================

import type { Race } from '@/lib/scraper/types';
import { classifyClassKey, distanceBandKey } from './race-category';

export type ReliabilityLevel = 'high' | 'mid' | 'caution' | 'low' | 'excluded' | 'unknown';

export type ReliabilityInfo = {
  level: ReliabilityLevel;
  label: string;               // "🟢 高" 等
  color: string;               // テーマ色
  bg: string;                  // 背景色
  border: string;              // ボーダー色
  similarRaceCount: number;    // バケット総R数
  umarenParticipated: number;  // 馬連本命 推奨R数
  umarenROI: number;           // 馬連本命 ROI (%)
  monthlyCV: number;           // 月別CV
  granularity: 'tight' | 'medium' | 'classOnly' | 'none';  // 採用されたフォールバック段階
  conditions: string[];        // 類似条件のラベル
  comment: string;             // 一言コメント
};

type Bucket = {
  total: number;
  umarenParticipated: number;
  umarenHits: number;
  umarenROI: number;
  monthlyCV: number;
  monthsEvaluated: number;
};

/** dashboard-data.json の byCategory 部分だけに依存 (結合度低減) */
type ByCategoryData = {
  tight:     Record<string, Bucket>;
  medium:    Record<string, Bucket>;
  classOnly: Record<string, Bucket>;
};

/** 指標 (ROI / 参加R / CV) を閾値と照合してレベルを返す */
function judgeLevel(b: Bucket, isExcludedClass: boolean): ReliabilityLevel {
  // 除外クラス (C1/C2 で umarenParticipated=0) は特殊扱い
  if (isExcludedClass) return 'excluded';
  if (b.umarenParticipated === 0) return 'unknown';
  const roi = b.umarenROI;
  const n   = b.umarenParticipated;
  const cv  = b.monthlyCV;
  if (roi < 100) return 'low';
  if (roi >= 120 && n >= 50 && cv <= 0.5) return 'high';
  if (roi >= 100 && n >= 20 && cv <= 1.0) return 'mid';
  return 'caution';
}

/** レベル → UI パラメータ */
const LEVEL_STYLE: Record<ReliabilityLevel, { label: string; color: string; bg: string; border: string }> = {
  high:     { label: '🟢 高',   color: '#14532d', bg: '#f0fdf4', border: '#86efac' },
  mid:      { label: '🟡 中',   color: '#713f12', bg: '#fefce8', border: '#fde047' },
  caution:  { label: '🟠 注意', color: '#9a3412', bg: '#fff7ed', border: '#fdba74' },
  low:      { label: '🔴 低',   color: '#7f1d1d', bg: '#fef2f2', border: '#fca5a5' },
  excluded: { label: '🚫 対象外', color: '#475569', bg: '#f1f5f9', border: '#cbd5e1' },
  unknown:  { label: '— 参考情報なし', color: '#475569', bg: '#f8fafc', border: '#e2e8f0' },
};

function generateComment(level: ReliabilityLevel, b: Bucket, granularity: string): string {
  if (level === 'excluded') return '1勝/2勝クラスは Phase 2G で推奨対象外 (ROI<70% のため)。';
  if (level === 'unknown')  return '類似条件での過去推奨がありません。このレースは戦略の対象外の可能性あり。';
  if (level === 'low')      return `過去の同条件 ROI ${b.umarenROI.toFixed(0)}% は 100% 未満、慎重に。`;
  if (level === 'high')     return `過去の同条件で安定して高ROI。サンプル充足・月別安定性 CV ${b.monthlyCV.toFixed(2)}。`;
  if (level === 'mid')      return `サンプル充足、月別安定性まずまず (CV ${b.monthlyCV.toFixed(2)})。`;
  // caution
  const issues: string[] = [];
  if (b.umarenParticipated < 20) issues.push(`推奨R少 (${b.umarenParticipated}R)`);
  if (b.monthlyCV > 1.0)         issues.push(`CV高 (${b.monthlyCV.toFixed(2)})`);
  if (b.umarenROI < 120)         issues.push(`ROI ${b.umarenROI.toFixed(0)}%`);
  return `ROI ≥ 100% だが ${issues.join(' / ')} のため参考程度に。` +
    (granularity === 'classOnly' ? ' サンプル不足で詳細条件の絞り込み不可。' : '');
}

/** Race と byCategory から 信頼度を計算 */
export function calculateReliability(race: Race, byCat: ByCategoryData): ReliabilityInfo {
  const cls  = classifyClassKey({
    raceClass: race.raceClass,
    raceGrade: race.raceGrade ?? undefined,
  });
  const surf = race.surface === 'turf' || race.surface === 'dirt' ? race.surface : 'unknown';
  const band = distanceBandKey(race.distance);

  const isExcludedClass = cls === 'C1' || cls === 'C2';

  const conditions: string[] = [
    `クラス: ${cls}`,
    surf === 'turf' ? '芝' : surf === 'dirt' ? 'ダート' : '不明',
    `距離: ${band}m`,
  ];

  // 3 階層フォールバック: tight → medium → classOnly
  const candidates: Array<{ key: string; map: Record<string, Bucket>; granularity: ReliabilityInfo['granularity'] }> = [
    { key: `${cls}|${surf}|${band}`, map: byCat.tight,     granularity: 'tight'     },
    { key: `${cls}|${surf}`,          map: byCat.medium,    granularity: 'medium'    },
    { key: cls,                        map: byCat.classOnly, granularity: 'classOnly' },
  ];

  const MIN_PARTICIPATED = 20;
  let chosen: { bucket: Bucket; granularity: ReliabilityInfo['granularity'] } | null = null;

  // 除外クラス (C1/C2) は参加R 0 が確定なので、fallback せずに classOnly を使う
  if (isExcludedClass) {
    const b = byCat.classOnly[cls];
    if (b) chosen = { bucket: b, granularity: 'classOnly' };
  } else {
    for (const c of candidates) {
      const b = c.map[c.key];
      if (b && b.umarenParticipated >= MIN_PARTICIPATED) {
        chosen = { bucket: b, granularity: c.granularity };
        break;
      }
    }
    // どの階層でも MIN 未達なら classOnly を採用 (unknown レベルになる)
    if (!chosen) {
      const b = byCat.classOnly[cls];
      if (b) chosen = { bucket: b, granularity: 'classOnly' };
    }
  }

  if (!chosen) {
    return {
      level:   'unknown',
      ...LEVEL_STYLE.unknown,
      similarRaceCount:    0,
      umarenParticipated:  0,
      umarenROI:           0,
      monthlyCV:           0,
      granularity:         'none',
      conditions,
      comment:             '類似条件の過去データがありません。',
    };
  }

  const level = judgeLevel(chosen.bucket, isExcludedClass);
  return {
    level,
    ...LEVEL_STYLE[level],
    similarRaceCount:   chosen.bucket.total,
    umarenParticipated: chosen.bucket.umarenParticipated,
    umarenROI:          chosen.bucket.umarenROI,
    monthlyCV:          chosen.bucket.monthlyCV,
    granularity:        chosen.granularity,
    conditions,
    comment:            generateComment(level, chosen.bucket, chosen.granularity),
  };
}
