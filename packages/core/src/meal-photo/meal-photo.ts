import type { ConfidenceLevel } from '../common';
import type { MealMacros } from '../meal-plan';

/** Компонент тарелки: «курица ≈150 г». Все числа приблизительные. */
export interface MealPhotoItem extends MealMacros {
  readonly name: string;
  readonly estimatedGrams: number;
  readonly confidence: ConfidenceLevel;
}

/**
 * Оценка блюда по одной фотографии. Это не измерение: total всегда сумма items (её считает сервер),
 * calorieRange показывает разброс оценки, а основная цифра одна.
 */
export interface MealPhotoEstimate {
  readonly mealName: string;
  readonly items: readonly MealPhotoItem[];
  readonly total: MealMacros;
  readonly calorieRange: { readonly min: number; readonly max: number };
  readonly confidence: ConfidenceLevel;
  /** Короткие допущения модели, не больше трёх: «Возможно, использовано масло». */
  readonly assumptions: readonly string[];
}

/** Ответ POST /scan/meal. Product Score у блюда нет. */
export interface MealPhotoScanResult {
  readonly estimate: MealPhotoEstimate;
}
