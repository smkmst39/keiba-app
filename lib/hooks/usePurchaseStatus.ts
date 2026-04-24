'use client';

// ==========================================
// 購入ステータス React hook
// useSyncExternalStore でストア変更を subscribe、SSR 安全
// ==========================================

import { useSyncExternalStore } from 'react';
import {
  subscribe,
  getPurchaseStore,
  getSSRSnapshot,
  getRaceStatusSummary,
  getRacePurchases,
  findEntry,
  type PurchaseStatusStore,
  type RaceStatusSummary,
  type PurchaseEntry,
  type TicketType,
} from '@/lib/purchaseStore';

/** ストア全体を反応的に取得 */
export function usePurchaseStore(): PurchaseStatusStore {
  return useSyncExternalStore(subscribe, getPurchaseStore, getSSRSnapshot);
}

/** 指定レースのエントリ配列を反応的に取得 */
export function useRacePurchases(raceId: string): PurchaseEntry[] {
  const store = usePurchaseStore();
  return store.races[raceId]?.entries ?? [];
}

/** 指定レースのステータスサマリ ('none' | 'planned' | 'purchased' | 'mixed') */
export function useRaceStatusSummary(raceId: string): RaceStatusSummary {
  // store 購読で再計算
  usePurchaseStore();
  return getRaceStatusSummary(raceId);
}

/** 指定 (raceId, ticketType, combination) のエントリを反応的に取得 */
export function usePurchaseEntry(
  raceId: string,
  ticketType: TicketType,
  combination: string,
): { entry: PurchaseEntry; index: number } | null {
  // store 購読で再計算
  usePurchaseStore();
  return findEntry(raceId, ticketType, combination);
}

/** 非リアクティブに読むだけのヘルパ (useEffect 内での利用想定) */
export { getRacePurchases, getRaceStatusSummary };
