'use client';

// ==========================================
// 組み合わせオッズ取得フック
// レースIDが変わるたびに自動再取得する
// ==========================================

import { useState, useEffect } from 'react';
import type { ComboOddsData } from '@/lib/scraper/types';

export type UseComboOddsResult = {
  data: ComboOddsData | null;
  isLoading: boolean;
  error: string | null;
};

export function useComboOdds(raceId: string | null): UseComboOddsResult {
  const [data, setData]         = useState<ComboOddsData | null>(null);
  const [isLoading, setLoading] = useState(false);
  const [error, setError]       = useState<string | null>(null);

  useEffect(() => {
    if (!raceId) {
      setData(null);
      setError(null);
      return;
    }

    let cancelled = false;

    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const res  = await fetch(`/api/race/${raceId}/combo-odds`);
        const json = await res.json() as { success: boolean; data: ComboOddsData | null; error?: string };
        if (cancelled) return;
        if (!json.success || !json.data) {
          setError(json.error ?? 'オッズデータの取得に失敗しました');
        } else {
          setData(json.data);
        }
      } catch {
        if (!cancelled) setError('ネットワークエラーが発生しました');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    // raceIdが変わったら古いデータをリセットしてから再取得
    setData(null);
    fetchData();

    return () => { cancelled = true; };
  }, [raceId]);

  return { data, isLoading, error };
}
