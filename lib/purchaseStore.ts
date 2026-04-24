// ==========================================
// 購入ステータス localStorage ストア (フェーズA)
//
// - localStorage キー: "keiba-purchase-status-v1"
// - 外部購読可能 (useSyncExternalStore 対応) なシンプル singleton
// - SSR 安全 (typeof window ガード、SSR 時は空スナップショット)
// - フェーズB でアーカイブ・的中記録を追加予定のため version と
//   plannedAt/purchasedAt タイムスタンプを将来拡張用に含める
// ==========================================

export type PurchaseStatus = 'planned' | 'purchased';

/** 券種 (spec 準拠: 馬連=uren / 馬単=utan / 三連複=sanpuku / 枠連=wakuren) */
export type TicketType =
  | 'tan'       // 単勝
  | 'fuku'      // 複勝
  | 'uren'      // 馬連
  | 'utan'      // 馬単
  | 'wide'      // ワイド
  | 'sanpuku'   // 三連複
  | 'santan'    // 三連単
  | 'wakuren';  // 枠連

export type PurchaseEntry = {
  status: PurchaseStatus;
  ticketType: TicketType;
  combination: string;      // "1" / "1-2" / "1→2→3" 等
  plannedAt?: string;       // ISO
  purchasedAt?: string;     // ISO
  amount?: number;          // 円
};

export type RacePurchaseData = {
  raceId: string;
  entries: PurchaseEntry[];
};

export type PurchaseStatusStore = {
  version: 1;
  races: Record<string, RacePurchaseData>;
  lastUpdated: string;
};

export type RaceStatusSummary = 'none' | 'planned' | 'purchased' | 'mixed';

const STORAGE_KEY = 'keiba-purchase-status-v1';

// ----------------------------------------
// 空ストア (SSR スナップショットで固定参照を返すため定数)
// ----------------------------------------
const EMPTY_STORE: PurchaseStatusStore = Object.freeze({
  version: 1 as const,
  races: {},
  lastUpdated: '',
}) as PurchaseStatusStore;

// ----------------------------------------
// メモリキャッシュ + 購読システム
// ----------------------------------------
let cachedStore: PurchaseStatusStore | null = null;
const listeners = new Set<() => void>();

function readFromStorage(): PurchaseStatusStore {
  if (typeof window === 'undefined') return EMPTY_STORE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: 1, races: {}, lastUpdated: '' };
    const parsed = JSON.parse(raw);
    // バージョン検証 (将来のマイグレーション用)
    if (parsed && typeof parsed === 'object' && parsed.version === 1) {
      return {
        version: 1,
        races: parsed.races ?? {},
        lastUpdated: parsed.lastUpdated ?? '',
      };
    }
    return { version: 1, races: {}, lastUpdated: '' };
  } catch {
    return { version: 1, races: {}, lastUpdated: '' };
  }
}

function writeToStorage(store: PurchaseStatusStore): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // QuotaExceededError 等は無視 (メモリキャッシュには反映される)
  }
}

function notify(): void {
  listeners.forEach((l) => l());
}

// storage イベントで他タブの変更を同期
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) {
      cachedStore = readFromStorage();
      notify();
    }
  });
}

// ----------------------------------------
// 読み出し API
// ----------------------------------------

export function getPurchaseStore(): PurchaseStatusStore {
  if (cachedStore) return cachedStore;
  cachedStore = readFromStorage();
  return cachedStore;
}

export function getSSRSnapshot(): PurchaseStatusStore {
  return EMPTY_STORE;
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function getRacePurchases(raceId: string): PurchaseEntry[] {
  const store = getPurchaseStore();
  return store.races[raceId]?.entries ?? [];
}

export function getRaceStatusSummary(raceId: string): RaceStatusSummary {
  const entries = getRacePurchases(raceId);
  if (entries.length === 0) return 'none';
  const hasPlanned = entries.some((e) => e.status === 'planned');
  const hasPurchased = entries.some((e) => e.status === 'purchased');
  if (hasPlanned && hasPurchased) return 'mixed';
  if (hasPurchased) return 'purchased';
  return 'planned';
}

/** (raceId, ticketType, combination) で既存エントリを探す */
export function findEntry(
  raceId: string,
  ticketType: TicketType,
  combination: string,
): { entry: PurchaseEntry; index: number } | null {
  const entries = getRacePurchases(raceId);
  const idx = entries.findIndex(
    (e) => e.ticketType === ticketType && e.combination === combination,
  );
  return idx >= 0 ? { entry: entries[idx], index: idx } : null;
}

// ----------------------------------------
// 書き込み API (内部で notify)
// ----------------------------------------

function mutateStore(mutator: (store: PurchaseStatusStore) => PurchaseStatusStore): void {
  const next = mutator(getPurchaseStore());
  const updated: PurchaseStatusStore = {
    ...next,
    lastUpdated: new Date().toISOString(),
  };
  cachedStore = updated;
  writeToStorage(updated);
  notify();
}

export function addPurchaseEntry(raceId: string, entry: PurchaseEntry): void {
  mutateStore((s) => {
    const race = s.races[raceId] ?? { raceId, entries: [] };
    return {
      ...s,
      races: {
        ...s.races,
        [raceId]: { ...race, entries: [...race.entries, entry] },
      },
    };
  });
}

export function updatePurchaseEntry(
  raceId: string,
  entryIndex: number,
  update: Partial<PurchaseEntry>,
): void {
  mutateStore((s) => {
    const race = s.races[raceId];
    if (!race) return s;
    const entries = race.entries.map((e, i) => (i === entryIndex ? { ...e, ...update } : e));
    return { ...s, races: { ...s.races, [raceId]: { ...race, entries } } };
  });
}

export function removePurchaseEntry(raceId: string, entryIndex: number): void {
  mutateStore((s) => {
    const race = s.races[raceId];
    if (!race) return s;
    const entries = race.entries.filter((_, i) => i !== entryIndex);
    if (entries.length === 0) {
      // レース全体を削除
      const { [raceId]: _, ...rest } = s.races;
      return { ...s, races: rest };
    }
    return { ...s, races: { ...s.races, [raceId]: { ...race, entries } } };
  });
}

/** ショートカット: (raceId, ticketType, combination) を planned で追加 */
export function planPurchase(raceId: string, ticketType: TicketType, combination: string): void {
  const existing = findEntry(raceId, ticketType, combination);
  if (existing) return; // 既にあるなら何もしない
  addPurchaseEntry(raceId, {
    status: 'planned',
    ticketType,
    combination,
    plannedAt: new Date().toISOString(),
  });
}

/** ショートカット: planned → purchased 昇格 (amount 必須) */
export function markAsPurchased(
  raceId: string,
  ticketType: TicketType,
  combination: string,
  amount: number,
): void {
  const existing = findEntry(raceId, ticketType, combination);
  const nowIso = new Date().toISOString();
  if (existing) {
    updatePurchaseEntry(raceId, existing.index, {
      status: 'purchased',
      purchasedAt: nowIso,
      amount,
    });
  } else {
    addPurchaseEntry(raceId, {
      status: 'purchased',
      ticketType,
      combination,
      plannedAt: nowIso,
      purchasedAt: nowIso,
      amount,
    });
  }
}

/** ショートカット: 指定買い目を削除 (該当なしなら no-op) */
export function removeByKey(raceId: string, ticketType: TicketType, combination: string): void {
  const existing = findEntry(raceId, ticketType, combination);
  if (existing) removePurchaseEntry(raceId, existing.index);
}
