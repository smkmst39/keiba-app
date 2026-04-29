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

/** 結果記録 (フェーズ2) — purchased エントリにのみ後から付与可能 */
export type PurchaseResult = {
  hit: boolean;             // 的中
  payout: number;           // 払戻金額 (円、不的中=0)
  recordedAt: string;       // ISO 結果記録日時
};

export type PurchaseEntry = {
  status: PurchaseStatus;
  ticketType: TicketType;
  combination: string;      // "1" / "1-2" / "1→2→3" 等
  plannedAt?: string;       // ISO
  purchasedAt?: string;     // ISO
  amount?: number;          // 円
  result?: PurchaseResult;  // 結果記録 (フェーズ2、未記録は undefined)
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

// ----------------------------------------
// 結果記録 API (フェーズ2)
// ----------------------------------------

/** 単一エントリの結果を記録 (上書き可) */
export function recordPurchaseResult(
  raceId: string,
  entryIndex: number,
  result: PurchaseResult,
): void {
  updatePurchaseEntry(raceId, entryIndex, { result });
}

/** 単一エントリの結果記録をクリア (purchased 状態は維持) */
export function clearPurchaseResult(raceId: string, entryIndex: number): void {
  mutateStore((s) => {
    const race = s.races[raceId];
    if (!race) return s;
    const entries = race.entries.map((e, i) => {
      if (i !== entryIndex) return e;
      const { result: _drop, ...rest } = e;
      return rest as PurchaseEntry;
    });
    return { ...s, races: { ...s.races, [raceId]: { ...race, entries } } };
  });
}

/**
 * 一括ハズレ記録: 指定 (raceId, ticketType) の result 未記録 purchased エントリ全てを
 * hit=false, payout=0 で記録。誤タップ防止のため呼び出し側で confirm 必須。
 */
export function bulkRecordRaceResults(
  raceId: string,
  ticketType: TicketType,
  hit: false,
  payout = 0,
): number {
  let count = 0;
  mutateStore((s) => {
    const race = s.races[raceId];
    if (!race) return s;
    const recordedAt = new Date().toISOString();
    const entries = race.entries.map((e) => {
      if (
        e.status === 'purchased' &&
        e.ticketType === ticketType &&
        !e.result
      ) {
        count++;
        return { ...e, result: { hit, payout, recordedAt } };
      }
      return e;
    });
    return { ...s, races: { ...s.races, [raceId]: { ...race, entries } } };
  });
  return count;
}

// ----------------------------------------
// ROI 集計 API (フェーズ2)
// ----------------------------------------

export type RaceROI = {
  totalSpent: number;
  totalPayout: number;
  roi: number;       // %
  recordedCount: number;  // 結果記録済件数
  pendingCount: number;   // 未記録件数 (purchased で result なし)
};

export type OverallROI = {
  totalSpent: number;
  totalPayout: number;
  roi: number;       // %
  hitCount: number;
  missCount: number;
  pendingCount: number;
  purchasedCount: number;
};

/**
 * レース単位の ROI。result 未記録エントリは集計対象外 (totalSpent から除外)。
 * purchased が 0 件なら null。
 */
export function getRaceROI(raceId: string): RaceROI | null {
  const entries = getRacePurchases(raceId);
  let totalSpent = 0, totalPayout = 0;
  let recordedCount = 0, pendingCount = 0;
  let purchasedAny = false;
  for (const e of entries) {
    if (e.status !== 'purchased') continue;
    purchasedAny = true;
    if (!e.result) { pendingCount++; continue; }
    totalSpent += e.amount ?? 0;
    totalPayout += e.result.payout;
    recordedCount++;
  }
  if (!purchasedAny) return null;
  const roi = totalSpent > 0 ? (totalPayout / totalSpent) * 100 : 0;
  return { totalSpent, totalPayout, roi, recordedCount, pendingCount };
}

/** 全期間 ROI。result 未記録は totalSpent から除外。 */
export function getOverallROI(): OverallROI {
  const store = getPurchaseStore();
  let totalSpent = 0, totalPayout = 0;
  let hitCount = 0, missCount = 0, pendingCount = 0, purchasedCount = 0;
  for (const race of Object.values(store.races)) {
    for (const e of race.entries) {
      if (e.status !== 'purchased') continue;
      purchasedCount++;
      if (!e.result) { pendingCount++; continue; }
      totalSpent += e.amount ?? 0;
      totalPayout += e.result.payout;
      if (e.result.hit) hitCount++;
      else missCount++;
    }
  }
  const roi = totalSpent > 0 ? (totalPayout / totalSpent) * 100 : 0;
  return { totalSpent, totalPayout, roi, hitCount, missCount, pendingCount, purchasedCount };
}
