import { nutritionPlausibility } from './nutrition-plausibility';
import { analyzeNutritionIngredients, estimateSugarShare } from './nutrition-ingredient-signals';
import { nutritionEstimationProfile } from './nutrition-profiles';
import { inferred, NUTRIENT_KEYS, NOT_DETECTED, type ConfidenceLevel, type NutrientKey, type NutritionFacts, type Product, type NutritionFieldMetadata } from '@foodlens/core';

export const NUTRITION_ESTIMATION_VERSION = 'context-rules-v5';
export { nutritionEstimationProfile } from './nutrition-profiles';
const clamp = (n: number, max: number) => Math.min(Math.max(Number.isFinite(n) ? n : 0, 0), Math.max(0, max));
const round = (n: number) => Math.round(n * 100) / 100;

export function estimatedNutritionFields(product: Product): readonly NutrientKey[] {
  return NUTRIENT_KEYS.filter(key => { const q = product.nutritionMetadata?.fields[key]?.quality; return q === 'estimated' || q === 'ai_estimated'; });
}

/** Final stage after all exact sources. Pure, deterministic, no I/O and no product-specific identifiers. */
export function estimateMissingNutrition(product: Product): Product {
  // A bare unknown barcode is not a recognized food. A name, ingredients or a readable table is context.
  if (!product.name.value?.trim() && !product.ingredients.value?.length && !product.nutrition) return product;
  const base = nutritionEstimationProfile(product);
  const { category, limits, source } = base;
  const ingredients = product.fieldEvidence?.some(item => item.field === 'ingredients' && item.ingredientsOnly) ? [] : product.ingredients.value ?? [];
  const signals = analyzeNutritionIngredients(ingredients);
  // A subtype maximum never lowers a source value; a listed sugar ingredient lifts the sugar maximum.
  const limit = (key: NutrientKey) => key === 'sugarsG' && signals.sugarPosition >= 0 ? undefined : limits[key as keyof typeof limits];
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
  const { subtype, prior } = base;
  const metadata: Partial<Record<NutrientKey, NutritionFieldMetadata>> = { ...product.nutritionMetadata?.fields };
  for (const key of NUTRIENT_KEYS) if (values[key] !== null && (!metadata[key] || (n[key].provenance !== 'inferred' && metadata[key]?.quality !== 'verified'))) {
    const evidence = product.fieldEvidence?.find(item => item.field === key);
    metadata[key] = { quality: evidence?.dataQuality === 'estimated' ? 'estimated' : 'verified', confidence: evidence?.confidence ?? (n[key].provenance === 'observed' ? 'high' : 'medium'), method: n[key].provenance === 'inferred' ? 'derived' : 'source', reason: n[key].provenance };
  }
  const set = (key: NutrientKey, value: number, reason: string, confidence: ConfidenceLevel = 'low', derivedFrom?: NutrientKey) => {
    if (values[key] !== null) return;
    const max = derivedFrom ? undefined : limit(key);
    const exactFloor = key === 'carbsG' ? values.sugarsG ?? 0 : key === 'fatG' ? values.saturatedFatG ?? 0 : 0;
    values[key] = max === undefined ? value : Math.min(value, Math.max(max, exactFloor));
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
  for (const entry of proposals) set(entry.key, clamp(entry.floor + entry.amount * massScale, 100), `category:${category}; profile:${subtype}; via:${source}; known energy/macros; mass budget; known sugar/saturated minimum`);
  const protein = values.proteinG!, carbs = values.carbsG!, fat = values.fatG!;
  set('caloriesKcal', clamp(4 * protein + 4 * carbs + 9 * fat, 900), '4 × protein + 4 × carbs + 9 × fat', macros.some(([key]) => metadata[key]?.quality === 'estimated') ? 'low' : 'medium');

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

  // Validate the completed profile together. Existing source fields are flagged, never clamped.
  const plausibility = nutritionPlausibility(base, signals);
  const plausibilityConstraints: string[] = [];
  for (const [key, [low, high]] of Object.entries(plausibility) as [NutrientKey, readonly [number, number]][]) {
    const value = values[key]!;
    if (value >= low && value <= high) continue;
    if (n[key].value !== null) { plausibilityConstraints.push(`plausibility_source_conflict:${subtype}:${key}`); continue; }
    let lower = low;
    let upper = high;
    if (key === 'carbsG') lower = Math.max(lower, values.sugarsG ?? 0);
    if (key === 'fatG') lower = Math.max(lower, values.saturatedFatG ?? 0);
    if (key === 'sugarsG') upper = Math.min(upper, values.carbsG!);
    if (key === 'saturatedFatG') upper = Math.min(upper, values.fatG!);
    const macro = macros.find(([field]) => field === key);
    if (macro) {
      upper = Math.min(upper, Math.max(0, 100 - macros.reduce((sum, [field]) => sum + (field === key ? 0 : values[field]!), 0)));
      if (n.caloriesKcal.value !== null) {
        const otherEnergy = macros.reduce((sum, [field, , factor]) => sum + (field === key ? 0 : values[field]! * factor), 0);
        upper = Math.min(upper, Math.max(0, (values.caloriesKcal! - otherEnergy) / macro[2]));
      }
    }
    // Source minima and known energy win if no coherent estimate can satisfy all bounds.
    if (lower > upper) {
      plausibilityConstraints.push(`plausibility_unresolved:${subtype}:${key}`);
      continue;
    }
    values[key] = Math.min(Math.max(value, lower), upper);
    metadata[key] = { ...metadata[key]!, confidence: 'low', reason: `${metadata[key]!.reason}; plausibility:${low}..${high}` };
    // A successful repair is recorded in the field reason; unresolved conflicts remain in constraints.
  }
  if (n.caloriesKcal.value === null) values.caloriesKcal = clamp(4 * values.proteinG! + 4 * values.carbsG! + 9 * values.fatG!, 900);
  if (n.sodiumMg.value === null && n.saltG.value === null) values.sodiumMg = values.saltG! * 400;

  const nutrition = { ...n } as { -readonly [K in keyof NutritionFacts]: NutritionFacts[K] };
  for (const key of NUTRIENT_KEYS) {
    if (n[key].value !== null) continue;
    const limit = key === 'sugarsG' ? nutrition.carbsG.value : key === 'saturatedFatG' ? nutrition.fatG.value : null;
    nutrition[key] = inferred(limit === null ? round(values[key]! * scale) : Math.min(round(values[key]! * scale), limit));
  }
  const estimated = NUTRIENT_KEYS.some(key => metadata[key]?.quality !== 'verified');
  const basisEstimated = original?.basis === 'unknown' || !original || (basis === 'per_serving' && servingSize !== serving);
  const constraints: string[] = [...plausibilityConstraints];
  const per100 = (key: NutrientKey) => nutrition[key].value! / scale;
  const macroEnergy = 4 * per100('proteinG') + 4 * per100('carbsG') + 9 * per100('fatG');
  if (Math.abs(per100('caloriesKcal') - macroEnergy) > Math.max(30, 0.2 * macroEnergy)) constraints.push('source_energy_macro_conflict');
  if (per100('proteinG') + per100('carbsG') + per100('fatG') > 100.1) constraints.push('source_macro_mass_conflict');
  if (per100('sugarsG') > per100('carbsG')) constraints.push('source_sugars_exceed_carbs');
  if (per100('saturatedFatG') > per100('fatG')) constraints.push('source_saturated_exceeds_fat');
  // A source value above the subtype maximum stays (exact > estimate) but is disclosed.
  for (const key of NUTRIENT_KEYS) {
    const max = limit(key);
    if (max !== undefined && metadata[key]?.quality === 'verified' && per100(key) > max) constraints.push(`category_limit_conflict:${subtype}:${key}`);
  }
  if (source === 'fallback') constraints.push('category_unknown');
  return { ...product, nutrition, nutritionMetadata: { version: NUTRITION_ESTIMATION_VERSION,
    basis: product.nutritionMetadata?.basis ?? { quality: basisEstimated ? 'estimated' : 'verified', confidence: basisEstimated ? 'low' : 'high', reason: basisEstimated ? 'product form / category; assumed serving if missing' : 'source' },
    fields: metadata as Record<NutrientKey, NutritionFieldMetadata>, constraints,
    selection: { category, subtype, confidence: plausibilityConstraints.some(item => !item.includes('adjusted')) ? 'low' : base.confidence, evidence: base.evidence, uncertainty: [...base.uncertainty, ...constraints.filter(item => item.includes('plausibility'))] } },
    confidence: estimated || basisEstimated ? { ...product.confidence, nutrition: 'low', overall: 'low' } : product.confidence };
}
