// ==========================================
// 月別ROI 折れ線グラフ (純SVG, 外部依存なし)
//
// - 馬連本命 (赤) / 馬単本命 (青) / ワイド堅実 (緑) の 3 本
// - 100% 損益分岐ラインを水平破線で表示
// - 各データポイントは <circle><title> でホバー時にサンプル数等を表示
// - 親要素の幅に 100% 追従、モバイルで破綻しない
// ==========================================

import type { MonthlyEntry } from '../types';
import { TYPE_COLORS } from '../types';

type Props = { monthly: MonthlyEntry[] };

export function MonthlyROIChart({ monthly }: Props) {
  if (monthly.length === 0) {
    return (
      <section style={cardStyle}>
        <h2 style={titleStyle}>月別ROI推移</h2>
        <p style={{ color: '#64748b', fontSize: '0.75rem' }}>データなし</p>
      </section>
    );
  }

  // --- viewBox 座標系 (解像度と見栄えのバランス) ---
  const W = 640;                          // viewBox 幅
  const H = 240;                          // viewBox 高
  const PAD = { top: 14, right: 16, bottom: 28, left: 36 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  // --- Y軸スケール (0 〜 最大ROI を含むよう動的、最低 200% 保証) ---
  const allROIs = monthly.flatMap((m) => [
    m.umarenHonmei.roi,
    m.umatanHonmei.roi,
    m.wideKenjitsu.roi,
  ]);
  const rawMax = Math.max(200, ...allROIs);
  // きりのよい上限 (100の倍数に切り上げ)
  const yMax = Math.ceil(rawMax / 100) * 100;
  const yMin = 0;
  const yScale = (v: number): number => PAD.top + plotH * (1 - (v - yMin) / (yMax - yMin));
  const xScale = (i: number): number => {
    if (monthly.length === 1) return PAD.left + plotW / 2;
    return PAD.left + (plotW * i) / (monthly.length - 1);
  };

  // --- Y軸グリッド (100%刻み) ---
  const yTicks: number[] = [];
  for (let v = 0; v <= yMax; v += 100) yTicks.push(v);

  // --- 折れ線生成 ---
  const polylinePoints = (key: 'umarenHonmei' | 'umatanHonmei' | 'wideKenjitsu'): string =>
    monthly.map((m, i) => `${xScale(i)},${yScale(m[key].roi)}`).join(' ');

  // --- X軸ラベル (MM 表記) ---
  const xLabel = (m: string): string => m.split('-')[1] + '月';

  return (
    <section style={cardStyle}>
      <h2 style={titleStyle}>月別ROI推移</h2>
      <p style={{ fontSize: '0.68rem', color: '#64748b', margin: '0 0 0.4rem', lineHeight: 1.4 }}>
        損益分岐線 (100%) を基準に、3券種の月別 ROI を比較。各点は参加R数を反映 (ホバーで詳細)。
      </p>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="月別ROI推移折れ線グラフ"
        style={{ width: '100%', height: 'auto', display: 'block' }}
      >
        {/* Y軸グリッド線 + ラベル */}
        {yTicks.map((v) => (
          <g key={v}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={yScale(v)}
              y2={yScale(v)}
              stroke={v === 100 ? '#94a3b8' : '#e2e8f0'}
              strokeWidth={v === 100 ? 1.2 : 0.8}
              strokeDasharray={v === 100 ? '4 3' : ''}
            />
            <text
              x={PAD.left - 5}
              y={yScale(v) + 3}
              fontSize={10}
              fill={v === 100 ? '#475569' : '#94a3b8'}
              fontWeight={v === 100 ? 700 : 400}
              textAnchor="end"
            >
              {v}%
            </text>
          </g>
        ))}

        {/* X軸ラベル */}
        {monthly.map((m, i) => (
          <text
            key={m.month}
            x={xScale(i)}
            y={H - PAD.bottom + 14}
            fontSize={10}
            fill="#64748b"
            textAnchor="middle"
          >
            {xLabel(m.month)}
          </text>
        ))}

        {/* 折れ線 (描画順: ワイド → 馬単 → 馬連 を後から描いて前面) */}
        <polyline
          fill="none"
          stroke={TYPE_COLORS.wideKenjitsu}
          strokeWidth={1.8}
          points={polylinePoints('wideKenjitsu')}
        />
        <polyline
          fill="none"
          stroke={TYPE_COLORS.umatanHonmei}
          strokeWidth={1.8}
          points={polylinePoints('umatanHonmei')}
        />
        <polyline
          fill="none"
          stroke={TYPE_COLORS.umarenHonmei}
          strokeWidth={1.8}
          points={polylinePoints('umarenHonmei')}
        />

        {/* データポイント (ホバー時にサンプル情報) */}
        {monthly.map((m, i) => (
          <g key={`pts-${m.month}`}>
            <circle cx={xScale(i)} cy={yScale(m.umarenHonmei.roi)} r={2.8} fill={TYPE_COLORS.umarenHonmei}>
              <title>{`${m.month} 馬連本命 — ROI ${m.umarenHonmei.roi.toFixed(1)}% (参加 ${m.umarenHonmei.participated}R / 的中 ${m.umarenHonmei.hits}R, 総R ${m.samples})`}</title>
            </circle>
            <circle cx={xScale(i)} cy={yScale(m.umatanHonmei.roi)} r={2.8} fill={TYPE_COLORS.umatanHonmei}>
              <title>{`${m.month} 馬単本命 — ROI ${m.umatanHonmei.roi.toFixed(1)}% (参加 ${m.umatanHonmei.participated}R / 的中 ${m.umatanHonmei.hits}R, 総R ${m.samples})`}</title>
            </circle>
            <circle cx={xScale(i)} cy={yScale(m.wideKenjitsu.roi)} r={2.8} fill={TYPE_COLORS.wideKenjitsu}>
              <title>{`${m.month} ワイド堅実 — ROI ${m.wideKenjitsu.roi.toFixed(1)}% (参加 ${m.wideKenjitsu.participated}R / 的中 ${m.wideKenjitsu.hits}R, 総R ${m.samples})`}</title>
            </circle>
          </g>
        ))}
      </svg>

      {/* 凡例 */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '0.6rem',
        marginTop: '0.35rem',
        fontSize: '0.68rem',
      }}>
        <Legend color={TYPE_COLORS.umarenHonmei} label="馬連本命" />
        <Legend color={TYPE_COLORS.umatanHonmei} label="馬単本命" />
        <Legend color={TYPE_COLORS.wideKenjitsu} label="ワイド堅実" />
        <Legend color="#94a3b8" label="損益分岐 (100%)" dashed />
      </div>
    </section>
  );
}

function Legend({ color, label, dashed = false }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', color: '#334155' }}>
      <span
        style={{
          display: 'inline-block',
          width: '1.5rem',
          height: '2px',
          background: dashed ? `repeating-linear-gradient(90deg, ${color} 0 4px, transparent 4px 7px)` : color,
        }}
      />
      {label}
    </span>
  );
}

const cardStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: '6px',
  padding: '0.6rem',
  marginBottom: '0.8rem',
};

const titleStyle: React.CSSProperties = {
  margin: '0 0 0.25rem',
  fontSize: '0.88rem',
  fontWeight: 800,
  color: '#1a365d',
};
