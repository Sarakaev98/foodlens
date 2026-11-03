import {
  inferred,
  normalizeProductSemantics,
  isAllergenCode,
  isProductCategory,
  lowestConfidence,
  NOT_DETECTED,
  SALT_PER_SODIUM,
  saltGFromSodiumMg,
  observed,
  type Additive,
  type Allergen,
  type AllergenCode,
  type ConfidenceLevel,
  type Detected,
  type Ingredient,
  type NutrientValue,
  type NutritionBasis,
  type NutritionFacts,
  type Product,
  type ProductCategory,
  type ProductConfidence,
  type ProductId,
} from '@foodlens/core';
import { META_PRODUCT_ANALYSIS_VERSION, type MetaEvidence, type MetaProductAnalysis } from './meta-product-analysis';

export interface NormalizeContext {
  readonly productId: string;
  /** ISO 8601. */
  readonly analyzedAt: string;
  /** Optional vision provenance; omitted for the unchanged Meta/Mock path. */
  readonly source?: Extract<Product['source'], { readonly type: 'meta_vision' | 'google_vision' }>;
}

/** Ответ Meta не описывает продукт: не еда или ничего не прочитано. */
export class ProductNotRecognizedError extends Error {
  constructor(readonly reason: 'not_food' | 'nothing_readable') {
    super(`Product not recognized: ${reason}`);
    this.name = 'ProductNotRecognizedError';
  }
}

/**
 * Превращает ответ Meta в core Product. Чистая функция без сети и состояния.
 * Здесь же стоят защиты от галлюцинаций: данные из невидимых разделов отбрасываются,
 * неправдоподобные числа становятся not_detected.
 */
export function normalizeMetaProductAnalysis(analysis: MetaProductAnalysis, context: NormalizeContext): Product {
  if (!analysis.image.is_food_product) throw new ProductNotRecognizedError('not_food');

  const name = normalizeText(analysis.identity.name.value, analysis.identity.name.evidence);
  const brand = normalizeText(analysis.identity.brand.value, analysis.identity.brand.evidence);
  const category = normalizeCategory(analysis.identity.category.value, analysis.identity.category.evidence);
  const nutrition = normalizeNutrition(analysis.nutrition_table);
  const ingredients = normalizeIngredients(analysis.ingredients);
  const allergens = normalizeAllergens(analysis.allergens, ingredients);
  const additives = normalizeAdditives(analysis.additives, ingredients);

  const nothingDetected =
    name.value === null &&
    brand.value === null &&
    nutrition === null &&
    ingredients.value === null &&
    allergens.value === null;
  if (nothingDetected) throw new ProductNotRecognizedError('nothing_readable');

  return {
    id: context.productId as ProductId,
    name,
    brand,
    category,
    nutrition,
    semantics: normalizeProductSemantics(analysis.semantics, nutrition?.servingSize.value !== null && nutrition?.servingSize.value !== undefined),
    ingredients,
    allergens,
    additives,
    confidence: normalizeConfidence(analysis, { name, nutrition, ingredients }),
    source: context.source ?? {
      type: 'meta_vision',
      provider: 'meta',
      analyzedAt: context.analyzedAt,
      analysisVersion: META_PRODUCT_ANALYSIS_VERSION,
    },
  };
}

// ---------- identity ----------

function provenanceOf(evidence: MetaEvidence): 'observed' | 'inferred' | null {
  if (evidence === 'visible_text') return 'observed';
  if (evidence === 'visual_inference') return 'inferred';
  return null;
}

function cleanText(value: string | null): string | null {
  const text = value?.replace(/\s+/g, ' ').trim();
  return text ? text : null;
}

function normalizeText(value: string | null, evidence: MetaEvidence): Detected<string> {
  const text = cleanText(value);
  const provenance = provenanceOf(evidence);
  if (text === null || provenance === null) return NOT_DETECTED;
  return { value: text, provenance };
}

function normalizeCategory(value: string | null, evidence: MetaEvidence): Detected<ProductCategory> {
  const provenance = provenanceOf(evidence);
  const raw = cleanText(value)?.toLowerCase().replace(/[\s-]+/g, '_');
  if (!raw || provenance === null) return NOT_DETECTED;
  return { value: isProductCategory(raw) ? raw : 'other', provenance };
}

// ---------- nutrition ----------

const BASIS: Readonly<Record<MetaProductAnalysis['nutrition_table']['basis'], NutritionBasis>> = {
  per_100g: 'per_100g',
  per_100ml: 'per_100ml',
  per_serving: 'per_serving',
  not_stated: 'unknown',
};

/** Верхние границы правдоподобия. На 100 г граммы не могут превышать 100. */
const PER_100_LIMITS = { kcal: 900, grams: 100, sodiumMg: 40_000 } as const;
const PER_SERVING_LIMITS = { kcal: 5_000, grams: 1_000, sodiumMg: 100_000 } as const;

const KJ_PER_KCAL = 4.184;

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function plausible(value: number | null, max: number): number | null {
  if (value === null || !Number.isFinite(value) || value < 0 || value > max) return null;
  return value;
}

function nutrient(value: number | null, digits = 2): NutrientValue {
  return value === null ? NOT_DETECTED : observed(round(value, digits));
}

function normalizeNutrition(table: MetaProductAnalysis['nutrition_table']): NutritionFacts | null {
  // Защита от галлюцинаций: если модель сама говорит, что таблицы не видно, числа не принимаются.
  if (!table.visible) return null;

  const basis = BASIS[table.basis];
  const limits = basis === 'per_100g' || basis === 'per_100ml' ? PER_100_LIMITS : PER_SERVING_LIMITS;
  const grams = (value: number | null) => nutrient(plausible(value, limits.grams));

  const kcal = plausible(table.energy_kcal, limits.kcal);
  const kj = plausible(table.energy_kj, limits.kcal * KJ_PER_KCAL);
  const caloriesKcal: NutrientValue =
    kcal !== null ? observed(round(kcal, 0)) : kj !== null ? inferred(round(kj / KJ_PER_KCAL, 0)) : NOT_DETECTED;

  const sodiumRaw = table.sodium.amount !== null && table.sodium.unit !== null
    ? table.sodium.unit === 'g' ? table.sodium.amount * 1000 : table.sodium.amount
    : null;
  const sodiumMg = plausible(sodiumRaw, limits.sodiumMg);
  const saltG = plausible(table.salt_g, limits.grams);

  const facts: NutritionFacts = {
    basis,
    servingSize: normalizeServingSize(table.serving_size),
    caloriesKcal,
    proteinG: grams(table.protein_g),
    carbsG: grams(table.carbohydrates_g),
    sugarsG: grams(table.sugars_g),
    fatG: grams(table.fat_g),
    saturatedFatG: grams(table.saturated_fat_g),
    fiberG: grams(table.fiber_g),
    // Если на этикетке только одно из двух, второе выводится по формуле и помечается inferred.
    saltG:
      saltG !== null ? observed(round(saltG, 2)) : sodiumMg !== null ? inferred(round(saltGFromSodiumMg(sodiumMg), 2)) : NOT_DETECTED,
    sodiumMg:
      sodiumMg !== null ? observed(round(sodiumMg, 0)) : saltG !== null ? inferred(round((saltG / SALT_PER_SODIUM) * 1000, 0)) : NOT_DETECTED,
  };

  const anyValue = [facts.caloriesKcal, facts.proteinG, facts.carbsG, facts.sugarsG, facts.fatG, facts.saturatedFatG, facts.fiberG, facts.saltG]
    .some((value) => value.value !== null);
  return anyValue ? facts : null;
}

function normalizeServingSize(size: MetaProductAnalysis['nutrition_table']['serving_size']): NutritionFacts['servingSize'] {
  if (size.amount === null || size.unit === null || !(size.amount > 0) || size.amount > 5_000) return NOT_DETECTED;
  return observed({ amount: round(size.amount, 1), unit: size.unit });
}

// ---------- ingredients, allergens, additives ----------

function normalizeIngredients(section: MetaProductAnalysis['ingredients']): Detected<readonly Ingredient[]> {
  if (!section.visible) return NOT_DETECTED;
  const items = section.items.flatMap((item): Ingredient[] => {
    const name = cleanText(item.name);
    if (!name) return [];
    const percent = item.percent !== null && item.percent > 0 && item.percent <= 100 ? round(item.percent, 1) : null;
    return [{ name, percent }];
  });
  return items.length > 0 ? observed(items) : NOT_DETECTED;
}

function normalizeAllergens(
  section: MetaProductAnalysis['allergens'],
  ingredients: Detected<readonly Ingredient[]>,
): Detected<readonly Allergen[]> {
  const ingredientsVisible = ingredients.value !== null;
  if (!section.statement_visible && !ingredientsVisible) return NOT_DETECTED;

  const byCode = new Map<AllergenCode, Allergen>();
  for (const item of section.items) {
    const code = item.allergen.trim().toLowerCase();
    if (!isAllergenCode(code)) continue;
    const derived = item.evidence === 'derived_from_ingredient';
    // Выведенный аллерген без видимого состава ни на чём не основан.
    if (derived && !ingredientsVisible) continue;

    const next: Allergen = { code, presence: item.presence, provenance: derived ? 'inferred' : 'observed' };
    const existing = byCode.get(code);
    // "Содержит" важнее "может содержать", явное указание важнее вывода.
    const stronger =
      !existing ||
      (existing.presence === 'may_contain' && next.presence === 'contains') ||
      (existing.presence === next.presence && existing.provenance === 'inferred' && next.provenance === 'observed');
    if (stronger) byCode.set(code, next);
  }
  return observed([...byCode.values()]);
}

/** "e 330", "E-330", "e150D" → "E330", "E150d". */
export function normalizeENumber(raw: string | null): string | null {
  const compact = raw?.replace(/[\s\-‑–.]/g, '');
  const match = compact?.match(/^[eеЕ]?(\d{3,4})([a-z]?)(\([ivx]+\))?$/i);
  if (!match) return null;
  return `E${match[1]}${(match[2] ?? '').toLowerCase()}${(match[3] ?? '').toLowerCase()}`;
}

function normalizeAdditives(
  items: MetaProductAnalysis['additives'],
  ingredients: Detected<readonly Ingredient[]>,
): Detected<readonly Additive[]> {
  // Добавки берутся только из состава: без видимого состава список ни на чём не основан.
  if (ingredients.value === null) return NOT_DETECTED;

  const result: Additive[] = [];
  const seenCodes = new Set<string>();
  const seenNames = new Set<string>();
  for (const item of items) {
    const code = normalizeENumber(item.e_number);
    const name = cleanText(item.name);
    if (code === null && name === null) continue;
    if (code !== null ? seenCodes.has(code) : seenNames.has(name!.toLowerCase())) continue;
    if (code !== null) seenCodes.add(code);
    if (name !== null) seenNames.add(name.toLowerCase());
    result.push({ code, name });
  }
  return observed(result);
}

// ---------- confidence ----------

const QUALITY_CAP: Readonly<Record<MetaProductAnalysis['image']['quality'], ConfidenceLevel>> = {
  clear: 'high',
  partially_readable: 'medium',
  unreadable: 'low',
};

/**
 * Уверенность модели ограничивается сверху проверяемыми фактами:
 * качеством фото, полнотой данных и тем, что вообще удалось найти.
 */
export function normalizeConfidence(
  analysis: MetaProductAnalysis,
  detected: {
    readonly name: Detected<string>;
    readonly nutrition: NutritionFacts | null;
    readonly ingredients: Detected<readonly Ingredient[]>;
  },
): ProductConfidence {
  const model = analysis.confidence;
  const cap = QUALITY_CAP[analysis.image.quality];

  const identity = detected.name.value === null ? 'low' : lowestConfidence(model.identity, cap);

  let nutrition: ConfidenceLevel | null = null;
  if (detected.nutrition) {
    const facts = detected.nutrition;
    const core = [facts.caloriesKcal, facts.proteinG, facts.carbsG, facts.fatG].filter((v) => v.value !== null).length;
    const completenessCap: ConfidenceLevel = core === 4 ? 'high' : core >= 2 ? 'medium' : 'low';
    const basisCap: ConfidenceLevel = facts.basis === 'unknown' ? 'medium' : 'high';
    nutrition = lowestConfidence(model.nutrition, cap, completenessCap, basisCap);
  }

  const ingredients = detected.ingredients.value === null ? null : lowestConfidence(model.ingredients, cap);

  const sections = [identity, nutrition, ingredients].filter((level): level is ConfidenceLevel => level !== null);
  return { overall: lowestConfidence(model.overall, cap, ...sections), identity, nutrition, ingredients };
}
