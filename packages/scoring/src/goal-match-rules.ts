import type { AllergenCode, DietaryPreference, NutritionGoal, NutritionTargets, ProductCategory } from '@foodlens/core';

/**
 * Правила Goal Match v1. Все пороги и веса собраны здесь, чтобы результат можно было проверить вручную.
 *
 * 1. Goal Match = BASE_MATCH + баллы факторов, ограничен 0–100 и округлён до целого.
 *    Цели пользователя берутся из Nutrition Engine (NutritionTargets), здесь они не пересчитываются.
 * 2. Нутриенты сравниваются с планом по плотности, без порции: во сколько раз доля нутриента
 *    в калориях продукта больше, чем в дневном плане. 1 — ровно как в плане, 2 — вдвое больше.
 *    Так 100 г никогда не сравниваются с целой дневной нормой.
 * 3. Калории сравниваются по порции: какую долю дневной цели калорий она занимает.
 *    Без размера порции на упаковке этот фактор не учитывается: порция не выдумывается.
 *    Для еды отдельно учитывается калорийность на 100 г, с весом по цели (важнее всего при снижении веса).
 * 4. Баллы фактора — кусочно-линейная функция (MatchCurve) с отдельными точками для каждой цели.
 * 5. Если продукт содержит аллерген из профиля или противоречит диете — conflict, value = 0.
 * 6. Фактор без данных не учитывается (0 баллов, not_counted). Без калорийности value нет.
 */
export const GOAL_MATCH_VERSION = 'goal-match-v1';

export const BASE_MATCH = 60;
export const MATCH_MIN = 0;
export const MATCH_MAX = 100;

/** Нижние границы уровней value. Ниже fair — poor. */
export const MATCH_LEVELS = { great: 80, good: 60, fair: 40 } as const;

/** При калорийности ниже этой (на 100 г/мл или на порцию) доли нутриентов в калориях не имеют смысла: вода, чай. */
export const MIN_KCAL_FOR_RATIOS = 5;

/** Точки [x, баллы], x по возрастанию. Между точками — линейно, за краями — значение крайней точки. */
export type MatchCurve = readonly (readonly [number, number])[];

export type RatioKind = 'protein' | 'fat' | 'carbs' | 'sugars' | 'saturatedFat' | 'salt';

/** Уровень нутриента по отношению к плану: low < 0.5, high ≥ 1.5, иначе moderate. */
export const RATIO_LEVELS = { lowBelow: 0.5, highFrom: 1.5 } as const;

/** Уровень калорий порции (% дневной цели): low ≤ 10, high > 25, иначе moderate. */
export const CALORIE_SHARE_LEVELS = { lowMax: 10, highAbove: 25 } as const;

/** Уровень калорийности еды, ккал на 100 г: low ≤ 150, high > 400, иначе moderate. */
export const ENERGY_DENSITY_LEVELS = { lowMax: 150, highAbove: 400 } as const;

/**
 * Дневное количество нутриента для плана пользователя, г.
 * Белки, жиры и углеводы — цели Nutrition Engine. Для сахаров, насыщенных жиров и соли целей нет,
 * поэтому используются общепринятые верхние нормы, пересчитанные на калорийность плана:
 * сахара — 90 г на 2000 ккал (референсная норма ЕС), насыщенные жиры — 10% калорий (ВОЗ), соль — 5 г (ВОЗ).
 */
export function dailyAmount(kind: RatioKind, targets: NutritionTargets): number {
  switch (kind) {
    case 'protein':
      return targets.proteinG;
    case 'fat':
      return targets.fatG;
    case 'carbs':
      return targets.carbsG;
    case 'sugars':
      return (90 / 2000) * targets.caloriesKcal;
    case 'saturatedFat':
      return (0.1 * targets.caloriesKcal) / 9;
    case 'salt':
      return 5;
  }
}

export interface GoalRules {
  /** x — доля дневной цели калорий в порции, %. */
  readonly calories: MatchCurve;
  /** x — ккал на 100 г. Только для еды: у напитков калории — это сахар, он учтён отдельно. */
  readonly energyDensity: MatchCurve;
  /** x — отношение к плану (1 = как в плане). */
  readonly ratios: Readonly<Record<RatioKind, MatchCurve>>;
}

const NO_POINTS: MatchCurve = [[0, 0]];

/** Белок важнее всего при снижении и наборе веса: он сохраняет и наращивает мышцы. */
const PROTEIN_KEY: MatchCurve = [[0, -10], [1, 0], [2, 20]];
const PROTEIN_SOFT: MatchCurve = [[0, -5], [1, 0], [2, 15]];

/** Калории порции при поддержании веса и здоровом питании: штраф, только если порция очень большая. */
const CALORIES_BALANCED: MatchCurve = [[15, 5], [25, 0], [40, -15]];
const ENERGY_DENSITY_BALANCED: MatchCurve = [[100, 3], [250, 0], [450, -10]];

export const GOAL_RULES: Readonly<Record<NutritionGoal, GoalRules>> = {
  lose_weight: {
    calories: [[10, 5], [20, 0], [35, -20]],
    // Для снижения веса важна калорийность на 100 г: менее калорийная еда даёт больше сытости на те же калории.
    energyDensity: [[100, 5], [250, 0], [450, -15], [600, -25]],
    ratios: {
      protein: PROTEIN_KEY,
      fat: [[1.5, 0], [3, -10]],
      carbs: [[1.5, 0], [2.5, -6]],
      sugars: [[1.5, 0], [3, -25]],
      saturatedFat: [[1.5, 0], [3, -15]],
      salt: [[1.5, 0], [4, -15]],
    },
  },
  maintain_weight: {
    calories: CALORIES_BALANCED,
    energyDensity: ENERGY_DENSITY_BALANCED,
    ratios: {
      protein: PROTEIN_SOFT,
      fat: [[1.5, 0], [3, -8]],
      carbs: [[1.5, 0], [2.5, -5]],
      sugars: [[1.5, 0], [3, -20]],
      saturatedFat: [[1.5, 0], [3, -15]],
      salt: [[1.5, 0], [4, -15]],
    },
  },
  gain_weight: {
    // Калорийная порция помогает набрать вес, маленькая не вредит.
    calories: [[5, 0], [15, 10]],
    energyDensity: [[100, 0], [300, 5]],
    ratios: {
      protein: PROTEIN_KEY,
      fat: [[2, 0], [4, -5]],
      carbs: NO_POINTS,
      sugars: [[1.5, 0], [3, -15]],
      saturatedFat: [[1.5, 0], [3, -10]],
      salt: [[1.5, 0], [4, -10]],
    },
  },
  eat_healthier: {
    calories: CALORIES_BALANCED,
    energyDensity: ENERGY_DENSITY_BALANCED,
    ratios: {
      protein: PROTEIN_SOFT,
      fat: [[1.5, 0], [3, -8]],
      carbs: [[1.5, 0], [2.5, -5]],
      sugars: [[1.5, 0], [3, -25]],
      saturatedFat: [[1.5, 0], [3, -20]],
      salt: [[1.5, 0], [4, -20]],
    },
  },
};

/** Следы аллергена («может содержать»): не запрет, но серьёзное предупреждение. */
export const MAY_CONTAIN_ALLERGEN_POINTS = -30;

/** Ингредиент из списка «избегать»: предпочтение, а не запрет, поэтому штраф, а не conflict. */
export const AVOIDED_INGREDIENT_POINTS = -40;

/**
 * Что противоречит диете. Проверяется только то, что видно на этикетке: аллергены «содержит» и категория.
 * Отсутствие противоречий не означает, что продукт веганский: например, желатин так не находится.
 * none не задаёт ограничений.
 */
export const DIET_CONFLICTS: Readonly<
  Partial<Record<DietaryPreference, { readonly allergens: readonly AllergenCode[]; readonly categories: readonly ProductCategory[] }>>
> = {
  vegan: { allergens: ['milk', 'eggs', 'fish', 'crustaceans', 'molluscs'], categories: ['meat', 'fish'] },
  vegetarian: { allergens: ['fish', 'crustaceans', 'molluscs'], categories: ['meat', 'fish'] },
  pescatarian: { allergens: [], categories: ['meat'] },
};
