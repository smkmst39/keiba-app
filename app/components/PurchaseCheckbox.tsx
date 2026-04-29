'use client';

// ==========================================
// 買い目1点分の購入ステータスチェックUI
//
// 状態遷移:
//   none     → 「+ 予定」タップで planned
//   planned  → 「💰 購入」で金額入力 → purchased、「✕」で削除
//   purchased→ 「編集」で金額再入力、「✕」で削除
//
// 購入額入力は window.prompt() でネイティブダイアログを使用 (軽量)
// ==========================================

import { useCallback } from 'react';
import {
  planPurchase,
  markAsPurchased,
  removeByKey,
  recordPurchaseResult,
  clearPurchaseResult,
  findEntry,
  type TicketType,
  type PurchaseResult,
} from '@/lib/purchaseStore';
import { usePurchaseEntry } from '@/lib/hooks/usePurchaseStatus';

const MAX_PAYOUT = 1_000_000;

/** 払戻金額入力 (0 〜 100万円の整数) */
function promptPayout(defaultValue?: number): number | null {
  if (typeof window === 'undefined') return null;
  const raw = window.prompt(
    `払戻金額 (円) を入力 (0〜${MAX_PAYOUT.toLocaleString()})`,
    String(defaultValue ?? 0),
  );
  if (raw == null) return null;
  const n = Number(raw.replace(/[^\d]/g, ''));
  if (!Number.isFinite(n) || n < 0 || n > MAX_PAYOUT) {
    window.alert(`0〜${MAX_PAYOUT.toLocaleString()}円の範囲で入力してください`);
    return null;
  }
  return Math.floor(n);
}

/** 結果記録ダイアログ (confirm 的中? + prompt 払戻) */
export function promptRecordResult(currentResult?: PurchaseResult): PurchaseResult | null {
  if (typeof window === 'undefined') return null;
  const hit = window.confirm('的中しましたか？\n\n[OK] 的中 → 払戻金額を入力\n[キャンセル] 不的中');
  if (hit) {
    const payout = promptPayout(currentResult?.payout || 1000);
    if (payout == null || payout <= 0) {
      window.alert('的中の場合は1円以上の払戻金額を入力してください');
      return null;
    }
    return { hit: true, payout, recordedAt: new Date().toISOString() };
  }
  return { hit: false, payout: 0, recordedAt: new Date().toISOString() };
}

export type PurchaseCheckboxProps = {
  raceId: string;
  ticketType: TicketType;
  combination: string;
  /** 前回入力金額のデフォルト値 (任意) */
  defaultAmount?: number;
};

function promptAmount(defaultAmount?: number): number | null {
  if (typeof window === 'undefined') return null;
  const raw = window.prompt('購入額 (円) を入力', String(defaultAmount ?? 100));
  if (raw == null) return null;
  const n = Number(raw.replace(/[^\d]/g, ''));
  if (!Number.isFinite(n) || n <= 0) {
    window.alert('有効な金額を入力してください');
    return null;
  }
  return Math.floor(n);
}

export function PurchaseCheckbox({
  raceId,
  ticketType,
  combination,
  defaultAmount,
}: PurchaseCheckboxProps) {
  const found = usePurchaseEntry(raceId, ticketType, combination);
  const entry = found?.entry;

  const handlePlan = useCallback(() => {
    planPurchase(raceId, ticketType, combination);
  }, [raceId, ticketType, combination]);

  const handlePurchase = useCallback(() => {
    const amt = promptAmount(defaultAmount ?? entry?.amount);
    if (amt == null) return;
    markAsPurchased(raceId, ticketType, combination, amt);
  }, [raceId, ticketType, combination, defaultAmount, entry?.amount]);

  const handleRemove = useCallback(() => {
    removeByKey(raceId, ticketType, combination);
  }, [raceId, ticketType, combination]);

  const handleRecordResult = useCallback(() => {
    if (!entry) return;
    const result = promptRecordResult(entry.result);
    if (!result) return;
    const cur = findEntry(raceId, ticketType, combination);
    if (!cur) return;
    recordPurchaseResult(raceId, cur.index, result);
  }, [entry, raceId, ticketType, combination]);

  const handleClearResult = useCallback(() => {
    if (typeof window !== 'undefined' && !window.confirm('結果記録を取り消しますか？')) return;
    const cur = findEntry(raceId, ticketType, combination);
    if (!cur) return;
    clearPurchaseResult(raceId, cur.index);
  }, [raceId, ticketType, combination]);

  // --- 未登録: 「+ 予定」ボタン ---
  if (!entry) {
    return (
      <button
        type="button"
        onClick={handlePlan}
        aria-label="購入予定に追加"
        style={{
          fontSize: '0.62rem',
          color: '#475569',
          background: '#f1f5f9',
          border: '1px solid #cbd5e1',
          borderRadius: '3px',
          padding: '0.1rem 0.4rem',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          flexShrink: 0,
          lineHeight: 1.3,
        }}
      >
        + 予定
      </button>
    );
  }

  // --- planned / purchased ---
  const isPurchased = entry.status === 'purchased';
  const result = entry.result;

  return (
    <span
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: '0.15rem',
        fontSize: '0.62rem',
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      {/* === 1段目: 購入ステータス === */}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
        <span
          style={{
            padding: '0.08rem 0.3rem',
            borderRadius: '3px',
            fontWeight: 700,
            background: isPurchased ? '#065f46' : '#92400e',
            color: '#fff',
          }}
          aria-label={isPurchased ? '購入済' : '購入予定'}
        >
          {isPurchased ? `💰 ¥${(entry.amount ?? 0).toLocaleString()}` : '📝 予定'}
        </span>

        {isPurchased ? (
          <button type="button" onClick={handlePurchase} aria-label="金額を編集" style={btnStyle}>
            編集
          </button>
        ) : (
          <button
            type="button"
            onClick={handlePurchase}
            aria-label="購入済にする"
            style={{ ...btnStyle, color: '#065f46', borderColor: '#6ee7b7' }}
          >
            💰 購入
          </button>
        )}
        <button
          type="button"
          onClick={handleRemove}
          aria-label="取消"
          title="取消"
          style={{ ...btnStyle, color: '#991b1b', borderColor: '#fca5a5' }}
        >
          ✕
        </button>
      </span>

      {/* === 2段目: 結果記録 (purchased のみ) === */}
      {isPurchased && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
          {result == null ? (
            <>
              <span
                style={{
                  padding: '0.08rem 0.3rem',
                  borderRadius: '3px',
                  fontWeight: 700,
                  background: '#475569',
                  color: '#fff',
                }}
                aria-label="結果未記録"
              >
                ⏳ 未記録
              </span>
              <button
                type="button"
                onClick={handleRecordResult}
                aria-label="結果を記録"
                style={{ ...btnStyle, color: '#1d4ed8', borderColor: '#93c5fd' }}
              >
                📊 結果
              </button>
            </>
          ) : result.hit ? (
            <>
              <span
                style={{
                  padding: '0.08rem 0.3rem',
                  borderRadius: '3px',
                  fontWeight: 700,
                  background: '#b45309',
                  color: '#fff',
                }}
                aria-label="的中"
              >
                🎯 ¥{result.payout.toLocaleString()}
              </span>
              <button
                type="button"
                onClick={handleRecordResult}
                aria-label="結果を編集"
                style={btnStyle}
              >
                編集
              </button>
              <button
                type="button"
                onClick={handleClearResult}
                aria-label="結果記録を取消"
                title="結果記録を取消"
                style={{ ...btnStyle, color: '#991b1b', borderColor: '#fca5a5' }}
              >
                ✕
              </button>
            </>
          ) : (
            <>
              <span
                style={{
                  padding: '0.08rem 0.3rem',
                  borderRadius: '3px',
                  fontWeight: 700,
                  background: '#7f1d1d',
                  color: '#fff',
                }}
                aria-label="不的中"
              >
                ❌ 外れ
              </span>
              <button
                type="button"
                onClick={handleRecordResult}
                aria-label="結果を編集"
                style={btnStyle}
              >
                編集
              </button>
              <button
                type="button"
                onClick={handleClearResult}
                aria-label="結果記録を取消"
                title="結果記録を取消"
                style={{ ...btnStyle, color: '#991b1b', borderColor: '#fca5a5' }}
              >
                ✕
              </button>
            </>
          )}
        </span>
      )}
    </span>
  );
}

const btnStyle: React.CSSProperties = {
  fontSize: '0.62rem',
  color: '#475569',
  background: '#fff',
  border: '1px solid #cbd5e1',
  borderRadius: '3px',
  padding: '0.08rem 0.3rem',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  lineHeight: 1.3,
};

/** レース一覧の行末に表示する小アイコン */
export function PurchaseStatusIcon({
  summary,
}: {
  summary: 'none' | 'planned' | 'purchased' | 'mixed';
}) {
  if (summary === 'none') return null;
  const text =
    summary === 'mixed' ? '📝💰' :
    summary === 'purchased' ? '💰' :
    '📝';
  const label =
    summary === 'mixed' ? '部分購入済' :
    summary === 'purchased' ? '全て購入済' :
    '購入予定あり';
  return (
    <span
      aria-label={label}
      title={label}
      style={{ fontSize: '0.78rem', flexShrink: 0 }}
    >
      {text}
    </span>
  );
}
