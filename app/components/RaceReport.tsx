'use client';

// ==========================================
// 予想記事レポートコンポーネント
// BakenSimulator の下に配置し、note転用向けに各セクションを独立表示する
// ==========================================

import { useMemo } from 'react';
import type { Race, Horse } from '@/lib/scraper/types';

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

  // △穴: オッズ10倍以上・EV1.0以上でEV最上位（既選択除外）
  const usedIds = new Set([honmei?.id, taikou?.id, sanbante?.id].filter(Boolean));
  const ana = byEV.find(h =>
    h.odds >= 10 &&
    (h.ev ?? 0) >= 1.0 &&
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

/** セクション区切りヘッダー */
function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={{ borderBottom: '2px solid #2b6cb0', paddingBottom: '0.4rem', marginBottom: '0.9rem' }}>
      <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#1a365d' }}>
        {title}
        {subtitle && (
          <span style={{ fontSize: '0.8rem', fontWeight: 400, color: '#718096', marginLeft: '0.5rem' }}>
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

/** メトリクスカード（展開・枠傾向等） */
function MetricCard({ label, value }: { label: string; value: string }) {
  const hasData = value !== 'データなし';
  return (
    <div style={{
      background: hasData ? '#ebf8ff' : '#f7fafc',
      border: `1px solid ${hasData ? '#90cdf4' : '#e2e8f0'}`,
      borderRadius: '6px',
      padding: '0.5rem 0.75rem',
      minWidth: '130px',
      flex: '1',
    }}>
      <div style={{ fontSize: '0.7rem', color: '#718096', marginBottom: '0.2rem' }}>{label}</div>
      <div style={{ fontSize: '0.85rem', fontWeight: 700, color: hasData ? '#2b6cb0' : '#a0aec0' }}>
        {value}
      </div>
    </div>
  );
}

/** 予想印カード */
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
        border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.75rem',
        background: '#f7fafc', minWidth: '150px', flex: '1',
      }}>
        <div style={{ fontSize: '1.4rem', fontWeight: 900, color: '#cbd5e0' }}>{mark}</div>
        <div style={{ fontSize: '0.8rem', color: '#a0aec0', marginTop: '0.3rem' }}>該当なし</div>
      </div>
    );
  }

  const ev = horse.ev ?? 0;
  const pop = popularityRanks.get(horse.id) ?? 0;
  const isBuy = ev >= 1.0;
  const score = horse.score ?? 0;

  return (
    <div style={{
      border: `2px solid ${markColor}`,
      borderRadius: '8px',
      padding: '0.75rem',
      background: '#fff',
      minWidth: '150px',
      flex: '1',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', marginBottom: '0.4rem' }}>
        <span style={{ fontSize: '1.4rem', fontWeight: 900, color: markColor }}>{mark}</span>
        <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#333' }}>
          {horse.id}番 {horse.name}
        </span>
      </div>
      <div style={{ fontSize: '0.8rem', color: '#555', marginBottom: '0.35rem' }}>
        {horse.odds > 0 ? `${horse.odds}倍（${pop || '-'}人気）` : 'オッズ未定'}
      </div>
      {/* スコアバー */}
      <div style={{ marginBottom: '0.4rem' }}>
        <div style={{ fontSize: '0.7rem', color: '#718096', marginBottom: '0.15rem' }}>
          総合スコア {score.toFixed(0)}
        </div>
        <div style={{ height: '6px', background: '#e2e8f0', borderRadius: '3px', overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            width: `${score}%`,
            background: score >= 70 ? '#276749' : score >= 50 ? '#2b6cb0' : '#c05621',
            borderRadius: '3px',
          }} />
        </div>
      </div>
      {/* EVバッジ */}
      <span style={{
        display: 'inline-block',
        padding: '0.1rem 0.4rem',
        borderRadius: '4px',
        fontSize: '0.75rem',
        fontWeight: 700,
        background: isBuy ? '#276749' : '#718096',
        color: '#fff',
      }}>
        {horse.odds > 0 ? (isBuy ? '買い推奨' : '検討') : '-'}
      </span>
    </div>
  );
}

/** EV・スコアに応じた色 */
function evColor(ev: number): string {
  if (ev >= 1.1) return '#276749';
  if (ev >= 1.0) return '#2b6cb0';
  return '#718096';
}

/** 馬券推奨カード */
function BetRecommendCard({
  label, horses, estOdds, ev, type,
}: {
  label: string;
  horses: Horse[];
  estOdds: number;
  ev: number;
  type: string;
}) {
  const color = evColor(ev);
  return (
    <div style={{
      border: `2px solid ${color}`,
      borderRadius: '8px',
      padding: '0.6rem 0.8rem',
      background: ev >= 1.0 ? '#f0fff4' : '#f7fafc',
      flex: '1',
      minWidth: '150px',
    }}>
      <div style={{ fontSize: '0.75rem', color: '#718096', marginBottom: '0.2rem' }}>{label}</div>
      <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#333', marginBottom: '0.25rem' }}>
        {horses.map(h => `${h.id}番`).join(type === 'santan' || type === 'umatan' ? '→' : '-')}
      </div>
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
        <span style={{
          background: color, color: '#fff',
          padding: '0.1rem 0.4rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 700,
        }}>
          EV {ev.toFixed(2)}
        </span>
        <span style={{ fontSize: '0.75rem', color: '#555', alignSelf: 'center' }}>
          ~{estOdds}倍
        </span>
      </div>
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
    () => race.horses.filter(h => h.odds >= 10 && (h.ev ?? 0) >= 1.0 && (h.score ?? 0) >= 60),
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
  const betRecs = useMemo(() => {
    const { honmei, taikou, sanbante, ana } = picks;
    if (!honmei) return null;

    const tan = honmei;
    const umaren = taikou ? { horses: [honmei, taikou], odds: estComboOdds(honmei, taikou, undefined, 'umaren') } : null;
    const wide   = ana    ? { horses: [honmei, ana],    odds: estComboOdds(honmei, ana,    undefined, 'wide')   } : null;
    const sanfuku = (taikou && sanbante) ? {
      horses: [honmei, taikou, sanbante],
      odds: estComboOdds(honmei, taikou, sanbante, 'sanfuku'),
    } : null;
    const santan = (taikou && sanbante) ? {
      horses: [honmei, taikou, sanbante],
      odds: estComboOdds(honmei, taikou, sanbante, 'santan'),
    } : null;

    const avgEV = (hs: Horse[]) => hs.reduce((s, h) => s + (h.ev ?? 0), 0) / hs.length;

    return { tan, umaren, wide, sanfuku, santan, avgEV };
  }, [picks]);

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

      {/* ====== Section 1: レース概要ヘッダー ====== */}
      <div style={section}>
        <SectionHeader title="1. レース概要" />
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.6rem', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, fontSize: '1.1rem' }}>{race.name}</span>
          <GradeBadge grade={grade} />
        </div>
        <div style={{ fontSize: '0.85rem', color: '#555', marginBottom: '0.8rem' }}>
          {race.course}・{race.surface === 'turf' ? '芝' : 'ダート'}{race.distance}m・{race.horses.length}頭立て
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <MetricCard label="展開予想"   value={tendency.pace}       />
          <MetricCard label="枠傾向"     value={tendency.waku}       />
          <MetricCard label="コース傾向" value={tendency.course}     />
          <MetricCard label="人気傾向"   value={tendency.popularity} />
        </div>
      </div>

      {/* ====== Section 2: 予想印カード ====== */}
      {hasOdds && (
        <div style={section}>
          <SectionHeader title="2. 予想印" subtitle="独自スコア・期待値による自動付与" />
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
            <PickCard mark="◎" horse={picks.honmei}   popularityRanks={popularityRanks} />
            <PickCard mark="○" horse={picks.taikou}   popularityRanks={popularityRanks} />
            <PickCard mark="▲" horse={picks.sanbante} popularityRanks={popularityRanks} />
            <PickCard mark="△" horse={picks.ana}      popularityRanks={popularityRanks} />
          </div>
          <p style={{ fontSize: '0.75rem', color: '#718096', margin: '0.5rem 0 0' }}>
            ◎本命=EV最高・○対抗=スコア2位・▲3番手=スコア3位・△穴=10倍以上でEV1.0超え
          </p>
        </div>
      )}

      {/* ====== Section 3: 重要指標TOP5 ====== */}
      <div style={section}>
        <SectionHeader title="3. スコアTOP5" subtitle="総合スコア降順" />
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ background: '#edf2f7' }}>
              {['順位', '馬名', 'スコア', '上がり評価', '調教評価', 'コメント'].map(h => (
                <th key={h} style={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {byScore.slice(0, 5).map((horse, i) => {
              const last3f = horse.lastThreeF;
              const lastEval = last3f === 0 ? '-' : last3f <= 11.2 ? '◎' : last3f <= 11.6 ? '○' : last3f <= 11.9 ? '△' : '▽';
              const trainEval = last3f === 0 ? '-' : last3f <= 11.0 ? '絶好' : last3f <= 11.4 ? '良好' : last3f <= 11.8 ? '普通' : '低調';
              const comment = horse.odds >= 10 && (horse.ev ?? 0) >= 1.0 ? '穴馬候補' : horse.odds < 5 ? '上位人気' : '注目';
              return (
                <tr key={horse.id} style={{ borderBottom: '1px solid #e2e8f0', background: i === 0 ? '#f0fff4' : '#fff' }}>
                  <td style={td}>{i + 1}位</td>
                  <td style={{ ...td, fontWeight: 700 }}>{horse.id}番 {horse.name}</td>
                  <td style={td}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <span style={{ fontWeight: 700, color: i === 0 ? '#276749' : '#333' }}>
                        {(horse.score ?? 0).toFixed(0)}
                      </span>
                      <div style={{ width: '50px', height: '5px', background: '#e2e8f0', borderRadius: '3px', overflow: 'hidden' }}>
                        <div style={{
                          height: '100%',
                          width: `${horse.score ?? 0}%`,
                          background: i === 0 ? '#276749' : '#3182ce',
                          borderRadius: '3px',
                        }} />
                      </div>
                    </div>
                  </td>
                  <td style={{ ...td, textAlign: 'center' }}>{lastEval}</td>
                  <td style={{ ...td, textAlign: 'center' }}>{trainEval}</td>
                  <td style={{ ...td, color: '#555' }}>{comment}</td>
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

      {/* ====== Section 5: 馬券推奨 ====== */}
      {hasOdds && betRecs && (
        <div style={section}>
          <SectionHeader title="5. 馬券推奨" subtitle="EV1.1以上=緑・1.0〜1.1=青・未満=グレー（推定オッズ）" />
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
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
            {/* ワイド */}
            {betRecs.wide && (
              <BetRecommendCard
                label="ワイド"
                horses={betRecs.wide.horses}
                estOdds={betRecs.wide.odds}
                ev={betRecs.avgEV(betRecs.wide.horses)}
                type="wide"
              />
            )}
            {/* 三連複 */}
            {betRecs.sanfuku && (
              <BetRecommendCard
                label="三連複"
                horses={betRecs.sanfuku.horses}
                estOdds={betRecs.sanfuku.odds}
                ev={betRecs.avgEV(betRecs.sanfuku.horses)}
                type="sanfuku"
              />
            )}
            {/* 三連単 */}
            {betRecs.santan && (
              <BetRecommendCard
                label="三連単"
                horses={betRecs.santan.horses}
                estOdds={betRecs.santan.odds}
                ev={betRecs.avgEV(betRecs.santan.horses)}
                type="santan"
              />
            )}
          </div>
        </div>
      )}

      {/* ====== Section 6: 全頭データサマリー ====== */}
      <div style={section}>
        <SectionHeader title="6. 全頭データサマリー" subtitle="総合スコア降順" />
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', minWidth: '600px' }}>
            <thead>
              <tr style={{ background: '#2d3748', color: '#fff' }}>
                {['番', '馬名', '印', '人気', 'オッズ', '脚質', '調教', '総合スコア'].map(h => (
                  <th key={h} style={{ ...th, color: '#fff', background: 'transparent' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {byScore.map(horse => {
                const pop = popularityRanks.get(horse.id) ?? 0;
                const isKiken = kikenHorses.some(k => k.id === horse.id);
                const isAna   = anaHorses.some(a => a.id === horse.id);
                const mark =
                  horse.id === picks.honmei?.id   ? '◎' :
                  horse.id === picks.taikou?.id   ? '○' :
                  horse.id === picks.sanbante?.id ? '▲' :
                  horse.id === picks.ana?.id      ? '△' : '';
                const last3f = horse.lastThreeF;
                const trainEval = last3f === 0 ? '-' : last3f <= 11.0 ? '絶好' : last3f <= 11.4 ? '良好' : last3f <= 11.8 ? '普通' : '低調';
                // 脚質: lastThreeFから近似（速=差し、遅=先行）
                const runStyle = last3f === 0 ? '-' : last3f <= 11.4 ? '差・追' : last3f <= 11.8 ? '先・差' : '逃・先';
                const score = horse.score ?? 0;
                const rowBg = isKiken ? '#fff5f5' : isAna ? '#fffff0' : '#fff';

                return (
                  <tr key={horse.id} style={{ borderBottom: '1px solid #e2e8f0', background: rowBg }}>
                    <td style={{ ...td, textAlign: 'center', fontWeight: 700 }}>{horse.id}</td>
                    <td style={{ ...td, fontWeight: mark ? 700 : 400 }}>
                      {horse.name}
                      {isKiken && <span style={{ color: '#e53e3e', fontSize: '0.7rem', marginLeft: '0.3rem' }}>⚠️</span>}
                      {isAna   && <span style={{ color: '#c05621', fontSize: '0.7rem', marginLeft: '0.3rem' }}>🎯</span>}
                    </td>
                    <td style={{ ...td, textAlign: 'center', fontWeight: 700, color: mark ? '#c05621' : '#ccc' }}>
                      {mark || '-'}
                    </td>
                    <td style={{ ...td, textAlign: 'center' }}>{pop || '-'}</td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      {horse.odds > 0 ? `${horse.odds}倍` : '-'}
                    </td>
                    <td style={{ ...td, textAlign: 'center', color: '#555' }}>{runStyle}</td>
                    <td style={{ ...td, textAlign: 'center', color: '#555' }}>{trainEval}</td>
                    <td style={td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                        <span style={{
                          fontWeight: 700,
                          color: score >= 70 ? '#276749' : score >= 50 ? '#2b6cb0' : '#c05621',
                          minWidth: '2rem',
                        }}>
                          {score.toFixed(0)}
                        </span>
                        <div style={{ width: '60px', height: '5px', background: '#e2e8f0', borderRadius: '3px', overflow: 'hidden' }}>
                          <div style={{
                            height: '100%',
                            width: `${score}%`,
                            background: score >= 70 ? '#276749' : score >= 50 ? '#3182ce' : '#c05621',
                            borderRadius: '3px',
                          }} />
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: '0.73rem', color: '#718096', marginTop: '0.4rem' }}>
          ⚠️薄赤=危険人気馬 / 🎯薄黄=穴馬候補 / 脚質はラスト3Fから近似
        </div>
      </div>

      {/* ====== Section 7: AI予想コメント（プレースホルダー） ====== */}
      <div style={section}>
        <SectionHeader title="7. 総評コメント" />
        <div style={{
          background: '#f7fafc',
          border: '1px solid #e2e8f0',
          borderRadius: '6px',
          padding: '0.75rem 1rem',
          fontSize: '0.85rem',
          color: '#4a5568',
          lineHeight: '1.8',
        }}>
          {/* 自動生成テキスト */}
          <p style={{ margin: '0 0 0.5rem' }}>
            <strong>{race.name}</strong>（{race.course}・{race.surface === 'turf' ? '芝' : 'ダート'}{race.distance}m）の独自分析です。
          </p>
          <p style={{ margin: '0 0 0.5rem' }}>
            コース傾向は<strong>{tendency.pace}</strong>。枠は<strong>{tendency.waku}</strong>の傾向があります。
          </p>
          {picks.honmei && (
            <p style={{ margin: '0 0 0.5rem' }}>
              ◎本命は<strong>{picks.honmei.id}番{picks.honmei.name}</strong>
              （{picks.honmei.odds}倍・スコア{(picks.honmei.score ?? 0).toFixed(0)}）。
              EV {(picks.honmei.ev ?? 0).toFixed(2)}と{(picks.honmei.ev ?? 0) >= 1.0 ? '長期回収期待できる水準' : '参考程度'}です。
            </p>
          )}
          {picks.ana && (
            <p style={{ margin: '0 0 0.5rem' }}>
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
  gap: '0.75rem',
  marginBottom: '1.2rem',
  paddingBottom: '0.75rem',
  borderBottom: '3px solid #2d3748',
  flexWrap: 'wrap',
};

const section: React.CSSProperties = {
  marginBottom: '1.8rem',
};

const th: React.CSSProperties = {
  padding: '0.4rem 0.6rem',
  textAlign: 'left',
  fontWeight: 700,
  fontSize: '0.8rem',
  color: '#4a5568',
  whiteSpace: 'nowrap',
};

const td: React.CSSProperties = {
  padding: '0.4rem 0.6rem',
  verticalAlign: 'middle',
  whiteSpace: 'nowrap',
};

function alertHeader(color: string, bg: string, border: string): React.CSSProperties {
  return {
    background: bg,
    border: `1px solid ${border}`,
    borderBottom: 'none',
    borderRadius: '6px 6px 0 0',
    padding: '0.35rem 0.6rem',
    fontWeight: 700,
    fontSize: '0.8rem',
    color,
  };
}

function alertRow(bg: string, border: string): React.CSSProperties {
  return {
    background: bg,
    border: `1px solid ${border}`,
    borderTop: 'none',
    borderRadius: '0 0 6px 6px',
    padding: '0.4rem 0.6rem',
    marginBottom: '0.4rem',
  };
}
