'use client';

// ==========================================
// 予想記事レポートコンポーネント
// BakenSimulator の下に配置し、note転用向けに各セクションを独立表示する
// ==========================================

import { useMemo } from 'react';
import type { Race, Horse } from '@/lib/scraper/types';
import {
  shouldRecommendUmaren,
  shouldRecommendUmatan,
  shouldRecommendWide,
  shouldRecommendTan,
  shouldRecommendFuku,
  EXPECTED_ROI,
} from '@/lib/score/calculator';
import { ReliabilityCard } from '@/app/components/ReliabilityCard';

// ==========================================
// ユーティリティ
// ==========================================

/** レース名からグレードを検出 */
function detectGrade(name: string): 'G1' | 'G2' | 'G3' | 'L' | 'OP' | null {
  if (/G1|GⅠ|G\s*I[^I]/.test(name)) return 'G1';
  if (/G2|GⅡ|G\s*II[^I]/.test(name)) return 'G2';
  if (/G3|GⅢ|G\s*III/.test(name))    return 'G3';
  if (/（L）|\(L\)|リステッド/.test(name))   return 'L';
  if (/オープン|（OP）|\(OP\)/.test(name))   return 'OP';
  return null;
}

/** 全馬の人気順マップ（馬番→人気）を返す */
function calcPopularityRanks(horses: Horse[]): Map<number, number> {
  const sorted = [...horses]
    .filter(h => h.odds > 0)
    .sort((a, b) => a.odds - b.odds);
  const map = new Map<number, number>();
  sorted.forEach((h, i) => map.set(h.id, i + 1));
  return map;
}

// ==========================================
// コース傾向データ（簡易版）
// ==========================================

type CourseTendency = {
  pace: string;       // 展開予想
  waku: string;       // 枠傾向
  course: string;     // コース傾向（先行/差し）
  popularity: string; // 人気傾向
};

const COURSE_TENDENCY: Record<string, CourseTendency> = {
  '中山-turf-2000':  { pace: 'スロー・先行有利',     waku: '内有利',    course: '先行有利', popularity: '穴馬が絡みやすい傾向'  },
  '中山-turf-1600':  { pace: 'ミドル・差し有利',     waku: '内有利',    course: '先行有利', popularity: '1〜3人気の信頼度高め'  },
  '中山-turf-1800':  { pace: 'ミドル・先行有利',     waku: '内有利',    course: '先行有利', popularity: '1〜3人気の複勝率高め'  },
  '中山-dirt-1800':  { pace: 'ミドル・先行有利',     waku: 'フラット',  course: '先行有利', popularity: '1人気の信頼度高め'      },
  '東京-turf-2400':  { pace: 'スロー・差し有利',     waku: 'フラット',  course: '差し有利', popularity: '穴馬が絡みやすい傾向'  },
  '東京-turf-2000':  { pace: 'スロー・差し有利',     waku: 'フラット',  course: '差し有利', popularity: '穴馬が絡みやすい傾向'  },
  '東京-turf-1600':  { pace: 'ミドル・差し有利',     waku: '外有利',    course: '差し有利', popularity: '1〜3人気の複勝率高め'  },
  '東京-dirt-1600':  { pace: 'ハイペース・先行有利', waku: '内有利',    course: '先行有利', popularity: '1人気の信頼度高め'      },
  '阪神-turf-2000':  { pace: 'ミドル・先行有利',     waku: '内有利',    course: '先行有利', popularity: '1〜3人気の複勝率高め'  },
  '阪神-turf-1800':  { pace: 'ミドル・差し有利',     waku: 'フラット',  course: 'フラット', popularity: '穴馬が絡みやすい傾向'  },
  '阪神-turf-1600':  { pace: 'ミドル・差し有利',     waku: '内有利',    course: 'フラット', popularity: '1〜3人気の複勝率高め'  },
  '阪神-dirt-1800':  { pace: 'ハイペース・先行有利', waku: '内有利',    course: '先行有利', popularity: '1人気の信頼度高め'      },
  '京都-turf-2200':  { pace: 'スロー・差し有利',     waku: 'フラット',  course: '差し有利', popularity: '穴馬が絡みやすい傾向'  },
  '京都-turf-2000':  { pace: 'スロー・差し有利',     waku: 'フラット',  course: '差し有利', popularity: '穴馬が絡みやすい傾向'  },
  '京都-turf-1600':  { pace: 'ミドル・差し有利',     waku: 'フラット',  course: '差し有利', popularity: '1〜3人気の複勝率高め'  },
  '京都-dirt-1800':  { pace: 'ミドル・先行有利',     waku: 'フラット',  course: '先行有利', popularity: '1人気の信頼度高め'      },
  '中京-turf-2000':  { pace: 'ミドル・差し有利',     waku: '外有利',    course: '差し有利', popularity: '穴馬が絡みやすい傾向'  },
  '中京-turf-1600':  { pace: 'ミドル・先行有利',     waku: '内有利',    course: '先行有利', popularity: '1〜3人気の複勝率高め'  },
  '中京-dirt-1800':  { pace: 'ハイペース・先行有利', waku: '内有利',    course: '先行有利', popularity: '1人気の信頼度高め'      },
  '福島-turf-1800':  { pace: 'ミドル・先行有利',     waku: '内有利',    course: '先行有利', popularity: '1〜3人気の複勝率高め'  },
  '新潟-turf-2000':  { pace: 'スロー・差し有利',     waku: '外有利',    course: '差し有利', popularity: '穴馬が絡みやすい傾向'  },
  '小倉-turf-2000':  { pace: 'ミドル・先行有利',     waku: '内有利',    course: '先行有利', popularity: '1〜3人気の信頼度高め'  },
};

function getCourseTendency(course: string, surface: 'turf' | 'dirt', distance: number): CourseTendency {
  // 200m単位で丸めてルックアップ
  const rounded = Math.round(distance / 200) * 200;
  const key = `${course}-${surface}-${rounded}`;
  return COURSE_TENDENCY[key] ?? {
    pace:       'データなし',
    waku:       'データなし',
    course:     'データなし',
    popularity: 'データなし',
  };
}

// ==========================================
// 予想印計算
// ==========================================

type Picks = {
  honmei:   Horse | null;  // ◎本命
  taikou:   Horse | null;  // ○対抗
  sanbante: Horse | null;  // ▲3番手
  ana:      Horse | null;  // △穴
};

function calcPicks(horses: Horse[]): Picks {
  const withOdds = horses.filter(h => h.odds > 0);

  // スコア降順
  const byScore = [...withOdds].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  // EV降順（オッズ2.0倍以上を対象）
  const byEV = [...withOdds]
    .filter(h => h.odds >= 2.0)
    .sort((a, b) => (b.ev ?? 0) - (a.ev ?? 0));

  const honmei   = byEV[0] ?? null;
  const taikou   = byScore.find(h => h.id !== honmei?.id) ?? null;
  const sanbante = byScore.find(h => h.id !== honmei?.id && h.id !== taikou?.id) ?? null;

  // △穴: オッズ10倍以上・EV1.00以上でEV最上位（既選択除外）
  //   Phase 2E Stage 2: 単勝 EV≥1.00 で ROI 82.7%
  const usedIds = new Set([honmei?.id, taikou?.id, sanbante?.id].filter(Boolean));
  const ana = byEV.find(h =>
    h.odds >= 10 &&
    (h.ev ?? 0) >= 1.00 &&
    !usedIds.has(h.id)
  ) ?? null;

  return { honmei, taikou, sanbante, ana };
}

// ==========================================
// 穴馬・危険人気馬コメント自動生成
// ==========================================

function generateAnaComment(horse: Horse): string {
  const parts: string[] = [];
  if (horse.lastThreeF > 0 && horse.lastThreeF <= 11.2) parts.push('調教タイム絶好');
  if (Math.abs(horse.weightDiff) <= 2)    parts.push('馬体重安定');
  if (horse.odds >= 20)                    parts.push(`大穴${horse.odds}倍`);
  parts.push(`EV ${(horse.ev ?? 0).toFixed(2)}で長期回収期待`);
  return parts.join('・');
}

function generateKikenComment(horse: Horse, popularityRanks: Map<number, number>): string {
  const parts: string[] = [];
  const pop = popularityRanks.get(horse.id) ?? 0;
  if (pop <= 3) parts.push(`${pop}人気`);
  if ((horse.score ?? 0) < 55)  parts.push('総合スコア低め');
  if ((horse.ev ?? 0) < 0.85)   parts.push(`EV ${(horse.ev ?? 0).toFixed(2)}と低評価`);
  if (horse.weightDiff < -8)    parts.push('大幅馬体減');
  if (horse.weightDiff > 8)     parts.push('大幅馬体増');
  if (horse.lastThreeF > 12.0 && horse.lastThreeF > 0) parts.push('調教評価低');
  return parts.join('・') || '過信禁物';
}

// ==========================================
// 推定オッズ計算（単純積算）
// ==========================================

function estComboOdds(h1: Horse, h2?: Horse, h3?: Horse, type: 'umaren' | 'wide' | 'sanfuku' | 'santan' = 'umaren'): number {
  const factor = { umaren: 0.20, wide: 0.35, sanfuku: 0.08, santan: 0.10 }[type];
  if (!h2) return h1.odds;
  if (!h3) return Math.round(h1.odds * h2.odds * factor * 10) / 10;
  return Math.round(h1.odds * h2.odds * h3.odds * factor * 10) / 10;
}

// ==========================================
// サブコンポーネント
// ==========================================

/** セクション区切りヘッダー (密度優先) */
function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={{ borderBottom: '1px solid #2b6cb0', paddingBottom: '0.2rem', marginBottom: '0.4rem' }}>
      <h3 style={{ margin: 0, fontSize: '0.88rem', fontWeight: 700, color: '#1a365d' }}>
        {title}
        {subtitle && (
          <span style={{ fontSize: '0.68rem', fontWeight: 400, color: '#718096', marginLeft: '0.4rem' }}>
            {subtitle}
          </span>
        )}
      </h3>
    </div>
  );
}

/** グレードバッジ */
function GradeBadge({ grade }: { grade: ReturnType<typeof detectGrade> }) {
  if (!grade) return null;
  const colors: Record<string, { bg: string; color: string }> = {
    G1: { bg: '#c05621', color: '#fff' },
    G2: { bg: '#553c9a', color: '#fff' },
    G3: { bg: '#276749', color: '#fff' },
    L:  { bg: '#2b6cb0', color: '#fff' },
    OP: { bg: '#718096', color: '#fff' },
  };
  const c = colors[grade] ?? { bg: '#718096', color: '#fff' };
  return (
    <span style={{
      ...c,
      padding: '0.15rem 0.5rem',
      borderRadius: '4px',
      fontSize: '0.8rem',
      fontWeight: 700,
    }}>
      {grade}
    </span>
  );
}

/** メトリクスカード（展開・枠傾向等、高密度版） */
function MetricCard({ label, value }: { label: string; value: string }) {
  const hasData = value !== 'データなし';
  return (
    <div style={{
      background: hasData ? '#ebf8ff' : '#f7fafc',
      border: `1px solid ${hasData ? '#90cdf4' : '#e2e8f0'}`,
      borderRadius: '4px',
      padding: '0.25rem 0.45rem',
      minWidth: 0,
    }}>
      <div style={{ fontSize: '0.6rem', color: '#718096' }}>{label}</div>
      <div style={{
        fontSize: '0.72rem',
        fontWeight: 700,
        color: hasData ? '#2b6cb0' : '#a0aec0',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}>
        {value}
      </div>
    </div>
  );
}

/** 予想印カード (高密度版: 1行2段構成で1馬=~2.2rem高) */
function PickCard({
  mark, horse, popularityRanks,
}: {
  mark: string;
  horse: Horse | null;
  popularityRanks: Map<number, number>;
}) {
  const markColors: Record<string, string> = {
    '◎': '#c05621', '○': '#2b6cb0', '▲': '#276749', '△': '#744210',
  };
  const markColor = markColors[mark] ?? '#333';

  if (!horse) {
    return (
      <div style={{
        border: '1px solid #e2e8f0', borderRadius: '6px',
        padding: '0.35rem 0.5rem',
        background: '#f7fafc',
        display: 'flex', alignItems: 'center', gap: '0.4rem',
      }}>
        <span style={{ fontSize: '1.1rem', fontWeight: 900, color: '#cbd5e0' }}>{mark}</span>
        <span style={{ fontSize: '0.72rem', color: '#a0aec0' }}>該当なし</span>
      </div>
    );
  }

  const ev = horse.ev ?? 0;
  const pop = popularityRanks.get(horse.id) ?? 0;
  const isBuy = ev >= 1.00;
  const score = horse.score ?? 0;
  const scoreColor = score >= 70 ? '#276749' : score >= 50 ? '#2b6cb0' : '#c05621';

  return (
    <div style={{
      border: `2px solid ${markColor}`,
      borderLeft: `5px solid ${markColor}`,
      borderRadius: '6px',
      padding: '0.35rem 0.5rem',
      background: '#fff',
      display: 'flex',
      alignItems: 'center',
      gap: '0.45rem',
      minHeight: '44px',  // タップ領域最低保証
    }}>
      {/* 印 */}
      <span style={{
        fontSize: '1.15rem',
        fontWeight: 900,
        color: markColor,
        flexShrink: 0,
        lineHeight: 1,
        minWidth: '1.3rem',
        textAlign: 'center',
      }}>{mark}</span>
      {/* 本体 (馬番+馬名 / 補助) */}
      <div style={{ minWidth: 0, flex: 1, lineHeight: 1.2 }}>
        <div style={{
          fontSize: '0.82rem',
          fontWeight: 700,
          color: '#333',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {horse.id}番 {horse.name}
        </div>
        <div style={{ fontSize: '0.68rem', color: '#718096' }}>
          {horse.odds > 0 ? `${horse.odds}倍(${pop || '-'}人)` : '—'}・S{score.toFixed(0)}
        </div>
      </div>
      {/* EVバッジ + スコアミニバー */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.15rem', flexShrink: 0 }}>
        <span style={{
          padding: '0.08rem 0.35rem',
          borderRadius: '3px',
          fontSize: '0.7rem',
          fontWeight: 700,
          background: isBuy ? '#276749' : '#718096',
          color: '#fff',
          whiteSpace: 'nowrap',
        }}>
          {horse.odds > 0 ? (isBuy ? '買い' : '検討') : '-'}
        </span>
        <div style={{ width: '48px', height: '4px', background: '#e2e8f0', borderRadius: '2px', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${score}%`, background: scoreColor }} />
        </div>
      </div>
    </div>
  );
}

/** EV・スコアに応じた色 */
function evColor(ev: number): string {
  if (ev >= 1.10) return '#276749';
  if (ev >= 1.00) return '#2b6cb0';
  return '#718096';
}

/** EV 数値から短いラベルを返す（視認補助） */
function evLabel(ev: number): string {
  if (ev >= 1.10) return '強気';
  if (ev >= 1.00) return '買い';
  if (ev >= 0.90) return '検討';
  return '-';
}

/** JRA 枠色 (app/components/CLAUDE.md と統一) */
const WAKU_COLORS: Record<number, { bg: string; border: string; text: string }> = {
  1: { bg: '#ffffff', border: '#aaaaaa', text: '#333333' },
  2: { bg: '#111111', border: '#111111', text: '#ffffff' },
  3: { bg: '#e8352a', border: '#c0281f', text: '#ffffff' },
  4: { bg: '#4fa3db', border: '#2d87c4', text: '#ffffff' },
  5: { bg: '#f5d800', border: '#d4b800', text: '#333333' },
  6: { bg: '#159c4a', border: '#0d7438', text: '#ffffff' },
  7: { bg: '#f08010', border: '#c86400', text: '#ffffff' },
  8: { bg: '#ec77ae', border: '#d05590', text: '#ffffff' },
};

/** スコア順位バッジ (高密度版: 1位=緑 / 2-3位=橙 / それ以外=グレー) */
function RankBadge({ rank }: { rank: number }) {
  const color =
    rank === 1 ? { bg: '#276749', text: '#fff' } :
    rank <= 3  ? { bg: '#b45309', text: '#fff' } :
                 { bg: '#e2e8f0', text: '#4a5568' };
  return (
    <div
      aria-label={`スコア${rank}位`}
      style={{
        background: color.bg,
        color: color.text,
        minWidth: '1.7rem',
        height: '1.5rem',
        borderRadius: '4px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 800,
        fontSize: '0.7rem',
        lineHeight: 1,
        padding: '0 0.25rem',
        flexShrink: 0,
      }}
    >
      {rank}
    </div>
  );
}

/**
 * 全頭EV一覧の 1 行分カード (モバイル優先の省スペース版)
 *
 * 目的:
 *   - スコア順位を左端のバッジで一目で把握
 *   - 左側の色帯 = EV 色 (緑/青/グレー) でEVランクを瞬時に視認
 *   - EV 数値 + スコア数値 + バーで「EV × スコア」を横一列で対比
 *   - 従来の横幅600pxテーブル → 縦 100% カードに変更、横スクロール不要
 */
function HorseRankRow({
  horse, rank, mark, pop, isKiken, isAna,
}: {
  horse: Horse;
  rank: number;
  mark: string;
  pop: number;
  isKiken: boolean;
  isAna: boolean;
}) {
  const ev    = horse.ev ?? 0;
  const score = horse.score ?? 0;
  const evC   = evColor(ev);
  const waku  = WAKU_COLORS[horse.waku] ?? { bg: '#f1f5f9', border: '#94a3b8', text: '#334155' };

  // 行背景: 危険人気>穴馬>1位強調>通常
  const rowBg = isKiken ? '#fff5f5' : isAna ? '#fffff0' : rank === 1 ? '#f0fff4' : '#fff';

  // 調教・脚質の近似 (従来の Section 6 と同じロジック)
  const l3 = horse.lastThreeF;
  const trainEval = l3 === 0 ? '-' : l3 <= 11.0 ? '絶好' : l3 <= 11.4 ? '良好' : l3 <= 11.8 ? '普通' : '低調';
  const runStyle  = l3 === 0 ? '-' : l3 <= 11.4 ? '差・追' : l3 <= 11.8 ? '先・差' : '逃・先';

  const scoreColor = score >= 70 ? '#276749' : score >= 50 ? '#2b6cb0' : '#c05621';
  const markColor  = mark === '◎' ? '#c05621' : mark === '○' ? '#2b6cb0' : mark === '▲' ? '#276749' : mark === '△' ? '#744210' : '';

  return (
    <div
      title={`${horse.jockey}・${runStyle}/${trainEval}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.35rem',
        padding: '0.28rem 0.4rem',
        borderLeft: `4px solid ${evC}`,
        borderBottom: '1px solid #e2e8f0',
        background: rowBg,
        minHeight: '36px',     // タップ領域、かつ16頭で ~9.6rem 相当
      }}
    >
      {/* 左: 順位バッジ */}
      <RankBadge rank={rank} />

      {/* 枠+馬番 (JRA 枠色、角丸矩形で省スペース) */}
      <div
        aria-label={`枠${horse.waku}・${horse.id}番`}
        style={{
          width: '1.6rem',
          height: '1.5rem',
          borderRadius: '3px',
          background: waku.bg,
          color: waku.text,
          border: `1px solid ${waku.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 800,
          fontSize: '0.72rem',
          flexShrink: 0,
        }}
      >
        {horse.id}
      </div>

      {/* 中央: 印+馬名+補助 (ellipsis で単行に収める) */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
        <div style={{
          fontSize: '0.76rem',
          color: '#1a202c',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {mark && <span style={{ color: markColor, fontWeight: 900, marginRight: '0.15rem' }}>{mark}</span>}
          <span style={{ fontWeight: 700 }}>{horse.name}</span>
          {isKiken && <span title="危険人気馬" style={{ marginLeft: '0.2rem' }}>⚠️</span>}
          {isAna   && <span title="穴馬候補"   style={{ marginLeft: '0.2rem' }}>🎯</span>}
        </div>
        <div style={{ fontSize: '0.62rem', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {horse.odds > 0 ? `${horse.odds}(${pop || '-'})` : '—'} {horse.jockey}
        </div>
      </div>

      {/* 右: EV バッジ + S 数値 + ミニバー (単行) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', flexShrink: 0 }}>
        <span style={{
          background: evC,
          color: '#fff',
          padding: '0.06rem 0.3rem',
          borderRadius: '3px',
          fontSize: '0.68rem',
          fontWeight: 800,
          whiteSpace: 'nowrap',
          minWidth: '3.2rem',
          textAlign: 'center',
        }}>
          {ev > 0 ? ev.toFixed(2) : '—'}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
          <span style={{
            fontSize: '0.72rem',
            fontWeight: 700,
            color: scoreColor,
            minWidth: '1.4rem',
            textAlign: 'right',
          }}>{score.toFixed(0)}</span>
          <div style={{ width: '32px', height: '4px', background: '#e2e8f0', borderRadius: '2px', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${score}%`, background: scoreColor }} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** 馬券推奨カード */
/** Phase 2F: 3段階推奨のヘッダスタイル (密度優先) */
function tierHeader(color: string, bg: string): React.CSSProperties {
  return {
    padding: '0.2rem 0.5rem',
    background: bg,
    color,
    fontSize: '0.72rem',
    fontWeight: 700,
    borderRadius: '4px 4px 0 0',
    borderBottom: `2px solid ${color}`,
    marginBottom: '0.25rem',
  };
}

/** Phase 2F: 3段階推奨カード (本命/堅実/参考) */
function TieredBetCard({
  tier, label, roi, horses, reason, costText, ordered = false,
}: {
  tier: 'honmei' | 'kenjitsu' | 'reference';
  label: string;
  roi: number;
  horses: Horse[];
  reason: string;
  costText: string;
  ordered?: boolean;
}) {
  const tierStyle = {
    honmei:    { border: '#b45309', bg: '#fffbeb', accent: '#b45309' },
    kenjitsu:  { border: '#0369a1', bg: '#eff6ff', accent: '#0369a1' },
    reference: { border: '#94a3b8', bg: '#f8fafc', accent: '#475569' },
  }[tier];

  return (
    <div style={{
      border: `1.5px solid ${tierStyle.border}`,
      borderLeft: `4px solid ${tierStyle.border}`,
      background: tierStyle.bg,
      borderRadius: '5px',
      padding: '0.3rem 0.45rem',
      marginBottom: '0.25rem',
      fontSize: '0.76rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700, fontSize: '0.78rem', color: tierStyle.accent }}>
          {label}
        </span>
        <span style={{
          padding: '0.02rem 0.3rem',
          background: tierStyle.accent,
          color: '#fff',
          borderRadius: '3px',
          fontSize: '0.64rem',
          fontWeight: 700,
        }}>
          {roi.toFixed(1)}%
        </span>
        <span style={{ fontSize: '0.68rem', color: '#1e293b', fontWeight: 700 }}>
          {horses.map((h) => `${h.id}`).join(ordered ? '→' : '-')}
        </span>
        <span style={{ fontSize: '0.64rem', color: '#64748b', whiteSpace: 'nowrap' }}>
          {horses.map((h) => h.name).join(ordered ? '→' : '/')}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: '0.65rem', color: '#64748b', whiteSpace: 'nowrap' }}>
          {costText}
        </span>
      </div>
      <div style={{ fontSize: '0.65rem', color: '#64748b', marginTop: '0.1rem', lineHeight: 1.3 }}>
        {reason}
      </div>
    </div>
  );
}

/** Phase 2F: 見送り (条件未達) カード (密度優先) */
function SkipCard({ label, reason }: { label: string; reason: string }) {
  return (
    <div style={{
      border: '1px dashed #cbd5e0',
      background: '#f8fafc',
      borderRadius: '4px',
      padding: '0.2rem 0.45rem',
      marginBottom: '0.25rem',
      fontSize: '0.68rem',
      color: '#64748b',
      lineHeight: 1.35,
    }}>
      <strong style={{ fontSize: '0.72rem' }}>{label}: 見送り</strong> — {reason}
    </div>
  );
}

function BetRecommendCard({
  label, horses, estOdds, ev, type, axes, spokes, points,
}: {
  label: string;
  horses: Horse[];
  estOdds: number;
  ev: number;
  type: string;
  /** ハイブリッド戦略の軸馬（三連系でフォーメーション表示時に使用） */
  axes?: Horse[];
  /** ハイブリッド戦略のひも馬 */
  spokes?: Horse[];
  /** 購入点数（ハイブリッド戦略の場合は自動算出した点数） */
  points?: number;
}) {
  const color = evColor(ev);
  const isHybrid = axes && spokes && axes.length > 0 && spokes.length > 0;
  const cost = points ? points * 100 : undefined;

  return (
    <div style={{
      border: `1.5px solid ${color}`,
      borderLeft: `4px solid ${color}`,
      borderRadius: '5px',
      padding: '0.3rem 0.45rem',
      background: ev >= 1.00 ? '#f0fff4' : '#f7fafc',
      minWidth: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginBottom: '0.1rem', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.7rem', color: '#718096', fontWeight: 700 }}>{label}</span>
        <span style={{
          background: color, color: '#fff',
          padding: '0.05rem 0.3rem', borderRadius: '3px', fontSize: '0.68rem', fontWeight: 700,
        }}>
          EV {ev.toFixed(2)}
        </span>
        <span style={{ fontSize: '0.65rem', color: '#555', marginLeft: 'auto' }}>
          ~{estOdds}倍{cost ? ` ・${points}点` : ''}
        </span>
      </div>
      {isHybrid ? (
        <div style={{ fontSize: '0.7rem', color: '#333', fontWeight: 700, lineHeight: 1.3 }}>
          <span style={{ color: '#2f855a' }}>軸</span> {axes!.map(h => h.id).join('・')}
          {' / '}
          <span style={{ color: '#2b6cb0' }}>ひも</span> {spokes!.map(h => h.id).join('・')}
        </div>
      ) : (
        <div style={{ fontWeight: 700, fontSize: '0.75rem', color: '#333' }}>
          {horses.map(h => h.id).join(type === 'santan' || type === 'umatan' ? '→' : '-')}
        </div>
      )}
    </div>
  );
}

// ==========================================
// メインコンポーネント
// ==========================================

type Props = { race: Race };

export function RaceReport({ race }: Props) {
  const isPreEntry = race.mode === 'pre-entry';

  const popularityRanks = useMemo(
    () => calcPopularityRanks(race.horses),
    [race.horses]
  );

  const picks = useMemo(
    () => calcPicks(race.horses),
    [race.horses]
  );

  const tendency = useMemo(
    () => getCourseTendency(race.course, race.surface, race.distance),
    [race.course, race.surface, race.distance]
  );

  const grade = useMemo(() => detectGrade(race.name), [race.name]);

  // スコア降順
  const byScore = useMemo(
    () => [...race.horses].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)),
    [race.horses]
  );

  // 穴馬・危険人気馬
  const anaHorses = useMemo(
    () => race.horses.filter(h => h.odds >= 10 && (h.ev ?? 0) >= 1.00 && (h.score ?? 0) >= 60),
    [race.horses]
  );
  const kikenHorses = useMemo(
    () => race.horses.filter(h => {
      const pop = popularityRanks.get(h.id) ?? 99;
      return pop <= 3 && ((h.ev ?? 0) < 0.85 || (h.score ?? 0) < 55);
    }),
    [race.horses, popularityRanks]
  );

  // 馬券推奨計算
  //   三連系はバックテスト (scripts/backtest_trifecta.ts) で最高の総合回収率75.2% を
  //   示した「戦略4: ハイブリッド（軸+ひも）」を採用する:
  //     - 軸    : EV≥1.05 の上位2頭まで
  //     - ひも : 0.95≤EV<1.05 の上位3頭まで
  //     - 三連複: 軸+ひも BOX (= C(N,3) 点)
  //     - 三連単: 軸を1着固定 × 残り馬で 2-3着 の順列
  const betRecs = useMemo(() => {
    const { honmei, taikou, sanbante, ana } = picks;
    if (!honmei) return null;

    const tan = honmei;
    const umaren = taikou ? { horses: [honmei, taikou], odds: estComboOdds(honmei, taikou, undefined, 'umaren') } : null;

    // ワイドは Phase 2E Stage 2 で **EV上位2頭BOX** を採用 (930R 実測 ROI 79.3%)
    //   1通り購入 (A-B) = 100円/R。top-3 BOX (70.6%) から +8.7pt 改善
    const wideByEV = [...race.horses]
      .filter((h) => h.odds > 0)
      .sort((a, b) => (b.ev ?? 0) - (a.ev ?? 0))
      .slice(0, 2);
    const wide = wideByEV.length >= 2
      ? {
          horses: wideByEV,
          points: 1, // 2C2 = 1通り
          odds:   estComboOdds(wideByEV[0], wideByEV[1], undefined, 'wide'),
        }
      : ana
        ? { horses: [honmei, ana], points: 1, odds: estComboOdds(honmei, ana, undefined, 'wide') }
        : null;

    // 複勝: EV≥1.07 の馬のみ推奨 (Phase 2E Stage 2: ROI 84.8%、前後半差 3.6pt 安定)
    //   EV≥1.07 を満たす馬が無ければ null (= 推奨なし表示)
    const fukuPick = [...race.horses]
      .filter((h) => h.odds > 0 && (h.ev ?? 0) >= 1.07)
      .sort((a, b) => (b.ev ?? 0) - (a.ev ?? 0))[0] ?? null;
    const fuku = fukuPick ? { horse: fukuPick } : null;

    // ---- 戦略4: ハイブリッド軸+ひも ----
    const byEV = [...race.horses]
      .filter((h) => h.odds > 0)
      .sort((a, b) => (b.ev ?? 0) - (a.ev ?? 0));
    const axes   = byEV.filter((h) => (h.ev ?? 0) >= 1.05).slice(0, 2);
    const spokes = byEV
      .filter((h) => (h.ev ?? 0) >= 0.95 && (h.ev ?? 0) < 1.05)
      .slice(0, 3);

    // 三連複/三連単は 軸≥1 かつ ひも≥2 で成立
    const hybridValid = axes.length >= 1 && spokes.length >= 2;
    const allPicks    = [...axes, ...spokes];
    const n           = allPicks.length;

    // 三連複 BOX 点数 = nC3
    const nC3 = n >= 3 ? (n * (n - 1) * (n - 2)) / 6 : 0;
    // 三連単: 軸を1着固定、残り(N-1)頭から順序付きで2-3着を選ぶ = 軸数 × (N-1)×(N-2)
    const santanPoints = hybridValid && n >= 3
      ? axes.length * (n - 1) * (n - 2)
      : 0;

    const sanfuku = hybridValid && nC3 > 0 ? {
      horses: allPicks,
      axes,
      spokes,
      points: nC3,
      odds: estComboOdds(axes[0] ?? honmei, spokes[0] ?? taikou!, spokes[1] ?? sanbante!, 'sanfuku'),
    } : (taikou && sanbante) ? {
      // フォールバック: 軸/ひも判定できない場合は従来の3頭BOX
      horses: [honmei, taikou, sanbante],
      axes: undefined,
      spokes: undefined,
      points: 1,
      odds: estComboOdds(honmei, taikou, sanbante, 'sanfuku'),
    } : null;

    const santan = hybridValid && santanPoints > 0 ? {
      horses: allPicks,
      axes,
      spokes,
      points: santanPoints,
      odds: estComboOdds(axes[0] ?? honmei, spokes[0] ?? taikou!, spokes[1] ?? sanbante!, 'santan'),
    } : (taikou && sanbante) ? {
      horses: [honmei, taikou, sanbante],
      axes: undefined,
      spokes: undefined,
      points: 6,
      odds: estComboOdds(honmei, taikou, sanbante, 'santan'),
    } : null;

    const avgEV = (hs: Horse[]) => hs.reduce((s, h) => s + (h.ev ?? 0), 0) / hs.length;

    // ---- Phase 2F: 3段階推奨 (参加条件グリッドサーチ結果) ----
    // EV 降順ソート済み配列を推奨判定関数に渡す
    const sortedForReco = [...race.horses]
      .filter((h) => h.odds > 0)
      .sort((a, b) => (b.ev ?? 0) - (a.ev ?? 0))
      .map((h) => ({ ev: h.ev ?? 0, score: h.score ?? 0, odds: h.odds, ref: h }));

    // Phase 2G: raceClass をクラス別ハイブリッド除外ロジックに渡す
    //   race.raceClass は scraper (RaceData02) で取得済み
    const umarenHonmei  = shouldRecommendUmaren(sortedForReco, race.raceClass) === 'honmei';
    const umatanHonmei  = shouldRecommendUmatan(sortedForReco, race.raceClass) === 'honmei';
    const wideKenjitsu  = shouldRecommendWide(sortedForReco, race.raceClass) === 'kenjitsu';
    const tanReference  = shouldRecommendTan(sortedForReco) === 'reference';
    const fukuReference = shouldRecommendFuku(sortedForReco) === 'reference';

    const tieredReco = {
      umarenHonmei:  umarenHonmei  && sortedForReco.length >= 2 ? { horses: [sortedForReco[0].ref, sortedForReco[1].ref] } : null,
      umatanHonmei:  umatanHonmei  && sortedForReco.length >= 2 ? { horses: [sortedForReco[0].ref, sortedForReco[1].ref] } : null,
      wideKenjitsu:  wideKenjitsu  && sortedForReco.length >= 2 ? { horses: [sortedForReco[0].ref, sortedForReco[1].ref] } : null,
      tanReference:  tanReference  && sortedForReco.length >= 1 ? { horse: sortedForReco[0].ref } : null,
      fukuReference: fukuReference ? { horse: sortedForReco.find((h) => h.ev >= 1.07)?.ref ?? null } : null,
    };

    return { tan, fuku, umaren, wide, sanfuku, santan, avgEV, tieredReco };
  }, [picks, race.horses]);

  // ==========================================
  // 仮予想モード: メッセージのみ表示
  // ==========================================
  if (isPreEntry) {
    return (
      <div style={sectionWrap}>
        <div style={reportHeader}>
          <h2 style={{ margin: 0, fontSize: '1.1rem' }}>📝 予想レポート</h2>
        </div>
        <div style={{
          background: '#fffbeb',
          border: '1px solid #f6ad55',
          borderRadius: '6px',
          padding: '1rem',
          color: '#744210',
          fontSize: '0.9rem',
        }}>
          ⚠️ 枠順確定前のため、予想印・馬券推奨は表示しません。<br />
          枠順確定後にページを再読み込みすると全セクションが表示されます。
        </div>
      </div>
    );
  }

  const hasOdds = race.horses.some(h => h.odds > 0);

  return (
    <div style={sectionWrap}>
      {/* ヘッダー */}
      <div style={reportHeader}>
        <h2 style={{ margin: 0, fontSize: '1.1rem' }}>📝 予想レポート</h2>
        <span style={{ fontSize: '0.8rem', color: '#718096' }}>
          ※独自スコア・期待値に基づく参考情報です
        </span>
      </div>

      {/* ====== Section 1: レース概要ヘッダー (高密度) ====== */}
      <div style={section}>
        <SectionHeader title="1. レース概要" />
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginBottom: '0.25rem', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, fontSize: '0.92rem' }}>{race.name}</span>
          <GradeBadge grade={grade} />
          <span style={{ fontSize: '0.7rem', color: '#555' }}>
            {race.course}・{race.surface === 'turf' ? '芝' : 'ダ'}{race.distance}m・{race.horses.length}頭
          </span>
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(8rem, 1fr))',
          gap: '0.3rem',
        }}>
          <MetricCard label="展開" value={tendency.pace} />
          <MetricCard label="枠" value={tendency.waku} />
          <MetricCard label="コース" value={tendency.course} />
          <MetricCard label="人気傾向" value={tendency.popularity} />
        </div>
      </div>

      {/* ====== Section 2: 予想印カード (2列グリッド, 1行2段構成) ====== */}
      {hasOdds && (
        <div style={section}>
          <SectionHeader title="2. 予想印" subtitle="スコア・期待値で自動付与" />
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))',
            gap: '0.3rem',
          }}>
            <PickCard mark="◎" horse={picks.honmei}   popularityRanks={popularityRanks} />
            <PickCard mark="○" horse={picks.taikou}   popularityRanks={popularityRanks} />
            <PickCard mark="▲" horse={picks.sanbante} popularityRanks={popularityRanks} />
            <PickCard mark="△" horse={picks.ana}      popularityRanks={popularityRanks} />
          </div>
          <p style={{ fontSize: '0.65rem', color: '#718096', margin: '0.3rem 0 0', lineHeight: 1.4 }}>
            ◎本命=EV最高・○=スコア2位・▲=3位・△=10倍以上&EV1.0超
          </p>
        </div>
      )}

      {/* ====== Section 3: スコアTOP5 (5列: 順位/馬番/馬名/スコア/人気) ====== */}
      <div style={section}>
        <SectionHeader title="3. スコアTOP5" subtitle="総合スコア降順" />
        <table style={{
          width: '100%',
          borderCollapse: 'collapse',
          tableLayout: 'fixed',  // 各列を %指定で厳密に制御、馬名は ellipsis で折返し回避
          fontSize: '0.76rem',
        }}>
          <colgroup>
            <col style={{ width: '14%' }} />  {/* 順位 */}
            <col style={{ width: '12%' }} />  {/* 馬番 */}
            <col style={{ width: '36%' }} />  {/* 馬名 */}
            <col style={{ width: '26%' }} />  {/* スコア (数値+バー) */}
            <col style={{ width: '12%' }} />  {/* 人気 */}
          </colgroup>
          <thead>
            <tr style={{ background: '#edf2f7' }}>
              <th style={{ ...th, textAlign: 'center' }}>順位</th>
              <th style={{ ...th, textAlign: 'center' }}>馬番</th>
              <th style={{ ...th, textAlign: 'left' }}>馬名</th>
              <th style={{ ...th, textAlign: 'center' }}>スコア</th>
              <th style={{ ...th, textAlign: 'center' }}>人気</th>
            </tr>
          </thead>
          <tbody>
            {byScore.slice(0, 5).map((horse, i) => {
              const score = horse.score ?? 0;
              const pop = popularityRanks.get(horse.id) ?? 0;
              return (
                <tr key={horse.id} style={{ borderBottom: '1px solid #e2e8f0', background: i === 0 ? '#f0fff4' : '#fff' }}>
                  <td style={{ ...td, textAlign: 'center', fontWeight: 700 }}>{i + 1}位</td>
                  <td style={{ ...td, textAlign: 'center', fontWeight: 700 }}>{horse.id}</td>
                  <td style={{
                    ...td,
                    fontWeight: 700,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>{horse.name}</td>
                  <td style={td}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                      <span style={{
                        fontWeight: 700,
                        color: i === 0 ? '#276749' : '#333',
                        minWidth: '1.5rem',
                        textAlign: 'right',
                      }}>
                        {score.toFixed(0)}
                      </span>
                      <div style={{
                        flex: 1,
                        height: '5px',
                        background: '#e2e8f0',
                        borderRadius: '3px',
                        overflow: 'hidden',
                        minWidth: 0,
                      }}>
                        <div style={{
                          height: '100%',
                          width: `${score}%`,
                          background: i === 0 ? '#276749' : '#3182ce',
                          borderRadius: '3px',
                        }} />
                      </div>
                    </div>
                  </td>
                  <td style={{ ...td, textAlign: 'center', color: '#555' }}>
                    {pop > 0 ? `${pop}人` : '-'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ====== Section 4: 穴馬・危険人気馬アラート ====== */}
      {hasOdds && (anaHorses.length > 0 || kikenHorses.length > 0) && (
        <div style={section}>
          <SectionHeader title="4. 穴馬・危険人気馬アラート" />
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            {anaHorses.length > 0 && (
              <div style={{ flex: '1', minWidth: '220px' }}>
                <div style={alertHeader('#744210', '#fffbeb', '#fbd38d')}>🎯 穴馬候補</div>
                {anaHorses.map(h => (
                  <div key={h.id} style={alertRow('#fffbeb', '#fbd38d')}>
                    <div style={{ fontWeight: 700, marginBottom: '0.2rem' }}>
                      {h.id}番 {h.name}（{h.odds}倍）
                    </div>
                    <div style={{ fontSize: '0.78rem', color: '#744210' }}>
                      {generateAnaComment(h)}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {kikenHorses.length > 0 && (
              <div style={{ flex: '1', minWidth: '220px' }}>
                <div style={alertHeader('#742a2a', '#fff5f5', '#feb2b2')}>⚠️ 危険人気馬</div>
                {kikenHorses.map(h => (
                  <div key={h.id} style={alertRow('#fff5f5', '#feb2b2')}>
                    <div style={{ fontWeight: 700, marginBottom: '0.2rem' }}>
                      {h.id}番 {h.name}（{popularityRanks.get(h.id) ?? '-'}人気/{h.odds}倍）
                    </div>
                    <div style={{ fontSize: '0.78rem', color: '#742a2a' }}>
                      {generateKikenComment(h, popularityRanks)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ====== Section 5A: 3段階推奨 (Phase 2F: 参加条件最適化) ====== */}
      {hasOdds && betRecs && (
        <div style={section}>
          <SectionHeader title="5A. 🏆 馬券推奨（バックテスト検証済み戦略）" subtitle="930レースの参加条件グリッドサーチで導出した推奨構成" />

          {/* 信頼度カード (Phase 2 ダッシュボード連携): 控えめに補強情報 */}
          <ReliabilityCard race={race} />

          {/* ⭐ 本命級 (110%超) */}
          <div style={{ marginBottom: '0.8rem' }}>
            <div style={tierHeader('#b45309', '#fef3c7')}>
              ⭐ 本命級（回収率110%超の戦略）
            </div>
            {betRecs.tieredReco.umarenHonmei ? (
              <TieredBetCard
                tier="honmei"
                label="馬連"
                roi={EXPECTED_ROI.umaren_honmei}
                horses={betRecs.tieredReco.umarenHonmei.horses}
                reason={`両馬スコア ${betRecs.tieredReco.umarenHonmei.horses.map((h) => (h.score ?? 0).toFixed(0)).join('/')}、EV ${betRecs.tieredReco.umarenHonmei.horses.map((h) => (h.ev ?? 0).toFixed(2)).join('/')}`}
                costText="100円（1点）"
              />
            ) : (
              <SkipCard
                label="馬連"
                reason={
                  /1勝|2勝/.test(race.raceClass ?? '')
                    ? `${race.raceClass} は精度が低いため推奨対象外 (Phase 2G 検証: ROI 54〜63%)`
                    : '両馬スコア≥65 & EV≥1.00 の条件未達'
                }
              />
            )}
            {betRecs.tieredReco.umatanHonmei ? (
              <TieredBetCard
                tier="honmei"
                label="馬単"
                roi={EXPECTED_ROI.umatan_honmei}
                horses={betRecs.tieredReco.umatanHonmei.horses}
                ordered
                reason={`両馬スコア ${betRecs.tieredReco.umatanHonmei.horses.map((h) => (h.score ?? 0).toFixed(0)).join('/')}、オッズ ${betRecs.tieredReco.umatanHonmei.horses.map((h) => h.odds.toFixed(1)).join('/')}`}
                costText="200円（2点BOX）"
              />
            ) : (
              <SkipCard
                label="馬単"
                reason={
                  /1勝|2勝/.test(race.raceClass ?? '')
                    ? `${race.raceClass} は精度が低いため推奨対象外 (Phase 2G 検証: ROI 18〜63%)`
                    : '両馬スコア≥65 & オッズ≤15 & EV≥1.00 の条件未達'
                }
              />
            )}
          </div>

          {/* 🎯 堅実級 (100〜109%) */}
          <div style={{ marginBottom: '0.8rem' }}>
            <div style={tierHeader('#0369a1', '#e0f2fe')}>
              🎯 堅実級（回収率100%超の戦略）
            </div>
            {betRecs.tieredReco.wideKenjitsu ? (
              <TieredBetCard
                tier="kenjitsu"
                label="ワイド"
                roi={EXPECTED_ROI.wide_kenjitsu}
                horses={betRecs.tieredReco.wideKenjitsu.horses}
                reason={`両馬スコア ${betRecs.tieredReco.wideKenjitsu.horses.map((h) => (h.score ?? 0).toFixed(0)).join('/')}、オッズ ${betRecs.tieredReco.wideKenjitsu.horses.map((h) => h.odds.toFixed(1)).join('/')}`}
                costText="100円（1点）"
              />
            ) : (
              <SkipCard
                label="ワイド"
                reason={
                  /1勝|500万/.test(race.raceClass ?? '')
                    ? `${race.raceClass} は精度が低いため推奨対象外 (Phase 2G 検証: ROI 80.5%)`
                    : '両馬スコア≥65 & オッズ≤10 & EV≥1.02 の条件未達'
                }
              />
            )}
          </div>

          {/* 📊 参考情報 */}
          <div style={{ marginBottom: '0.5rem' }}>
            <div style={tierHeader('#475569', '#f1f5f9')}>
              📊 参考情報（平均回収率 100% 未満・判断は各自）
            </div>
            {betRecs.tieredReco.tanReference ? (
              <TieredBetCard
                tier="reference"
                label="単勝"
                roi={EXPECTED_ROI.tan_reference}
                horses={[betRecs.tieredReco.tanReference.horse]}
                reason={`EV ${(betRecs.tieredReco.tanReference.horse.ev ?? 0).toFixed(2)}、参考値`}
                costText="100円"
              />
            ) : null}
            {betRecs.tieredReco.fukuReference?.horse ? (
              <TieredBetCard
                tier="reference"
                label="複勝"
                roi={EXPECTED_ROI.fuku_reference}
                horses={[betRecs.tieredReco.fukuReference.horse]}
                reason={`EV≥1.07、安定狙い`}
                costText="100円"
              />
            ) : (
              <div style={{ color: '#64748b', fontSize: '0.8rem', padding: '0.3rem 0.5rem' }}>
                複勝: 推奨なし (EV≥1.07 該当馬なし)
              </div>
            )}
          </div>

          <div style={{
            marginTop: '0.35rem',
            padding: '0.3rem 0.5rem',
            background: '#fffbeb',
            border: '1px solid #fde68a',
            borderRadius: '4px',
            fontSize: '0.63rem',
            color: '#78350f',
            lineHeight: 1.45,
          }}>
            <strong>注意:</strong> 三連系は過学習リスクで除外。馬連・馬単・ワイドは 930R で前後半差 ≤15pt の安定性確認済（将来の実績は保証しません）。
          </div>
        </div>
      )}

      {/* ====== Section 5: 馬券推奨 ====== */}
      {hasOdds && betRecs && (
        <div style={section}>
          <SectionHeader title="5. 馬券推奨（全券種）" subtitle="EV≥1.1=緑・≥1.0=青・未満=灰" />
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(11rem, 1fr))',
            gap: '0.3rem',
          }}>
            {/* 単勝 */}
            <BetRecommendCard
              label="単勝"
              horses={[betRecs.tan]}
              estOdds={betRecs.tan.odds}
              ev={betRecs.tan.ev ?? 0}
              type="tan"
            />
            {/* 馬連 */}
            {betRecs.umaren && (
              <BetRecommendCard
                label="馬連"
                horses={betRecs.umaren.horses}
                estOdds={betRecs.umaren.odds}
                ev={betRecs.avgEV(betRecs.umaren.horses)}
                type="umaren"
              />
            )}
            {/* 複勝 (Phase 2E Stage 2: EV≥1.07 の馬のみ推奨・ROI 84.8%) */}
            {betRecs.fuku ? (
              <BetRecommendCard
                label="複勝"
                horses={[betRecs.fuku.horse]}
                points={1}
                estOdds={Math.max(1, Math.round(betRecs.fuku.horse.fukuOddsMin * 10) / 10)}
                ev={betRecs.fuku.horse.ev ?? 0}
                type="fuku"
              />
            ) : (
              <div style={{
                border: '1px dashed #cbd5e0',
                borderRadius: '5px',
                padding: '0.3rem 0.45rem',
                background: '#f7fafc',
                color: '#718096',
                fontSize: '0.7rem',
                lineHeight: 1.3,
              }}>
                <strong style={{ fontSize: '0.72rem' }}>複勝</strong> — 推奨なし (EV≥1.07 該当なし)
              </div>
            )}
            {/* ワイド (Phase 2E Stage 2: EV上位2頭BOX) */}
            {betRecs.wide && (
              <BetRecommendCard
                label="ワイド"
                horses={betRecs.wide.horses}
                points={betRecs.wide.points}
                estOdds={betRecs.wide.odds}
                ev={betRecs.avgEV(betRecs.wide.horses)}
                type="wide"
              />
            )}
            {/* 三連複 (現行: ハイブリッド軸+ひも BOX)
                TODO: サンプル1500R+で再検証後にtop-4 BOX採用を検討
                Phase 2E Stage 2: top-4 で ROI 68.2% だが前後半差 28.3pt と過学習懸念 */}
            {betRecs.sanfuku && (
              <BetRecommendCard
                label="三連複"
                horses={betRecs.sanfuku.horses}
                axes={betRecs.sanfuku.axes}
                spokes={betRecs.sanfuku.spokes}
                points={betRecs.sanfuku.points}
                estOdds={betRecs.sanfuku.odds}
                ev={betRecs.avgEV(betRecs.sanfuku.horses)}
                type="sanfuku"
              />
            )}
            {/* 三連単 (現行: ハイブリッド軸+ひも)
                TODO: サンプル1500R+で再検証後にtop-4 BOX採用を検討
                Phase 2E Stage 2: top-4 で ROI 80.4% だが前後半差 41.6pt と過学習懸念大 */}
            {betRecs.santan && (
              <BetRecommendCard
                label="三連単"
                horses={betRecs.santan.horses}
                axes={betRecs.santan.axes}
                spokes={betRecs.santan.spokes}
                points={betRecs.santan.points}
                estOdds={betRecs.santan.odds}
                ev={betRecs.avgEV(betRecs.santan.horses)}
                type="santan"
              />
            )}
          </div>
        </div>
      )}

      {/* ====== Section 6: 全頭EV一覧 (スコア順位 × EV 色分け) ====== */}
      <div style={section}>
        <SectionHeader
          title="6. 全頭EV一覧"
          subtitle="スコア順位 × 期待値（EV色分け）"
        />
        <div style={{
          border: '1px solid #e2e8f0',
          borderRadius: '8px',
          overflow: 'hidden',
          background: '#fff',
        }}>
          {byScore.map((horse, i) => {
            const pop = popularityRanks.get(horse.id) ?? 0;
            const isKiken = kikenHorses.some((k) => k.id === horse.id);
            const isAna   = anaHorses.some((a) => a.id === horse.id);
            const mark =
              horse.id === picks.honmei?.id   ? '◎' :
              horse.id === picks.taikou?.id   ? '○' :
              horse.id === picks.sanbante?.id ? '▲' :
              horse.id === picks.ana?.id      ? '△' : '';
            return (
              <HorseRankRow
                key={horse.id}
                horse={horse}
                rank={i + 1}
                mark={mark}
                pop={pop}
                isKiken={isKiken}
                isAna={isAna}
              />
            );
          })}
        </div>
        <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.45rem', lineHeight: 1.5 }}>
          左端の色帯 = EV 色（<span style={{ color: '#276749', fontWeight: 700 }}>緑 EV≥1.10</span>
          ／<span style={{ color: '#2b6cb0', fontWeight: 700 }}>青 EV≥1.00</span>
          ／<span style={{ color: '#718096', fontWeight: 700 }}>グレー EV&lt;1.00</span>）・
          ⚠️=危険人気 ・ 🎯=穴馬 ・ ◎○▲△=予想印
        </div>
      </div>

      {/* ====== Section 7: AI予想コメント (密度優先) ====== */}
      <div style={section}>
        <SectionHeader title="7. 総評" />
        <div style={{
          background: '#f7fafc',
          border: '1px solid #e2e8f0',
          borderRadius: '4px',
          padding: '0.4rem 0.6rem',
          fontSize: '0.74rem',
          color: '#4a5568',
          lineHeight: 1.55,
        }}>
          {/* 自動生成テキスト */}
          <p style={{ margin: '0 0 0.3rem' }}>
            <strong>{race.name}</strong>（{race.course}・{race.surface === 'turf' ? '芝' : 'ダート'}{race.distance}m）の独自分析です。
          </p>
          <p style={{ margin: '0 0 0.3rem' }}>
            コース傾向は<strong>{tendency.pace}</strong>。枠は<strong>{tendency.waku}</strong>の傾向があります。
          </p>
          {picks.honmei && (
            <p style={{ margin: '0 0 0.3rem' }}>
              ◎本命は<strong>{picks.honmei.id}番{picks.honmei.name}</strong>
              （{picks.honmei.odds}倍・スコア{(picks.honmei.score ?? 0).toFixed(0)}）。
              EV {(picks.honmei.ev ?? 0).toFixed(2)}と{(picks.honmei.ev ?? 0) >= 1.00 ? '長期回収期待できる水準' : '参考程度'}です。
            </p>
          )}
          {picks.ana && (
            <p style={{ margin: '0 0 0.3rem' }}>
              穴馬として<strong>{picks.ana.id}番{picks.ana.name}</strong>
              （{picks.ana.odds}倍）に注目。EV {(picks.ana.ev ?? 0).toFixed(2)}で妙味があります。
            </p>
          )}
          {kikenHorses.length > 0 && (
            <p style={{ margin: 0, color: '#742a2a' }}>
              ⚠️ {kikenHorses.map(h => `${h.id}番${h.name}`).join('・')}は
              人気に対してスコア・EVが伴っておらず過信禁物です。
            </p>
          )}
        </div>
      </div>

    </div>
  );
}

// ==========================================
// スタイル定数
// ==========================================

const sectionWrap: React.CSSProperties = {
  fontFamily: "'Helvetica Neue', Arial, 'Hiragino Kaku Gothic ProN', sans-serif",
};

const reportHeader: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: '0.4rem',
  marginBottom: '0.5rem',
  paddingBottom: '0.3rem',
  borderBottom: '2px solid #2d3748',
  flexWrap: 'wrap',
};

const section: React.CSSProperties = {
  marginBottom: '0.9rem',
};

const th: React.CSSProperties = {
  padding: '0.25rem 0.4rem',
  textAlign: 'left',
  fontWeight: 700,
  fontSize: '0.7rem',
  color: '#4a5568',
  whiteSpace: 'nowrap',
};

const td: React.CSSProperties = {
  padding: '0.25rem 0.4rem',
  verticalAlign: 'middle',
  whiteSpace: 'nowrap',
  fontSize: '0.75rem',
};

function alertHeader(color: string, bg: string, border: string): React.CSSProperties {
  return {
    background: bg,
    border: `1px solid ${border}`,
    borderBottom: 'none',
    borderRadius: '4px 4px 0 0',
    padding: '0.2rem 0.45rem',
    fontWeight: 700,
    fontSize: '0.7rem',
    color,
  };
}

function alertRow(bg: string, border: string): React.CSSProperties {
  return {
    background: bg,
    border: `1px solid ${border}`,
    borderTop: 'none',
    borderRadius: '0 0 4px 4px',
    padding: '0.25rem 0.45rem',
    marginBottom: '0.25rem',
    fontSize: '0.72rem',
  };
}
