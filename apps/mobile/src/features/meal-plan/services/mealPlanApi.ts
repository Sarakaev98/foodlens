import type { MealPlanResult } from '@foodlens/core';
import { apiClient } from '@/shared/api';

/** С запасом на одну попытку исправления на сервере. */
const GENERATE_TIMEOUT_MS = 130_000;

export const mealPlanApi = {
  /** Последний составленный план или null. */
  getLatest: () => apiClient.get<MealPlanResult | null>('/meal-plan'),
  generate: () => apiClient.post<MealPlanResult>('/meal-plan/generate', {}, { timeoutMs: GENERATE_TIMEOUT_MS }),
};
