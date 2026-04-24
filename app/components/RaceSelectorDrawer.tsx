'use client';

// ==========================================
// レース選択 フローティングドロワー
//
// - 画面右下の FAB (フローティングアクションボタン) で開閉
// - FAB ラベルは現在選択中レース ("中山 11R") or "レース選択"
// - ボトムシート式 (高さ 85vh)、外側タップ・✕ボタン・Esc で閉じる
// - 中身は既存 RaceSelector を再利用 (DRY)
// - レース選択時に自動クローズ
//
// 仕様: ページ最上部の RaceSelector はそのまま維持。本コンポーネントは追加 UI。
// ==========================================

import { useEffect, useRef } from 'react';
import type { Race } from '@/lib/scraper/types';
import { RaceSelector } from '@/app/components/RaceSelector';

// ----------------------------------------
// FAB (フローティング呼び出しボタン)
// ----------------------------------------

export function RaceSelectorFAB({
  race,
  onClick,
}: {
  race: Race | null;
  onClick: () => void;
}) {
  const label = race
    ? `${race.course ?? '未取得'} ${parseInt(race.raceId.slice(-2), 10)}R`
    : 'レース選択';

  return (
    <button
      onClick={onClick}
      aria-label={race ? `現在のレース: ${label}。タップでレース選択ドロワーを開く` : 'レース選択ドロワーを開く'}
      style={{
        position: 'fixed',
        right: '16px',
        bottom: '16px',
        zIndex: 1000,
        background: '#1e40af',
        color: '#fff',
        border: 'none',
        borderRadius: '24px',
        padding: '0 1.1rem',
        height: '48px',
        minWidth: '120px',
        maxWidth: 'calc(100vw - 32px)',
        fontSize: '0.92rem',
        fontWeight: 700,
        boxShadow: '0 4px 12px rgba(0,0,0,0.18), 0 2px 4px rgba(0,0,0,0.12)',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.45rem',
        whiteSpace: 'nowrap',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <span style={{ fontSize: '1.1rem', lineHeight: 1 }} aria-hidden="true">🏇</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
    </button>
  );
}

// ----------------------------------------
// ドロワー本体
// ----------------------------------------

export function RaceSelectorDrawer({
  isOpen,
  onClose,
  onRaceLoaded,
}: {
  isOpen: boolean;
  onClose: () => void;
  onRaceLoaded: (race: Race) => void;
}) {
  // body スクロールロック (open 時のみ、SSR 安全)
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!isOpen) return;
    const orig = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = orig; };
  }, [isOpen]);

  // ESC キーで閉じる
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  // RaceSelector で onRaceLoaded が呼ばれた時に既存ハンドラ + ドロワーを閉じる
  // ただし RaceSelector 内部の useEffect で「race が変わるたび onRaceLoaded」が
  // 走るため、開いた瞬間に既存選択が再度通知されて即閉じるのを避けるべく、
  // 「ユーザーが何かを操作したあと」のみクローズする ref を使用
  const userInteractedRef = useRef(false);
  useEffect(() => {
    if (!isOpen) userInteractedRef.current = false;
  }, [isOpen]);

  return (
    <>
      {/* オーバーレイ (フェード) */}
      <div
        onClick={onClose}
        aria-hidden="true"
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.45)',
          opacity: isOpen ? 1 : 0,
          pointerEvents: isOpen ? 'auto' : 'none',
          transition: 'opacity 0.25s ease-out',
          zIndex: 1001,
        }}
      />

      {/* ドロワー (スライドアップ) */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="レース選択"
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          height: '85vh',
          maxHeight: '85vh',
          background: '#fff',
          borderRadius: '16px 16px 0 0',
          boxShadow: '0 -8px 28px rgba(0,0,0,0.22)',
          transform: isOpen ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform 0.3s ease-out',
          zIndex: 1002,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* ドラッグハンドル風 */}
        <div
          aria-hidden="true"
          style={{
            width: '40px',
            height: '4px',
            background: '#cbd5e1',
            borderRadius: '2px',
            margin: '8px auto 0',
            flexShrink: 0,
          }}
        />

        {/* ヘッダー (タイトル + ✕ ボタン) */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          padding: '0.4rem 0.75rem 0.5rem',
          borderBottom: '1px solid #e2e8f0',
          flexShrink: 0,
        }}>
          <h2 style={{
            margin: 0,
            fontSize: '0.95rem',
            fontWeight: 800,
            color: '#1a365d',
          }}>
            🏇 レース選択
          </h2>
          <button
            onClick={onClose}
            aria-label="ドロワーを閉じる"
            style={{
              marginLeft: 'auto',
              background: '#f1f5f9',
              border: '1px solid #cbd5e1',
              borderRadius: '999px',
              width: '40px',
              height: '40px',
              cursor: 'pointer',
              fontSize: '1.05rem',
              fontWeight: 700,
              color: '#475569',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            ✕
          </button>
        </div>

        {/* 本体 (スクロール可能) */}
        <div
          // ユーザーの操作 (タップ/クリック) を検知してフラグを立てる
          // → onRaceLoaded が走った時に「実ユーザー操作由来か」を判定
          onPointerDown={() => { userInteractedRef.current = true; }}
          style={{
            flex: 1,
            overflow: 'auto',
            padding: '0.6rem 0.6rem 1rem',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          <RaceSelector
            onRaceLoaded={(r) => {
              onRaceLoaded(r);
              // ユーザー操作起因なら閉じる (キャッシュ自動通知では閉じない)
              if (userInteractedRef.current) {
                onClose();
              }
            }}
          />
        </div>
      </div>
    </>
  );
}
