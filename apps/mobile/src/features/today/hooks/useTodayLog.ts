import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import type { TodayLog } from '@foodlens/core';
import { localDate, todayLogApi } from '../services/todayLogApi';
import { todayLogStore } from '../state/todayLogStore';

/**
 * Журнал съеденного за сегодня. Обновляется при каждом открытии вкладки и сразу после «Добавить в Сегодня».
 * null: ещё не загружен или сервер недоступен; тогда Today показывает только цели.
 */
export function useTodayLog(): TodayLog | null {
  const [log, setLog] = useState<TodayLog | null>(() => todayLogStore.get());

  useEffect(() => todayLogStore.subscribe(setLog), []);

  useFocusEffect(
    useCallback(() => {
      todayLogApi.get().then(todayLogStore.set, () => undefined);
    }, []),
  );

  // Журнал вчерашнего дня после полуночи не показываем.
  return log && log.date === localDate() ? log : null;
}
