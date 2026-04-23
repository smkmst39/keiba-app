// ==========================================
// 券種別詳細カード 3枚
// 馬連本命 / 馬単本命 / ワイド堅実 の詳細指標を Grid 配置
// ==========================================

import type { DashboardData, TypeDetail } from '../types';
import { TYPE_COLORS } from '../types';

type Props = { byType: DashboardData['byType'] };

function DetailCard({ type, detail }: { type: keyof typeof TYPE_COLORS; detail: TypeDetail }) {
  const color = TYPE_COLORS[type];
  return (
    <article style={{
      background: '#fff',
      border: `1px solid #e2e8f0`,
      borderLeft: `5px solid ${color}`,
      borderRadius: '6px',
      padding: '0.6rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', marginBottom: '0.3rem', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: '0.88rem', fontWeight: 800, color }}>{detail.label}</h3>
        <span style={{
          fontSize: '1.05rem',
          fontWeight: 800,
          color,
          marginLeft: 'auto',
        }}>{detail.roi.toFixed(1)}%</span>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: '0.3rem 0.5rem',
        fontSize: '0.7rem',
      }}>
        <Row label="参加R" value={`${detail.joinedRaces} / ${detail.totalRaces}R`} />
        <Row label="的中率" value={`${detail.hitRate.toFixed(1)}% (${detail.hits}R)`} />
        <Row label="回収率" value={`${detail.recoveryRate.toFixed(1)}%`} />
        <Row label="月別CV" value={detail.monthlyCV.toFixed(3)} accent={detail.monthlyCV > 1.0 ? '#b45309' : '#334155'} />
        <Row
          label="最良月"
          value={detail.bestMonth ? `${detail.bestMonth.month} (${detail.bestMonth.roi.toFixed(0)}%)` : '—'}
          accent="#276749"
        />
        <Row
          label="最悪月"
          value={detail.worstMonth ? `${detail.worstMonth.month} (${detail.worstMonth.roi.toFixed(0)}%)` : '—'}
          accent="#c05621"
        />
      </div>

      <div style={{
        marginTop: '0.4rem',
        paddingTop: '0.3rem',
        borderTop: '1px dashed #e2e8f0',
        fontSize: '0.62rem',
        color: '#64748b',
        lineHeight: 1.45,
      }}>
        <strong style={{ color: '#334155' }}>条件:</strong> {detail.condition} ・ {detail.costPerRace}円/R
      </div>
    </article>
  );
}

function Row({ label, value, accent = '#334155' }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.3rem', minWidth: 0 }}>
      <span style={{ color: '#64748b', fontWeight: 600, flexShrink: 0 }}>{label}</span>
      <span style={{
        color: accent,
        fontWeight: 700,
        textAlign: 'right',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}>{value}</span>
    </div>
  );
}

export function TypeDetailCards({ byType }: Props) {
  return (
    <section style={{ marginBottom: '0.8rem' }}>
      <h2 style={{ margin: '0 0 0.35rem', fontSize: '0.88rem', fontWeight: 800, color: '#1a365d' }}>
        券種別 詳細
      </h2>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(15rem, 1fr))',
        gap: '0.4rem',
      }}>
        <DetailCard type="umarenHonmei" detail={byType.umarenHonmei} />
        <DetailCard type="umatanHonmei" detail={byType.umatanHonmei} />
        <DetailCard type="wideKenjitsu" detail={byType.wideKenjitsu} />
      </div>
    </section>
  );
}
