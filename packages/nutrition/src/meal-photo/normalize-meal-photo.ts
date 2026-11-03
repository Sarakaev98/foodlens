import { lowestConfidence, sumMeals, type ConfidenceLevel, type MealPhotoEstimate, type MealPhotoItem } from '@foodlens/core';

/** Ответ модели в том виде, в каком его проверила JSON-схема. Структурный тип: пакет не зависит от @foodlens/ai. */
export interface RawMealPhotoEstimate {
  readonly is_food: boolean;
  readonly meal_name: string;
  readonly items: readonly {
    readonly name: string;
    readonly grams: number;
    readonly kcal: number;
    readonly protein_g: number;
    readonly carbs_g: number;
    readonly fat_g: number;
    readonly confidence: ConfidenceLevel;
  }[];
  readonly total_kcal: number;
  readonly kcal_min: number | null;
  readonly kcal_max: number | null;
  readonly confidence: ConfidenceLevel;
  readonly assumptions: readonly string[];
}

/** Что исправлено при нормализации: только для логов. */
export interface MealPhotoNormalizationReport {
  readonly droppedItems: number;
  /** Калории компонента пересчитаны из БЖУ: модель дала несогласованные числа. */
  readonly adjustedItems: number;
  readonly aiTotalKcal: number;
  /** Насколько total модели отличался от суммы компонентов, %. */
  readonly totalDiffPercent: number;
}

export type MealPhotoNormalization =
  | { readonly kind: 'estimate'; readonly estimate: MealPhotoEstimate; readonly report: MealPhotoNormalizationReport }
  /** Модель не увидела еду или фото слишком плохое. */
  | { readonly kind: 'no_food' }
  /** Еда есть, но ни одного правдоподобного компонента: ответ модели не годится. */
  | { readonly kind: 'invalid' };

/** Границы правдоподобия одной тарелки. Это не медицинские нормы, а защита от бессмысленных чисел. */
export const MEAL_PHOTO_LIMITS = {
  maxItems: 8,
  maxItemGrams: 1500,
  maxItemKcal: 2500,
  maxMealKcal: 4000,
  /** Чистый жир: 9 ккал на грамм, плотнее еды не бывает. */
  maxKcalPerGram: 9,
  /** Расхождение ккал и 4Б+4У+9Ж, после которого калории пересчитываются из БЖУ. */
  kcalMismatchShare: 0.2,
  kcalMismatchMinKcal: 40,
  maxNameLength: 80,
  maxAssumptions: 3,
  maxAssumptionLength: 120,
} as const;

/** Разброс по уверенности, если диапазон модели неправдоподобен. */
const RANGE_SHARE: Readonly<Record<ConfidenceLevel, number>> = { high: 0.1, medium: 0.2, low: 0.3 };

const finite = (value: number) => Number.isFinite(value);
const roundTo = (value: number, step: number) => Math.round(value / step) * step;

/**
 * Проверяет ответ модели и сводит его в одну согласованную модель:
 * компоненты с отрицательными или невозможными числами отбрасываются, ккал компонента сверяются с БЖУ,
 * итог всегда сумма компонентов (total модели только для лога), диапазон всегда содержит итог.
 */
export function normalizeMealPhotoEstimate(raw: RawMealPhotoEstimate): MealPhotoNormalization {
  if (!raw.is_food || raw.items.length === 0) return { kind: 'no_food' };

  let dropped = 0;
  let adjusted = 0;
  const items: MealPhotoItem[] = [];
  for (const item of raw.items.slice(0, MEAL_PHOTO_LIMITS.maxItems)) {
    const normalized = normalizeItem(item);
    if (!normalized) dropped++;
    else {
      if (normalized.adjusted) adjusted++;
      items.push(normalized.item);
    }
  }
  dropped += Math.max(0, raw.items.length - MEAL_PHOTO_LIMITS.maxItems);
  if (items.length === 0) return { kind: 'invalid' };

  const total = sumMeals(items);
  if (total.caloriesKcal <= 0 || total.caloriesKcal > MEAL_PHOTO_LIMITS.maxMealKcal) return { kind: 'invalid' };

  const confidence = dropped > 0 || adjusted > 0 ? lowestConfidence(raw.confidence, 'medium') : raw.confidence;
  const aiTotalKcal = finite(raw.total_kcal) ? Math.round(raw.total_kcal) : 0;
  return {
    kind: 'estimate',
    estimate: {
      mealName: mealName(raw.meal_name, items),
      items,
      total,
      calorieRange: calorieRange(raw, total.caloriesKcal, confidence),
      confidence,
      assumptions: raw.assumptions
        .map((text) => text.trim().slice(0, MEAL_PHOTO_LIMITS.maxAssumptionLength))
        .filter(Boolean)
        .slice(0, MEAL_PHOTO_LIMITS.maxAssumptions),
    },
    report: {
      droppedItems: dropped,
      adjustedItems: adjusted,
      aiTotalKcal,
      totalDiffPercent: Math.round((Math.abs(aiTotalKcal - total.caloriesKcal) / total.caloriesKcal) * 100),
    },
  };
}

function normalizeItem(item: RawMealPhotoEstimate['items'][number]): { item: MealPhotoItem; adjusted: boolean } | null {
  const name = item.name.trim().slice(0, MEAL_PHOTO_LIMITS.maxNameLength);
  const numbers = [item.grams, item.kcal, item.protein_g, item.carbs_g, item.fat_g];
  if (!name || !numbers.every((value) => finite(value) && value >= 0)) return null;
  if (item.grams > MEAL_PHOTO_LIMITS.maxItemGrams || item.kcal > MEAL_PHOTO_LIMITS.maxItemKcal) return null;
  // Граммы БЖУ не больше веса порции (с запасом на округление), энергия не плотнее чистого жира.
  if (item.grams > 0 && (item.protein_g + item.carbs_g + item.fat_g > item.grams * 1.05 || item.kcal > item.grams * MEAL_PHOTO_LIMITS.maxKcalPerGram)) {
    return null;
  }

  const macroKcal = 4 * item.protein_g + 4 * item.carbs_g + 9 * item.fat_g;
  const mismatch = Math.abs(item.kcal - macroKcal);
  const adjusted = macroKcal > 0 && mismatch > Math.max(MEAL_PHOTO_LIMITS.kcalMismatchMinKcal, MEAL_PHOTO_LIMITS.kcalMismatchShare * Math.max(item.kcal, macroKcal));
  const kcal = adjusted ? macroKcal : item.kcal;
  if (kcal <= 0) return null;

  return {
    adjusted,
    item: {
      name,
      estimatedGrams: Math.round(item.grams),
      caloriesKcal: Math.round(kcal),
      proteinG: Math.round(item.protein_g),
      carbsG: Math.round(item.carbs_g),
      fatG: Math.round(item.fat_g),
      confidence: item.confidence,
    },
  };
}

function mealName(raw: string, items: readonly MealPhotoItem[]): string {
  const name = raw.trim().slice(0, MEAL_PHOTO_LIMITS.maxNameLength);
  if (name) return name;
  return items.length === 1 ? items[0]!.name : 'Meal';
}

/** Диапазон модели, если он правдоподобен и содержит итог; иначе разброс по уверенности. Шаг 10 ккал. */
function calorieRange(raw: RawMealPhotoEstimate, total: number, confidence: ConfidenceLevel): MealPhotoEstimate['calorieRange'] {
  const { kcal_min: min, kcal_max: max } = raw;
  if (min !== null && max !== null && finite(min) && finite(max) && min <= total && total <= max && min >= total * 0.5 && max <= total * 2) {
    return { min: Math.min(roundTo(min, 10), total), max: Math.max(roundTo(max, 10), total) };
  }
  const share = RANGE_SHARE[confidence];
  return { min: roundTo(total * (1 - share), 10), max: roundTo(total * (1 + share), 10) };
}
