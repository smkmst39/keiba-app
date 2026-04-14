// ==========================================
// スケジュールモックデータ: 2026年4月11日（土）
// USE_MOCK=true のとき /api/schedule で返す
// ==========================================

import type { Venue } from '../types';

export const MOCK_SCHEDULE_20260411: { date: string; venues: Venue[] } = {
  date: '20260411',
  venues: [
    {
      name: '中山',
      code: '06',
      races: [
        { raceId: '202606030501', raceNum: 1,  startTime: '10:05', raceName: '3歳未勝利',               grade: null, headCount: 16 },
        { raceId: '202606030502', raceNum: 2,  startTime: '10:40', raceName: '4歳以上1勝クラス',         grade: null, headCount: 14 },
        { raceId: '202606030503', raceNum: 3,  startTime: '11:15', raceName: '3歳未勝利',               grade: null, headCount: 18 },
        { raceId: '202606030504', raceNum: 4,  startTime: '11:50', raceName: '4歳以上1勝クラス',         grade: null, headCount: 15 },
        { raceId: '202606030505', raceNum: 5,  startTime: '12:25', raceName: '3歳1勝クラス',            grade: null, headCount: 16 },
        { raceId: '202606030506', raceNum: 6,  startTime: '13:00', raceName: '4歳以上2勝クラス',         grade: null, headCount: 13 },
        { raceId: '202606030507', raceNum: 7,  startTime: '13:35', raceName: '3歳1勝クラス',            grade: null, headCount: 15 },
        { raceId: '202606030508', raceNum: 8,  startTime: '14:05', raceName: '4歳以上3勝クラス',         grade: null, headCount: 12 },
        { raceId: '202606030509', raceNum: 9,  startTime: '14:35', raceName: '3歳2勝クラス',            grade: null, headCount: 14 },
        { raceId: '202606030510', raceNum: 10, startTime: '15:10', raceName: '4歳以上オープン',          grade: 'OP', headCount: 11 },
        { raceId: '202606030511', raceNum: 11, startTime: '15:45', raceName: 'ニュージーランドトロフィー', grade: 'G2', headCount: 15 },
        { raceId: '202606030512', raceNum: 12, startTime: '16:20', raceName: '4歳以上1勝クラス',         grade: null, headCount: 16 },
      ],
    },
    {
      name: '福島',
      code: '03',
      races: [
        { raceId: '202603010501', raceNum: 1,  startTime: '10:05', raceName: '3歳未勝利',       grade: null, headCount: 16 },
        { raceId: '202603010502', raceNum: 2,  startTime: '10:40', raceName: '4歳以上1勝クラス', grade: null, headCount: 15 },
        { raceId: '202603010503', raceNum: 3,  startTime: '11:15', raceName: '3歳未勝利',       grade: null, headCount: 14 },
        { raceId: '202603010504', raceNum: 4,  startTime: '11:50', raceName: '3歳1勝クラス',    grade: null, headCount: 13 },
        { raceId: '202603010505', raceNum: 5,  startTime: '12:25', raceName: '4歳以上2勝クラス', grade: null, headCount: 12 },
        { raceId: '202603010506', raceNum: 6,  startTime: '13:00', raceName: '3歳2勝クラス',    grade: null, headCount: 15 },
        { raceId: '202603010507', raceNum: 7,  startTime: '13:35', raceName: '4歳以上1勝クラス', grade: null, headCount: 14 },
        { raceId: '202603010508', raceNum: 8,  startTime: '14:05', raceName: '3歳3勝クラス',    grade: null, headCount: 11 },
        { raceId: '202603010509', raceNum: 9,  startTime: '14:35', raceName: '4歳以上2勝クラス', grade: null, headCount: 16 },
        { raceId: '202603010510', raceNum: 10, startTime: '15:10', raceName: 'エメラルドステークス', grade: 'OP', headCount: 12 },
        { raceId: '202603010511', raceNum: 11, startTime: '15:45', raceName: 'ラジオ福島賞',     grade: null, headCount: 16 },
        { raceId: '202603010512', raceNum: 12, startTime: '16:20', raceName: '4歳以上1勝クラス', grade: null, headCount: 15 },
      ],
    },
    {
      name: '阪神',
      code: '09',
      races: [
        { raceId: '202609020501', raceNum: 1,  startTime: '10:05', raceName: '3歳未勝利',         grade: null, headCount: 16 },
        { raceId: '202609020502', raceNum: 2,  startTime: '10:40', raceName: '4歳以上1勝クラス',   grade: null, headCount: 14 },
        { raceId: '202609020503', raceNum: 3,  startTime: '11:15', raceName: '3歳未勝利',         grade: null, headCount: 15 },
        { raceId: '202609020504', raceNum: 4,  startTime: '11:50', raceName: '3歳1勝クラス',      grade: null, headCount: 16 },
        { raceId: '202609020505', raceNum: 5,  startTime: '12:25', raceName: '4歳以上2勝クラス',   grade: null, headCount: 13 },
        { raceId: '202609020506', raceNum: 6,  startTime: '13:00', raceName: '3歳2勝クラス',      grade: null, headCount: 14 },
        { raceId: '202609020507', raceNum: 7,  startTime: '13:35', raceName: '4歳以上1勝クラス',   grade: null, headCount: 15 },
        { raceId: '202609020508', raceNum: 8,  startTime: '14:05', raceName: '4歳以上3勝クラス',   grade: null, headCount: 11 },
        { raceId: '202609020509', raceNum: 9,  startTime: '14:35', raceName: '3歳1勝クラス',      grade: null, headCount: 16 },
        { raceId: '202609020510', raceNum: 10, startTime: '15:10', raceName: 'メトロポリタンS',    grade: 'OP', headCount: 12 },
        { raceId: '202609020511', raceNum: 11, startTime: '15:45', raceName: '阪神牝馬ステークス', grade: 'G2', headCount: 14 },
        { raceId: '202609020512', raceNum: 12, startTime: '16:20', raceName: '4歳以上1勝クラス',   grade: null, headCount: 16 },
      ],
    },
  ],
};

// ==========================================
// 直近土・日（本日2026-04-13から数えて4/18・4/19）
// USE_MOCK=true 時にこれらの日付で開催ありを返す
// ==========================================

/** 土曜（4/18）モック: 東京・京都・新潟
 * raceId形式: {年}{場コード}{回}{日}{R} → 4/18=東京3回8日目
 * 東京(05): 202605030801〜12, 京都(08): 202608030801〜12, 新潟(04): 202604030801〜12
 */
export const MOCK_SCHEDULE_20260418: { date: string; venues: Venue[] } = {
  date: '20260418',
  venues: [
    {
      name: '東京',
      code: '05',
      races: [
        { raceId: '202605030801', raceNum: 1,  startTime: '10:05', raceName: '3歳未勝利',        grade: null, headCount: 16 },
        { raceId: '202605030802', raceNum: 2,  startTime: '10:40', raceName: '4歳以上1勝クラス',  grade: null, headCount: 14 },
        { raceId: '202605030803', raceNum: 3,  startTime: '11:15', raceName: '3歳未勝利',        grade: null, headCount: 15 },
        { raceId: '202605030804', raceNum: 4,  startTime: '11:50', raceName: '3歳1勝クラス',     grade: null, headCount: 16 },
        { raceId: '202605030805', raceNum: 5,  startTime: '12:25', raceName: '4歳以上2勝クラス',  grade: null, headCount: 13 },
        { raceId: '202605030806', raceNum: 6,  startTime: '13:00', raceName: '3歳2勝クラス',     grade: null, headCount: 14 },
        { raceId: '202605030807', raceNum: 7,  startTime: '13:35', raceName: '4歳以上1勝クラス',  grade: null, headCount: 15 },
        { raceId: '202605030808', raceNum: 8,  startTime: '14:05', raceName: '4歳以上3勝クラス',  grade: null, headCount: 11 },
        { raceId: '202605030809', raceNum: 9,  startTime: '14:35', raceName: '3歳1勝クラス',     grade: null, headCount: 16 },
        { raceId: '202605030810', raceNum: 10, startTime: '15:10', raceName: 'フローラステークス', grade: 'G2', headCount: 18 },
        { raceId: '202605030811', raceNum: 11, startTime: '15:45', raceName: '皐月賞',            grade: 'G1', headCount: 18 },
        { raceId: '202605030812', raceNum: 12, startTime: '16:20', raceName: '4歳以上1勝クラス',  grade: null, headCount: 16 },
      ],
    },
    {
      name: '京都',
      code: '08',
      races: [
        { raceId: '202608030801', raceNum: 1,  startTime: '10:05', raceName: '3歳未勝利',        grade: null, headCount: 16 },
        { raceId: '202608030802', raceNum: 2,  startTime: '10:40', raceName: '4歳以上1勝クラス',  grade: null, headCount: 14 },
        { raceId: '202608030803', raceNum: 3,  startTime: '11:15', raceName: '3歳未勝利',        grade: null, headCount: 13 },
        { raceId: '202608030804', raceNum: 4,  startTime: '11:50', raceName: '4歳以上2勝クラス',  grade: null, headCount: 12 },
        { raceId: '202608030805', raceNum: 5,  startTime: '12:25', raceName: '3歳1勝クラス',     grade: null, headCount: 16 },
        { raceId: '202608030806', raceNum: 6,  startTime: '13:00', raceName: '4歳以上3勝クラス',  grade: null, headCount: 10 },
        { raceId: '202608030807', raceNum: 7,  startTime: '13:35', raceName: '3歳2勝クラス',     grade: null, headCount: 14 },
        { raceId: '202608030808', raceNum: 8,  startTime: '14:05', raceName: '4歳以上オープン',   grade: 'OP', headCount: 12 },
        { raceId: '202608030809', raceNum: 9,  startTime: '14:35', raceName: '4歳以上1勝クラス',  grade: null, headCount: 15 },
        { raceId: '202608030810', raceNum: 10, startTime: '15:10', raceName: 'マイラーズカップ',  grade: 'G2', headCount: 14 },
        { raceId: '202608030811', raceNum: 11, startTime: '15:45', raceName: '桜花賞',            grade: 'G1', headCount: 18 },
        { raceId: '202608030812', raceNum: 12, startTime: '16:20', raceName: '4歳以上1勝クラス',  grade: null, headCount: 16 },
      ],
    },
    {
      name: '新潟',
      code: '04',
      races: [
        { raceId: '202604030801', raceNum: 1,  startTime: '10:05', raceName: '3歳未勝利',        grade: null, headCount: 15 },
        { raceId: '202604030802', raceNum: 2,  startTime: '10:40', raceName: '4歳以上1勝クラス',  grade: null, headCount: 14 },
        { raceId: '202604030803', raceNum: 3,  startTime: '11:15', raceName: '3歳未勝利',        grade: null, headCount: 16 },
        { raceId: '202604030804', raceNum: 4,  startTime: '11:50', raceName: '3歳1勝クラス',     grade: null, headCount: 12 },
        { raceId: '202604030805', raceNum: 5,  startTime: '12:25', raceName: '4歳以上2勝クラス',  grade: null, headCount: 13 },
        { raceId: '202604030806', raceNum: 6,  startTime: '13:00', raceName: '3歳2勝クラス',     grade: null, headCount: 11 },
        { raceId: '202604030807', raceNum: 7,  startTime: '13:35', raceName: '4歳以上1勝クラス',  grade: null, headCount: 15 },
        { raceId: '202604030808', raceNum: 8,  startTime: '14:05', raceName: '4歳以上3勝クラス',  grade: null, headCount: 10 },
        { raceId: '202604030809', raceNum: 9,  startTime: '14:35', raceName: '3歳1勝クラス',     grade: null, headCount: 16 },
        { raceId: '202604030810', raceNum: 10, startTime: '15:10', raceName: '新潟大賞典',        grade: 'G3', headCount: 16 },
        { raceId: '202604030811', raceNum: 11, startTime: '15:45', raceName: '4歳以上オープン',   grade: 'OP', headCount: 11 },
        { raceId: '202604030812', raceNum: 12, startTime: '16:20', raceName: '4歳以上1勝クラス',  grade: null, headCount: 14 },
      ],
    },
  ],
};

/** 日曜（4/19）モック: 東京・京都・新潟
 * 東京(05): 202605030901〜12, 京都(08): 202608030901〜12, 新潟(04): 202604030901〜12
 */
export const MOCK_SCHEDULE_20260419: { date: string; venues: Venue[] } = {
  date: '20260419',
  venues: [
    {
      name: '東京',
      code: '05',
      races: [
        { raceId: '202605030901', raceNum: 1,  startTime: '10:05', raceName: '3歳未勝利',             grade: null, headCount: 16 },
        { raceId: '202605030902', raceNum: 2,  startTime: '10:40', raceName: '4歳以上1勝クラス',       grade: null, headCount: 14 },
        { raceId: '202605030903', raceNum: 3,  startTime: '11:15', raceName: '3歳未勝利',             grade: null, headCount: 15 },
        { raceId: '202605030904', raceNum: 4,  startTime: '11:50', raceName: '3歳1勝クラス',          grade: null, headCount: 16 },
        { raceId: '202605030905', raceNum: 5,  startTime: '12:25', raceName: '4歳以上2勝クラス',       grade: null, headCount: 13 },
        { raceId: '202605030906', raceNum: 6,  startTime: '13:00', raceName: '3歳2勝クラス',          grade: null, headCount: 14 },
        { raceId: '202605030907', raceNum: 7,  startTime: '13:35', raceName: '4歳以上1勝クラス',       grade: null, headCount: 15 },
        { raceId: '202605030908', raceNum: 8,  startTime: '14:05', raceName: '4歳以上3勝クラス',       grade: null, headCount: 11 },
        { raceId: '202605030909', raceNum: 9,  startTime: '14:35', raceName: '3歳1勝クラス',          grade: null, headCount: 16 },
        { raceId: '202605030910', raceNum: 10, startTime: '15:10', raceName: '天皇賞（春）トライアル', grade: 'G2', headCount: 12 },
        { raceId: '202605030911', raceNum: 11, startTime: '15:45', raceName: '天皇賞（春）',           grade: 'G1', headCount: 18 },
        { raceId: '202605030912', raceNum: 12, startTime: '16:20', raceName: '4歳以上1勝クラス',       grade: null, headCount: 16 },
      ],
    },
    {
      name: '京都',
      code: '08',
      races: [
        { raceId: '202608030901', raceNum: 1,  startTime: '10:05', raceName: '3歳未勝利',       grade: null, headCount: 15 },
        { raceId: '202608030902', raceNum: 2,  startTime: '10:40', raceName: '4歳以上1勝クラス', grade: null, headCount: 14 },
        { raceId: '202608030903', raceNum: 3,  startTime: '11:15', raceName: '3歳未勝利',       grade: null, headCount: 13 },
        { raceId: '202608030904', raceNum: 4,  startTime: '11:50', raceName: '4歳以上2勝クラス', grade: null, headCount: 12 },
        { raceId: '202608030905', raceNum: 5,  startTime: '12:25', raceName: '3歳1勝クラス',    grade: null, headCount: 16 },
        { raceId: '202608030906', raceNum: 6,  startTime: '13:00', raceName: '4歳以上3勝クラス', grade: null, headCount: 11 },
        { raceId: '202608030907', raceNum: 7,  startTime: '13:35', raceName: '3歳2勝クラス',    grade: null, headCount: 14 },
        { raceId: '202608030908', raceNum: 8,  startTime: '14:05', raceName: '4歳以上オープン',  grade: 'OP', headCount: 10 },
        { raceId: '202608030909', raceNum: 9,  startTime: '14:35', raceName: '4歳以上1勝クラス', grade: null, headCount: 15 },
        { raceId: '202608030910', raceNum: 10, startTime: '15:10', raceName: '読売マイラーズC',  grade: 'G2', headCount: 16 },
        { raceId: '202608030911', raceNum: 11, startTime: '15:45', raceName: 'NHKマイルカップ', grade: 'G1', headCount: 18 },
        { raceId: '202608030912', raceNum: 12, startTime: '16:20', raceName: '4歳以上1勝クラス', grade: null, headCount: 16 },
      ],
    },
    {
      name: '新潟',
      code: '04',
      races: [
        { raceId: '202604030901', raceNum: 1,  startTime: '10:05', raceName: '3歳未勝利',       grade: null, headCount: 16 },
        { raceId: '202604030902', raceNum: 2,  startTime: '10:40', raceName: '4歳以上1勝クラス', grade: null, headCount: 14 },
        { raceId: '202604030903', raceNum: 3,  startTime: '11:15', raceName: '3歳未勝利',       grade: null, headCount: 15 },
        { raceId: '202604030904', raceNum: 4,  startTime: '11:50', raceName: '3歳1勝クラス',    grade: null, headCount: 12 },
        { raceId: '202604030905', raceNum: 5,  startTime: '12:25', raceName: '4歳以上2勝クラス', grade: null, headCount: 13 },
        { raceId: '202604030906', raceNum: 6,  startTime: '13:00', raceName: '3歳2勝クラス',    grade: null, headCount: 11 },
        { raceId: '202604030907', raceNum: 7,  startTime: '13:35', raceName: '4歳以上1勝クラス', grade: null, headCount: 15 },
        { raceId: '202604030908', raceNum: 8,  startTime: '14:05', raceName: '4歳以上3勝クラス', grade: null, headCount: 10 },
        { raceId: '202604030909', raceNum: 9,  startTime: '14:35', raceName: '3歳1勝クラス',    grade: null, headCount: 16 },
        { raceId: '202604030910', raceNum: 10, startTime: '15:10', raceName: '4歳以上オープン',  grade: 'OP', headCount: 12 },
        { raceId: '202604030911', raceNum: 11, startTime: '15:45', raceName: '4歳以上1勝クラス', grade: null, headCount: 14 },
        { raceId: '202604030912', raceNum: 12, startTime: '16:20', raceName: '4歳以上1勝クラス', grade: null, headCount: 16 },
      ],
    },
  ],
};

export const MOCK_SCHEDULE_20260412: { date: string; venues: Venue[] } = {
  date: '20260412',
  venues: [
    {
      name: '中山',
      code: '06',
      races: [
        { raceId: '202606030601', raceNum: 1,  startTime: '10:05', raceName: '3歳未勝利',      grade: null, headCount: 16 },
        { raceId: '202606030602', raceNum: 2,  startTime: '10:40', raceName: '4歳以上1勝クラス', grade: null, headCount: 14 },
        { raceId: '202606030603', raceNum: 3,  startTime: '11:15', raceName: '3歳未勝利',      grade: null, headCount: 15 },
        { raceId: '202606030604', raceNum: 4,  startTime: '11:50', raceName: '3歳1勝クラス',   grade: null, headCount: 16 },
        { raceId: '202606030605', raceNum: 5,  startTime: '12:25', raceName: '4歳以上2勝クラス', grade: null, headCount: 12 },
        { raceId: '202606030606', raceNum: 6,  startTime: '13:00', raceName: '3歳2勝クラス',   grade: null, headCount: 14 },
        { raceId: '202606030607', raceNum: 7,  startTime: '13:35', raceName: '4歳以上1勝クラス', grade: null, headCount: 15 },
        { raceId: '202606030608', raceNum: 8,  startTime: '14:05', raceName: '3歳3勝クラス',   grade: null, headCount: 11 },
        { raceId: '202606030609', raceNum: 9,  startTime: '14:35', raceName: '4歳以上2勝クラス', grade: null, headCount: 13 },
        { raceId: '202606030610', raceNum: 10, startTime: '15:10', raceName: '4歳以上オープン',  grade: 'OP', headCount: 10 },
        { raceId: '202606030611', raceNum: 11, startTime: '15:45', raceName: '皐月賞トライアル', grade: 'G3', headCount: 18 },
        { raceId: '202606030612', raceNum: 12, startTime: '16:20', raceName: '4歳以上1勝クラス', grade: null, headCount: 16 },
      ],
    },
    {
      name: '福島',
      code: '03',
      races: [
        { raceId: '202603010601', raceNum: 1,  startTime: '10:05', raceName: '3歳未勝利',       grade: null, headCount: 15 },
        { raceId: '202603010602', raceNum: 2,  startTime: '10:40', raceName: '4歳以上1勝クラス', grade: null, headCount: 16 },
        { raceId: '202603010603', raceNum: 3,  startTime: '11:15', raceName: '3歳未勝利',       grade: null, headCount: 14 },
        { raceId: '202603010604', raceNum: 4,  startTime: '11:50', raceName: '3歳1勝クラス',    grade: null, headCount: 13 },
        { raceId: '202603010605', raceNum: 5,  startTime: '12:25', raceName: '4歳以上2勝クラス', grade: null, headCount: 12 },
        { raceId: '202603010606', raceNum: 6,  startTime: '13:00', raceName: '3歳2勝クラス',    grade: null, headCount: 15 },
        { raceId: '202603010607', raceNum: 7,  startTime: '13:35', raceName: '4歳以上1勝クラス', grade: null, headCount: 14 },
        { raceId: '202603010608', raceNum: 8,  startTime: '14:05', raceName: '3歳3勝クラス',    grade: null, headCount: 11 },
        { raceId: '202603010609', raceNum: 9,  startTime: '14:35', raceName: '4歳以上2勝クラス', grade: null, headCount: 16 },
        { raceId: '202603010610', raceNum: 10, startTime: '15:10', raceName: '福島民報杯',      grade: 'OP', headCount: 12 },
        { raceId: '202603010611', raceNum: 11, startTime: '15:45', raceName: '福島牝馬ステークス', grade: 'G3', headCount: 16 },
        { raceId: '202603010612', raceNum: 12, startTime: '16:20', raceName: '4歳以上1勝クラス', grade: null, headCount: 15 },
      ],
    },
    {
      name: '阪神',
      code: '09',
      races: [
        { raceId: '202609020601', raceNum: 1,  startTime: '10:05', raceName: '3歳未勝利',       grade: null, headCount: 16 },
        { raceId: '202609020602', raceNum: 2,  startTime: '10:40', raceName: '4歳以上1勝クラス', grade: null, headCount: 14 },
        { raceId: '202609020603', raceNum: 3,  startTime: '11:15', raceName: '3歳未勝利',       grade: null, headCount: 15 },
        { raceId: '202609020604', raceNum: 4,  startTime: '11:50', raceName: '3歳1勝クラス',    grade: null, headCount: 16 },
        { raceId: '202609020605', raceNum: 5,  startTime: '12:25', raceName: '4歳以上2勝クラス', grade: null, headCount: 13 },
        { raceId: '202609020606', raceNum: 6,  startTime: '13:00', raceName: '3歳2勝クラス',    grade: null, headCount: 14 },
        { raceId: '202609020607', raceNum: 7,  startTime: '13:35', raceName: '4歳以上1勝クラス', grade: null, headCount: 15 },
        { raceId: '202609020608', raceNum: 8,  startTime: '14:05', raceName: '4歳以上3勝クラス', grade: null, headCount: 11 },
        { raceId: '202609020609', raceNum: 9,  startTime: '14:35', raceName: '3歳1勝クラス',    grade: null, headCount: 16 },
        { raceId: '202609020610', raceNum: 10, startTime: '15:10', raceName: 'アンタレスS',     grade: 'G3', headCount: 12 },
        { raceId: '202609020611', raceNum: 11, startTime: '15:45', raceName: '桜花賞トライアル', grade: 'G3', headCount: 18 },
        { raceId: '202609020612', raceNum: 12, startTime: '16:20', raceName: '4歳以上1勝クラス', grade: null, headCount: 16 },
      ],
    },
  ],
};
