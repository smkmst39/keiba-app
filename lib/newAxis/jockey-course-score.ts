// ==========================================
// アプローチ2 軸1: 騎手コース別勝率スコア (新軸、Phase 2G と並走)
//
// 3段階フォールバック:
//   tight:  jockey × course × surface (サンプル ≥20R で採用)
//   medium: jockey × surface          (tight 不足時)
//   loose:  jockey のみ                (medium 不足時)
//   fallback: 全騎手平均 (上記全てサンプル不足)
//
// 正規化: 全体平均勝率 (≈7%) を 0.5、最高勝率 (20%) を 1.0、0% を 0.0
// シグモイドではなく線形スケールで解釈性を確保
// ==========================================

export type JockeyCourseScoreInput = {
  jockey: string;
  course: string;     // "東京" / "中山" / ...
  surface: 'turf' | 'dirt';
};

export type Stat = {
  jockey: string;
  course: string;
  surface: string;
  totalRaces: number;
  wins: number;
  top3: number;
  winRate: number;
  top3Rate: number;
};

export type StatsDataset = {
  stats: Stat[];
  overall: { averageWinRate: number; averageTop3Rate: number };
};

export type ScoreSource = 'tight' | 'medium' | 'loose' | 'fallback';

export type JockeyCourseScoreResult = {
  score: number;          // 0〜1 正規化スコア
  source: ScoreSource;
  rawWinRate: number;
  sampleSize: number;
};

const MIN_SAMPLE_TIGHT = 20;
const MIN_SAMPLE_MEDIUM = 50;
const MIN_SAMPLE_LOOSE = 80;

// 線形正規化: 平均を 0.5、20% を 1.0、0% を 0.0
function normalize(winRate: number, average: number): number {
  const anchorMax = 0.20;  // 20% で 1.0
  if (winRate >= anchorMax) return 1.0;
  if (winRate >= average) {
    // average 〜 anchorMax を 0.5 〜 1.0
    if (anchorMax === average) return 0.5;
    return 0.5 + ((winRate - average) / (anchorMax - average)) * 0.5;
  }
  // 0 〜 average を 0.0 〜 0.5
  if (average === 0) return 0.5;
  return Math.max(0, (winRate / average) * 0.5);
}

function findStat(
  dataset: StatsDataset,
  jockey: string,
  predicate: (s: Stat) => boolean,
): { winRate: number; top3Rate: number; sampleSize: number } | null {
  let total = 0, wins = 0;
  for (const s of dataset.stats) {
    if (s.jockey === jockey && predicate(s)) {
      total += s.totalRaces;
      wins  += s.wins;
    }
  }
  if (total === 0) return null;
  return {
    winRate:  wins / total,
    top3Rate: 0,
    sampleSize: total,
  };
}

/**
 * 騎手コース別勝率スコアを返す (0〜1 正規化)
 *
 * 3 階層フォールバック + 全体平均フォールバック。
 * source フィールドで採用された粒度を明示。
 */
export function calcJockeyCourseScore(
  input: JockeyCourseScoreInput,
  dataset: StatsDataset,
): JockeyCourseScoreResult {
  const { jockey, course, surface } = input;
  const avg = dataset.overall.averageWinRate;

  // tight: jockey × course × surface
  {
    const tight = findStat(dataset, jockey, (s) => s.course === course && s.surface === surface);
    if (tight && tight.sampleSize >= MIN_SAMPLE_TIGHT) {
      return { score: normalize(tight.winRate, avg), source: 'tight', rawWinRate: tight.winRate, sampleSize: tight.sampleSize };
    }
  }
  // medium: jockey × surface
  {
    const med = findStat(dataset, jockey, (s) => s.surface === surface);
    if (med && med.sampleSize >= MIN_SAMPLE_MEDIUM) {
      return { score: normalize(med.winRate, avg), source: 'medium', rawWinRate: med.winRate, sampleSize: med.sampleSize };
    }
  }
  // loose: jockey 全体
  {
    const loose = findStat(dataset, jockey, () => true);
    if (loose && loose.sampleSize >= MIN_SAMPLE_LOOSE) {
      return { score: normalize(loose.winRate, avg), source: 'loose', rawWinRate: loose.winRate, sampleSize: loose.sampleSize };
    }
  }
  // fallback: 全体平均 → 中立スコア 0.5
  return { score: 0.5, source: 'fallback', rawWinRate: avg, sampleSize: 0 };
}
