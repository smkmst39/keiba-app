'use client';

// ==========================================
// レーススケジュール選択コンポーネント
// 日付タブ → 競馬場タブ → レース一覧 の3階層UI
// ==========================================

import { useState, useEffect, useRef } from 'react';
import type { Race, Grade } from '@/lib/scraper/types';
import { useSchedule, getTodayStr, type DaySchedule } from '@/app/hooks/useSchedule';
import { useRaceData } from '@/app/hooks/useRaceData';

type Props = {
  onRaceLoaded: (race: Race) => void;
};

// ==========================================
// 日付フォーマット: "20260411" → "4月11日（土）"
// ==========================================
const DOW_JA = ['日', '月', '火', '水', '木', '金', '土'];

function formatDate(dateStr: string): string {
  const y = parseInt(dateStr.slice(0, 4), 10);
  const m = parseInt(dateStr.slice(4, 6), 10);
  const d = parseInt(dateStr.slice(6, 8), 10);
  const dow = DOW_JA[new Date(y, m - 1, d).getDay()];
  return `${m}月${d}日（${dow}）`;
}

// ==========================================
// グレードバッジ
// ==========================================
function GradeBadge({ grade }: { grade: Grade }) {
  if (!grade) return null;
  const colors: Record<string, { bg: string; color: string }> = {
    G1: { bg: '#c53030', color: '#fff' },
    G2: { bg: '#6b46c1', color: '#fff' },
    G3: { bg: '#c05621', color: '#fff' },
    L:  { bg: '#2b6cb0', color: '#fff' },
    OP: { bg: '#2f855a', color: '#fff' },
  };
  const style = colors[grade] ?? { bg: '#718096', color: '#fff' };
  return (
    <span style={{
      ...style,
      padding: '0.1rem 0.4rem',
      borderRadius: '3px',
      fontSize: '0.7rem',
      fontWeight: 700,
      letterSpacing: '0.03em',
      whiteSpace: 'nowrap',
    }}>
      {grade}
    </span>
  );
}

// ==========================================
// スケルトンローダー
// ==========================================
function Skeleton({ width, height }: { width: string; height: string }) {
  return (
    <span style={{
      display: 'inline-block',
      width,
      height,
      background: 'linear-gradient(90deg, #e2e8f0 25%, #edf2f7 50%, #e2e8f0 75%)',
      backgroundSize: '200% 100%',
      borderRadius: '4px',
      animation: 'shimmer 1.4s infinite',
    }} />
  );
}

// ==========================================
// レース一覧アイテム
// ==========================================
function RaceItem({
  raceId, raceNum, startTime, raceName, grade, headCount,
  selected, onClick,
}: {
  raceId: string; raceNum: number; startTime: string;
  raceName: string; grade: Grade; headCount: number;
  selected: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.6rem',
        width: '100%',
        padding: '0.55rem 0.75rem',
        background: selected ? '#ebf8ff' : 'transparent',
        border: selected ? '1px solid #90cdf4' : '1px solid transparent',
        borderRadius: '6px',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'background 0.1s',
      }}
    >
      <span style={{
        minWidth: '2.2rem',
        fontWeight: 700,
        fontSize: '0.85rem',
        color: selected ? '#2b6cb0' : '#555',
      }}>
        {raceNum}R
      </span>
      <span style={{ minWidth: '3rem', fontSize: '0.82rem', color: '#666', fontVariantNumeric: 'tabular-nums' }}>
        {startTime}
      </span>
      <span style={{ flex: 1, fontSize: '0.88rem', color: '#222', fontWeight: selected ? 700 : 400 }}>
        {raceName}
      </span>
      <GradeBadge grade={grade} />
      {headCount > 0 && (
        <span style={{ fontSize: '0.78rem', color: '#888', minWidth: '2.5rem', textAlign: 'right' }}>
          {headCount}頭
        </span>
      )}
    </button>
  );
}

// ==========================================
// タブボタン（共通）
// ==========================================
function TabBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '0.4rem 0.85rem',
        border: 'none',
        borderBottom: active ? '2px solid #2b6cb0' : '2px solid transparent',
        background: 'none',
        cursor: 'pointer',
        fontWeight: active ? 700 : 400,
        color: active ? '#2b6cb0' : '#555',
        fontSize: '0.9rem',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );
}

// ==========================================
// 内部コンポーネント: レース取得してコールバック
// ==========================================
function RaceFetcher({ raceId, onRaceLoaded }: { raceId: string; onRaceLoaded: (r: Race) => void }) {
  const { race, isLoading, error } = useRaceData(raceId);

  useEffect(() => {
    if (race) onRaceLoaded(race);
  }, [race, onRaceLoaded]);

  if (isLoading) return (
    <div style={{ padding: '2rem', textAlign: 'center', color: '#666' }}>
      <div style={spinnerStyle} />
      <p style={{ marginTop: '0.5rem', fontSize: '0.9rem' }}>レースデータを取得中…</p>
    </div>
  );
  if (error) return <p style={{ color: '#e53e3e', padding: '1rem' }}>⚠ {error}</p>;
  return null;
}

const spinnerStyle: React.CSSProperties = {
  width: '28px', height: '28px',
  border: '3px solid #e2e8f0',
  borderTop: '3px solid #2b6cb0',
  borderRadius: '50%',
  animation: 'spin 0.8s linear infinite',
  margin: '0 auto',
};

// ==========================================
// メインコンポーネント
// ==========================================
export function RaceSchedule({ onRaceLoaded }: Props) {
  // useSchedule は引数なし（過去7日〜翌々日の10日分を内部で順次取得）
  const { schedule, isLoading, error } = useSchedule();

  // schedule は開催ありの日のみ格納されているのでそのまま availableDates として使う
  const availableDates = schedule.map((s) => s.date);

  const [selectedDate, setSelectedDate]     = useState<string | null>(null);
  const [selectedVenue, setSelectedVenue]   = useState<string | null>(null);
  const [selectedRaceId, setSelectedRaceId] = useState<string | null>(null);
  const [fetchingRaceId, setFetchingRaceId] = useState<string | null>(null);

  // スケジュール取得後、初回のみデフォルト日付を設定
  // - 本日に開催がある → 本日
  // - ない → 直近の未来の開催日、なければ直近の過去の開催日
  const initialDateSetRef = useRef(false);
  useEffect(() => {
    if (isLoading || availableDates.length === 0 || initialDateSetRef.current) return;
    initialDateSetRef.current = true;

    const today = getTodayStr();
    if (availableDates.includes(today)) {
      setSelectedDate(today);
    } else {
      // 今日以降で最も近い開催日
      const futureDate = availableDates.find((d) => d > today);
      // なければ最も新しい過去の開催日
      setSelectedDate(futureDate ?? availableDates[availableDates.length - 1]);
    }
  }, [availableDates, isLoading]);

  // 日付が変わったらデフォルト競馬場を設定
  useEffect(() => {
    const day = schedule.find((s) => s.date === selectedDate);
    if (day && day.venues.length > 0 && !selectedVenue) {
      setSelectedVenue(day.venues[0].code);
    }
  }, [schedule, selectedDate, selectedVenue]);

  const handleDateChange = (date: string) => {
    setSelectedDate(date);
    setSelectedVenue(null);
    setSelectedRaceId(null);
    setFetchingRaceId(null);
  };

  const handleVenueChange = (code: string) => {
    setSelectedVenue(code);
    setSelectedRaceId(null);
    setFetchingRaceId(null);
  };

  const handleRaceClick = (raceId: string) => {
    setSelectedRaceId(raceId);
    setFetchingRaceId(raceId);
  };

  const currentDay: DaySchedule | undefined = schedule.find((s) => s.date === selectedDate);
  const currentVenue = currentDay?.venues.find((v) => v.code === selectedVenue);

  return (
    <>
      {/* shimmer + spin アニメーション CSS */}
      <style>{`
        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      {/* 日付タブ（開催ありの日のみ表示） */}
      <div style={styles.tabRow}>
        {isLoading && availableDates.length === 0
          ? [80, 90, 80].map((w, i) => <Skeleton key={i} width={`${w}px`} height="28px" />)
          : availableDates.map((d) => (
              <TabBtn key={d} label={formatDate(d)} active={selectedDate === d} onClick={() => handleDateChange(d)} />
            ))
        }
      </div>

      {error && <p style={{ color: '#e53e3e', fontSize: '0.9rem', margin: '0.5rem 0' }}>⚠ {error}</p>}

      {/* 競馬場タブ */}
      {isLoading && availableDates.length === 0 ? (
        <div style={{ ...styles.tabRow, gap: '0.5rem' }}>
          {[80, 60, 70].map((w, i) => <Skeleton key={i} width={`${w}px`} height="28px" />)}
        </div>
      ) : currentDay ? (
        <div style={styles.tabRow}>
          {currentDay.venues.map((v) => (
            <TabBtn key={v.code} label={v.name} active={selectedVenue === v.code} onClick={() => handleVenueChange(v.code)} />
          ))}
        </div>
      ) : null}

      {/* レース一覧 */}
      {isLoading && availableDates.length === 0 ? (
        <div style={styles.raceList}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', padding: '0.55rem 0' }}>
              <Skeleton width="2.2rem" height="18px" />
              <Skeleton width="3rem" height="18px" />
              <Skeleton width="8rem" height="18px" />
            </div>
          ))}
        </div>
      ) : currentVenue ? (
        <div style={styles.raceList}>
          {currentVenue.races.map((r) => (
            <RaceItem
              key={r.raceId}
              {...r}
              selected={selectedRaceId === r.raceId}
              onClick={() => handleRaceClick(r.raceId)}
            />
          ))}
        </div>
      ) : !isLoading && availableDates.length === 0 ? (
        <p style={{ color: '#888', fontSize: '0.9rem', padding: '1rem 0' }}>
          前後7日以内の開催はありません
        </p>
      ) : (
        <p style={{ color: '#888', fontSize: '0.9rem', padding: '1rem 0' }}>
          競馬場を選択してください
        </p>
      )}

      {/* レースデータ取得（選択時） */}
      {fetchingRaceId && (
        <RaceFetcher
          key={fetchingRaceId}
          raceId={fetchingRaceId}
          onRaceLoaded={(race) => {
            setFetchingRaceId(null);
            onRaceLoaded(race);
          }}
        />
      )}
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  tabRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0',
    borderBottom: '1px solid #e2e8f0',
    marginBottom: '0.5rem',
  },
  raceList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.15rem',
    maxHeight: '380px',
    overflowY: 'auto',
  },
};
