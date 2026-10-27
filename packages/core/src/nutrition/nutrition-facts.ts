import type { Energy, Mass, Volume } from '../common';

/** К какому количеству продукта относятся значения. */
export type NutritionBasis =
  | { readonly kind: 'per100g' }
  | { readonly kind: 'per100ml' }
  | { readonly kind: 'perServing'; readonly servingSize: Mass | Volume };

/**
 * Пищевая ценность. Все нутриенты опциональны: источники (этикетка,
 * база штрихкодов, распознавание) часто дают неполные данные.
 */
export interface NutritionFacts {
  readonly basis: NutritionBasis;
  readonly energy?: Energy;
  readonly protein?: Mass;
  readonly fat?: Mass;
  readonly saturatedFat?: Mass;
  readonly carbohydrates?: Mass;
  readonly sugars?: Mass;
  readonly fiber?: Mass;
  readonly salt?: Mass;
}
