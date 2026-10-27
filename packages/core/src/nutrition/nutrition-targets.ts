/**
 * Персональные дневные цели по калориям и макронутриентам.
 * Это приблизительная оценка на основе профиля, а не медицинское назначение.
 */
export interface NutritionTargets {
  readonly caloriesKcal: number;
  readonly proteinG: number;
  readonly carbsG: number;
  readonly fatG: number;
  /** Как получены значения. Нужно для прозрачности, экраны от этих полей не зависят. */
  readonly calculation: NutritionTargetsCalculation;
}

export interface NutritionTargetsCalculation {
  /** Идентификатор алгоритма, например "nutrition-v1". Меняется при изменении формул. */
  readonly version: string;
  readonly bmrKcal: number;
  readonly tdeeKcal: number;
  /** Поправка к TDEE в процентах: -15 означает дефицит 15%. */
  readonly goalAdjustmentPercent: number;
  readonly macroSplit: MacroSplit;
}

/** Доли калорий из белков, жиров и углеводов в процентах, в сумме 100. */
export interface MacroSplit {
  readonly proteinPercent: number;
  readonly fatPercent: number;
  readonly carbsPercent: number;
}
