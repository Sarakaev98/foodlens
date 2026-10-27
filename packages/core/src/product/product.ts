import type { Brand, ConfidenceLevel, Detected } from '../common';
import type { NutritionFacts } from '../nutrition';
import type { Additive } from './additive';
import type { Allergen } from './allergen';
import type { Ingredient } from './ingredient';
import type { ProductCategory } from './product-category';
import type { ProductSource } from './product-source';

export type ProductId = Brand<string, 'ProductId'>;

/**
 * Уверенность по разделам. Раздел, которого нет на изображении, имеет null:
 * уверенность в отсутствующих данных не имеет смысла.
 */
export interface ProductConfidence {
  readonly overall: ConfidenceLevel;
  readonly identity: ConfidenceLevel;
  readonly nutrition: ConfidenceLevel | null;
  readonly ingredients: ConfidenceLevel | null;
}

/**
 * Нормализованный продукт: единый формат, который возвращает Scan
 * независимо от способа получения (фото, штрихкод, ручной ввод)
 * и с которым работают scoring, AI и UI.
 */
export interface Product {
  readonly id: ProductId;
  readonly name: Detected<string>;
  readonly brand: Detected<string>;
  readonly category: Detected<ProductCategory>;
  /** null: этикетки с пищевой ценностью на изображении нет. */
  readonly nutrition: NutritionFacts | null;
  /** Состав в порядке этикетки. not_detected: состава на изображении нет. */
  readonly ingredients: Detected<readonly Ingredient[]>;
  /** not_detected: ни состава, ни заявления об аллергенах не видно. Пустой список: аллергены не указаны. */
  readonly allergens: Detected<readonly Allergen[]>;
  readonly additives: Detected<readonly Additive[]>;
  readonly confidence: ProductConfidence;
  readonly source: ProductSource;
}
