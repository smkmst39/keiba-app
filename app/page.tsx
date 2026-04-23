'use client';

// ==========================================
// トップページ — 馬券シミュレーター
// Phase 1-D+: レーススケジュール選択 + BakenSimulator
// ==========================================

import { useState } from 'react';
import type { Race } from '@/lib/scraper/types';
import { RaceSelector } from '@/app/components/RaceSelector';
import { BakenSimulator } from '@/app/components/BakenSimulator';
import { RaceReport } from '@/app/components/RaceReport';
import { RaceVerification } from '@/app/components/RaceVerification';

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
        <>
          <section style={styles.card}>
            <BakenSimulator race={race} />
          </section>
          <section style={styles.card}>
            <RaceReport race={race} />
          </section>
          <section style={styles.card}>
            <RaceVerification race={race} />
          </section>
        </>
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
    padding: '0.75rem 0.6rem',
    fontFamily: "'Helvetica Neue', Arial, 'Hiragino Kaku Gothic ProN', sans-serif",
  },
  header: { marginBottom: '0.6rem' },
  title: { fontSize: '1.25rem', margin: '0 0 0.15rem', color: '#1a202c' },
  subtitle: { color: '#555', fontSize: '0.75rem', margin: 0 },
  card: {
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: '6px',
    padding: '0.6rem 0.55rem',
    marginBottom: '0.5rem',
    boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
  },
  cardTitle: { fontSize: '0.88rem', fontWeight: 700, margin: '0 0 0.4rem', color: '#2d3748' },
  empty: { color: '#666', textAlign: 'center', padding: '1.2rem' },
  footer: { marginTop: '0.8rem', color: '#888', fontSize: '0.72rem', textAlign: 'center' },
};
