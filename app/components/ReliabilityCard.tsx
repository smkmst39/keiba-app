'use client';

// ==========================================
// 信頼度カード (予想レポート冒頭に表示)
//
// - /dashboard-data.json の byCategory から類似条件バケットを引き、
//   lib/reliability/calculator で ROI × サンプル × CV を統合判定
// - 控えめな 2 行構成、Section 5A の冒頭に配置
// - データ未取得時は描画せず (graceful degrade)
// ==========================================

import { useEffect, useState } from 'react';
import type { Race } from '@/lib/scraper/types';
import { calculateReliability, type ReliabilityInfo } from '@/lib/reliability/calculator';

type ByCategory = {
  tight:     Record<string, any>;
  medium:    Record<string, any>;
  classOnly: Record<string, any>;
};

// モジュール内キャッシュ (タブ内で再 fetch を避ける)
let cachedByCategory: ByCategory | null = null;

async function loadByCategory(): Promise<ByCategory | null> {
  if (cachedByCategory) return cachedByCategory;
  try {
    const res = await fetch('/dashboard-data.json', { cache: 'force-cache' });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json?.byCategory) return null;
    cachedByCategory = json.byCategory as ByCategory;
    return cachedByCategory;
  } catch {
    return null;
  }
}

export function ReliabilityCard({ race }: { race: Race }) {
  const [info, setInfo] = useState<ReliabilityInfo | null>(null);

  useEffect(() => {
    let active = true;
    loadByCategory().then((byCat) => {
      if (!active || !byCat) return;
      setInfo(calculateReliability(race, byCat));
    });
    return () => { active = false; };
  }, [race]);

  if (!info) return null; // データ読込中/無し: 描画しない (既存UIを邪魔しない)

  return (
    <div
      role="status"
      aria-label={`このレースの信頼度: ${info.label}`}
      style={{
        background: info.bg,
        border: `1px solid ${info.border}`,
        borderLeft: `4px solid ${info.border}`,
        borderRadius: '5px',
        padding: '0.3rem 0.45rem',
        marginBottom: '0.45rem',
        fontSize: '0.7rem',
        color: info.color,
        lineHeight: 1.4,
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.3rem',
        flexWrap: 'wrap',
      }}>
        <span style={{ fontWeight: 800, fontSize: '0.75rem' }}>
          信頼度 {info.label}
        </span>
        <span style={{ fontSize: '0.62rem', color: info.color, opacity: 0.75 }}>
          類似条件: {info.conditions.join(' ・ ')} ({info.granularity === 'tight' ? '細' : info.granularity === 'medium' ? '中' : info.granularity === 'classOnly' ? '粗' : '-'})
        </span>
      </div>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        flexWrap: 'wrap',
        marginTop: '0.1rem',
        fontSize: '0.66rem',
      }}>
        <span>
          <strong>類似R</strong> {info.similarRaceCount}
          {info.umarenParticipated > 0 && <> (推奨 {info.umarenParticipated})</>}
        </span>
        {info.umarenParticipated > 0 && (
          <>
            <span>
              <strong>馬連本命ROI</strong> {info.umarenROI.toFixed(1)}%
            </span>
            <span>
              <strong>CV</strong> {info.monthlyCV.toFixed(2)}
            </span>
          </>
        )}
      </div>
      <div style={{ fontSize: '0.64rem', opacity: 0.82, marginTop: '0.1rem', lineHeight: 1.35 }}>
        {info.comment}
      </div>
    </div>
  );
}
