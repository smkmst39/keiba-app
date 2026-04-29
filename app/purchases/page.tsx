'use client';

// ==========================================
// /purchases — 購入予定/購入済 一覧 (フェーズA 拡張)
//
// localStorage の keiba-purchase-status-v1 を直接表示する画面。
// useSyncExternalStore で localStorage 変更を即時反映、削除/編集も可能。
//
// 実装外 (フェーズB/C):
//   - 的中・払戻入力、JSON アーカイブ、月別/券種別の高度集計
// ==========================================

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  removePurchaseEntry,
  recordPurchaseResult,
  clearPurchaseResult,
  bulkRecordRaceResults,
  getOverallROI,
  getPurchaseStore,
  type PurchaseEntry,
  type RacePurchaseData,
  type TicketType,
} from '@/lib/purchaseStore';
import { usePurchaseStore } from '@/lib/hooks/usePurchaseStatus';
import { promptRecordResult } from '@/app/components/PurchaseCheckbox';

// raceId 5-6桁目 → 競馬場 (lib/scraper/CLAUDE.md と同期)
const COURSE_MAP: Record<string, string> = {
  '01': '札幌', '02': '函館', '03': '福島', '04': '新潟', '05': '東京',
  '06': '中山', '07': '中京', '08': '京都', '09': '阪神', '10': '小倉',
};

const TICKET_LABEL: Record<TicketType, string> = {
  tan: '単勝', fuku: '複勝', uren: '馬連', utan: '馬単',
  wide: 'ワイド', sanpuku: '三連複', santan: '三連単', wakuren: '枠連',
};

const TICKET_COLOR: Record<TicketType, string> = {
  tan: '#0369a1', fuku: '#475569', uren: '#b45309', utan: '#c2410c',
  wide: '#0e7490', sanpuku: '#7c3aed', santan: '#a21caf', wakuren: '#65a30d',
};

function decodeRaceId(raceId: string): { year: string; venue: string; raceNum: string; pretty: string } {
  if (raceId.length !== 12) return { year: '', venue: '不明', raceNum: '', pretty: raceId };
  const year   = raceId.slice(0, 4);
  const code   = raceId.slice(4, 6);
  const kaisai = raceId.slice(6, 8);
  const day    = raceId.slice(8, 10);
  const r      = String(Number(raceId.slice(10, 12)));
  const venue  = COURSE_MAP[code] ?? '不明';
  return {
    year, venue, raceNum: `${r}R`,
    pretty: `${year} ${venue} ${r}R (${Number(kaisai)}回${Number(day)}日目)`,
  };
}

function formatDate(iso?: string): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('ja-JP', {
      month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
      timeZone: 'Asia/Tokyo',
    });
  } catch {
    return '—';
  }
}

// ----------------------------------------
// フィルタ
// ----------------------------------------
type StatusFilter = 'all' | 'planned' | 'purchased';
type TypeFilter = 'all' | TicketType;
type ResultFilter = 'all' | 'pending' | 'hit' | 'miss';

function passFilter(e: PurchaseEntry, sf: StatusFilter, tf: TypeFilter, rf: ResultFilter): boolean {
  if (sf !== 'all' && e.status !== sf) return false;
  if (tf !== 'all' && e.ticketType !== tf) return false;
  if (rf !== 'all') {
    if (e.status !== 'purchased') return false; // 結果は purchased のみ
    if (rf === 'pending') return e.result == null;
    if (rf === 'hit')     return e.result?.hit === true;
    if (rf === 'miss')    return e.result?.hit === false;
  }
  return true;
}

// ----------------------------------------
// メイン
// ----------------------------------------

export default function PurchasesPage() {
  const store = usePurchaseStore();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [typeFilter,   setTypeFilter]   = useState<TypeFilter>('all');
  const [resultFilter, setResultFilter] = useState<ResultFilter>('all');

  const allRaces: RacePurchaseData[] = useMemo(
    () => Object.values(store.races).sort((a, b) => b.raceId.localeCompare(a.raceId)),
    [store.races],
  );

  // フィルタ適用後のレース別集計
  const filteredRaces = useMemo(() => {
    return allRaces
      .map((r) => ({ ...r, entries: r.entries.filter((e) => passFilter(e, statusFilter, typeFilter, resultFilter)) }))
      .filter((r) => r.entries.length > 0);
  }, [allRaces, statusFilter, typeFilter, resultFilter]);

  // サマリ (フィルタは未適用、全体集計)
  const summary = useMemo(() => {
    let totalAmount = 0;
    let plannedCount = 0;
    let purchasedCount = 0;
    const byType = new Map<TicketType, number>();
    for (const race of allRaces) {
      for (const e of race.entries) {
        if (e.status === 'purchased') {
          purchasedCount++;
          totalAmount += e.amount ?? 0;
        } else {
          plannedCount++;
        }
        byType.set(e.ticketType, (byType.get(e.ticketType) ?? 0) + 1);
      }
    }
    return {
      totalAmount,
      plannedCount,
      purchasedCount,
      raceCount: allRaces.length,
      entryCount: plannedCount + purchasedCount,
      byType,
    };
  }, [allRaces]);

  // ROI サマリ (購読再計算は store 変更で自動)
  const roi = useMemo(() => {
    // store を依存に入れて再計算
    void store;
    return getOverallROI();
  }, [store]);

  const recordedCount = roi.hitCount + roi.missCount;
  const progressPct = roi.purchasedCount > 0
    ? (recordedCount / roi.purchasedCount) * 100
    : 0;

  // JSON エクスポート
  const handleExport = () => {
    if (typeof window === 'undefined') return;
    const data = getPurchaseStore();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mi = String(now.getMinutes()).padStart(2, '0');
    const filename = `purchase-history-${yyyy}${mm}${dd}-${hh}${mi}.json`;
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <main style={styles.main}>
      <nav style={styles.nav}>
        <Link href="/" style={styles.navLink}>← 予想ツール</Link>
        <Link href="/dashboard" style={styles.navLink}>📊 ダッシュボード</Link>
      </nav>

      <header style={styles.header}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap' }}>
          <h1 style={styles.title}>📒 購入記録</h1>
          <button
            type="button"
            onClick={handleExport}
            style={{
              marginLeft: 'auto',
              fontSize: '0.7rem',
              padding: '0.25rem 0.55rem',
              border: '1px solid #2563eb',
              borderRadius: '4px',
              background: '#fff',
              color: '#2563eb',
              fontWeight: 700,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
            aria-label="購入記録 JSON をダウンロード"
          >
            📥 JSONエクスポート
          </button>
        </div>
        <p style={styles.subtitle}>
          手動チェック機能で記録した「購入予定 / 購入済 / 結果」一覧 ({summary.raceCount}R / {summary.entryCount}件)
        </p>
      </header>

      {/* サマリ */}
      <section style={card}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(5.5rem, 1fr))',
          gap: '0.3rem',
        }}>
          <Tile label="合計購入額" value={`¥${roi.totalSpent.toLocaleString()}`} color="#065f46" />
          <Tile label="合計払戻"   value={`¥${roi.totalPayout.toLocaleString()}`} color="#0369a1" />
          <Tile
            label="ROI"
            value={recordedCount > 0 ? `${roi.roi.toFixed(1)}%` : '—'}
            color={roi.roi >= 100 ? '#065f46' : roi.roi >= 50 ? '#92400e' : '#7f1d1d'}
          />
          <Tile label="🎯 的中"    value={`${roi.hitCount}件`} color="#b45309" />
          <Tile label="❌ 不的中"  value={`${roi.missCount}件`} color="#7f1d1d" />
          <Tile label="⏳ 未記録"  value={`${roi.pendingCount}件`} color="#475569" />
          <Tile label="購入レース" value={`${summary.raceCount}R`} color="#1a365d" />
          <Tile label="📝 予定"    value={`${summary.plannedCount}件`} color="#92400e" />
        </div>

        {/* 結果記録 進捗バー */}
        {roi.purchasedCount > 0 && (
          <div style={{ marginTop: '0.4rem' }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '0.62rem',
              color: '#64748b',
              marginBottom: '0.15rem',
            }}>
              <span>結果記録の進捗</span>
              <span>{recordedCount}/{roi.purchasedCount} ({progressPct.toFixed(0)}%)</span>
            </div>
            <div style={{
              height: '6px',
              background: '#e2e8f0',
              borderRadius: '3px',
              overflow: 'hidden',
            }}>
              <div style={{
                width: `${progressPct}%`,
                height: '100%',
                background: progressPct >= 100 ? '#065f46' : '#3b82f6',
                transition: 'width 0.2s',
              }} />
            </div>
          </div>
        )}

        {summary.byType.size > 0 && (
          <div style={{
            marginTop: '0.4rem',
            paddingTop: '0.35rem',
            borderTop: '1px dashed #e2e8f0',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.35rem',
            fontSize: '0.7rem',
          }}>
            <span style={{ color: '#64748b', fontWeight: 700 }}>券種別:</span>
            {Array.from(summary.byType.entries()).map(([t, n]) => (
              <span
                key={t}
                style={{
                  padding: '0.05rem 0.35rem',
                  borderRadius: '3px',
                  background: '#f8fafc',
                  border: `1px solid ${TICKET_COLOR[t]}40`,
                  color: TICKET_COLOR[t],
                  fontWeight: 700,
                }}
              >
                {TICKET_LABEL[t]} {n}
              </span>
            ))}
          </div>
        )}
      </section>

      {/* フィルタ */}
      <section style={card}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem 0.5rem', alignItems: 'center', fontSize: '0.72rem' }}>
          <span style={{ color: '#64748b', fontWeight: 700 }}>状態:</span>
          {(['all', 'planned', 'purchased'] as StatusFilter[]).map((s) => (
            <FilterBtn
              key={s}
              active={statusFilter === s}
              onClick={() => setStatusFilter(s)}
              label={s === 'all' ? '全て' : s === 'planned' ? '📝 予定' : '💰 購入済'}
            />
          ))}
          <span style={{ color: '#64748b', fontWeight: 700, marginLeft: '0.35rem' }}>結果:</span>
          {(['all', 'pending', 'hit', 'miss'] as ResultFilter[]).map((r) => (
            <FilterBtn
              key={r}
              active={resultFilter === r}
              onClick={() => setResultFilter(r)}
              label={r === 'all' ? '全て' : r === 'pending' ? '⏳未記録' : r === 'hit' ? '🎯的中' : '❌不的中'}
            />
          ))}
          <span style={{ color: '#64748b', fontWeight: 700, marginLeft: '0.35rem' }}>券種:</span>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
            style={{
              fontSize: '0.72rem',
              padding: '0.2rem 0.4rem',
              border: '1px solid #cbd5e1',
              borderRadius: '3px',
              background: '#fff',
            }}
          >
            <option value="all">全て</option>
            {(Object.keys(TICKET_LABEL) as TicketType[]).map((t) => (
              <option key={t} value={t}>{TICKET_LABEL[t]}</option>
            ))}
          </select>
        </div>
      </section>

      {/* レース別一覧 */}
      {filteredRaces.length === 0 ? (
        <section style={{ ...card, textAlign: 'center', color: '#64748b', fontSize: '0.85rem', padding: '1.5rem' }}>
          {allRaces.length === 0
            ? '購入記録はまだありません。レース詳細画面で「+ 予定」または「💰 購入」をタップして記録してください。'
            : '条件に一致する記録がありません。フィルタを変更してください。'}
        </section>
      ) : (
        filteredRaces.map((race) => (
          <RaceBlock key={race.raceId} race={race} />
        ))
      )}

      <footer style={styles.footer}>
        <p style={{ margin: 0 }}>
          ※ localStorage に記録、ブラウザ単位で管理されます。フェーズB で JSON アーカイブを実装予定。
        </p>
      </footer>
    </main>
  );
}

// ----------------------------------------
// レースブロック (一括ハズレボタン付き)
// ----------------------------------------
function RaceBlock({ race }: { race: RacePurchaseData }) {
  const dec = decodeRaceId(race.raceId);

  // 結果未記録 purchased エントリの券種別カウント (一括ハズレボタン用)
  const pendingByType = new Map<TicketType, number>();
  for (const e of race.entries) {
    if (e.status === 'purchased' && !e.result) {
      pendingByType.set(e.ticketType, (pendingByType.get(e.ticketType) ?? 0) + 1);
    }
  }

  const handleBulkMiss = (ticketType: TicketType, count: number) => {
    if (typeof window === 'undefined') return;
    if (!window.confirm(
      `${dec.venue} ${dec.raceNum} の${TICKET_LABEL[ticketType]} 結果未記録 ${count}件を全てハズレにしますか?`,
    )) return;
    const recorded = bulkRecordRaceResults(race.raceId, ticketType, false);
    if (typeof window !== 'undefined') {
      window.alert(`${recorded}件をハズレ記録しました`);
    }
  };

  return (
    <section style={card}>
      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: '0.35rem',
        flexWrap: 'wrap',
        marginBottom: '0.35rem',
        paddingBottom: '0.25rem',
        borderBottom: '1px solid #e2e8f0',
      }}>
        <span style={{ fontWeight: 800, fontSize: '0.88rem', color: '#1a365d' }}>
          {dec.venue} {dec.raceNum}
        </span>
        <span style={{ fontSize: '0.65rem', color: '#94a3b8' }}>
          {dec.year} ({race.raceId})
        </span>
        <span style={{
          marginLeft: 'auto',
          fontSize: '0.65rem',
          color: '#64748b',
          fontWeight: 700,
        }}>
          {race.entries.length}件
        </span>
      </div>

      {/* 一括ハズレボタン (券種別、未記録 ≥ 1 件のみ) */}
      {pendingByType.size > 0 && (
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.25rem',
          marginBottom: '0.3rem',
          fontSize: '0.65rem',
          alignItems: 'center',
        }}>
          <span style={{ color: '#64748b', fontWeight: 700 }}>一括ハズレ:</span>
          {Array.from(pendingByType.entries()).map(([t, n]) => (
            <button
              key={t}
              type="button"
              onClick={() => handleBulkMiss(t, n)}
              style={{
                padding: '0.12rem 0.4rem',
                border: '1px solid #fca5a5',
                borderRadius: '3px',
                background: '#fff5f5',
                color: '#7f1d1d',
                fontWeight: 700,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              ❌ {TICKET_LABEL[t]} {n}件
            </button>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
        {race.entries.map((e, idx) => (
          <EntryRow
            key={`${e.ticketType}-${e.combination}-${idx}`}
            raceId={race.raceId}
            entry={e}
            entryIndex={idx}
          />
        ))}
      </div>
    </section>
  );
}

function EntryRow({
  raceId, entry, entryIndex,
}: {
  raceId: string;
  entry: PurchaseEntry;
  entryIndex: number;
}) {
  const isPurchased = entry.status === 'purchased';
  const color = TICKET_COLOR[entry.ticketType];
  const dt = formatDate(entry.purchasedAt ?? entry.plannedAt);
  const result = entry.result;

  // 結果状態 → 行背景色
  const rowBg =
    result?.hit ? '#fef3c7' :     // 的中: 金
    result && !result.hit ? '#fee2e2' :  // 不的中: 赤
    isPurchased ? '#f0fdf4' :     // 購入済 (未記録): 緑
    '#fffbeb';                     // 予定: 橙

  const handleRecord = () => {
    if (!isPurchased) return;
    const r = promptRecordResult(entry.result);
    if (!r) return;
    recordPurchaseResult(raceId, entryIndex, r);
  };

  const handleClearResult = () => {
    if (typeof window === 'undefined') return;
    if (!window.confirm('結果記録を取り消しますか？')) return;
    clearPurchaseResult(raceId, entryIndex);
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.35rem',
        padding: '0.3rem 0.4rem',
        borderLeft: `4px solid ${color}`,
        background: rowBg,
        borderRadius: '3px',
        minWidth: 0,
        flexWrap: 'wrap',
      }}
    >
      {/* 状態 */}
      <span
        style={{
          fontSize: '0.7rem',
          padding: '0.05rem 0.3rem',
          borderRadius: '3px',
          background: isPurchased ? '#065f46' : '#92400e',
          color: '#fff',
          fontWeight: 700,
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
        aria-label={isPurchased ? '購入済' : '購入予定'}
      >
        {isPurchased ? '💰' : '📝'}
      </span>

      {/* 券種 */}
      <span
        style={{
          fontSize: '0.7rem',
          fontWeight: 700,
          color,
          minWidth: '2.6rem',
          flexShrink: 0,
        }}
      >
        {TICKET_LABEL[entry.ticketType]}
      </span>

      {/* 買い目 */}
      <span
        style={{
          fontSize: '0.78rem',
          fontWeight: 700,
          color: '#1e293b',
          flex: '1 1 5rem',
          minWidth: 0,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {entry.combination}
      </span>

      {/* 金額 */}
      {isPurchased && (
        <span
          style={{
            fontSize: '0.74rem',
            fontWeight: 800,
            color: '#065f46',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          ¥{(entry.amount ?? 0).toLocaleString()}
        </span>
      )}

      {/* 結果バッジ + 操作 (purchased のみ) */}
      {isPurchased && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', flexShrink: 0 }}>
          {result == null ? (
            <>
              <span style={{
                fontSize: '0.62rem',
                padding: '0.05rem 0.3rem',
                borderRadius: '3px',
                background: '#475569',
                color: '#fff',
                fontWeight: 700,
                whiteSpace: 'nowrap',
              }}>⏳ 未記録</span>
              <button
                type="button"
                onClick={handleRecord}
                style={{ ...resultBtnStyle, color: '#1d4ed8', borderColor: '#93c5fd' }}
              >
                📊 結果
              </button>
            </>
          ) : result.hit ? (
            <>
              <span style={{
                fontSize: '0.62rem',
                padding: '0.05rem 0.3rem',
                borderRadius: '3px',
                background: '#b45309',
                color: '#fff',
                fontWeight: 700,
                whiteSpace: 'nowrap',
              }}>🎯 ¥{result.payout.toLocaleString()}</span>
              <button type="button" onClick={handleRecord} style={resultBtnStyle}>編集</button>
              <button type="button" onClick={handleClearResult}
                style={{ ...resultBtnStyle, color: '#991b1b', borderColor: '#fca5a5' }}>✕</button>
            </>
          ) : (
            <>
              <span style={{
                fontSize: '0.62rem',
                padding: '0.05rem 0.3rem',
                borderRadius: '3px',
                background: '#7f1d1d',
                color: '#fff',
                fontWeight: 700,
                whiteSpace: 'nowrap',
              }}>❌ 外れ</span>
              <button type="button" onClick={handleRecord} style={resultBtnStyle}>編集</button>
              <button type="button" onClick={handleClearResult}
                style={{ ...resultBtnStyle, color: '#991b1b', borderColor: '#fca5a5' }}>✕</button>
            </>
          )}
        </span>
      )}

      {/* 日時 */}
      <span
        style={{
          fontSize: '0.6rem',
          color: '#64748b',
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
      >
        {dt}
      </span>

      {/* 削除 */}
      <button
        type="button"
        onClick={() => {
          if (typeof window !== 'undefined' && window.confirm(`このエントリを削除しますか？\n${TICKET_LABEL[entry.ticketType]} ${entry.combination}`)) {
            removePurchaseEntry(raceId, entryIndex);
          }
        }}
        aria-label="エントリを削除"
        title="削除"
        style={{
          fontSize: '0.65rem',
          color: '#991b1b',
          background: '#fff',
          border: '1px solid #fca5a5',
          borderRadius: '3px',
          padding: '0.05rem 0.3rem',
          cursor: 'pointer',
          flexShrink: 0,
          lineHeight: 1.2,
        }}
      >
        ✕
      </button>
    </div>
  );
}

const resultBtnStyle: React.CSSProperties = {
  fontSize: '0.6rem',
  color: '#475569',
  background: '#fff',
  border: '1px solid #cbd5e1',
  borderRadius: '3px',
  padding: '0.05rem 0.3rem',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  lineHeight: 1.2,
};

// ----------------------------------------
// 共通サブコンポーネント
// ----------------------------------------
function Tile({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderLeft: `4px solid ${color}`,
        borderRadius: '5px',
        padding: '0.35rem 0.5rem',
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontSize: '0.62rem',
          color: '#64748b',
          fontWeight: 700,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: '0.95rem',
          fontWeight: 800,
          color,
          marginTop: '0.1rem',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {value}
      </div>
    </div>
  );
}

function FilterBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontSize: '0.7rem',
        padding: '0.2rem 0.5rem',
        border: `1px solid ${active ? '#2b6cb0' : '#cbd5e1'}`,
        borderRadius: '3px',
        background: active ? '#ebf8ff' : '#fff',
        color: active ? '#2b6cb0' : '#475569',
        fontWeight: active ? 700 : 400,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

// ----------------------------------------
// スタイル
// ----------------------------------------
const card: React.CSSProperties = {
  background: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: '6px',
  padding: '0.5rem 0.55rem',
  marginBottom: '0.5rem',
};

const styles: Record<string, React.CSSProperties> = {
  main: {
    maxWidth: '900px',
    margin: '0 auto',
    padding: '0.75rem 0.6rem',
    fontFamily: "'Helvetica Neue', Arial, 'Hiragino Kaku Gothic ProN', sans-serif",
  },
  nav: {
    display: 'flex',
    gap: '0.6rem',
    marginBottom: '0.4rem',
    fontSize: '0.72rem',
    flexWrap: 'wrap',
  },
  navLink: {
    color: '#2b6cb0',
    textDecoration: 'none',
    fontWeight: 700,
  },
  header: { marginBottom: '0.5rem' },
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
  footer: {
    marginTop: '0.8rem',
    padding: '0.4rem 0',
    borderTop: '1px solid #e2e8f0',
    fontSize: '0.62rem',
    color: '#94a3b8',
    textAlign: 'center',
  },
};
