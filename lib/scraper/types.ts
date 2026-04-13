// ==========================================
// 競馬データ型定義
// ==========================================

/** 出走馬の情報 */
export type Horse = {
  id: number;          // 馬番
  name: string;        // 馬名
  waku: number;        // 枠番
  odds: number;        // 単勝オッズ
  fukuOddsMin: number; // 複勝オッズ下限
  fukuOddsMax: number; // 複勝オッズ上限
  jockey: string;      // 騎手名
  trainer: string;     // 調教師名
  weight: number;      // 馬体重（kg）
  weightDiff: number;  // 馬体重増減（kg）
  lastThreeF: number;  // 前走上がり3F（秒）
  score?: number;      // 計算後スコア（0-100）
  ev?: number;         // 単勝期待値（calcEV で付与）
};

/** レース情報 */
export type Race = {
  raceId: string;                 // netkeibaレースID（例: "202606030511"）
  name: string;                   // レース名
  course: string;                 // 競馬場名
  distance: number;               // 距離（m）
  surface: 'turf' | 'dirt';      // 芝 or ダート
  horses: Horse[];                // 出走馬リスト
  fetchedAt: Date;                // データ取得日時
};

/** 馬券の券種 */
export type BetType =
  | 'tan'      // 単勝
  | 'fuku'     // 複勝
  | 'waku'     // 枠連
  | 'umaren'   // 馬連
  | 'wide'     // ワイド
  | 'umatan'   // 馬単
  | 'sanfuku'  // 三連複
  | 'santan';  // 三連単

/** APIレスポンス形式 */
export type RaceApiResponse = {
  success: boolean;
  data: Race | null;
  error?: string;
};

// ==========================================
// 開催スケジュール型
// ==========================================

/** グレード種別 */
export type Grade = 'G1' | 'G2' | 'G3' | 'L' | 'OP' | null;

/** 1レース分のエントリ */
export type RaceEntry = {
  raceId: string;       // "202606030511"
  raceNum: number;      // 11
  startTime: string;    // "15:45"
  raceName: string;     // "ニュージーランドトロフィー"
  grade: Grade;
  headCount: number;    // 出走頭数
};

/** 1競馬場分のデータ */
export type Venue = {
  name: string;         // "中山"
  code: string;         // "06"
  races: RaceEntry[];   // 発走時刻順ソート済み
};

// ==========================================
// 組み合わせオッズ型
// ==========================================

/**
 * 組み合わせオッズデータ
 * キー形式: 2頭="1-2"(小さい番号先), 馬単="1-2"(順序付き), 三連系="1-2-3"
 */
export type ComboOddsData = {
  waku:    Record<string, number>; // 枠連: "1-2": 12.0
  umaren:  Record<string, number>; // 馬連: "1-2": 8.4
  umatan:  Record<string, number>; // 馬単: "1-2": 15.2 (1着→2着順)
  wide:    Record<string, number>; // ワイド: "1-2": 3.1
  sanfuku: Record<string, number>; // 三連複: "1-2-3": 42.5 (昇順)
  santan:  Record<string, number>; // 三連単: "1-2-3": 185.0 (1着→2着→3着順)
};

/** 組み合わせオッズAPIレスポンス */
export type ComboOddsApiResponse = {
  success: boolean;
  data: ComboOddsData | null;
  meta: { fetchedAt: string; cached: boolean };
  error?: string;
};

/** スケジュールAPIレスポンス */
export type ScheduleResponse = {
  success: boolean;
  data: {
    date: string;       // "20260411"
    venues: Venue[];
  }[];
  meta: {
    fetchedAt: string;  // ISO8601
    cached: boolean;
    mock: boolean;
  };
};
