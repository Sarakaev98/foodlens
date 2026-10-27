import type { BodyMetrics, NutritionGoal, NutritionTargets } from '@foodlens/core';
import { applyGoalAdjustment, calculateBmr, calculateTdee } from './energy';
import { calculateMacroGrams } from './macros';
import {
  CALORIES_ROUNDING_STEP,
  GOAL_CALORIE_ADJUSTMENT_PERCENT,
  MACRO_SPLITS,
  NUTRITION_CALCULATION_VERSION,
} from './nutrition-coefficients';

/** Часть профиля, нужная для расчёта. UserNutritionProfile подходит без преобразований. */
export interface NutritionTargetsInput extends BodyMetrics {
  readonly goal: NutritionGoal;
}

/** Технические значения отдаются с точностью до сотых, без шума float. */
const toHundredths = (value: number) => Math.round(value * 100) / 100;

/** Рассчитывает дневные цели из актуального профиля. Чистая функция без побочных эффектов. */
export function calculateNutritionTargets(profile: NutritionTargetsInput): NutritionTargets {
  const bmrKcal = calculateBmr(profile);
  const tdeeKcal = calculateTdee(bmrKcal, profile.activityLevel);
  const caloriesKcal =
    Math.round(applyGoalAdjustment(tdeeKcal, profile.goal) / CALORIES_ROUNDING_STEP) * CALORIES_ROUNDING_STEP;
  const macroSplit = MACRO_SPLITS[profile.goal];

  return {
    caloriesKcal,
    ...calculateMacroGrams(caloriesKcal, macroSplit),
    calculation: {
      version: NUTRITION_CALCULATION_VERSION,
      bmrKcal: toHundredths(bmrKcal),
      tdeeKcal: toHundredths(tdeeKcal),
      goalAdjustmentPercent: GOAL_CALORIE_ADJUSTMENT_PERCENT[profile.goal],
      macroSplit,
    },
  };
}
