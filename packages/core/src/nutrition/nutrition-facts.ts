import type { Detected } from '../common';

/** К какому количеству продукта относятся значения. Разные основы никогда не смешиваются. */
export const NUTRITION_BASES = ['per_100g', 'per_100ml', 'per_serving', 'unknown'] as const;

export type NutritionBasis = (typeof NUTRITION_BASES)[number];

export interface ServingSize {
  readonly amount: number;
  readonly unit: 'g' | 'ml';
}

/** Значение нутриента. Единица измерения зашита в имя поля (kcal, G, Mg). */
export type NutrientValue = Detected<number>;

/**
 * Пищевая ценность с этикетки. Каждый нутриент может отсутствовать:
 * not_detected означает «на этикетке не видно», это не ноль.
 */
export interface NutritionFacts {
  readonly basis: NutritionBasis;
  /** Размер порции, если указан на упаковке (для basis = per_serving обязателен по смыслу, но может быть не виден). */
  readonly servingSize: Detected<ServingSize>;
  readonly caloriesKcal: NutrientValue;
  readonly proteinG: NutrientValue;
  readonly carbsG: NutrientValue;
  readonly sugarsG: NutrientValue;
  readonly fatG: NutrientValue;
  readonly saturatedFatG: NutrientValue;
  readonly fiberG: NutrientValue;
  /** Соль (NaCl) в граммах. Не путать с натрием: соль ≈ натрий × 2.5. */
  readonly saltG: NutrientValue;
  /** Натрий в миллиграммах. */
  readonly sodiumMg: NutrientValue;
}

export type NutrientKey = Exclude<keyof NutritionFacts, 'basis' | 'servingSize'>;

export const NUTRIENT_KEYS = [
  'caloriesKcal',
  'proteinG',
  'carbsG',
  'sugarsG',
  'fatG',
  'saturatedFatG',
  'fiberG',
  'saltG',
  'sodiumMg',
] as const satisfies readonly NutrientKey[];
