import type { Brand } from '../common';
import type { NutritionTargets } from '../nutrition';

export type MealPlanId = Brand<string, 'MealPlanId'>;
export type MealId = Brand<string, 'MealId'>;

export const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
export type MealSlot = (typeof MEAL_SLOTS)[number];

/** Калории и БЖУ блюда или суммы блюд. */
export interface MealMacros {
  readonly caloriesKcal: number;
  readonly proteinG: number;
  readonly carbsG: number;
  readonly fatG: number;
}

export interface Meal extends MealMacros {
  readonly id: MealId;
  readonly slot: MealSlot;
  readonly name: string;
  /** Одно короткое предложение. */
  readonly description: string;
  /** С количеством, например "овсяные хлопья, 60 г". */
  readonly ingredients: readonly string[];
  /** Размер порции, например "1 тарелка, 350 г". */
  readonly portion: string;
}

export interface MealPlanDay {
  /** Дата в формате ISO, YYYY-MM-DD. */
  readonly date: string;
  readonly meals: readonly Meal[];
  /** Всегда сумма блюд: итогам модели доверять нельзя. */
  readonly totals: MealMacros;
}

/** План питания. Намеренно не ссылается на Scan/Product. */
export interface MealPlan {
  readonly id: MealPlanId;
  readonly days: readonly MealPlanDay[];
}

/** Ответ API: план и цели, под которые он составлен. */
export interface MealPlanResult {
  readonly plan: MealPlan;
  readonly targets: NutritionTargets;
  /** false: калории или БЖУ заметно отличаются от цели. Ограничения профиля соблюдены всегда. */
  readonly withinTargets: boolean;
}

export function sumMeals(meals: readonly MealMacros[]): MealMacros {
  const sum = (pick: (meal: MealMacros) => number) => Math.round(meals.reduce((total, meal) => total + pick(meal), 0));
  return {
    caloriesKcal: sum((meal) => meal.caloriesKcal),
    proteinG: sum((meal) => meal.proteinG),
    carbsG: sum((meal) => meal.carbsG),
    fatG: sum((meal) => meal.fatG),
  };
}
