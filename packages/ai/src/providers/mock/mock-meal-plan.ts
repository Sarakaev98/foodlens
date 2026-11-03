import { sumMeals, type Meal, type MealId, type MealPlan, type MealPlanId } from '@foodlens/core';
import type { GenerateMealPlanInput } from '../../ai-provider.types';

/** Доля дневной цели на блюдо. */
const MOCK_MEALS: readonly (Pick<Meal, 'slot' | 'name' | 'description' | 'ingredients' | 'portion'> & { readonly share: number })[] = [
  { slot: 'breakfast', share: 0.25, name: 'Гречка с грибами', description: 'Сытный завтрак без лишнего сахара.', ingredients: ['гречка, 80 г', 'шампиньоны, 100 г', 'растительное масло, 10 г'], portion: '1 тарелка, 300 г' },
  { slot: 'lunch', share: 0.35, name: 'Чечевичный суп с овощами', description: 'Тёплый обед с растительным белком.', ingredients: ['чечевица, 90 г', 'морковь, 50 г', 'картофель, 100 г'], portion: '1 тарелка, 400 г' },
  { slot: 'dinner', share: 0.3, name: 'Рис с нутом и томатами', description: 'Простой ужин из доступных продуктов.', ingredients: ['рис, 80 г', 'нут, 120 г', 'помидоры, 100 г'], portion: '1 тарелка, 350 г' },
  { slot: 'snack', share: 0.1, name: 'Банан и яблоко', description: 'Лёгкий перекус между приёмами пищи.', ingredients: ['банан, 100 г', 'яблоко, 100 г'], portion: '2 фрукта, 200 г' },
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
