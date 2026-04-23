// ==========================================
// ダッシュボード サマリーエリア
// 全体ROI、券種別、的中率、参加R数 を 6 タイル グリッド表示
// ==========================================

import type { DashboardData } from '../types';

type Props = { summary: DashboardData['summary']; generatedAt: string };

function Tile({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{
      background: '#fff',
      border: `1px solid #e2e8f0`,
      borderLeft: `4px solid ${color}`,
      borderRadius: '6px',
      padding: '0.45rem 0.6rem',
      minWidth: 0,
    }}>
      <div style={{
        fontSize: '0.65rem',
        color: '#64748b',
        fontWeight: 700,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}>{label}</div>
      <div style={{
        fontSize: '1.05rem',
        fontWeight: 800,
        color,
        marginTop: '0.15rem',
        whiteSpace: 'nowrap',
      }}>{value}</div>
    </div>
  );
}

export function SummarySection({ summary, generatedAt }: Props) {
  const pct = (n: number): string => `${n.toFixed(1)}%`;

  const genDate = new Date(generatedAt).toLocaleString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  });

  return (
    <section style={{ marginBottom: '0.8rem' }}>
      <div style={{
        background: '#f8fafc',
        border: '1px solid #e2e8f0',
        borderRadius: '6px',
        padding: '0.6rem 0.6rem 0.7rem',
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
          <h2 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 800, color: '#1a365d' }}>
            バックテスト総括
          </h2>
          <span style={{ fontSize: '0.68rem', color: '#64748b' }}>
            {summary.totalRaces.toLocaleString()}R 分析 / {summary.period.from} 〜 {summary.period.to}
          </span>
          <span style={{ fontSize: '0.6rem', color: '#94a3b8', marginLeft: 'auto' }}>
            更新: {genDate}
          </span>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(6.5rem, 1fr))',
          gap: '0.3rem',
        }}>
          <Tile label="合計pt"      value={summary.totalPt.toFixed(1)}       color="#1a365d" />
          <Tile label="馬連本命"    value={pct(summary.umarenHonmeiROI)}      color="#c05621" />
          <Tile label="馬単本命"    value={pct(summary.umatanHonmeiROI)}      color="#2b6cb0" />
          <Tile label="ワイド堅実"  value={pct(summary.wideKenjitsuROI)}      color="#276749" />
          <Tile label="総合的中率"  value={pct(summary.overallHitRate)}       color="#b45309" />
          <Tile label="馬連 参加R"  value={`${summary.joinedRacesUmaren}/${summary.totalRaces}`} color="#475569" />
        </div>
      </div>
    </section>
  );
}
