'use client';

// ==========================================
// 開催スケジュール取得フック
// 複数日分を並列取得し、直近の開催日を自動選択する
// ==========================================

import { useState, useEffect } from 'react';
import type { ScheduleResponse, Venue } from '@/lib/scraper/types';

export type DaySchedule = {
  date: string;   // "20260411"
  venues: Venue[];
};

export type UseScheduleResult = {
  schedule: DaySchedule[];
  isLoading: boolean;
  error: string | null;
};

/**
 * 前日・本日・翌日・翌々日の4日分の日付文字列を返す。
 * 返す配列は常に時系列順（前日 → 翌々日）。
 */
export function getScheduleDates(): string[] {
  const today = new Date();

  const formatDate = (d: Date) =>
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  const dayAfterTomorrow = new Date(today);
  dayAfterTomorrow.setDate(today.getDate() + 2);

  return [yesterday, today, tomorrow, dayAfterTomorrow].map(formatDate);
}

/**
 * スケジュールデータを取得するフック
 * @param dates 取得する日付配列（例: ["20260411", "20260412"]）
 */
export function useSchedule(dates: string[]): UseScheduleResult {
  const [schedule, setSchedule] = useState<DaySchedule[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (dates.length === 0) return;

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    // 複数日を並列取得
    Promise.all(
      dates.map((date) =>
        fetch(`/api/schedule?date=${date}`)
          .then((r) => r.json() as Promise<ScheduleResponse>)
          .then((json) => {
            if (!json.success || !json.data?.[0]) return null;
            return json.data[0] as DaySchedule;
          })
          .catch(() => null)
      )
    ).then((results) => {
      if (cancelled) return;
      const valid = results.filter((r): r is DaySchedule => r !== null);
      setSchedule(valid);
      if (valid.length === 0) setError('開催スケジュールの取得に失敗しました');
    }).finally(() => {
      if (!cancelled) setIsLoading(false);
    });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dates.join(',')]);

  return { schedule, isLoading, error };
}
