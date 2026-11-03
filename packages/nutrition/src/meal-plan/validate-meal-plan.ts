import { normalizeDietaryPreferences } from '@foodlens/core';
import { ALLERGEN_CODES, sumMeals, type AllergenCode, type FoodPreferences, type Meal, type MealMacros, type MealPlan, type NutritionTargets } from '@foodlens/core';
import { ALLERGEN_FOODS, DIET_FOODS, LABEL_ALLERGEN_FOODS, SAFE_PHRASES } from './restricted-foods';

/** Насколько итог дня может отличаться от цели: калории, БЖУ. */
export const MEAL_PLAN_TOLERANCE = { calories: 0.1, macros: 0.2 } as const;

/** Насколько калории блюда могут расходиться с 4·Б + 4·У + 9·Ж. */
const MEAL_ENERGY_TOLERANCE = 0.25;

/**
 * Широкие физические границы для блюда, если вес порции указан явно. Ловят только невозможное:
 * больше 9 ккал на грамм не бывает даже у масла, меньше 0,1 ккал на грамм это вода или чай, а не блюдо.
 */
export const PORTION_SANITY = { minKcalPerGram: 0.1, maxKcalPerGram: 9, maxGrams: 2000 } as const;

const MACRO_LABELS: readonly (readonly [keyof MealMacros, string])[] = [
  ['proteinG', 'protein'],
  ['carbsG', 'carbs'],
  ['fatG', 'fat'],
];

export type MealPlanIssueKind = 'restriction' | 'nutrition';

export interface MealPlanIssue {
  /** restriction: нарушение профиля, такой план показывать нельзя. nutrition: значения далеко от цели. */
  readonly kind: MealPlanIssueKind;
  /** На английском: уходит в запрос на исправление к AI, пользователю не показывается. */
  readonly message: string;
}

/**
 * Детерминированная проверка плана AI. Модель не единственный судья: диета, аллергены и нежелательные продукты
 * проверяются по названию и ингредиентам каждого блюда, калории и БЖУ по сумме блюд.
 */
export function validateMealPlan(plan: MealPlan, targets: NutritionTargets, preferences: FoodPreferences): readonly MealPlanIssue[] {
  const meals = plan.days.flatMap((day) => day.meals);
  if (meals.length === 0) return [{ kind: 'nutrition', message: 'The plan has no meals' }];
  return [...meals.flatMap((meal) => restrictionIssues(meal, preferences)), ...totalsIssues(sumMeals(meals), targets, plan.days.length), ...meals.flatMap(energyIssues), ...meals.flatMap(structureIssues), ...meals.flatMap(portionIssues)];
}

/** Блюдо без порции, ингредиентов или с невозможными числами показать нельзя: модель должна его переписать. */
function structureIssues(meal: Meal): readonly MealPlanIssue[] {
  const issue = (message: string): MealPlanIssue => ({ kind: 'nutrition', message: `"${meal.name}": ${message}` });
  const issues: MealPlanIssue[] = [];
  if (!meal.name.trim()) issues.push(issue('the meal has no name'));
  if (!meal.portion.trim()) issues.push(issue('the portion is empty'));
  if (meal.ingredients.length === 0 || meal.ingredients.some((item) => !item.trim())) issues.push(issue('every meal needs a non-empty list of ingredients'));
  if (!(meal.caloriesKcal > 0)) issues.push(issue('calories must be above 0'));
  if ([meal.proteinG, meal.carbsG, meal.fatG].some((value) => !(value >= 0))) issues.push(issue('protein, carbs and fat cannot be negative'));
  return issues;
}

/**
 * Вес порции, только если он назван явно и один: «350 г», «1 тарелка, 350 г», «350 ml». Миллилитры считаются граммами только для этой проверки.
 * null: веса нет или их несколько, проверять нечего.
 */
export function portionGrams(portion: string): number | null {
  const text = portion.toLowerCase();
  // «2 шт. по 50 г» и «2 × 50 г» называют вес одной штуки, а не порции.
  if (/(?:^|\s)по\s+\d|\d\s*[×x*]\s*\d/.test(text)) return null;
  const found = [...text.matchAll(/(?<![\d.,])(-?\d+(?:[.,]\d+)?)\s*(г|гр|g|мл|ml)(?![a-zа-я])/g)];
  return found.length === 1 ? Number(found[0]![1]!.replace(',', '.')) : null;
}

/** Калории и БЖУ, невозможные для заявленного веса порции. Без явного веса блюдо не проверяется. */
function portionIssues(meal: Meal): readonly MealPlanIssue[] {
  const grams = portionGrams(meal.portion);
  if (grams === null) return [];
  const issue = (message: string): MealPlanIssue => ({ kind: 'nutrition', message: `"${meal.name}": ${message}` });
  if (!(grams > 0) || grams > PORTION_SANITY.maxGrams) return [issue(`the portion weight ${grams} g is not a real serving`)];
  const issues: MealPlanIssue[] = [];
  const density = meal.caloriesKcal / grams;
  if (density > PORTION_SANITY.maxKcalPerGram) issues.push(issue(`${meal.caloriesKcal} kcal in ${grams} g is physically impossible`));
  else if (density < PORTION_SANITY.minKcalPerGram) issues.push(issue(`${meal.caloriesKcal} kcal in ${grams} g is far too little for this meal`));
  if (meal.proteinG + meal.carbsG + meal.fatG > grams) issues.push(issue(`protein, carbs and fat weigh more than the whole ${grams} g portion`));
  return issues;
}

function restrictionIssues(meal: Meal, { dietaryPreferences, allergens, avoidedIngredients }: FoodPreferences): readonly MealPlanIssue[] {
  const text = mealText(meal);
  const issue = (message: string): MealPlanIssue => ({ kind: 'restriction', message: `"${meal.name}": ${message}` });
  const dietIssues = normalizeDietaryPreferences(dietaryPreferences).flatMap((diet) => {
    const found = firstMatch(text, DIET_FOODS[diet] ?? []);
    return found ? [issue(`"${found}" is not allowed for a ${diet} diet`)] : [];
  });
  const allergenIssues = allergens.flatMap((code: AllergenCode) => {
    const found = firstMatch(text, ALLERGEN_FOODS[code]);
    return found ? [issue(`"${found}" contains the allergen ${code}`)] : [];
  });
  const avoidedIssues = avoidedIngredients.flatMap((ingredient) => {
    const stem = ingredientStem(ingredient);
    return stem && firstMatch(text, [escapeRegExp(stem)]) ? [issue(`contains avoided ingredient "${ingredient}"`)] : [];
  });
  return [...dietIssues, ...allergenIssues, ...avoidedIssues];
}

function totalsIssues(totals: MealMacros, targets: NutritionTargets, days: number): readonly MealPlanIssue[] {
  const off = (actual: number, target: number, tolerance: number) => Math.abs(actual / days - target) > target * tolerance;
  const issues: MealPlanIssue[] = [];
  if (off(totals.caloriesKcal, targets.caloriesKcal, MEAL_PLAN_TOLERANCE.calories)) {
    issues.push({ kind: 'nutrition', message: `Day calories must be close to ${targets.caloriesKcal} kcal, got ${Math.round(totals.caloriesKcal / days)}` });
  }
  for (const [key, label] of MACRO_LABELS) {
    const target = targets[key as 'proteinG' | 'carbsG' | 'fatG'];
    if (off(totals[key], target, MEAL_PLAN_TOLERANCE.macros)) {
      issues.push({ kind: 'nutrition', message: `Day ${label} must be close to ${target} g, got ${Math.round(totals[key] / days)}` });
    }
  }
  return issues;
}

function energyIssues(meal: Meal): readonly MealPlanIssue[] {
  const fromMacros = 4 * meal.proteinG + 4 * meal.carbsG + 9 * meal.fatG;
  if (Math.abs(meal.caloriesKcal - fromMacros) <= fromMacros * MEAL_ENERGY_TOLERANCE) return [];
  return [{ kind: 'nutrition', message: `"${meal.name}": ${meal.caloriesKcal} kcal does not match its macros (${Math.round(fromMacros)} kcal)` }];
}

/** Описание не проверяется: в нём возможно «без молока». */
function mealText(meal: Meal): string {
  return foodText([meal.name, ...meal.ingredients].join('; '));
}

/** Текст для поиска продуктов: нижний регистр, без отрицаний и безопасных замен. */
function foodText(raw: string): string {
  const text = raw.toLowerCase().replace(/ё/g, 'е').replace(/без\s+[а-я]+/g, ' ').replace(/\bwithout\s+[a-z]+/g, ' ');
  return SAFE_PHRASES.reduce((clean, phrase) => clean.replace(phrase, '$1'), text);
}

/** Аллергены, прямо названные в тексте состава. Никаких догадок по категории продукта. */
export function detectAllergens(ingredients: string): readonly AllergenCode[] {
  const text = foodText(ingredients);
  return ALLERGEN_CODES.filter((code) => firstMatch(text, LABEL_ALLERGEN_FOODS[code]) !== null);
}

function firstMatch(text: string, foods: readonly string[]): string | null {
  if (foods.length === 0) return null;
  const match = new RegExp(`(?:^|[^a-zа-я])((?:${foods.join('|')})[a-zа-я]*)`).exec(text);
  return match?.[1] ?? null;
}

/** "Кинза" → "кинз": так находятся и другие падежи. Короткие слова остаются целиком. */
function ingredientStem(ingredient: string): string {
  const word = ingredient.trim().toLowerCase().replace(/ё/g, 'е');
  return word.length > 4 ? word.slice(0, -1) : word;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
