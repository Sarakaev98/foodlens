import type { ProductLookupContext } from '../product-lookup.provider';
import { normalizeProductName } from './product-identity';

export type SearchStepKind = 'barcode' | 'barcode_identity' | 'barcode_field' | 'ingredients' | 'ingredients_local' | 'exact_product' | 'missing_nutrients';

export interface SearchStep {
  readonly kind: SearchStepKind;
  readonly query: string;
}

/** Порядок шагов. Какие из них нужны, решает то, чего не хватает продукту. */
export const SEARCH_ORDER: readonly SearchStepKind[] = ['barcode', 'barcode_identity', 'barcode_field', 'barcode_field', 'barcode_field', 'barcode_field', 'ingredients', 'ingredients_local', 'exact_product', 'missing_nutrients'];

/** Запрос про питание называет только недостающие поля, а не их значения. */
const NUTRIENT_WORDS = {
  latin: { kcal: 'calories', protein: 'protein', carbs: 'carbohydrates', fat: 'fat', sugars: 'sugars', saturatedFat: 'saturated fat', salt: 'salt', fiber: 'fiber' },
  cyrillic: { kcal: 'калорийность', protein: 'белки', carbs: 'углеводы', fat: 'жиры', sugars: 'сахара', saturatedFat: 'насыщенные жиры', salt: 'соль', fiber: 'клетчатка' },
} as const;

/** Слово «состав» по письму названия. Перевод не нужен: словарь маленький и дополняется здесь. */
const INGREDIENT_WORDS: readonly (readonly [RegExp, string])[] = [[/[а-яё]/i, 'состав'], [/[ა-ჰ]/, 'შემადგენლობა'], [/[ğışİ]/, 'içindekiler']];

/**
 * Запросы по порядку: от самого точного к общему. Строятся только из штрихкода, бренда, названия и упаковки:
 * макросов в контексте запроса нет, они нужны только для сверки уже прочитанной страницы.
 * Сначала штрихкод, затем штрихкод с каждым недостающим полем, затем название с недостающими полями. Запросы строятся заново: найденное в них уже не попадает.
 */
export function searchStrategy(barcode: string | null, context: ProductLookupContext): readonly SearchStep[] {
  const { brand, name, serving } = context;
  const sameName = brand !== null && name !== null && normalizeProductName(name).includes(normalizeProductName(brand));
  const product = [sameName ? null : brand, name].filter(Boolean).join(' ') || null;
  const quoted = [sameName ? null : brand, name].filter(Boolean).map((part) => `"${part}"`).join(' ');
  const steps: SearchStep[] = [];
  if (barcode) steps.push({ kind: 'barcode', query: `"${barcode}"` });
  if (!product) return steps;
  if (barcode) steps.push({ kind: 'barcode_identity', query: `"${barcode}" ${quoted}` });

  // Российские штрихкоды начинаются с 46: страницы о таких товарах обычно на русском, даже если название латиницей.
  const cyrillic = /[а-яё]/i.test(product) || barcode?.startsWith('46') === true;
  const words = NUTRIENT_WORDS[cyrillic ? 'cyrillic' : 'latin'];
  // Порядок важен: сначала поля, без которых оценка самая неточная.
  const missing = (['sugars', 'saturatedFat', 'salt', 'kcal', 'protein', 'carbs', 'fat', 'fiber'] as const).filter((field) => context.missingFields.includes(field)).map((field) => words[field]);
  const local = INGREDIENT_WORDS.find(([pattern]) => pattern.test(product))?.[1] ?? (cyrillic ? 'состав' : null);
  // Каждое недостающее поле ищется отдельно по штрихкоду. Состав идёт после питания.
  if (barcode) for (const word of [...missing, ...(context.needsIngredients ? [local ?? 'ingredients'] : [])]) steps.push({ kind: 'barcode_field', query: `${barcode} ${word}` });
  if (context.needsIngredients && missing.length > 0) {
    // Нужно и то и другое: общий запрос, затем запрос только с тем, чего не хватает.
    steps.push({ kind: 'exact_product', query: `${quoted} ${cyrillic ? 'пищевая ценность' : 'nutrition'} ${local ?? 'ingredients'}` });
    steps.push({ kind: 'missing_nutrients', query: `${product} ${missing.join(' ')} ${local ?? 'ingredients'}` });
    return steps;
  }
  if (context.needsIngredients) {
    steps.push({ kind: 'ingredients', query: `${quoted} ingredients` });
    if (local) steps.push({ kind: 'ingredients_local', query: `${quoted} ${local}` });
  }
  if (missing.length === 0) return steps;
  if (!context.needsIngredients) steps.push({ kind: 'exact_product', query: [product, serving, cyrillic ? 'пищевая ценность' : 'nutrition facts пищевая ценность'].filter(Boolean).join(' ') });
  steps.push({ kind: 'missing_nutrients', query: `${product} ${missing.join(' ')}` });
  return steps;
}
