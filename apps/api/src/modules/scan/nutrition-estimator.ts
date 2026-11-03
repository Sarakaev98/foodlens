import { analyzeNutritionIngredients, estimateSugarShare } from './nutrition-ingredient-signals';
import { inferred, NUTRIENT_KEYS, NOT_DETECTED, type ConfidenceLevel, type NutrientKey, type NutritionFacts, type Product, type ProductCategory, type NutritionFieldMetadata } from '@foodlens/core';

export const NUTRITION_ESTIMATION_VERSION = 'context-rules-v3';
type Profile = { protein: number; carbs: number; fat: number; sugarShare: number; saturatedShare: number; fiber: number; salt: number };
const profile = (protein: number, carbs: number, fat: number, sugarShare: number, saturatedShare: number, fiber: number, salt: number): Profile => ({ protein, carbs, fat, sugarShare, saturatedShare, fiber, salt });
/** MVP priors per 100 g/ml, not measurements. Only fill gaps, never used as a scoring formula. */
const PROFILES: Record<ProductCategory, Profile> = {
  water: profile(0, 0, 0, 0, 0, 0, 0.01), beverage: profile(0, 10, 0, 0.9, 0, 0, 0.03), juice: profile(0.5, 11, 0.2, 0.9, 0.1, 0.2, 0.01),
  dairy: profile(4, 5, 3, 0.8, 0.65, 0, 0.1), yogurt: profile(4, 6, 3, 0.8, 0.65, 0, 0.1), cheese: profile(22, 2, 26, 0.5, 0.65, 0, 1.7),
  meat: profile(20, 1, 8, 0.05, 0.3, 0, 0.25), fish: profile(20, 1, 8, 0.05, 0.25, 0, 0.25), nuts: profile(18, 18, 52, 0.15, 0.15, 8, 0.02),
  snack: profile(6, 55, 30, 0.05, 0.2, 3, 1.3), chocolate: profile(6, 55, 32, 0.8, 0.6, 3, 0.2), sweets: profile(3, 75, 8, 0.8, 0.45, 0.5, 0.2),
  bakery: profile(6, 60, 20, 0.45, 0.45, 2, 0.5), bread: profile(8, 45, 4, 0.08, 0.2, 4, 1.1), cereal: profile(10, 65, 6, 0.12, 0.2, 7, 0.2),
  sauce: profile(2, 12, 15, 0.3, 0.2, 1, 1.8), ready_meal: profile(8, 25, 8, 0.06, 0.3, 3, 1.1), protein_product: profile(25, 15, 6, 0.2, 0.3, 2, 0.4),
  fruit: profile(1, 12, 0.3, 0.75, 0.1, 2, 0.01), vegetable: profile(2, 6, 0.4, 0.3, 0.1, 2.5, 0.03), other: profile(8, 25, 10, 0.15, 0.3, 2, 0.6),
};
/** Generic food words only. A new brand or barcode needs no branch here. */
const FOOD_TYPES: readonly [RegExp, ProductCategory][] = [
  [/\bwater\b|питьевая вода|минеральная вода/i, 'water'], [/\bjuice\b|\bсок\b/i, 'juice'], [/йогурт|yogurt/i, 'yogurt'], [/сыр|cheese/i, 'cheese'],
  [/печень|бисквит|пирожн|cake|biscuit|cookie/i, 'bakery'], [/шоколад|chocolate/i, 'chocolate'], [/конфет|candy|sweet/i, 'sweets'],
  [/хлеб|bread/i, 'bread'], [/орех|nuts|almond/i, 'nuts'], [/чипс|chips|crisps/i, 'snack'], [/пюре|лапш|суп|noodle|soup|puree|mashed/i, 'ready_meal'],
  [/соус|sauce/i, 'sauce'], [/молок|кефир|milk|kefir/i, 'dairy'], [/круп|овсян|хлопья|oat|cereal/i, 'cereal'], [/лимонад|напиток|soda|drink/i, 'beverage'],
];
// Subtypes stay inside the existing sauce category; these are generic MVP priors, not label data.
const SAUCE_PROFILES = [
  { name: 'ketchup', words: /(?:^|[^\p{L}])(?:ketchup|кетчуп|ketçap)(?=$|[^\p{L}])/iu, profile: profile(1, 25, 0.3, 0.8, 0.1, 1, 2.2) },
  { name: 'mayonnaise', words: /mayonnaise|mayo\b|майонез/iu, profile: profile(1, 2, 70, 0.5, 0.12, 0, 1.2) },
  { name: 'mustard', words: /mustard|горчиц/iu, profile: profile(6, 6, 6, 0.25, 0.1, 3, 3) },
  { name: 'bbq', words: /\bbbq\b|barbecue|barbeque|барбекю/iu, profile: profile(1, 35, 0.5, 0.8, 0.15, 1, 2) },
  { name: 'soy_sauce', words: /soy\s+sauce|соев[а-я]*\s+соус/iu, profile: profile(5, 5, 0.1, 0.3, 0.15, 0.5, 5) },
  { name: 'tomato_sauce', words: /tomato\s+sauce|томатн[а-я]*\s+соус/iu, profile: profile(1.5, 7, 2, 0.6, 0.15, 1.5, 0.8) },
] as const;
export function nutritionEstimationProfile(product: Product) {
  const declared = product.category.value;
  const sauce = (!declared || declared === 'other' || declared === 'sauce')
    ? SAUCE_PROFILES.find(item => item.words.test(product.name.value ?? '')) : undefined;
  const category: ProductCategory = sauce ? 'sauce' : declared && declared !== 'other' ? declared
    : FOOD_TYPES.find(([words]) => words.test(product.name.value ?? ''))?.[1] ?? 'other';
  return { category, subtype: sauce?.name ?? category, prior: sauce?.profile ?? PROFILES[category] };
}
const clamp = (n: number, max: number) => Math.min(Math.max(Number.isFinite(n) ? n : 0, 0), Math.max(0, max));
const round = (n: number) => Math.round(n * 100) / 100;

export function estimatedNutritionFields(product: Product): readonly NutrientKey[] {
  return NUTRIENT_KEYS.filter(key => { const q = product.nutritionMetadata?.fields[key]?.quality; return q === 'estimated' || q === 'ai_estimated'; });
}

/** Final stage after all exact sources. Pure, deterministic, no I/O and no product-specific identifiers. */
export function estimateMissingNutrition(product: Product): Product {
  // A bare unknown barcode is not a recognized food. A name, ingredients or a readable table is context.
  if (!product.name.value?.trim() && !product.ingredients.value?.length && !product.nutrition) return product;
  const { category, subtype, prior } = nutritionEstimationProfile(product);
  const drink = product.semantics?.productForm.value === 'beverage' || ['water', 'juice', 'beverage'].includes(category);
  const original = product.nutrition;
  const basis = original && original.basis !== 'unknown' ? original.basis : drink ? 'per_100ml' : 'per_100g';
  const serving = original?.servingSize.value ?? null;
  const typical = product.semantics?.typicalServing;
  const servingSize = basis === 'per_serving' && (!serving || !Number.isFinite(serving.amount) || serving.amount <= 0)
    ? { amount: typical && typical.amount > 0 && Number.isFinite(typical.amount) ? typical.amount : drink ? 250 : 100, unit: typical?.unit ?? (drink ? 'ml' as const : 'g' as const) }
    : serving;
  const scale = basis === 'per_serving' ? servingSize!.amount / 100 : 1;
  const n: NutritionFacts = original ? { ...original, basis, ...(servingSize !== serving ? { servingSize: inferred(servingSize!) } : {}) }
    : { basis, servingSize: NOT_DETECTED, ...Object.fromEntries(NUTRIENT_KEYS.map(key => [key, NOT_DETECTED])) } as NutritionFacts;
  const values = Object.fromEntries(NUTRIENT_KEYS.map(key => [key, n[key].value === null ? null : n[key].value / scale])) as Record<NutrientKey, number | null>;
  const metadata: Partial<Record<NutrientKey, NutritionFieldMetadata>> = { ...product.nutritionMetadata?.fields };
  for (const key of NUTRIENT_KEYS) if (values[key] !== null && (!metadata[key] || (n[key].provenance !== 'inferred' && metadata[key]?.quality !== 'verified'))) {
    const evidence = product.fieldEvidence?.find(item => item.field === key);
    metadata[key] = { quality: evidence?.dataQuality === 'estimated' ? 'estimated' : 'verified', confidence: evidence?.confidence ?? (n[key].provenance === 'observed' ? 'high' : 'medium'), method: n[key].provenance === 'inferred' ? 'derived' : 'source', reason: n[key].provenance };
  }
  const set = (key: NutrientKey, value: number, reason: string, confidence: ConfidenceLevel = 'low', derivedFrom?: NutrientKey) => {
    if (values[key] !== null) return;
    values[key] = value;
    const parent = derivedFrom && metadata[derivedFrom];
    metadata[key] = { quality: parent?.quality === 'verified' ? 'verified' : 'estimated', confidence: parent?.confidence ?? confidence, method: derivedFrom ? 'derived' : 'context_rules', reason };
  };
  // Convert a known salt/sodium pair before estimating either side.
  if (values.saltG === null && values.sodiumMg !== null) set('saltG', values.sodiumMg * 2.5 / 1000, 'sodium × 2.5 / 1000', 'medium', 'sodiumMg');
  if (values.sodiumMg === null && values.saltG !== null) set('sodiumMg', values.saltG * 1000 / 2.5, 'salt × 1000 / 2.5', 'medium', 'saltG');

  const macros = [['proteinG', prior.protein, 4], ['carbsG', prior.carbs, 4], ['fatG', prior.fat, 9]] as const;
  const missing = macros.filter(([key]) => values[key] === null);
  const knownEnergy = macros.reduce((sum, [key, , factor]) => sum + (values[key] ?? 0) * factor, 0);
  const minimum = (key: NutrientKey) => key === 'carbsG' ? clamp(values.sugarsG ?? 0, 100) : key === 'fatG' ? clamp(values.saturatedFatG ?? 0, 100) : 0;
  const minimumEnergy = missing.reduce((sum, [key, , factor]) => sum + minimum(key) * factor, 0);
  const remainingEnergy = values.caloriesKcal === null ? null : Math.max(0, values.caloriesKcal - knownEnergy - minimumEnergy);
  const priorEnergy = missing.reduce((sum, [key, amount, factor]) => sum + Math.max(0, amount - minimum(key)) * factor, 0);
  const proposals = missing.map(([key, amount, factor]) => ({ key, floor: minimum(key), amount: remainingEnergy === null ? Math.max(0, amount - minimum(key)) : priorEnergy > 0 ? remainingEnergy * Math.max(0, amount - minimum(key)) / priorEnergy : remainingEnergy / (missing.length * factor) }));
  const massBudget = Math.max(0, 100 - macros.reduce((sum, [key]) => sum + (values[key] ?? minimum(key)), 0));
  const proposedMass = proposals.reduce((sum, entry) => sum + entry.amount, 0);
  const massScale = proposedMass > massBudget ? massBudget / proposedMass : 1;
  for (const entry of proposals) set(entry.key, clamp(entry.floor + entry.amount * massScale, 100), `category:${category}; profile:${subtype}; known energy/macros; mass budget; known sugar/saturated minimum`);
  const protein = values.proteinG!, carbs = values.carbsG!, fat = values.fatG!;
  set('caloriesKcal', clamp(4 * protein + 4 * carbs + 9 * fat, 900), '4 × protein + 4 × carbs + 9 × fat', macros.some(([key]) => metadata[key]?.quality === 'estimated') ? 'low' : 'medium');

  const ingredients = product.fieldEvidence?.some(item => item.field === 'ingredients' && item.ingredientsOnly) ? [] : product.ingredients.value ?? [];
  const signals = analyzeNutritionIngredients(ingredients);
  const addedSugar = product.semantics?.sugarSource.value === 'added' || product.semantics?.sugarSource.value === 'mixed';
  const sugar = estimateSugarShare(category, prior.sugarShare, signals, addedSugar);
  set('sugarsG', clamp(carbs * (product.semantics?.sugarSource.value === 'none' ? 0 : signals.sweetenerOnly ? Math.min(sugar.share, 0.05) : sugar.share), Math.min(100, carbs)), `category:${category}; profile:${subtype}; carbohydrate bound; sugar ingredient position:${signals.sugarPosition}; nested sugar count:${signals.nestedSugars.length}; sugar share:${sugar.share}; category cap:${sugar.categoryCap}; capped:${sugar.capped}`);
  const saturatedShare = signals.hasSaturatedFat ? Math.max(0.5, prior.saturatedShare)
    : signals.hasUnsaturatedFat ? Math.min(0.18, prior.saturatedShare) : prior.saturatedShare;
  set('saturatedFatG', clamp(fat * saturatedShare, Math.min(100, fat)), `category:${category}; profile:${subtype}; fat type; total fat bound`);
  const plant = signals.hasFiber;
  const fiber = plant ? Math.max(prior.fiber, 4) : prior.fiber;
  set('fiberG', clamp(fiber, Math.min(30, values.caloriesKcal! / 2, Math.max(0, 100 - protein - carbs - fat))), `category:${category}; profile:${subtype}; plant ingredients; remaining mass bound`);
  const saltPosition = signals.saltPosition;
  const salt = saltPosition >= 0 ? Math.max(prior.salt, saltPosition <= 2 ? 1.5 : 0.5) : prior.salt;
  set('saltG', clamp(salt, 5), `category:${category}; profile:${subtype}; salt ingredient position:${saltPosition}; 0–5 g/100 bound`);
  set('sodiumMg', values.saltG! * 1000 / 2.5, 'salt × 1000 / 2.5', 'low', 'saltG');

  const nutrition = { ...n } as { -readonly [K in keyof NutritionFacts]: NutritionFacts[K] };
  for (const key of NUTRIENT_KEYS) {
    if (n[key].value !== null) continue;
    const limit = key === 'sugarsG' ? nutrition.carbsG.value : key === 'saturatedFatG' ? nutrition.fatG.value : null;
    nutrition[key] = inferred(limit === null ? round(values[key]! * scale) : Math.min(round(values[key]! * scale), limit));
  }
  const estimated = NUTRIENT_KEYS.some(key => metadata[key]?.quality !== 'verified');
  const basisEstimated = original?.basis === 'unknown' || !original || (basis === 'per_serving' && servingSize !== serving);
  const constraints: string[] = [];
  const per100 = (key: NutrientKey) => nutrition[key].value! / scale;
  const macroEnergy = 4 * per100('proteinG') + 4 * per100('carbsG') + 9 * per100('fatG');
  if (Math.abs(per100('caloriesKcal') - macroEnergy) > Math.max(30, 0.2 * macroEnergy)) constraints.push('source_energy_macro_conflict');
  if (per100('proteinG') + per100('carbsG') + per100('fatG') > 100.1) constraints.push('source_macro_mass_conflict');
  if (per100('sugarsG') > per100('carbsG')) constraints.push('source_sugars_exceed_carbs');
  if (per100('saturatedFatG') > per100('fatG')) constraints.push('source_saturated_exceeds_fat');
  return { ...product, nutrition, nutritionMetadata: { version: NUTRITION_ESTIMATION_VERSION,
    basis: product.nutritionMetadata?.basis ?? { quality: basisEstimated ? 'estimated' : 'verified', confidence: basisEstimated ? 'low' : 'high', reason: basisEstimated ? 'product form / category; assumed serving if missing' : 'source' },
    fields: metadata as Record<NutrientKey, NutritionFieldMetadata>, constraints },
    confidence: estimated || basisEstimated ? { ...product.confidence, nutrition: 'low', overall: 'low' } : product.confidence };
}
