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
  type TicketType,
} from '@/lib/purchaseStore';
import { usePurchaseEntry } from '@/lib/hooks/usePurchaseStatus';

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

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.2rem',
        fontSize: '0.62rem',
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      {/* ステータスバッジ */}
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

      {/* アクションボタン */}
      {isPurchased ? (
        <button
          type="button"
          onClick={handlePurchase}
          aria-label="金額を編集"
          style={btnStyle}
        >
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
