import type { MealSlot } from '@foodlens/core';
import type { MealPlanFailure } from './hooks/useMealPlan';

export const MEAL_SLOT_LABELS: Readonly<Record<MealSlot, string>> = {
  breakfast: 'Завтрак',
  lunch: 'Обед',
  dinner: 'Ужин',
  snack: 'Перекус',
};

export const MEAL_PLAN_LOADING_TEXT = 'Составляем рацион с учётом ваших целей и предпочтений';

export const MEAL_PLAN_FAILURES: Readonly<Record<MealPlanFailure, string>> = {
  restrictions: 'Не удалось составить рацион, подходящий под все ваши ограничения. Попробуйте ещё раз.',
  unavailable: 'Сейчас не получилось составить рацион. Попробуйте ещё раз чуть позже.',
  no_connection: 'Нет связи. Проверьте подключение к интернету и попробуйте ещё раз.',
};
