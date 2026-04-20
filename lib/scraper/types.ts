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
  jockeyCode?: string; // db.netkeiba.com 騎手コード（pre-entryモードで付与）
  trainerCode?: string;// db.netkeiba.com 調教師コード（pre-entryモードで付与）
  score?: number;      // 計算後スコア（0-100）
  ev?: number;         // 単勝期待値（calcEV で付与）
  prevRaceName?: string;  // 前走レース名（出馬表の前走リンクのテキスト）
  prevRaceClass?: number; // 前走クラススコア（15-100。classifyPrevRace 参照）

  // --- 血統関連（Phase 2B で追加。取得失敗時は undefined） ---
  horseId?: string;        // db.netkeiba.com の競走馬ID（10桁数字）
  father?: string;         // 父馬名（種牡馬）
  fatherId?: string;       // 父馬の種牡馬ID（db.netkeiba.com/sire/{id}/）
  /** 父馬の「当該コース×距離帯」連対率 (0〜1)。normalize 前のレート */
  breedingFitness?: number;
  breedingScore?: number;  // 血統適性スコア（0〜100。scoreBreeding で算出）
};

/** 距離帯の分類（血統スコア計算で使用） */
export type DistanceBand = 'sprint' | 'mile' | 'intermediate' | 'long';

/** 種牡馬統計（芝/ダート × 距離帯ごとの連対率・勝率） */
export type SireStats = {
  sireName: string;
  sireId?: string;
  turf: Partial<Record<DistanceBand, { placeRate: number; winRate: number; samples: number }>>;
  dirt: Partial<Record<DistanceBand, { placeRate: number; winRate: number; samples: number }>>;
};

/**
 * レース表示モード
 * - confirmed: 枠順確定済み（通常モード）
 * - pre-entry: 枠順未確定（仮予想モード）。オッズ・枠番なし
 */
export type RaceMode = 'confirmed' | 'pre-entry';

/** レース情報 */
export type Race = {
  raceId: string;                 // netkeibaレースID（例: "202606030511"）
  name: string;                   // レース名
  course: string;                 // 競馬場名
  distance: number;               // 距離（m）
  surface: 'turf' | 'dirt';      // 芝 or ダート
  horses: Horse[];                // 出走馬リスト
  fetchedAt: Date;                // データ取得日時
  mode?: RaceMode;               // 省略時は 'confirmed' として扱う
  startTime?: string;            // 発走時刻 "HH:MM" 形式（例: "15:40"）
  raceDate?: string;             // 開催日 "YYYYMMDD"（例: "20260418"）
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

// ==========================================
// レース結果型
// ==========================================

/** 1頭分の着順データ */
export type RaceResultItem = {
  rank: number;       // 着順
  horseId: number;    // 馬番
  horseName: string;  // 馬名
  time: string;       // タイム（例: "1:57.0"）
  lastThreeF: number; // 後3F（秒、例: 34.1）
};

/** 払戻金データ */
export type RacePayouts = {
  tan:    { horseId: number; payout: number }[];                // 単勝
  umaren: { combination: string; payout: number }[];            // 馬連
  wide?:  { combination: string; payout: number }[];            // ワイド（任意：Phase 2D以降）
  sanfuku: { combination: string; payout: number }[];           // 三連複
  santan:  { combination: string; payout: number }[];           // 三連単
};

/** レース結果（スクレイピング後） */
export type RaceResult = {
  raceId: string;
  results: RaceResultItem[];
  payouts: RacePayouts;
};

/** 検証データ（ローカル保存用） */
export type VerificationData = {
  raceId: string;
  raceName: string;
  date: string;       // "YYYY-MM-DD"
  predictions: {
    horseId: number;
    horseName: string;
    score: number;
    ev: number;
    odds: number;
  }[];
  results: RaceResult;
  accuracy: {
    top1ScoreRank: number;   // 1着馬のスコア順位
    top3EVCount: number;     // EV1.0以上で3着以内に来た頭数
    recommendedHits: {       // 推奨馬券の的中
      type: string;
      hit: boolean;
      payout: number;
    }[];
  };
};

/** 結果APIレスポンス */
export type RaceResultApiResponse = {
  success: boolean;
  data: RaceResult | null;
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
