// ==========================================
// /dashboard — 過去実績ダッシュボード (フェーズ1)
//
// public/dashboard-data.json を server 側で読み込み、
// SummarySection / MonthlyROIChart / TypeDetailCards / StrategyInfoCard
// の 4 コンポーネントで構成する。
//
// データ更新: `pnpm tsx scripts/build_dashboard_data.ts` を実行
// (週次スクレイプ後に手動実行、将来は Actions で自動化)
// ==========================================

import { promises as fs } from 'node:fs';
import path from 'node:path';
import Link from 'next/link';
import type { Metadata } from 'next';

import type { DashboardData } from './types';
import { SummarySection } from './components/SummarySection';
import { MonthlyROIChart } from './components/MonthlyROIChart';
import { TypeDetailCards } from './components/TypeDetailCards';
import { StrategyInfoCard } from './components/StrategyInfoCard';

export const metadata: Metadata = {
  title: '過去実績ダッシュボード | 競馬予想ツール',
  description: 'Phase 2G ハイブリッド戦略の 3233R バックテスト結果・月別ROI推移',
};

// ISR: 再ビルドせずデータ更新を反映 (revalidate: 60秒)
export const revalidate = 60;

async function loadData(): Promise<DashboardData | null> {
  try {
    const raw = await fs.readFile(
      path.resolve(process.cwd(), 'public', 'dashboard-data.json'),
      'utf-8',
    );
    return JSON.parse(raw) as DashboardData;
  } catch {
    return null;
  }
}

export default async function DashboardPage() {
  const data = await loadData();

  if (!data) {
    return (
      <main style={styles.main}>
        <Nav />
        <div style={styles.emptyCard}>
          <h1 style={styles.title}>📊 ダッシュボード</h1>
          <p>
            データが見つかりません。以下を実行してください:<br />
            <code style={{ background: '#f1f5f9', padding: '0.15rem 0.35rem', borderRadius: '3px' }}>
              pnpm tsx scripts/build_dashboard_data.ts
            </code>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main style={styles.main}>
      <Nav />
      <header style={styles.header}>
        <h1 style={styles.title}>📊 過去実績ダッシュボード</h1>
        <p style={styles.subtitle}>
          Phase 2G ハイブリッド戦略のバックテスト実績 — 週次スクレイプで継続拡大中
        </p>
      </header>

      <SummarySection summary={data.summary} generatedAt={data.generatedAt} />
      <MonthlyROIChart monthly={data.monthly} />
      <TypeDetailCards byType={data.byType} />
      <StrategyInfoCard strategy={data.strategy} />

      <footer style={styles.footer}>
        <p style={{ margin: 0 }}>
          ※ 本ダッシュボードは独自スコア × 期待値の参考情報です。
          将来の的中・回収を保証するものではありません。
        </p>
      </footer>
    </main>
  );
}

function Nav() {
  return (
    <nav style={styles.nav}>
      <Link href="/" style={styles.navLink}>← 予想ツールに戻る</Link>
    </nav>
  );
}

const styles: Record<string, React.CSSProperties> = {
  main: {
    maxWidth: '900px',
    margin: '0 auto',
    padding: '0.75rem 0.6rem',
    fontFamily: "'Helvetica Neue', Arial, 'Hiragino Kaku Gothic ProN', sans-serif",
  },
  nav: {
    marginBottom: '0.4rem',
    fontSize: '0.72rem',
  },
  navLink: {
    color: '#2b6cb0',
    textDecoration: 'none',
    fontWeight: 700,
  },
  header: {
    marginBottom: '0.6rem',
  },
  title: {
    fontSize: '1.1rem',
    margin: '0 0 0.15rem',
    color: '#1a365d',
    fontWeight: 800,
  },
  subtitle: {
    color: '#64748b',
    fontSize: '0.7rem',
    margin: 0,
  },
  emptyCard: {
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: '6px',
    padding: '1.2rem',
    textAlign: 'center',
    color: '#64748b',
    fontSize: '0.85rem',
    lineHeight: 1.6,
  },
  footer: {
    marginTop: '1rem',
    padding: '0.4rem 0',
    borderTop: '1px solid #e2e8f0',
    fontSize: '0.62rem',
    color: '#94a3b8',
    textAlign: 'center',
  },
};
