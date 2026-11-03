import { sumMeals, type Meal, type MealId, type MealPlan, type MealPlanId } from '@foodlens/core';
import type { GenerateMealPlanInput } from '../../ai-provider.types';

/** Доля дневной цели на блюдо. */
const MOCK_MEALS: readonly (Pick<Meal, 'slot' | 'name' | 'description' | 'ingredients' | 'portion'> & { readonly share: number })[] = [
  { slot: 'breakfast', share: 0.25, name: 'Buckwheat with Mushrooms', description: 'A filling breakfast without extra sugar.', ingredients: ['buckwheat, 80 g', 'button mushrooms, 100 g', 'vegetable oil, 10 g'], portion: '1 plate, 300 g' },
  { slot: 'lunch', share: 0.35, name: 'Lentil Soup with Vegetables', description: 'A warm lunch with plant protein.', ingredients: ['lentils, 90 g', 'carrot, 50 g', 'potato, 100 g'], portion: '1 bowl, 400 g' },
  { slot: 'dinner', share: 0.3, name: 'Rice with Chickpeas and Tomatoes', description: 'A simple dinner from everyday foods.', ingredients: ['rice, 80 g', 'chickpeas, 120 g', 'tomatoes, 100 g'], portion: '1 plate, 350 g' },
  { slot: 'snack', share: 0.1, name: 'Banana and Apple', description: 'A light snack between meals.', ingredients: ['banana, 100 g', 'apple, 100 g'], portion: '2 pieces of fruit, 200 g' },
];

/** Для AI_PROVIDER=mock: фиксированный растительный день, числа пропорциональны цели. Ничего не генерирует. */
export function mockMealPlan(input: GenerateMealPlanInput, createId: () => string): MealPlan {
  const { targets, startDate } = input;
  const meals: Meal[] = MOCK_MEALS.map(({ share, ...meal }) => ({
    ...meal,
    id: `meal_${createId()}` as MealId,
    caloriesKcal: Math.round(targets.caloriesKcal * share),
    proteinG: Math.round(targets.proteinG * share),
    carbsG: Math.round(targets.carbsG * share),
    fatG: Math.round(targets.fatG * share),
  }));
  return { id: `plan_${createId()}` as MealPlanId, days: [{ date: startDate, meals, totals: sumMeals(meals) }] };
}
