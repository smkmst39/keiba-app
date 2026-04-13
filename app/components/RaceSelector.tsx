'use client';

// ==========================================
// レース選択コンポーネント
// 通常: RaceSchedule（3階層タブUI）を表示
// 開発時のみ: raceId直接入力の折りたたみセクションを追加
// ==========================================

import { useState } from 'react';
import type { Race } from '@/lib/scraper/types';
import { RaceSchedule } from '@/app/components/RaceSchedule';
import { useRaceData } from '@/app/hooks/useRaceData';

type Props = {
  onRaceLoaded: (race: Race) => void;
};

const isDev = process.env.NODE_ENV === 'development';

/** netkeibaのraceId形式チェック（12桁数字） */
function isValidRaceId(id: string): boolean {
  return /^\d{12}$/.test(id);
}

/** 開発用: raceId直接入力パネル */
function DevDirectInput({ onRaceLoaded }: Props) {
  const [open, setOpen]         = useState(false);
  const [input, setInput]       = useState('202606030511');
  const [raceId, setRaceId]     = useState<string | null>(null);

  const { race, isLoading, error, lastUpdated, refetch } = useRaceData(raceId);
  if (race) onRaceLoaded(race);

  const handleSubmit = () => {
    const v = input.trim();
    if (!isValidRaceId(v)) return;
    v === raceId ? refetch() : setRaceId(v);
  };

  const inputInvalid = input.trim() !== '' && !isValidRaceId(input.trim());

  return (
    <div style={{ marginTop: '0.75rem', borderTop: '1px dashed #e2e8f0', paddingTop: '0.5rem' }}>
      <button
        onClick={() => setOpen((p) => !p)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888', fontSize: '0.8rem' }}
      >
        {open ? '▲' : '▼'} raceIdを直接入力（開発用）
      </button>
      {open && (
        <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              placeholder="12桁のraceId"
              maxLength={12}
              style={{
                padding: '0.4rem 0.6rem', fontSize: '0.9rem', fontFamily: 'monospace',
                border: `1px solid ${inputInvalid ? '#e53e3e' : '#ccc'}`, borderRadius: '4px', width: '200px',
              }}
            />
            <button
              onClick={handleSubmit}
              disabled={isLoading || inputInvalid || input.trim() === ''}
              style={{
                padding: '0.4rem 0.9rem', fontSize: '0.9rem',
                background: '#2b6cb0', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer',
                opacity: isLoading || inputInvalid || input.trim() === '' ? 0.5 : 1,
              }}
            >
              {isLoading ? '取得中…' : '取得'}
            </button>
          </div>
          {inputInvalid && <p style={{ color: '#e53e3e', fontSize: '0.8rem', margin: 0 }}>12桁の数字で入力してください</p>}
          {error && <p style={{ color: '#e53e3e', fontSize: '0.85rem', margin: 0 }}>⚠ {error}</p>}
          {lastUpdated && (
            <p style={{ color: '#666', fontSize: '0.8rem', margin: 0 }}>
              最終更新: {lastUpdated.toLocaleTimeString('ja-JP')}
              <button onClick={refetch} disabled={isLoading}
                style={{ marginLeft: '0.4rem', background: 'none', border: '1px solid #ccc', borderRadius: '3px', cursor: 'pointer', padding: '0 0.3rem' }}>
                ↻
              </button>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function RaceSelector({ onRaceLoaded }: Props) {
  return (
    <div>
      <RaceSchedule onRaceLoaded={onRaceLoaded} />
      {isDev && <DevDirectInput onRaceLoaded={onRaceLoaded} />}
    </div>
  );
}
