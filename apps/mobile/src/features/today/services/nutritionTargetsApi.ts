import type { NutritionTargets } from '@foodlens/core';
import { apiClient } from '@/shared/api';

export const nutritionTargetsApi = {
  get: () => apiClient.get<NutritionTargets>('/nutrition-targets'),
};
