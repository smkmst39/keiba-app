'use client';

// ==========================================
// 開催スケジュール取得フック
// 過去7日間〜翌々日（合計10日）を順番に取得し、開催ありの日をすべて収集する
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

/** YYYYMMDD 形式の今日の日付文字列を返す */
export function getTodayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

/** 過去7日間〜翌々日の日付文字列を返す（合計10日分・昇順） */
export function getScheduleDates(): string[] {
  const today = new Date();
  const fmt = (d: Date) =>
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

  // -7日前から +2日後まで: i=0 → -7, i=9 → +2
  return Array.from({ length: 10 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - 7 + i);
    return fmt(d);
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
 * - 過去7日間〜翌々日（10日分）を先頭から順次取得
 * - 打ち切りなし。開催ありの日をすべて収集する
 * - 見つかった都度 UI を更新して応答性を高める
 */
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
