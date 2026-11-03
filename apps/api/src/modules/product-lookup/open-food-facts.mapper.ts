import { isAllergenCode, type Additive, type Allergen, type AllergenCode, type Ingredient, type NutrientKey, type ProductCategory, type ServingSize } from '@foodlens/core';
import type { BeverageClassification, ProductLookupNutrition, ProductLookupResult } from './product-lookup.provider';

export const OPEN_FOOD_FACTS_PROVIDER = 'open_food_facts';
const KJ_PER_KCAL = 4.184;
/** Те же границы правдоподобия на 100 г/мл, что у нормализатора этикетки. */
const MAX_KCAL = 900;
const MAX_GRAMS = 100;
const MAX_SODIUM_MG = 40_000;
const MAX_SERVING = 5_000;
/** Источники v3.6, которым можно верить для значения 0. Подробности: docs/diagnostics/off-zero-semantics.md. */
const CONFIRMED_ZERO_SOURCES: readonly string[] = ['manufacturer', 'packaging'];
const BEVERAGE_CATEGORIES: readonly string[] = ['en:beverages', 'en:waters', 'en:sodas', 'en:juices', 'en:fruit-juices', 'en:milks', 'en:dairy-drinks'];
/** Жидкие продукты, которые не пьют: их категория всегда важнее тега напитка. Сиропы здесь: это концентрат, а не готовый напиток. */
const NOT_BEVERAGE_CATEGORIES: readonly string[] = ['en:fats', 'en:oils', 'en:vegetable-oils', 'en:olive-oils', 'en:sauces', 'en:dressings', 'en:salad-dressings', 'en:condiments', 'en:vinegars', 'en:syrups', 'en:cooking-creams'];

const NUTRIENT_KEYS: readonly (readonly [NutrientKey, string])[] = [
  ['proteinG', 'proteins'], ['carbsG', 'carbohydrates'], ['sugarsG', 'sugars'], ['fatG', 'fat'],
  ['saturatedFatG', 'saturated-fat'], ['fiberG', 'fiber'], ['saltG', 'salt'],
];

/** Теги Open Food Facts → коды FoodLens. Неизвестные теги пропускаются. */
const ALLERGEN_TAGS: Readonly<Record<string, AllergenCode>> = {
  'en:gluten': 'gluten', 'en:crustaceans': 'crustaceans', 'en:eggs': 'eggs', 'en:fish': 'fish', 'en:peanuts': 'peanuts',
  'en:soybeans': 'soy', 'en:milk': 'milk', 'en:nuts': 'tree_nuts', 'en:celery': 'celery', 'en:mustard': 'mustard',
  'en:sesame-seeds': 'sesame', 'en:sulphur-dioxide-and-sulphites': 'sulphites', 'en:lupin': 'lupin', 'en:molluscs': 'molluscs',
};

type Json = Record<string, unknown>;
const record = (value: unknown): value is Json => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.replace(/\s+/g, ' ').trim() : null);
const tags = (value: unknown): string[] => (Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === 'string') : []);

function positive(value: unknown): number | null {
  const number = typeof value === 'string' && value.trim() ? Number(value.replace(',', '.')) : value;
  return typeof number === 'number' && Number.isFinite(number) && number >= 0 ? number : null;
}

/**
 * Значение нутриента с упаковки. Отбрасываются оценки базы: source "estimate" (рассчитано по составу)
 * и modifier "~" (приблизительно). Такое значение считается отсутствующим.
 */
function nutrient(nutrients: Json, key: string): { readonly value: number; readonly unit: string } | null {
  const item = nutrients[key];
  if (!record(item) || item.source === 'estimate' || item.modifier === '~') return null;
  const value = positive(item.value);
  // Ноль засчитывается, только если он пришёл из данных с упаковки или от производителя и без пометок вроде "<".
  if (value === 0 && !(CONFIRMED_ZERO_SOURCES.includes(item.source as string) && item.modifier === undefined)) return null;
  return value === null ? null : { value, unit: typeof item.unit === 'string' ? item.unit : '' };
}

function grams(item: { readonly value: number; readonly unit: string } | null): number | null {
  if (!item) return null;
  const value = item.unit === 'g' ? item.value : item.unit === 'mg' ? item.value / 1000 : null;
  return value !== null && value <= MAX_GRAMS ? value : null;
}

function mapEnergy(nutrients: Json): { readonly kcal: number | null; readonly derived: boolean } {
  const kcal = nutrient(nutrients, 'energy-kcal');
  if (kcal?.unit === 'kcal' && kcal.value <= MAX_KCAL) return { kcal: kcal.value, derived: false };
  const kj = nutrient(nutrients, 'energy-kj') ?? nutrient(nutrients, 'energy');
  if (kj?.unit !== 'kJ') return { kcal: null, derived: false };
  const converted = Math.round(kj.value / KJ_PER_KCAL);
  return converted <= MAX_KCAL ? { kcal: converted, derived: true } : { kcal: null, derived: false };
}

/**
 * OFF часто хранит значения напитков «на 100 г». Для напитка плотность принимается за 1: 100 г = 100 мл.
 * Решают только категории OFF. Единица мл ничего не доказывает: масло и соус тоже бывают в мл.
 * unknown: категорий нет, основа остаётся как в OFF.
 */
function classifyBeverage(product: Json): BeverageClassification {
  const categories = [...tags(product.categories_tags), ...tags(product.categories_hierarchy)];
  if (categories.length === 0) return 'unknown';
  if (categories.some((tag) => NOT_BEVERAGE_CATEGORIES.includes(tag))) return 'not_beverage';
  return categories.some((tag) => BEVERAGE_CATEGORIES.includes(tag)) ? 'beverage' : 'not_beverage';
}

function mapNutrition(nutrition: unknown, beverage: boolean): ProductLookupNutrition | null {
  const set = record(nutrition) ? nutrition.aggregated_set : null;
  if (!record(set) || !record(set.nutrients) || set.preparation !== 'as_sold') return null;
  const basis = set.per === '100ml' || (set.per === '100g' && beverage) ? 'per_100ml' : set.per === '100g' ? 'per_100g' : null;
  if (!basis) return null;

  const energy = mapEnergy(set.nutrients);
  const sodiumGrams = grams(nutrient(set.nutrients, 'sodium'));
  const sodiumMg = sodiumGrams === null ? null : sodiumGrams * 1000;
  const values = {
    caloriesKcal: energy.kcal, proteinG: null, carbsG: null, sugarsG: null, fatG: null, saturatedFatG: null, fiberG: null, saltG: null,
    sodiumMg: sodiumMg !== null && sodiumMg <= MAX_SODIUM_MG ? sodiumMg : null,
  } as Record<NutrientKey, number | null>;
  for (const [key, name] of NUTRIENT_KEYS) values[key] = grams(nutrient(set.nutrients, name));
  if (Object.values(values).every((value) => value === null)) return null;
  return { basis, values, derived: energy.derived ? ['caloriesKcal'] : [] };
}

/** Только явная порция продукта: поле базы или набор «на порцию» из самих данных, не оценка. */
function mapServing(product: Json): ServingSize | null {
  const unit = (value: unknown): 'g' | 'ml' | null => (value === 'g' || value === 'ml' ? value : null);
  const size = (amount: number | null, servingUnit: 'g' | 'ml' | null): ServingSize | null =>
    amount !== null && amount > 0 && amount <= MAX_SERVING && servingUnit ? { amount, unit: servingUnit } : null;

  const direct = size(positive(product.serving_quantity), unit(product.serving_quantity_unit));
  if (direct) return direct;
  const nutrition = product.nutrition;
  const sets = record(nutrition) && Array.isArray(nutrition.input_sets) ? nutrition.input_sets : [];
  for (const set of sets) {
    if (!record(set) || set.per !== 'serving' || set.source === 'estimate') continue;
    const fromSet = size(positive(set.per_quantity), unit(set.per_unit));
    if (fromSet) return fromSet;
  }
  const printed = text(product.serving_size)?.match(/^(\d+(?:[.,]\d+)?)\s*(g|ml)\b/i);
  return printed ? size(positive(printed[1]), unit(printed[2]!.toLowerCase())) : null;
}

/** Делит состав по запятым верхнего уровня: запятые внутри скобок остаются частью ингредиента. */
export function splitIngredients(raw: string): Ingredient[] {
  const items: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of raw) {
    if (char === '(' || char === '[') depth++;
    if (char === ')' || char === ']') depth = Math.max(0, depth - 1);
    if ((char === ',' || char === ';') && depth === 0) {
      items.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  items.push(current);
  return items.map((name) => name.trim().replace(/\.$/, '')).filter(Boolean).map((name) => ({ name, percent: null }));
}

function mapAllergens(product: Json): Allergen[] | null {
  const byCode = new Map<AllergenCode, Allergen>();
  const add = (list: readonly string[], presence: Allergen['presence']) => {
    for (const tag of list) {
      const code = ALLERGEN_TAGS[tag];
      if (isAllergenCode(code) && !byCode.has(code)) byCode.set(code, { code, presence, provenance: 'open_food_facts' });
    }
  };
  add(tags(product.allergens_tags), 'contains');
  add(tags(product.traces_tags), 'may_contain');
  // Пустой список в базе значит «не заполнено», а не «аллергенов нет».
  return byCode.size > 0 ? [...byCode.values()] : null;
}

function mapAdditives(value: unknown): Additive[] | null {
  const additives = tags(value).flatMap((tag): Additive[] => {
    const match = tag.match(/^en:e(\d{3,4})([a-z]?)/i);
    return match ? [{ code: `E${match[1]}${(match[2] ?? '').toLowerCase()}`, name: null, provenance: 'open_food_facts' }] : [];
  });
  return additives.length > 0 ? additives : null;
}

/** От частного к общему: первый совпавший тег и есть категория. */
const CATEGORY_TAGS: readonly (readonly [string, ProductCategory])[] = [
  ['en:waters', 'water'], ['en:fruit-juices', 'juice'], ['en:juices', 'juice'], ['en:yogurts', 'yogurt'], ['en:cheeses', 'cheese'], ['en:chocolates', 'chocolate'], ['en:breads', 'bread'],
  ['en:nuts', 'nuts'], ['en:fishes', 'fish'], ['en:meats', 'meat'], ['en:sauces', 'sauce'], ['en:breakfast-cereals', 'cereal'], ['en:biscuits-and-cakes', 'bakery'], ['en:salty-snacks', 'snack'],
  ['en:confectioneries', 'sweets'], ['en:sugary-snacks', 'sweets'], ['en:meals', 'ready_meal'], ['en:fruits', 'fruit'], ['en:vegetables', 'vegetable'], ['en:dairies', 'dairy'], ['en:beverages', 'beverage'],
];

function mapCategory(product: Json): ProductCategory | null {
  const categories = [...tags(product.categories_tags), ...tags(product.categories_hierarchy)];
  return CATEGORY_TAGS.find(([tag]) => categories.includes(tag))?.[1] ?? null;
}

/** Оценки самой базы по составу. В таблицу они не идут: используются только как последний запасной вариант и помечаются. */
function mapEstimates(nutrition: unknown): Partial<Record<NutrientKey, number>> {
  const set = record(nutrition) ? nutrition.aggregated_set : null;
  if (!record(set) || !record(set.nutrients) || set.preparation !== 'as_sold') return {};
  const nutrients = set.nutrients;
  return Object.fromEntries(NUTRIENT_KEYS.flatMap(([key, name]) => {
    const item = nutrients[name];
    if (!record(item) || (item.source !== 'estimate' && item.modifier !== '~')) return [];
    const value = positive(item.value);
    return value !== null && value > 0 && value <= MAX_GRAMS && item.unit === 'g' ? [[key, value]] : [];
  }));
}

/** Чистая функция: ответ Open Food Facts v3.6 → только нужные поля. Отсутствующее остаётся null, не 0. */
export function mapOpenFoodFactsProduct(product: unknown, barcode: string): ProductLookupResult | null {
  if (!record(product)) return null;
  const beverage = classifyBeverage(product);
  const ingredientsText = text(product.ingredients_text_ru) ?? text(product.ingredients_text);
  return {
    provider: OPEN_FOOD_FACTS_PROVIDER,
    match: 'exact_barcode',
    barcode,
    name: text(product.product_name_ru) ?? text(product.product_name),
    brand: text(product.brands)?.split(',')[0]?.trim() || null,
    nutrition: mapNutrition(product.nutrition, beverage === 'beverage'),
    beverage,
    servingSize: mapServing(product),
    ingredients: ingredientsText ? splitIngredients(ingredientsText) : null,
    allergens: mapAllergens(product),
    additives: mapAdditives(product.additives_tags),
    category: mapCategory(product),
    estimates: mapEstimates(product.nutrition),
    nova: typeof product.nova_group === 'number' && product.nova_group >= 1 && product.nova_group <= 4 ? product.nova_group : null,
  };
}
