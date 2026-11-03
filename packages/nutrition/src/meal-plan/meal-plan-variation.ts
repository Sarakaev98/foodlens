import type { FoodPreferences } from '@foodlens/core';

/** Мягкая подсказка для разнообразия: стиль кухни и основа дня. Не каталог блюд и не замена ограничений профиля. */
export interface MealPlanVariation {
  readonly style: string;
  readonly emphasis: string;
}

const STYLES = ['Mediterranean', 'Georgian-inspired', 'Turkish-inspired', 'European home cooking', 'Asian-inspired', 'simple international'] as const;

type Emphasis = 'grains' | 'potatoes' | 'legumes' | 'poultry' | 'fish' | 'dairy' | 'eggs';
const EMPHASES: readonly Emphasis[] = ['grains', 'potatoes', 'legumes', 'poultry', 'fish', 'dairy', 'eggs'];

/** Основы, которые диета или аллерген исключают. Свинины и алкоголя в списке нет, поэтому halal ничего не убирает. */
const EXCLUDED_BY_DIET: Readonly<Record<string, readonly Emphasis[]>> = {
  vegan: ['poultry', 'fish', 'dairy', 'eggs'],
  vegetarian: ['poultry', 'fish'],
  pescatarian: ['poultry'],
};
const EXCLUDED_BY_ALLERGEN: Readonly<Record<string, readonly Emphasis[]>> = { milk: ['dairy'], eggs: ['eggs'], fish: ['fish'], gluten: ['grains'] };

/** Основы, которые профиль разрешает. Пустым список не бывает: картофель и бобовые остаются всегда. */
export function allowedEmphases({ dietaryPreferences, allergens }: Pick<FoodPreferences, 'dietaryPreferences' | 'allergens'>): readonly Emphasis[] {
  const excluded = new Set([...dietaryPreferences.flatMap((diet) => EXCLUDED_BY_DIET[diet] ?? []), ...allergens.flatMap((code) => EXCLUDED_BY_ALLERGEN[code] ?? [])]);
  return EMPHASES.filter((emphasis) => !excluded.has(emphasis));
}

/** Случайная подсказка для новой генерации. Прошлую подсказку по возможности не повторяет. */
export function chooseMealPlanVariation(preferences: Pick<FoodPreferences, 'dietaryPreferences' | 'allergens'>, previous: MealPlanVariation | null, random: () => number = Math.random): MealPlanVariation {
  const pick = <T>(items: readonly T[], last: T | undefined): T => {
    const fresh = items.length > 1 ? items.filter((item) => item !== last) : items;
    return fresh[Math.min(fresh.length - 1, Math.floor(random() * fresh.length))]!;
  };
  return { style: pick(STYLES, previous?.style as (typeof STYLES)[number] | undefined), emphasis: pick(allowedEmphases(preferences), previous?.emphasis as Emphasis | undefined) };
}
