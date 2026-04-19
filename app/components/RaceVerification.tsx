'use client';

// ==========================================
// レース結果検証コンポーネント
// 発走から30分後に結果を自動取得し、
// 予想スコア・EVと実際の着順を照合して表示する
// ==========================================

import { useState, useEffect, useCallback } from 'react';
import type { Race, RaceResult, VerificationData } from '@/lib/scraper/types';

// ==========================================
// ユーティリティ
// ==========================================

/**
 * "HH:MM" 形式 + 開催日(YYYYMMDD) → Date オブジェクト（JST）
 * raceDate が渡された場合は正確な日時、なければ今日の日付でフォールバック
 */
function parseStartTime(timeStr: string, raceDate?: string): Date | null {
  const m = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;

  const hh = m[1].padStart(2, '0');
  const mm = m[2];

  if (raceDate && raceDate.length === 8) {
    // 開催日が分かる場合は正確なJST日時を生成
    const y  = raceDate.slice(0, 4);
    const mo = raceDate.slice(4, 6);
    const d  = raceDate.slice(6, 8);
    return new Date(`${y}-${mo}-${d}T${hh}:${mm}:00+09:00`);
  }

  // フォールバック: 今日の日付（raceDate が取れない場合）
  const today = new Date();
  today.setHours(parseInt(m[1], 10), parseInt(m[2], 10), 0, 0);
  return today;
}

/** "1,060円" → 1060 */
function parsePayout(text: string): number {
  return parseInt(text.replace(/[^0-9]/g, ''), 10) || 0;
}

/** スコア降順で並べたときの着順（1-indexed）を返す */
function scoreRankOf(horseId: number, horses: Race['horses']): number {
  const sorted = [...horses].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const idx = sorted.findIndex(h => h.id === horseId);
  return idx >= 0 ? idx + 1 : 99;
}

/** accuracy を計算して VerificationData を構築 */
function buildVerificationData(race: Race, result: RaceResult): VerificationData {
  const top3ids = result.results.filter(r => r.rank <= 3).map(r => r.horseId);
  const highEVHorses = race.horses.filter(h => (h.ev ?? 0) >= 1.0);
  const top3EVCount = highEVHorses.filter(h => top3ids.includes(h.id)).length;

  // 1着馬のスコア順位
  const winner = result.results.find(r => r.rank === 1);
  const top1ScoreRank = winner ? scoreRankOf(winner.horseId, race.horses) : 99;

  // 推奨馬券的中確認（単勝・馬連・三連複・三連単）
  const scoreSorted = [...race.horses].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const top1 = scoreSorted[0];
  const top2 = scoreSorted[1];
  const top3 = scoreSorted[2];

  const top3IdsSorted = [top1?.id, top2?.id, top3?.id].filter(Boolean).map(String).sort().join('-');

  const tanHit = result.payouts.tan.some(t => t.horseId === top1?.id);
  const umarenHit = result.payouts.umaren.some(u => {
    const ids = u.combination.split('-').map(Number).sort().join('-');
    return ids === [top1?.id, top2?.id].filter(Boolean).map(String).sort().join('-');
  });
  const sanfukuHit = result.payouts.sanfuku.some(s => {
    const ids = s.combination.split('-').map(Number).sort().join('-');
    return ids === top3IdsSorted;
  });
  const santanHit = result.payouts.santan.some(s => {
    return s.combination === [top1?.id, top2?.id, top3?.id].join('-');
  });

  const recommendedHits = [
    { type: '単勝',  hit: tanHit,    payout: tanHit    ? (result.payouts.tan[0]?.payout    ?? 0) : 0 },
    { type: '馬連',  hit: umarenHit, payout: umarenHit ? (result.payouts.umaren[0]?.payout ?? 0) : 0 },
    { type: '三連複', hit: sanfukuHit, payout: sanfukuHit ? (result.payouts.sanfuku[0]?.payout ?? 0) : 0 },
    { type: '三連単', hit: santanHit,  payout: santanHit  ? (result.payouts.santan[0]?.payout  ?? 0) : 0 },
  ];

  return {
    raceId: race.raceId,
    raceName: race.name,
    date: new Date().toISOString().slice(0, 10),
    predictions: race.horses.map(h => ({
      horseId: h.id,
      horseName: h.name,
      score: h.score ?? 0,
      ev: h.ev ?? 0,
      odds: h.odds,
    })),
    results: result,
    accuracy: { top1ScoreRank, top3EVCount, recommendedHits },
  };
}

// ==========================================
// サブコンポーネント
// ==========================================

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#2d3748', margin: '0 0 0.6rem' }}>
      {children}
    </h3>
  );
}

const cell: React.CSSProperties = {
  padding: '0.4rem 0.6rem',
  borderBottom: '1px solid #e2e8f0',
  fontSize: '0.82rem',
};
const hd: React.CSSProperties = {
  ...cell,
  background: '#2d3748',
  color: '#fff',
  fontWeight: 700,
  textAlign: 'center' as const,
};

// ==========================================
// メインコンポーネント
// ==========================================

export function RaceVerification({ race }: { race: Race }) {
  const [result, setResult]       = useState<RaceResult | null>(null);
  const [isLoading, setLoading]   = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [timerMsg, setTimerMsg]   = useState<string | null>(null);

  // 結果を取得する関数
  const fetchResult = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch(`/api/race/${race.raceId}/result`);
      const json = await res.json() as { success: boolean; data: RaceResult | null; error?: string };
      if (json.success && json.data) {
        setResult(json.data);
        setTimerMsg(null);
      } else {
        setError(json.error ?? 'レース結果をまだ取得できません');
      }
    } catch {
      setError('ネットワークエラーが発生しました');
    } finally {
      setLoading(false);
    }
  }, [race.raceId]);

  // 発走時刻 + 30分後に自動取得
  useEffect(() => {
    setResult(null);
    setError(null);
    setTimerMsg(null);

    if (!race.startTime) return;

    const startDate = parseStartTime(race.startTime, race.raceDate);
    if (!startDate) return;

    const resultAvailableAt = new Date(startDate.getTime() + 30 * 60 * 1000);
    const now = new Date();

    if (now >= resultAvailableAt) {
      // すでに30分経過 → 即時取得
      fetchResult();
    } else {
      // タイマーをセット
      const waitMs = resultAvailableAt.getTime() - now.getTime();
      const waitMin = Math.ceil(waitMs / 60000);
      setTimerMsg(`発走後 ${waitMin} 分後に自動取得します（${race.startTime} + 30分）`);
      const timer = setTimeout(() => {
        setTimerMsg(null);
        fetchResult();
      }, waitMs);
      return () => clearTimeout(timer);
    }
  }, [race.raceId, race.startTime, race.raceDate, fetchResult]);

  // ----------------------------------------
  // 表示条件: startTime がなければ非表示
  // ----------------------------------------
  if (!race.startTime) return null;

  // ----------------------------------------
  // VerificationData の計算（結果あり時のみ）
  // ----------------------------------------
  const vd = result ? buildVerificationData(race, result) : null;

  // 着順→スコアマップ
  const horseMap = new Map(race.horses.map(h => [h.id, h]));
  const scoreSorted = [...race.horses].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  // ----------------------------------------
  // レンダリング
  // ----------------------------------------
  const section: React.CSSProperties = { marginBottom: '1.5rem' };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0, color: '#1a202c' }}>
          レース結果検証
        </h2>
        {!result && !isLoading && (
          <button
            onClick={fetchResult}
            style={{
              padding: '0.3rem 0.8rem',
              background: '#3182ce',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '0.85rem',
            }}
          >
            結果を取得
          </button>
        )}
        {isLoading && (
          <span style={{ fontSize: '0.85rem', color: '#666' }}>取得中...</span>
        )}
      </div>

      {/* タイマー待機メッセージ */}
      {timerMsg && (
        <div style={{
          padding: '0.75rem 1rem',
          background: '#ebf8ff',
          border: '1px solid #bee3f8',
          borderRadius: '6px',
          fontSize: '0.85rem',
          color: '#2b6cb0',
          marginBottom: '1rem',
        }}>
          ⏱ {timerMsg}
        </div>
      )}

      {/* エラー表示 */}
      {error && !result && (
        <div style={{
          padding: '0.75rem 1rem',
          background: '#fff5f5',
          border: '1px solid #fed7d7',
          borderRadius: '6px',
          fontSize: '0.85rem',
          color: '#c53030',
          marginBottom: '1rem',
        }}>
          {error}
        </div>
      )}

      {/* 結果あり */}
      {result && vd && (
        <>
          {/* ====== 精度サマリー ====== */}
          <div style={section}>
            <SectionTitle>精度サマリー</SectionTitle>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              {/* 1着馬のスコア順位 */}
              <div style={metricCard}>
                <div style={metricLabel}>1着馬のスコア順位</div>
                <div style={{
                  ...metricValue,
                  color: vd.accuracy.top1ScoreRank <= 3 ? '#276749' : '#c05621',
                }}>
                  {vd.accuracy.top1ScoreRank}位
                </div>
                <div style={metricSub}>スコア上位に来れば精度◎</div>
              </div>

              {/* EV1.0以上で3着以内 */}
              <div style={metricCard}>
                <div style={metricLabel}>EV1.0以上が3着以内</div>
                <div style={{
                  ...metricValue,
                  color: vd.accuracy.top3EVCount >= 2 ? '#276749' : '#c05621',
                }}>
                  {vd.accuracy.top3EVCount}頭
                </div>
                <div style={metricSub}>EV選定の有効性</div>
              </div>

              {/* 推奨馬券的中 */}
              {vd.accuracy.recommendedHits.map(h => (
                <div key={h.type} style={{
                  ...metricCard,
                  background: h.hit ? '#f0fff4' : '#fff5f5',
                  borderColor: h.hit ? '#9ae6b4' : '#fed7d7',
                }}>
                  <div style={metricLabel}>{h.type}</div>
                  <div style={{
                    ...metricValue,
                    fontSize: '1.3rem',
                    color: h.hit ? '#276749' : '#c05621',
                  }}>
                    {h.hit ? '✅ 的中' : '❌ ハズレ'}
                  </div>
                  {h.hit && (
                    <div style={{ ...metricSub, color: '#276749', fontWeight: 700 }}>
                      {h.payout.toLocaleString()}円
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* ====== 着順 vs スコア対応表 ====== */}
          <div style={section}>
            <SectionTitle>着順 × スコア対応表</SectionTitle>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', minWidth: '480px' }}>
                <thead>
                  <tr style={{ background: '#2d3748', color: '#fff' }}>
                    {['着順', '馬番', '馬名', 'タイム', '後3F', 'スコア順位', 'スコア', 'EV', '単勝'].map(h => (
                      <th key={h} style={{ ...hd }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.results.slice(0, 10).map(r => {
                    const horse = horseMap.get(r.horseId);
                    const sRank = scoreRankOf(r.horseId, race.horses);
                    const rankBg = r.rank === 1 ? '#f0fff4' : r.rank <= 3 ? '#ebf8ff' : '#fff';
                    const scoreColor =
                      sRank <= 3 ? '#276749' : sRank <= 6 ? '#2b6cb0' : '#718096';
                    return (
                      <tr key={r.rank} style={{ borderBottom: '1px solid #e2e8f0', background: rankBg }}>
                        <td style={{ ...cell, textAlign: 'center', fontWeight: 700 }}>
                          {r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : r.rank}
                        </td>
                        <td style={{ ...cell, textAlign: 'center' }}>{r.horseId}</td>
                        <td style={{ ...cell, fontWeight: r.rank <= 3 ? 700 : 400 }}>{r.horseName}</td>
                        <td style={{ ...cell, textAlign: 'center' }}>{r.time}</td>
                        <td style={{ ...cell, textAlign: 'center' }}>{r.lastThreeF || '-'}</td>
                        <td style={{ ...cell, textAlign: 'center', fontWeight: 700, color: scoreColor }}>
                          {sRank}位
                        </td>
                        <td style={{ ...cell, textAlign: 'center' }}>
                          {horse ? (horse.score ?? 0).toFixed(0) : '-'}
                        </td>
                        <td style={{
                          ...cell, textAlign: 'center',
                          color: (horse?.ev ?? 0) >= 1.0 ? '#276749' : '#718096',
                        }}>
                          {horse ? (horse.ev ?? 0).toFixed(3) : '-'}
                        </td>
                        <td style={{ ...cell, textAlign: 'right' }}>
                          {horse ? `${horse.odds}倍` : '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* ====== スコアTOP3の実際の着順 ====== */}
          <div style={section}>
            <SectionTitle>スコアTOP3 の実際の着順</SectionTitle>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              {scoreSorted.slice(0, 3).map((h, i) => {
                const actual = result.results.find(r => r.horseId === h.id);
                const actualRank = actual?.rank ?? '着外';
                const hit = typeof actualRank === 'number' && actualRank <= 3;
                return (
                  <div key={h.id} style={{
                    flex: '1 1 140px',
                    padding: '0.75rem',
                    border: `2px solid ${hit ? '#9ae6b4' : '#e2e8f0'}`,
                    borderRadius: '8px',
                    background: hit ? '#f0fff4' : '#f7fafc',
                    textAlign: 'center',
                  }}>
                    <div style={{ fontSize: '0.75rem', color: '#718096' }}>
                      スコア{i + 1}位
                    </div>
                    <div style={{ fontWeight: 700, margin: '0.25rem 0' }}>{h.name}</div>
                    <div style={{ fontSize: '0.8rem', color: '#555' }}>
                      スコア {(h.score ?? 0).toFixed(0)}
                    </div>
                    <div style={{
                      fontSize: '1.4rem',
                      fontWeight: 700,
                      margin: '0.3rem 0 0',
                      color: hit ? '#276749' : '#c05621',
                    }}>
                      {typeof actualRank === 'number' ? `${actualRank}着` : '着外'}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ====== 払戻金 ====== */}
          <div style={section}>
            <SectionTitle>払戻金</SectionTitle>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              {[
                { label: '単勝',  items: result.payouts.tan.map(t => ({ combo: `${t.horseId}番`, payout: t.payout })) },
                { label: '馬連',  items: result.payouts.umaren.map(u => ({ combo: u.combination, payout: u.payout })) },
                { label: '三連複', items: result.payouts.sanfuku.map(s => ({ combo: s.combination, payout: s.payout })) },
                { label: '三連単', items: result.payouts.santan.map(s => ({ combo: s.combination, payout: s.payout })) },
              ].map(({ label, items }) => (
                <div key={label} style={{
                  flex: '1 1 120px',
                  padding: '0.75rem',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  background: '#f7fafc',
                }}>
                  <div style={{ fontWeight: 700, fontSize: '0.8rem', color: '#555', marginBottom: '0.3rem' }}>
                    {label}
                  </div>
                  {items.length > 0 ? items.map((it, i) => (
                    <div key={i}>
                      <div style={{ fontSize: '0.78rem', color: '#444' }}>{it.combo}</div>
                      <div style={{ fontWeight: 700, color: '#2b6cb0', fontSize: '0.95rem' }}>
                        {it.payout.toLocaleString()}円
                      </div>
                    </div>
                  )) : (
                    <div style={{ fontSize: '0.78rem', color: '#aaa' }}>データなし</div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* ====== JSON保存ボタン ====== */}
          <div style={{ textAlign: 'right' }}>
            <button
              onClick={() => {
                const json = JSON.stringify(vd, null, 2);
                const blob = new Blob([json], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${vd.date.replace(/-/g, '')}_${race.raceId}.json`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              style={{
                padding: '0.35rem 0.9rem',
                background: '#f7fafc',
                border: '1px solid #cbd5e0',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '0.82rem',
                color: '#4a5568',
              }}
            >
              📥 検証データをJSONで保存
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ==========================================
// スタイル定数
// ==========================================
const metricCard: React.CSSProperties = {
  flex: '1 1 120px',
  padding: '0.75rem',
  border: '1px solid #e2e8f0',
  borderRadius: '8px',
  background: '#f7fafc',
  textAlign: 'center',
};
const metricLabel: React.CSSProperties = {
  fontSize: '0.75rem',
  color: '#718096',
  marginBottom: '0.25rem',
};
const metricValue: React.CSSProperties = {
  fontSize: '1.6rem',
  fontWeight: 700,
  lineHeight: 1.1,
};
const metricSub: React.CSSProperties = {
  fontSize: '0.72rem',
  color: '#a0aec0',
  marginTop: '0.2rem',
};
