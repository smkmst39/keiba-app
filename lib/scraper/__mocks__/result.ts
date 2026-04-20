// ==========================================
// レース結果モックデータ
// USE_MOCK=true のとき result API が返すサンプルデータ
// 実際の 2025年NZT (202506030511) に近いフィクションデータ
// ==========================================

import type { RaceResult } from '../types';

/** モック結果データ（NZT想定: 15頭） */
export const MOCK_RESULT: RaceResult = {
  raceId: '202606030511',
  results: [
    { rank: 1,  horseId: 12, horseName: 'アルデトップガン', time: '1:33.5', lastThreeF: 33.8 },
    { rank: 2,  horseId:  5, horseName: 'ジーネキング',     time: '1:33.6', lastThreeF: 34.0 },
    { rank: 3,  horseId:  8, horseName: 'スマイルカーブ',   time: '1:33.7', lastThreeF: 34.1 },
    { rank: 4,  horseId:  1, horseName: 'ハノハノ',         time: '1:33.8', lastThreeF: 34.2 },
    { rank: 5,  horseId:  4, horseName: 'ヒズマスターピース', time: '1:33.9', lastThreeF: 34.3 },
    { rank: 6,  horseId: 14, horseName: 'ディールメーカー', time: '1:34.0', lastThreeF: 34.5 },
    { rank: 7,  horseId:  3, horseName: 'レザベーション',   time: '1:34.1', lastThreeF: 34.6 },
    { rank: 8,  horseId:  9, horseName: 'ブルズアイプリンス', time: '1:34.2', lastThreeF: 34.7 },
    { rank: 9,  horseId:  6, horseName: 'シュペルリング',   time: '1:34.3', lastThreeF: 34.8 },
    { rank: 10, horseId: 11, horseName: 'ゴーラッキー',     time: '1:34.4', lastThreeF: 35.0 },
    { rank: 11, horseId:  2, horseName: 'マダックス',       time: '1:34.5', lastThreeF: 35.1 },
    { rank: 12, horseId:  7, horseName: 'ロデオドライブ',   time: '1:34.6', lastThreeF: 35.2 },
    { rank: 13, horseId: 13, horseName: 'ガリレア',         time: '1:34.7', lastThreeF: 35.3 },
    { rank: 14, horseId: 15, horseName: 'ミリオンクラウン', time: '1:34.9', lastThreeF: 35.5 },
    { rank: 15, horseId: 10, horseName: 'ジーティーシンドウ', time: '1:35.0', lastThreeF: 35.8 },
  ],
  payouts: {
    tan: [
      { horseId: 12, payout: 680 },
    ],
    fuku: [
      { horseId: 12, payout: 220 },
      { horseId:  5, payout: 180 },
      { horseId:  8, payout: 240 },
    ],
    waku: [
      { combination: '3-6', payout: 1350 },
    ],
    umaren: [
      { combination: '5-12', payout: 1040 },
    ],
    umatan: [
      { combination: '12-5', payout: 2480 },
    ],
    wide: [
      { combination: '5-12', payout:  480 },
      { combination: '8-12', payout:  620 },
      { combination: '5-8',  payout:  540 },
    ],
    sanfuku: [
      { combination: '5-8-12', payout: 3150 },
    ],
    santan: [
      { combination: '12-5-8', payout: 14200 },
    ],
  },
};
