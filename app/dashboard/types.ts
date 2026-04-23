// ==========================================
// ダッシュボードデータの型
// public/dashboard-data.json の構造と一致させること
// 生成元: scripts/build_dashboard_data.ts
// ==========================================

export type BestWorstPoint = { month: string; roi: number } | null;

export type TypeDetail = {
  roi: number;
  joinedRaces: number;
  totalRaces: number;
  hits: number;
  hitRate: number;
  recoveryRate: number;
  monthlyCV: number;
  bestMonth: BestWorstPoint;
  worstMonth: BestWorstPoint;
  label: string;
  costPerRace: number;
  condition: string;
};

export type MonthlyEntry = {
  month: string;
  samples: number;
  umarenHonmei: { participated: number; hits: number; roi: number };
  umatanHonmei: { participated: number; hits: number; roi: number };
  wideKenjitsu: { participated: number; hits: number; roi: number };
};

export type StrategyRule = {
  class: string;
  umaren: string;
  umatan: string;
  wide: string;
};

export type DashboardData = {
  generatedAt: string;
  summary: {
    totalRaces: number;
    period: { from: string; to: string };
    totalPt: number;
    umarenHonmeiROI: number;
    umatanHonmeiROI: number;
    wideKenjitsuROI: number;
    overallHitRate: number;
    joinedRacesUmaren: number;
  };
  monthly: MonthlyEntry[];
  byType: {
    umarenHonmei: TypeDetail;
    umatanHonmei: TypeDetail;
    wideKenjitsu: TypeDetail;
  };
  strategy: {
    name: string;
    description: string;
    rules: StrategyRule[];
    verificationSummary: string;
  };
};

/** 券種カラー (馬連=赤 / 馬単=青 / ワイド=緑) */
export const TYPE_COLORS = {
  umarenHonmei: '#c05621',
  umatanHonmei: '#2b6cb0',
  wideKenjitsu: '#276749',
} as const;
