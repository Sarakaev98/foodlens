import { NUTRIENT_KEYS, type AllergenCode, type ExternalProvenance, type NutritionBasis, type Product, type ProductCategory } from '@foodlens/core';

export const CATEGORY_LABELS: Readonly<Record<ProductCategory, string>> = {
  beverage: 'Напиток',
  water: 'Вода',
  juice: 'Сок',
  dairy: 'Молочный продукт',
  yogurt: 'Йогурт',
  cheese: 'Сыр',
  meat: 'Мясо',
  fish: 'Рыба',
  nuts: 'Орехи',
  snack: 'Снек',
  chocolate: 'Шоколад',
  sweets: 'Сладости',
  bakery: 'Выпечка',
  bread: 'Хлеб',
  cereal: 'Злаки и хлопья',
  sauce: 'Соус',
  ready_meal: 'Готовое блюдо',
  protein_product: 'Протеиновый продукт',
  fruit: 'Фрукты',
  vegetable: 'Овощи',
  other: 'Другое',
};

export const ALLERGEN_LABELS: Readonly<Record<AllergenCode, string>> = {
  gluten: 'Глютен',
  crustaceans: 'Ракообразные',
  eggs: 'Яйца',
  fish: 'Рыба',
  peanuts: 'Арахис',
  soy: 'Соя',
  milk: 'Молоко',
  tree_nuts: 'Орехи',
  celery: 'Сельдерей',
  mustard: 'Горчица',
  sesame: 'Кунжут',
  sulphites: 'Сульфиты',
  lupin: 'Люпин',
  molluscs: 'Моллюски',
};

export const BASIS_LABELS: Readonly<Record<NutritionBasis, string>> = {
  per_100g: 'на 100 г',
  per_100ml: 'на 100 мл',
  per_serving: 'на порцию',
  unknown: 'основа не указана',
};

export const NOT_DETECTED_LABEL = 'Не обнаружено';

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
export const ORIGINAL_TEXT_LABEL = 'как на упаковке, без перевода';

/** Больше букв не кириллицей, чем кириллицей. Диапазоны вместо \p{L}: так надёжнее в Hermes. */
export function isForeignText(text: string): boolean {
  const cyrillic = text.match(/[\u0400-\u04FF]/g)?.length ?? 0;
  const other = text.match(/[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0590-\u1FFF\u3040-\uD7FF]/g)?.length ?? 0;
  return other > cyrillic;
}

/** E-номер понятен на любом языке: название на другом языке рядом с ним только мешает. */
export function additiveLabel(additive: { readonly code: string | null; readonly name: string | null }): string {
  if (additive.code && additive.name && isForeignText(additive.name)) return additive.code;
  return [additive.code, additive.name].filter(Boolean).join(' · ');
}
