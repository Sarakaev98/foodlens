import type { Brand, Confidence } from '../common';
import type { NutritionFacts } from '../nutrition';
import type { Additive } from './additive';
import type { Allergen } from './allergen';
import type { Ingredient } from './ingredient';
import type { ProductSource } from './product-source';

export type ProductId = Brand<string, 'ProductId'>;

export interface ProductCategory {
  /** Стабильный машинный идентификатор, например "dairy.yogurt". */
  readonly id: string;
  readonly name: string;
}

/**
 * Нормализованный продукт: единый формат, который возвращает Scan
 * независимо от способа получения (штрихкод, фото, ручной ввод)
 * и с которым работают scoring, AI и UI.
 */
export interface Product {
  readonly id: ProductId;
  readonly name: string;
  readonly brand?: string;
  readonly category?: ProductCategory;
  readonly nutrition?: NutritionFacts;
  readonly ingredients: readonly Ingredient[];
  readonly allergens: readonly Allergen[];
  readonly additives: readonly Additive[];
  readonly source: ProductSource;
  /** Насколько мы доверяем данным продукта в целом. */
  readonly confidence: Confidence;
}
