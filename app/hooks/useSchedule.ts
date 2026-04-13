'use client';

// ==========================================
// 開催スケジュール取得フック
// 本日から14日分を順番に取得し、開催ありの日を最大3件見つけた時点で打ち切る
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

/** 本日から14日分の日付文字列を返す（今日〜13日後） */
export function getScheduleDates(): string[] {
  const today = new Date();
  const formatDate = (d: Date) =>
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

  return Array.from({ length: 14 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    return formatDate(d);
  });
}

/** 1日分のスケジュールを取得する */
async function fetchDaySchedule(date: string): Promise<DaySchedule | null> {
  try {
    const r = await fetch(`/api/schedule?date=${date}`);
    const json = await r.json() as ScheduleResponse;
    if (!json.success || !json.data?.[0]) return null;
    const day = json.data[0] as DaySchedule;
    return day.venues.length > 0 ? day : null;
  } catch {
    return null;
  }
}

/**
 * 開催スケジュールを取得するフック
 * - 14日分を先頭から順次取得
 * - 開催ありの日が MIN_FOUND 件見つかった時点で取得を打ち切る
 */
const MIN_FOUND = 3;

export function useSchedule(): UseScheduleResult {
  const [schedule, setSchedule] = useState<DaySchedule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setIsLoading(true);
      setError(null);
      setSchedule([]);

      const dates = getScheduleDates();
      const found: DaySchedule[] = [];

      for (const date of dates) {
        if (cancelled) return;

        const day = await fetchDaySchedule(date);
        if (day) {
          found.push(day);
          // 見つかった都度 UI を更新して応答性を高める
          if (!cancelled) setSchedule([...found]);
          if (found.length >= MIN_FOUND) break;
        }
      }

      if (!cancelled) {
        if (found.length === 0) setError('開催スケジュールの取得に失敗しました');
        setIsLoading(false);
      }
    };

    run();
    return () => { cancelled = true; };
  }, []); // 初回マウント時のみ実行

  return { schedule, isLoading, error };
}
