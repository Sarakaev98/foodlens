import type { AddTodayEntryInput, TodayLog } from '@foodlens/core';
import { apiClient } from '@/shared/api';

/** Локальная дата пользователя YYYY-MM-DD: «сегодня» считается по часам телефона, а не сервера. */
export function localDate(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export const todayLogApi = {
  get: (date: string = localDate()) => apiClient.get<TodayLog>(`/today?date=${date}`),
  /** Повтор с тем же id сервер не дублирует. */
  add: (entry: AddTodayEntryInput) => apiClient.post<TodayLog>('/today/entries', entry, { timeoutMs: 15_000 }),
};
