'use client';

// ==========================================
// レースデータ取得フック
// APIからデータを取得し、5分ごとに自動更新する
// ==========================================

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Race } from '@/lib/scraper/types';

/** 自動更新のデフォルト間隔（5分） */
const DEFAULT_REFRESH_MS = 5 * 60 * 1000;

export type UseRaceDataResult = {
  race: Race | null;
  isLoading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  refetch: () => void;
};

/**
 * レースデータを取得するフック
 * @param raceId 12桁のnetkeibaレースID。nullのとき取得しない。
 * @param refreshIntervalMs 自動更新間隔（ミリ秒）。0のとき自動更新なし。
 */
export function useRaceData(
  raceId: string | null,
  refreshIntervalMs: number = DEFAULT_REFRESH_MS,
): UseRaceDataResult {
  const [race, setRace]             = useState<Race | null>(null);
  const [isLoading, setIsLoading]   = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // 最新の raceId を ref で保持（タイマーコールバック内でも参照できるように）
  const raceIdRef = useRef<string | null>(raceId);
  raceIdRef.current = raceId;

  const fetchData = useCallback(async (id: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const res  = await fetch(`/api/race/${id}`);
      const json = await res.json() as { success: boolean; data: Race | null; error?: string };

      if (!json.success || !json.data) {
        setError(json.error ?? 'データの取得に失敗しました');
        return;
      }

      // fetchedAt は JSON では文字列になるため Date に変換
      setRace({ ...json.data, fetchedAt: new Date(json.data.fetchedAt) });
      setLastUpdated(new Date());
    } catch {
      setError('ネットワークエラーが発生しました。しばらくして再試行してください。');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // raceId が変わったら即座に取得
  useEffect(() => {
    if (!raceId) {
      setRace(null);
      setError(null);
      return;
    }
    fetchData(raceId);
  }, [raceId, fetchData]);

  // 自動更新タイマー
  useEffect(() => {
    if (!raceId || refreshIntervalMs <= 0) return;

    const timer = setInterval(() => {
      if (raceIdRef.current) fetchData(raceIdRef.current);
    }, refreshIntervalMs);

    return () => clearInterval(timer);
  }, [raceId, refreshIntervalMs, fetchData]);

  const refetch = useCallback(() => {
    if (raceIdRef.current) fetchData(raceIdRef.current);
  }, [fetchData]);

  return { race, isLoading, error, lastUpdated, refetch };
}
