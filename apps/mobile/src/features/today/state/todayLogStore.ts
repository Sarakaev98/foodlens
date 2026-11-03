import type { TodayLog } from '@foodlens/core';

type Listener = (log: TodayLog) => void;

let latest: TodayLog | null = null;
const listeners = new Set<Listener>();

/** Последний журнал дня в памяти приложения: запись со Scan сразу видна на Today без перезагрузки. */
export const todayLogStore = {
  get: (): TodayLog | null => latest,
  set(log: TodayLog): void {
    latest = log;
    listeners.forEach((listener) => listener(log));
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
