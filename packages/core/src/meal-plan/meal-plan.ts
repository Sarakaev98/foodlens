import type { Brand } from '../common';
import type { NutritionFacts } from '../nutrition';

export type MealPlanId = Brand<string, 'MealPlanId'>;
export type MealId = Brand<string, 'MealId'>;

export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export interface Meal {
  readonly id: MealId;
  readonly slot: MealSlot;
  readonly name: string;
  readonly nutrition?: NutritionFacts;
}

export interface MealPlanDay {
  /** Дата в формате ISO, YYYY-MM-DD. */
  readonly date: string;
  readonly meals: readonly Meal[];
}

/** План питания. Намеренно не ссылается на Scan/Product. */
export interface MealPlan {
  readonly id: MealPlanId;
  readonly days: readonly MealPlanDay[];
}
