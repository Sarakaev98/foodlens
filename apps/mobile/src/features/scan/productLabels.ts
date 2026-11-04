import { NUTRIENT_KEYS, type AllergenCode, type ExternalProvenance, type NutritionBasis, type Product, type ProductCategory } from '@foodlens/core';

export const CATEGORY_LABELS: Readonly<Record<ProductCategory, string>> = {
  beverage: 'Beverage',
  water: 'Water',
  juice: 'Juice',
  dairy: 'Dairy',
  yogurt: 'Yogurt',
  cheese: 'Cheese',
  meat: 'Meat',
  fish: 'Fish',
  nuts: 'Nuts',
  snack: 'Snack',
  chocolate: 'Chocolate',
  sweets: 'Sweets',
  bakery: 'Bakery',
  bread: 'Bread',
  cereal: 'Cereals & Grains',
  sauce: 'Sauce',
  ready_meal: 'Ready Meal',
  protein_product: 'Protein Product',
  fruit: 'Fruit',
  vegetable: 'Vegetables',
  other: 'Other',
};

export const ALLERGEN_LABELS: Readonly<Record<AllergenCode, string>> = {
  gluten: 'Gluten',
  crustaceans: 'Crustaceans',
  eggs: 'Eggs',
  fish: 'Fish',
  peanuts: 'Peanuts',
  soy: 'Soy',
  milk: 'Milk',
  tree_nuts: 'Tree nuts',
  celery: 'Celery',
  mustard: 'Mustard',
  sesame: 'Sesame',
  sulphites: 'Sulphites',
  lupin: 'Lupin',
  molluscs: 'Molluscs',
};

export const BASIS_LABELS: Readonly<Record<NutritionBasis, string>> = {
  per_100g: 'per 100 g',
  per_100ml: 'per 100 ml',
  per_serving: 'per serving',
  unknown: 'basis not specified',
};

export const NOT_DETECTED_LABEL = 'Not detected';

function usesSource(product: Product, source: ExternalProvenance): boolean {
  const fields = [product.name, product.brand, product.ingredients, product.allergens, product.additives];
  const nutrition = product.nutrition;
  const nutrients = nutrition ? [nutrition.servingSize, ...NUTRIENT_KEYS.map((key) => nutrition[key])] : [];
  return [...fields, ...nutrients].some((field) => field.provenance === source) ||
    (product.allergens.value?.some((item) => item.provenance === source) ?? false) ||
    (product.additives.value?.some((item) => item.provenance === source) ?? false);
}

/** Есть ли в продукте данные Open Food Facts: тогда нужна атрибуция по условиям ODbL. */
export const usesOpenFoodFacts = (product: Product): boolean => usesSource(product, 'open_food_facts');

/** Есть ли в продукте данные FatSecret: тогда нужна их подпись. */
export const usesFatSecret = (product: Product): boolean => usesSource(product, 'fatsecret');

/** Подпись к тексту с упаковки на другом языке: его показываем как есть и не переводим. */
export const ORIGINAL_TEXT_LABEL = 'as printed on the package, not translated';

/** Больше букв не латиницей, чем латиницей: интерфейс на английском. Диапазоны вместо \p{L}: так надёжнее в Hermes. */
export function isForeignText(text: string): boolean {
  const latin = text.match(/[A-Za-z\u00C0-\u024F]/g)?.length ?? 0;
  const other = text.match(/[\u0370-\u03FF\u0400-\u04FF\u0590-\u1FFF\u3040-\uD7FF]/g)?.length ?? 0;
  return other > latin;
}

/** E-номер понятен на любом языке: название на другом языке рядом с ним только мешает. */
export function additiveLabel(additive: { readonly code: string | null; readonly name: string | null }): string {
  if (additive.code && additive.name && isForeignText(additive.name)) return additive.code;
  return [additive.code, additive.name].filter(Boolean).join(' · ');
}
