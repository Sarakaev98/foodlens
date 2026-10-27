/** Нормализованные категории продукта. Всё, что не подходит, становится "other". */
export const PRODUCT_CATEGORIES = [
  'beverage',
  'water',
  'juice',
  'dairy',
  'yogurt',
  'cheese',
  'meat',
  'fish',
  'nuts',
  'snack',
  'chocolate',
  'sweets',
  'bakery',
  'bread',
  'cereal',
  'sauce',
  'ready_meal',
  'protein_product',
  'fruit',
  'vegetable',
  'other',
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export function isProductCategory(value: unknown): value is ProductCategory {
  return typeof value === 'string' && (PRODUCT_CATEGORIES as readonly string[]).includes(value);
}
