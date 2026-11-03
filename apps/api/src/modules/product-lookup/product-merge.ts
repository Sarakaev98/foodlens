import {
  fromExternalSource, inferred, isExternalProvenance, lowestConfidence, NOT_DETECTED, type Additive, type Allergen, type ConfidenceLevel, type Detected,
  type ExternalProvenance, type NutrientKey, type NutrientValue, type NutritionFacts, type Product, type ProductConfidence, type ServingSize,
} from '@foodlens/core';
import type { ProductLookupNutrition, ProductLookupResult, WebFieldSource } from './product-lookup.provider';

const SALT_PER_SODIUM = 2.5;
/** Допуск «значения совпадают»: 10% от большего, но не меньше этого абсолютного порога. */
const RELATIVE_TOLERANCE = 0.1;
const ABSOLUTE_TOLERANCE: Readonly<Record<NutrientKey, number>> = {
  caloriesKcal: 10, proteinG: 0.5, carbsG: 0.5, sugarsG: 0.5, fatG: 0.5, saturatedFatG: 0.5, fiberG: 0.5, saltG: 0.1, sodiumMg: 40,
};
/** Основные значения: если расходятся два из них, в базе, скорее всего, другой продукт или рецептура. */
const CORE_KEYS: readonly NutrientKey[] = ['caloriesKcal', 'proteinG', 'carbsG', 'fatG'];
const MISMATCH_CONFLICTS = 2;
/** verified_attributes принимается, только если совпали хотя бы столько основных значений. */
const MIN_VERIFIED_CORE = 2;
const KEYS: readonly NutrientKey[] = ['caloriesKcal', 'proteinG', 'carbsG', 'sugarsG', 'fatG', 'saturatedFatG', 'fiberG', 'saltG', 'sodiumMg'];

export interface MergeConflict {
  readonly field: NutrientKey;
  readonly label: number;
  readonly lookup: number;
}

/** Только для логов: откуда что взялось в этом скане. */
export interface ProductMergeReport {
  readonly filled: readonly string[];
  readonly confirmed: readonly string[];
  readonly conflicts: readonly MergeConflict[];
  /** Значения базы, заменённые более сильными источниками. */
  readonly corrected: readonly NutrientKey[];
  /** Значения базы, противоречащие этикетке внутри таблицы (сахара больше углеводов). */
  readonly rejected: readonly string[];
  /** Значения из разных баз сильно расходятся: поле остаётся пустым, а не выбирается наугад. */
  readonly unresolved: readonly NutrientKey[];
  /** Почему данные источника не использованы. */
  readonly skipped: 'different_product' | 'incompatible_basis' | 'low_confidence_match' | 'unverified_match' | null;
}

const round = (value: number, digits: number): number => Math.round(value * 10 ** digits) / 10 ** digits;
const digits = (key: NutrientKey): number => (key === 'caloriesKcal' || key === 'sodiumMg' ? 0 : 2);

function agrees(key: NutrientKey, a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(RELATIVE_TOLERANCE * Math.max(a, b), ABSOLUTE_TOLERANCE[key]);
}

/** Множитель из значений базы на 100 г/мл к основе этикетки. null: сравнивать и подставлять нельзя. */
function scaleToLabel(label: NutritionFacts, off: ProductLookupNutrition, serving: ServingSize | null): number | null {
  if (label.basis === 'per_100g' || label.basis === 'per_100ml') return label.basis === off.basis ? 1 : null;
  if (label.basis !== 'per_serving' || !serving) return null;
  return serving.unit === (off.basis === 'per_100ml' ? 'ml' : 'g') ? serving.amount / 100 : null;
}

/** Порция из базы подходит, только если она в единицах той же основы. */
function usableServing(off: ProductLookupNutrition | null, serving: ServingSize | null): ServingSize | null {
  return off && serving && serving.unit === (off.basis === 'per_100ml' ? 'ml' : 'g') ? serving : null;
}

function fromLookup(off: ProductLookupNutrition, key: NutrientKey, value: number, source: ExternalProvenance): NutrientValue {
  const rounded = round(value, digits(key));
  return off.derived.includes(key) ? inferred(rounded) : fromExternalSource(rounded, source);
}

/** Соль и натрий дополняют друг друга: выведенное по формуле значение помечается как derived (inferred). */
function completeSaltPair(values: Partial<Record<NutrientKey, NutrientValue>>, nutrition: NutritionFacts): void {
  const salt = values.saltG ?? nutrition.saltG;
  const sodium = values.sodiumMg ?? nutrition.sodiumMg;
  if (salt.value === null && sodium.value !== null) values.saltG = inferred(round((sodium.value * SALT_PER_SODIUM) / 1000, 2));
  if (sodium.value === null && salt.value !== null) values.sodiumMg = inferred(round((salt.value / SALT_PER_SODIUM) * 1000, 0));
}

function tableFromLookup(off: ProductLookupNutrition, serving: ServingSize | null, source: ExternalProvenance, report: Mutable): NutritionFacts {
  const facts = {
    basis: off.basis,
    servingSize: serving ? fromExternalSource(serving, source) : { value: null, provenance: 'not_detected' },
  } as unknown as Record<string, unknown>;
  for (const key of KEYS) {
    const value = off.values[key];
    facts[key] = value === null ? { value: null, provenance: 'not_detected' } : fromLookup(off, key, value, source);
    if (value !== null) report.filled.push(key);
  }
  const nutrition = facts as unknown as NutritionFacts;
  const pair: Partial<Record<NutrientKey, NutrientValue>> = {};
  completeSaltPair(pair, nutrition);
  return { ...nutrition, ...pair };
}

/** Подставляет значение только в пустое поле; значения этикетки не меняются никогда. */
function fillTable(label: NutritionFacts, off: ProductLookupNutrition, serving: ServingSize | null, scale: number, source: ExternalProvenance, report: Mutable): NutritionFacts {
  const filled: Partial<Record<NutrientKey, NutrientValue>> = {};
  const merged = (key: NutrientKey) => filled[key]?.value ?? label[key].value;
  for (const key of KEYS) {
    const value = off.values[key];
    if (value === null || label[key].value !== null) continue;
    const scaled = value * scale;
    const parent = key === 'sugarsG' ? merged('carbsG') : key === 'saturatedFatG' ? merged('fatG') : null;
    if (parent !== null && scaled > parent + ABSOLUTE_TOLERANCE[key]) {
      report.rejected.push(key);
      continue;
    }
    filled[key] = fromLookup(off, key, scaled, source);
    report.filled.push(key);
  }
  completeSaltPair(filled, label);
  const useServing = label.servingSize.value === null && serving !== null;
  if (useServing) report.filled.push('servingSize');
  return { ...label, ...filled, ...(useServing ? { servingSize: fromExternalSource(serving, source) } : {}) };
}

/** Поле, по которому внешние базы разошлись, становится пустым вместе с выведенной из него парой соль/натрий. */
function clearUnresolved(nutrition: NutritionFacts, unresolved: readonly NutrientKey[]): NutritionFacts {
  const cleared: Partial<Record<NutrientKey, NutrientValue>> = {};
  for (const key of unresolved) {
    cleared[key] = NOT_DETECTED;
    if (key === 'saltG' && nutrition.sodiumMg.provenance === 'inferred') cleared.sodiumMg = NOT_DETECTED;
    if (key === 'sodiumMg' && nutrition.saltG.provenance === 'inferred') cleared.saltG = NOT_DETECTED;
  }
  return { ...nutrition, ...cleared };
}

function mergeAllergens(current: Detected<readonly Allergen[]>, lookup: readonly Allergen[] | null, source: ExternalProvenance, report: Mutable): Detected<readonly Allergen[]> {
  if (!lookup) return current;
  if (current.value === null) {
    report.filled.push('allergens');
    return fromExternalSource(lookup, source);
  }
  const byCode = new Map(current.value.map((allergen) => [allergen.code, allergen]));
  for (const allergen of lookup) {
    const existing = byCode.get(allergen.code);
    // Для безопасности берётся более строгий вариант: «содержит» важнее «может содержать».
    if (!existing || (existing.presence === 'may_contain' && allergen.presence === 'contains')) byCode.set(allergen.code, allergen);
  }
  if (byCode.size === current.value.length && [...byCode.values()].every((allergen, index) => allergen === current.value[index])) return current;
  report.filled.push('allergens');
  return { ...current, value: [...byCode.values()] };
}

function mergeAdditives(current: Detected<readonly Additive[]>, lookup: readonly Additive[] | null, source: ExternalProvenance, report: Mutable): Detected<readonly Additive[]> {
  if (!lookup) return current;
  if (current.value === null) {
    report.filled.push('additives');
    return fromExternalSource(lookup, source);
  }
  const known = new Set(current.value.map((additive) => additive.code));
  const added = lookup.filter((additive) => !known.has(additive.code));
  if (added.length === 0) return current;
  report.filled.push('additives');
  return { ...current, value: [...current.value, ...added] };
}

/** Заменяет значения базы теми, что подтвердили более сильные источники. Прочитанное с этикетки не трогается. Соль и натрий меняются парой. */
function applyCorrections(nutrition: NutritionFacts | null, lookup: ProductLookupResult, report: Mutable): NutritionFacts | null {
  const values = lookup.nutrition?.values;
  if (!nutrition || !values || nutrition.basis !== lookup.nutrition!.basis) return nutrition;
  const patch: Partial<Record<NutrientKey, NutrientValue>> = {};
  for (const key of lookup.corrections ?? []) {
    const value = values[key];
    if (value === null || !isExternalProvenance(nutrition[key].provenance)) continue;
    patch[key] = fromExternalSource(round(value, digits(key)), lookup.provider);
    report.corrected.push(key);
    report.filled.push(key);
    if (key === 'saltG') patch.sodiumMg = NOT_DETECTED;
    if (key === 'sodiumMg') patch.saltG = NOT_DETECTED;
  }
  return { ...nutrition, ...patch };
}

/** Значение Open Food Facts: своя запись по штрихкоду, средняя уверенность. */
function baseEvidence(field: string, lookup: ProductLookupResult): WebFieldSource | undefined {
  if (lookup.provider !== 'open_food_facts' || !lookup.nutrition || !KEYS.includes(field as NutrientKey)) return undefined;
  return { url: `https://world.openfoodfacts.org/product/${lookup.barcode}`, domain: 'openfoodfacts.org', tier: 3, confidence: 'medium', identityMatch: lookup.match, retrievedAt: new Date().toISOString(), method: 'api', basis: lookup.nutrition.basis, trust: 'open_food_facts', dataQuality: 'database' };
}

/** Поля старой рецептуры, которые новая не подтвердила, в продукте не остаются. Прочитанное с этикетки главнее рецептуры из веба. */
function withoutOldRecipe(product: Product, lookup: ProductLookupResult): Product {
  const external = <T>(field: Detected<T>): Detected<T> => (isExternalProvenance(field.provenance) ? NOT_DETECTED : field);
  const n = product.nutrition;
  const cleared: Partial<Record<NutrientKey, NutrientValue>> = {};
  if (n) for (const key of KEYS) if (n[key].provenance !== 'observed' && lookup.nutrition?.values[key] === null) cleared[key] = NOT_DETECTED;
  return { ...product, nutrition: n && { ...n, ...cleared }, ingredients: external(product.ingredients), allergens: external(product.allergens), additives: external(product.additives),
    fieldEvidence: product.fieldEvidence?.filter((item) => !KEYS.includes(item.field as NutrientKey) || !(item.field in cleared)) };
}

interface Mutable {
  filled: string[];
  confirmed: string[];
  corrected: NutrientKey[];
  conflicts: MergeConflict[];
  rejected: string[];
  unresolved: NutrientKey[];
  skipped: ProductMergeReport['skipped'];
}

/**
 * Этикетка главнее базы: прочитанное с фото никогда не перезаписывается и не усредняется.
 * База только заполняет пустые поля. Значения Goal Match и Product Score здесь не считаются.
 */
export function mergeProductLookup(current: Product, lookup: ProductLookupResult): { readonly product: Product; readonly report: ProductMergeReport } {
  const report: Mutable = { filled: [], confirmed: [], corrected: [], conflicts: [], rejected: [], unresolved: [], skipped: null };
  // Недоверенный ответ не может очищать старую рецептуру или исправлять значения до проверки личности.
  if (lookup.match === 'name_only') return { product: current, report: { ...report, skipped: 'low_confidence_match' } };
  const barcode = current.source.type === 'barcode' ? current.source.barcode : null;
  if (barcode && lookup.barcode && barcode.replace(/^0+/, '') !== lookup.barcode.replace(/^0+/, '')) return { product: current, report: { ...report, skipped: 'different_product' } };
  if (lookup.match === 'verified_attributes') {
    const n = current.nutrition;
    const off = lookup.nutrition;
    const scale = n && off ? scaleToLabel(n, off, n.servingSize.value ?? usableServing(off, lookup.servingSize)) : null;
    const compared = n && off && scale !== null ? CORE_KEYS.filter((key) => n[key].value !== null && off.values[key] !== null) : [];
    if (compared.length < MIN_VERIFIED_CORE || compared.some((key) => !agrees(key, n![key].value!, off!.values[key]! * scale!))) return { product: current, report: { ...report, skipped: 'unverified_match' } };
  }
  const product = lookup.replacesRecipe ? withoutOldRecipe(current, lookup) : current;
  if (lookup.replacesRecipe) report.corrected.push(...KEYS.filter((key) => product.nutrition?.[key].value !== current.nutrition?.[key].value));
  const off = lookup.nutrition;
  const source = lookup.provider;
  // Исправление применяется до сверки: дальше эти поля уже совпадают с источником.
  const label = applyCorrections(product.nutrition, lookup, report);
  const needsVerification = lookup.match === 'verified_attributes';
  const offServing = usableServing(off, lookup.servingSize);
  let nutrition = label;
  let confidence = product.confidence;

  // Сверить нечего: запись без точного штрихкода принимать нельзя.
  if (needsVerification && !label) return { product, report: { ...report, skipped: 'unverified_match' } };

  if (off && !label) {
    nutrition = tableFromLookup(off, offServing, source, report);
    confidence = { ...confidence, nutrition: confidence.nutrition ?? 'medium' };
  } else if (off && label) {
    const scale = scaleToLabel(label, off, label.servingSize.value ?? offServing);
    if (scale === null) {
      report.skipped = 'incompatible_basis';
    } else {
      for (const key of KEYS) {
        const printed = label[key].value;
        const value = off.values[key];
        if (printed === null || value === null) continue;
        if (agrees(key, printed, value * scale)) {
          report.confirmed.push(key);
          continue;
        }
        report.conflicts.push({ field: key, label: printed, lookup: round(value * scale, digits(key)) });
        // Этикетка остаётся главной; спор двух внешних баз этикеткой не решить.
        // Веб-поиск только подтверждает: значение из базы он не отменяет.
        if (isExternalProvenance(label[key].provenance) && source !== 'web_search') report.unresolved.push(key);
      }
      const coreConflicts = report.conflicts.filter((conflict) => CORE_KEYS.includes(conflict.field)).length;
      const coreConfirmed = report.confirmed.filter((key) => CORE_KEYS.includes(key as NutrientKey)).length;
      if (coreConflicts >= MISMATCH_CONFLICTS) report.skipped = 'different_product';
      else if (needsVerification && (coreConfirmed < MIN_VERIFIED_CORE || coreConflicts > 0)) report.skipped = 'unverified_match';
      else {
        nutrition = clearUnresolved(fillTable(clearUnresolved(label, report.unresolved), off, offServing, scale, source, report), report.unresolved);
        report.filled = report.filled.filter((key) => !report.unresolved.includes(key as NutrientKey));
      }
    }
  }

  // Если база описывает другой продукт, из неё нельзя брать и остальные поля.
  if (report.skipped === 'different_product' || report.skipped === 'unverified_match') return { product, report: { ...report, unresolved: [] } };

  const ingredientsFilled = product.ingredients.value === null && lookup.ingredients !== null;
  if (ingredientsFilled) {
    report.filled.push('ingredients');
    confidence = { ...confidence, ingredients: confidence.ingredients ?? 'medium' };
  }
  const nameFilled = product.name.value === null && lookup.name !== null;
  const brandFilled = product.brand.value === null && lookup.brand !== null;
  if (nameFilled) report.filled.push('name');
  if (brandFilled) report.filled.push('brand');

  const fieldEvidence = report.filled.flatMap((field) => {
    const evidence = field === 'ingredients' ? lookup.evidence?.ingredients : lookup.evidence?.fields[field as NutrientKey] ?? baseEvidence(field, lookup);
    if (!evidence) return [];
    const { url, domain, tier, confidence: level, identityMatch, retrievedAt, ingredientsOnly, basis, consensusCount, sources, trust, dataQuality, estimatedRange } = evidence;
    const corrected = report.corrected.includes(field as NutrientKey);
    return [{ field, source, url, domain, tier, confidence: level, identityMatch, retrievedAt, ...(ingredientsOnly ? { ingredientsOnly } : {}), ...(trust ? { trust } : {}), ...(dataQuality ? { dataQuality } : {}), ...(estimatedRange ? { estimatedRange } : {}), ...(corrected ? { corrected } : {}), ...(basis ? { basis } : {}), ...(consensusCount ? { consensusCount } : {}), ...(sources ? { sources } : {}) }];
  });

  return {
    product: {
      ...product,
      ...(fieldEvidence.length > 0 ? { fieldEvidence: [...(product.fieldEvidence ?? []).filter((item) => !report.corrected.includes(item.field as NutrientKey)), ...fieldEvidence] } : {}),
      category: product.category.value === null && lookup.category ? fromExternalSource(lookup.category, source) : product.category,
      name: nameFilled ? fromExternalSource(lookup.name!, source) : product.name,
      brand: brandFilled ? fromExternalSource(lookup.brand!, source) : product.brand,
      nutrition,
      ingredients: ingredientsFilled ? fromExternalSource(lookup.ingredients!, source) : product.ingredients,
      allergens: mergeAllergens(product.allergens, lookup.allergens, source, report),
      additives: mergeAdditives(product.additives, lookup.additives, source, report),
      confidence,
    },
    report,
  };
}

/**
 * Уверенность в пищевой ценности после всех источников:
 * спор баз → low; конфликт с этикеткой или значения из баз → не выше medium;
 * этикетка, подтверждённая базой без конфликтов → high (низкое качество фото не повышается).
 */
export function applyMergeConfidence(product: Product, reports: readonly ProductMergeReport[]): Product {
  const current = product.confidence.nutrition;
  const n = product.nutrition;
  if (!n || current === null) return product;
  const fromDatabase = KEYS.some((key) => isExternalProvenance(n[key].provenance));
  const confirmedCore = new Set(reports.flatMap((report) => report.confirmed).filter((key) => CORE_KEYS.includes(key as NutrientKey))).size;
  let nutrition: ConfidenceLevel = current;
  if (reports.some((report) => report.unresolved.length > 0)) nutrition = 'low';
  else if (reports.some((report) => report.conflicts.length > 0) || fromDatabase) nutrition = lowestConfidence(current, 'medium');
  else if (confirmedCore >= CORE_KEYS.length - 1 && current !== 'low') nutrition = 'high';
  // Оценки участвуют в Score, но уверенность в нём не выше low.
  if (product.fieldEvidence?.some((item) => item.dataQuality === 'estimated')) nutrition = 'low';
  const confidence: ProductConfidence = { ...product.confidence, nutrition, overall: lowestConfidence(product.confidence.overall, nutrition) };
  return { ...product, confidence };
}
