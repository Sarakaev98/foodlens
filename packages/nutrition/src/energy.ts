import type { ActivityLevel, BodyMetrics, NutritionGoal } from '@foodlens/core';
import { ACTIVITY_MULTIPLIERS, GOAL_CALORIE_ADJUSTMENT_PERCENT, MIFFLIN_ST_JEOR } from './nutrition-coefficients';

function assertPositiveFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number, got ${value}`);
  }
}

/** Базовый обмен по формуле Mifflin-St Jeor, ккал/день. */
export function calculateBmr({ sex, weightKg, heightCm, age }: Pick<BodyMetrics, 'sex' | 'weightKg' | 'heightCm' | 'age'>): number {
  assertPositiveFinite('weightKg', weightKg);
  assertPositiveFinite('heightCm', heightCm);
  assertPositiveFinite('age', age);

  const bmr =
    MIFFLIN_ST_JEOR.weightKg * weightKg +
    MIFFLIN_ST_JEOR.heightCm * heightCm +
    MIFFLIN_ST_JEOR.ageYears * age +
    MIFFLIN_ST_JEOR.sexOffset[sex];
  assertPositiveFinite('BMR', bmr);
  return bmr;
}

/** Суточный расход энергии с учётом активности, ккал/день. */
export function calculateTdee(bmrKcal: number, activityLevel: ActivityLevel): number {
  return bmrKcal * ACTIVITY_MULTIPLIERS[activityLevel];
}

/** Калории с поправкой на цель, до округления. */
export function applyGoalAdjustment(tdeeKcal: number, goal: NutritionGoal): number {
  return tdeeKcal * (1 + GOAL_CALORIE_ADJUSTMENT_PERCENT[goal] / 100);
}
