// ==========================================
// レース選択画面用の推奨ヒント判定
//
// スケジュール行 (raceName, grade) 時点では馬個別データが無いので、
// レース選択画面での推奨有無は「クラス別の過去実績」ベースの近似で判定する。
// → 全レース瞬時 / 追加 netkeiba アクセス 0 / レート制限の懸念なし
//
// 正確な per-race 推奨判定は、レースを選択した後の
// RaceReport.tsx / ReliabilityCard.tsx で実施される (フェーズ2)。
// ==========================================

import type { Grade } from '@/lib/scraper/types';

export type RaceListRecLevel = 'honmei' | 'kenjitsu' | 'excluded' | 'none' | 'unknown';

/** 信頼度バッジ (フェーズ2 と整合) */
export type RaceListReliability = 'high' | 'mid' | 'caution' | 'low' | 'excluded' | 'unknown';

export type RaceListHint = {
  level: RaceListRecLevel;
  reliability: RaceListReliability;
  classKey: string;
  note: string;               // ホバー/aria 用の説明
  historicalROI: number;      // クラス過去 ROI
  historicalParticipated: number;
  historicalCV: number;
};

/** スケジュール由来のレース名 + grade → クラスキー (lib/reliability/race-category と整合) */
export function classifyFromName(raceName: string, grade: Grade | null | undefined): string {
  if (grade === 'G1') return 'G1';
  if (grade === 'G2') return 'G2';
  if (grade === 'G3') return 'G3';
  if (grade === 'L')  return 'L';

  const n = (raceName ?? '').trim();
  // レース名中のグレード表記
  if (/G1|GⅠ|Ｇ１/.test(n)) return 'G1';
  if (/G2|GⅡ|Ｇ２/.test(n)) return 'G2';
  if (/G3|GⅢ|Ｇ３/.test(n)) return 'G3';
  if (/\(L\)|（L）|リステッド/.test(n)) return 'L';

  // 条件戦 (明示)
  if (/3勝|1600万/.test(n)) return 'C3';
  if (/2勝|1000万/.test(n)) return 'C2';
  if (/1勝|500万/.test(n)) return 'C1';
  if (/未勝利/.test(n))      return 'UW';
  if (/新馬/.test(n))        return 'NW';

  // オープン特別
  if (/オープン|ＯＰ|\(OP\)|（OP）/.test(n)) return 'OP';

  // 愛称 (特別) — 一般にOP相当
  if (/S$|Ｓ$|ステークス|特別|賞$|杯$|カップ|C$|Ｃ$/.test(n)) return 'SP';

  return 'Unknown';
}

type Bucket = {
  total: number;
  umarenParticipated: number;
  umarenHits: number;
  umarenROI: number;
  monthlyCV: number;
  monthsEvaluated: number;
};

/**
 * クラス別過去実績 → レベル + 信頼度ラベル
 *
 * level 判定:
 *   - C1 / C2: 'excluded' (Phase 2G で全券種 or 馬連馬単 skip)
 *     (C2 のみワイドは参加だが、レース選択画面での「推奨あり」強調には不十分と判断)
 *   - クラス過去 ROI ≥ 120% AND 推奨R ≥ 50: 'honmei' (本命級推奨が出やすい)
 *   - クラス過去 ROI ≥ 100% AND 推奨R ≥ 20: 'kenjitsu' (堅実級までは期待)
 *   - ROI < 100% OR 推奨R < 20: 'none'
 *   - バケット欠損: 'unknown'
 *
 * reliability は ReliabilityCard と同じ閾値 (ROI 120/100, R 50/20, CV 0.5/1.0)
 */
export function detectRaceListHint(
  raceName: string,
  grade: Grade | null | undefined,
  byCategoryClassOnly: Record<string, Bucket>,
): RaceListHint {
  const classKey = classifyFromName(raceName, grade);
  const bucket = byCategoryClassOnly[classKey];

  // 1勝・2勝クラスは Phase 2G で除外
  if (classKey === 'C1' || classKey === 'C2') {
    return {
      level: 'excluded',
      reliability: 'excluded',
      classKey,
      note: `${classKey === 'C1' ? '1勝' : '2勝'}クラスは Phase 2G で馬連・馬単 skip`,
      historicalROI: bucket?.umarenROI ?? 0,
      historicalParticipated: bucket?.umarenParticipated ?? 0,
      historicalCV: bucket?.monthlyCV ?? 0,
    };
  }

  if (!bucket || bucket.umarenParticipated === 0) {
    return {
      level: 'unknown',
      reliability: 'unknown',
      classKey,
      note: '過去実績データが不足',
      historicalROI: 0,
      historicalParticipated: 0,
      historicalCV: 0,
    };
  }

  const roi = bucket.umarenROI;
  const n   = bucket.umarenParticipated;
  const cv  = bucket.monthlyCV;

  let level: RaceListRecLevel;
  if (roi >= 120 && n >= 50) level = 'honmei';
  else if (roi >= 100 && n >= 20) level = 'kenjitsu';
  else level = 'none';

  let reliability: RaceListReliability;
  if (roi >= 120 && n >= 50 && cv <= 0.5) reliability = 'high';
  else if (roi >= 100 && n >= 20 && cv <= 1.0) reliability = 'mid';
  else if (roi >= 100) reliability = 'caution';
  else reliability = 'low';

  return {
    level,
    reliability,
    classKey,
    note: `${classKey}: 過去 ROI ${roi.toFixed(0)}% / 推奨${n}R / CV ${cv.toFixed(2)}`,
    historicalROI: roi,
    historicalParticipated: n,
    historicalCV: cv,
  };
}

/** レベル → UI スタイル (控えめ背景 + 左 border 強調) */
export const REC_STYLE: Record<RaceListRecLevel, {
  bg: string;
  borderLeft: string;
  label: string;
  ringColor: string;
}> = {
  honmei:   { bg: '#fffbeb', borderLeft: '#d97706', label: '本命級', ringColor: '#f59e0b' },
  kenjitsu: { bg: '#eff6ff', borderLeft: '#2563eb', label: '堅実級', ringColor: '#3b82f6' },
  excluded: { bg: '#f8fafc', borderLeft: '#94a3b8', label: '対象外', ringColor: '#94a3b8' },
  none:     { bg: 'transparent', borderLeft: 'transparent', label: '',    ringColor: 'transparent' },
  unknown:  { bg: 'transparent', borderLeft: 'transparent', label: '',    ringColor: 'transparent' },
};

/** 信頼度 → 絵文字 */
export const RELIABILITY_EMOJI: Record<RaceListReliability, string> = {
  high:     '🟢',
  mid:      '🟡',
  caution:  '🟠',
  low:      '🔴',
  excluded: '🚫',
  unknown:  '⚪',
};
