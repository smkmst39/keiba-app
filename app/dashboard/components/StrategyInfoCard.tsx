// ==========================================
// 戦略情報カード
// Phase 2G ハイブリッドの除外ルールを表形式で表示
// ==========================================

import type { DashboardData } from '../types';

type Props = { strategy: DashboardData['strategy'] };

function ruleIcon(action: string): { icon: string; color: string } {
  if (action === 'skip') return { icon: '✗', color: '#c05621' };
  return { icon: '✓', color: '#276749' };
}

export function StrategyInfoCard({ strategy }: Props) {
  return (
    <section style={{
      background: '#fff',
      border: '1px solid #e2e8f0',
      borderRadius: '6px',
      padding: '0.6rem',
      marginBottom: '0.8rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem', flexWrap: 'wrap', marginBottom: '0.3rem' }}>
        <h2 style={{ margin: 0, fontSize: '0.88rem', fontWeight: 800, color: '#1a365d' }}>
          戦略: {strategy.name}
        </h2>
        <span style={{ fontSize: '0.68rem', color: '#64748b' }}>
          {strategy.description}
        </span>
      </div>

      <table style={{
        width: '100%',
        borderCollapse: 'collapse',
        tableLayout: 'fixed',
        fontSize: '0.72rem',
      }}>
        <colgroup>
          <col style={{ width: '40%' }} />
          <col style={{ width: '20%' }} />
          <col style={{ width: '20%' }} />
          <col style={{ width: '20%' }} />
        </colgroup>
        <thead>
          <tr style={{ background: '#f1f5f9' }}>
            <th style={thStyle}>クラス</th>
            <th style={{ ...thStyle, textAlign: 'center' }}>馬連</th>
            <th style={{ ...thStyle, textAlign: 'center' }}>馬単</th>
            <th style={{ ...thStyle, textAlign: 'center' }}>ワイド</th>
          </tr>
        </thead>
        <tbody>
          {strategy.rules.map((r) => {
            const iu = ruleIcon(r.umaren);
            const it = ruleIcon(r.umatan);
            const iw = ruleIcon(r.wide);
            return (
              <tr key={r.class} style={{ borderBottom: '1px solid #e2e8f0' }}>
                <td style={tdStyle}>{r.class}</td>
                <td style={{ ...tdStyle, textAlign: 'center', color: iu.color, fontWeight: 700 }}>
                  <span title={r.umaren}>{iu.icon}</span>
                </td>
                <td style={{ ...tdStyle, textAlign: 'center', color: it.color, fontWeight: 700 }}>
                  <span title={r.umatan}>{it.icon}</span>
                </td>
                <td style={{ ...tdStyle, textAlign: 'center', color: iw.color, fontWeight: 700 }}>
                  <span title={r.wide}>{iw.icon}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div style={{
        marginTop: '0.35rem',
        padding: '0.3rem 0.45rem',
        background: '#f0fdf4',
        border: '1px solid #bbf7d0',
        borderRadius: '4px',
        fontSize: '0.65rem',
        color: '#14532d',
        lineHeight: 1.45,
      }}>
        ✅ {strategy.verificationSummary}
      </div>

      <div style={{ fontSize: '0.6rem', color: '#94a3b8', marginTop: '0.3rem', lineHeight: 1.4 }}>
        ✓ = 参加 / ✗ = skip (除外)
        &ensp;詳細は後日「戦略透明化」フェーズで可視化予定
      </div>
    </section>
  );
}

const thStyle: React.CSSProperties = {
  padding: '0.25rem 0.4rem',
  textAlign: 'left',
  fontWeight: 700,
  fontSize: '0.68rem',
  color: '#475569',
};

const tdStyle: React.CSSProperties = {
  padding: '0.3rem 0.4rem',
  verticalAlign: 'middle',
  fontSize: '0.72rem',
  color: '#1e293b',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};
