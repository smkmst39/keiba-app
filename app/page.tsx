'use client';

// ==========================================
// トップページ — 馬券シミュレーター
// Phase 1-D+: レーススケジュール選択 + BakenSimulator
// ==========================================

import { useState } from 'react';
import type { Race } from '@/lib/scraper/types';
import { RaceSelector } from '@/app/components/RaceSelector';
import { BakenSimulator } from '@/app/components/BakenSimulator';

export default function Home() {
  const [race, setRace]   = useState<Race | null>(null);

  return (
    <main style={styles.main}>
      <header style={styles.header}>
        <h1 style={styles.title}>競馬予想ツール</h1>
        <p style={styles.subtitle}>
          レースを選択するとスコア・期待値が自動計算されます
        </p>
      </header>

      {/* レース選択（3階層タブ） */}
      <section style={styles.card}>
        <h2 style={styles.cardTitle}>レース選択</h2>
        <RaceSelector onRaceLoaded={setRace} />
      </section>

      {/* シミュレーター本体 */}
      {race ? (
        <section style={styles.card}>
          <BakenSimulator race={race} />
        </section>
      ) : (
        <section style={{ ...styles.card, ...styles.empty }}>
          <p>上のリストからレースを選択してください</p>
        </section>
      )}

      <footer style={styles.footer}>
        <p>
          API:{' '}
          <code>GET /api/race/[raceId]</code>
          {' '}|{' '}
          <code>GET /api/schedule?date=YYYYMMDD</code>
          {' '}|{' '}
          <a href="/api/race/202606030511" target="_blank" rel="noreferrer">モックデータ確認</a>
        </p>
      </footer>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  main: {
    maxWidth: '900px',
    margin: '0 auto',
    padding: '1.5rem 1rem',
    fontFamily: "'Helvetica Neue', Arial, 'Hiragino Kaku Gothic ProN', sans-serif",
  },
  header: { marginBottom: '1.5rem' },
  title: { fontSize: '1.8rem', margin: '0 0 0.25rem', color: '#1a202c' },
  subtitle: { color: '#555', fontSize: '0.9rem', margin: 0 },
  card: {
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: '8px',
    padding: '1.25rem',
    marginBottom: '1rem',
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
  },
  cardTitle: { fontSize: '1rem', fontWeight: 700, margin: '0 0 0.75rem', color: '#2d3748' },
  empty: { color: '#666', textAlign: 'center', padding: '2rem' },
  footer: { marginTop: '2rem', color: '#888', fontSize: '0.8rem', textAlign: 'center' },
};
