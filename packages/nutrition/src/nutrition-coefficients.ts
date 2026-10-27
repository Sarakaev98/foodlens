import type { ActivityLevel, MacroSplit, NutritionGoal } from '@foodlens/core';

/**
 * Все коэффициенты Nutrition Engine. Изменение алгоритма начинается здесь
 * и сопровождается новым NUTRITION_CALCULATION_VERSION.
 */
export const NUTRITION_CALCULATION_VERSION = 'nutrition-v1';

/** Множители активности для TDEE = BMR × multiplier. */
export const ACTIVITY_MULTIPLIERS: Readonly<Record<ActivityLevel, number>> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

/** Умеренная поправка калорий к TDEE в процентах, без агрессивных дефицитов. */
export const GOAL_CALORIE_ADJUSTMENT_PERCENT: Readonly<Record<NutritionGoal, number>> = {
  lose_weight: -15,
  maintain_weight: 0,
  gain_weight: 10,
  eat_healthier: 0,
};

export const MACRO_SPLITS: Readonly<Record<NutritionGoal, MacroSplit>> = {
  lose_weight: { proteinPercent: 30, fatPercent: 30, carbsPercent: 40 },
  maintain_weight: { proteinPercent: 25, fatPercent: 30, carbsPercent: 45 },
  gain_weight: { proteinPercent: 25, fatPercent: 25, carbsPercent: 50 },
  eat_healthier: { proteinPercent: 25, fatPercent: 30, carbsPercent: 45 },
};

export const KCAL_PER_GRAM = {
  protein: 4,
  carbs: 4,
  fat: 9,
} as const;

/** Константы формулы Mifflin-St Jeor: 10 × вес + 6.25 × рост − 5 × возраст + поправка пола. */
export const MIFFLIN_ST_JEOR = {
  weightKg: 10,
  heightCm: 6.25,
  ageYears: -5,
  sexOffset: { male: 5, female: -161 },
} as const;

/** Калории округляются до ближайших 10 ккал. */
export const CALORIES_ROUNDING_STEP = 10;
