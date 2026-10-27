import type { MacroSplit } from '@foodlens/core';
import { KCAL_PER_GRAM } from './nutrition-coefficients';

export interface MacroGrams {
  readonly proteinG: number;
  readonly carbsG: number;
  readonly fatG: number;
}

/** Граммы макронутриентов из калорий и распределения, округлённые до целых. */
export function calculateMacroGrams(caloriesKcal: number, split: MacroSplit): MacroGrams {
  const grams = (percent: number, kcalPerGram: number) => Math.round((caloriesKcal * percent) / 100 / kcalPerGram);
  return {
    proteinG: grams(split.proteinPercent, KCAL_PER_GRAM.protein),
    carbsG: grams(split.carbsPercent, KCAL_PER_GRAM.carbs),
    fatG: grams(split.fatPercent, KCAL_PER_GRAM.fat),
  };
}
