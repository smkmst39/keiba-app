// ==========================================
// node-cache ラッパー
// キャッシュのTTLは環境変数 CACHE_TTL_SECONDS で設定（デフォルト10分）
// ==========================================

import NodeCache from 'node-cache';

const TTL = parseInt(process.env.CACHE_TTL_SECONDS ?? '600', 10);

// シングルトンインスタンス
const cache = new NodeCache({ stdTTL: TTL, checkperiod: TTL * 0.2 });

/**
 * キャッシュからデータを取得する
 * @param key キャッシュキー
 * @returns キャッシュされた値、なければ undefined
 */
export function getCache<T>(key: string): T | undefined {
  return cache.get<T>(key);
}

/**
 * キャッシュにデータを保存する
 * @param key キャッシュキー
 * @param value 保存する値
 * @param ttl 個別TTL（秒）。省略時はデフォルトTTLを使用
 */
export function setCache<T>(key: string, value: T, ttl?: number): void {
  if (ttl !== undefined) {
    cache.set(key, value, ttl);
  } else {
    cache.set(key, value);
  }
}

/**
 * キャッシュからデータを削除する
 * @param key キャッシュキー
 */
export function deleteCache(key: string): void {
  cache.del(key);
}
