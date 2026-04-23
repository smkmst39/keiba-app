// ==========================================
// レースカテゴリ分類 (信頼度計算 × ダッシュボード集計で共有)
// scripts/build_dashboard_data.ts と同一ロジックを保持
// ==========================================

/** Race meta の小型サブセット (依存循環回避) */
export type RaceMetaForCategory = {
  raceClass?: string;
  raceGrade?: string;
};

/** クラスキー: G1/G2/G3/L/C3/C2/C1/UW/NW/OP/SP */
export function classifyClassKey(meta: RaceMetaForCategory): string {
  const g = meta.raceGrade;
  if (g === 'G1') return 'G1';
  if (g === 'G2') return 'G2';
  if (g === 'G3') return 'G3';
  if (g === 'L')  return 'L';
  const rc = meta.raceClass ?? '';
  if (/3勝|1600万/.test(rc)) return 'C3';
  if (/2勝|1000万/.test(rc)) return 'C2';
  if (/1勝|500万/.test(rc))  return 'C1';
  if (/未勝利/.test(rc))      return 'UW';
  if (/新馬/.test(rc))        return 'NW';
  if (/オープン|OP|リステッド/.test(rc)) return 'OP';
  return 'SP';
}

/** 距離帯キー (5バンド) */
export function distanceBandKey(d?: number): string {
  if (d == null) return 'unknown';
  if (d <= 1200) return '≤1200';
  if (d <= 1599) return '1201-1599';
  if (d <= 1899) return '1600-1899';
  if (d <= 2199) return '1900-2199';
  return '≥2200';
}
