import type { MealPhotoEstimate, TodayLog } from '@foodlens/core';
import { localDate, todayLogApi } from './services/todayLogApi';
import { todayLogStore } from './state/todayLogStore';

/** id создаётся один раз на результат скана: повторное нажатие или повтор после ошибки не создают дубль. */
export function newTodayEntryId(): string {
  return `meal_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Добавляет оценку блюда в журнал дня через общий API Today и обновляет Today. */
export async function addMealEstimateToToday(entryId: string, estimate: MealPhotoEstimate): Promise<TodayLog> {
  const { caloriesKcal, proteinG, carbsG, fatG } = estimate.total;
  const log = await todayLogApi.add({
    id: entryId,
    date: localDate(),
    name: estimate.mealName,
    source: 'meal_photo_estimate',
    caloriesKcal,
    proteinG,
    carbsG,
    fatG,
  });
  todayLogStore.set(log);
  return log;
}
