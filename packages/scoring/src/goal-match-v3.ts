import { checkNutritionSanity } from './nutrition-sanity';
import {
  normalizeProductSemantics,
  type ConfidenceLevel, type GoalMatchFactor, type GoalMatchLevel, type GoalMatchPortion,
  type GoalMatchUnavailableReason, type GoalMatchUncertainty, type GoalMatchUserPlan,
  type GoalMatchV3, type NutritionFacts, type Product, type ProductSemantics,
} from '@foodlens/core';
import { calculateEatHealthier, type HealthCalculation, type HealthFeatures } from './goal-match-v3-calculation';
import { clampHealthScore, GOAL_MATCH_V3_VERSION, UNCERTAINTY_WIDTH, V3_LEVELS } from './goal-match-v3-rules';

type Size = { readonly amount: number; readonly unit: 'g' | 'ml' };
/** label: printed on the package. reference: the label's own 100 g/ml basis, not a claim about what is eaten. */
type Serving = Size & { readonly source: 'label' | 'reference' };
interface Nutrients {
  readonly caloriesKcal: number;
  readonly proteinG: number | null;
  readonly sugarsG: number;
  readonly saturatedFatG: number;
  readonly saltG: number;
  readonly fiberG: number | null;
  readonly fatG: number | null;
}
const number = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const round = (value: number): number => Math.round(value * 10) / 10;
const validSize = (size: Size | null | undefined): size is Size =>
  !!size && Number.isFinite(size.amount) && size.amount > 0 && (size.unit === 'g' || size.unit === 'ml');

function level(score: number): Exclude<GoalMatchLevel, 'conflict'> {
  return score >= V3_LEVELS.great ? 'great' : score >= V3_LEVELS.good ? 'good' : score >= V3_LEVELS.fair ? 'fair' : 'poor';
}

/** Only a printed serving is trusted. AI typicalServing is never a real serving. Without one, per-100 labels use 100 g/ml. */
function resolveServing(n: NutritionFacts): Serving | null {
  const label = n.servingSize.value;
  const per100Unit = n.basis === 'per_100g' ? 'g' : n.basis === 'per_100ml' ? 'ml' : null;
  if (validSize(label) && (per100Unit === null || label.unit === per100Unit)) return { ...label, source: 'label' };
  return per100Unit ? { amount: 100, unit: per100Unit, source: 'reference' } : null;
}

function nutrients(n: NutritionFacts, scale: number | null): Nutrients | null {
  const p = number(n.proteinG.value), kcal = number(n.caloriesKcal.value);
  let sugars = number(n.sugarsG.value), saturated = number(n.saturatedFatG.value);
  const fat = number(n.fatG.value), carbs = number(n.carbsG.value);
  // These are the only missing-value substitutions allowed by the approved design.
  if (sugars === null && carbs !== null && scale !== null && carbs * scale <= 0.5) sugars = 0;
  if (saturated === null && fat !== null && scale !== null && fat * scale <= 0.5) saturated = 0;
  const sodium = number(n.sodiumMg.value);
  const salt = number(n.saltG.value) ?? (sodium === null ? null : sodium * 2.5 / 1000);
  if (kcal === null || sugars === null || saturated === null || salt === null) return null;
  return {
    caloriesKcal: kcal, proteinG: p, sugarsG: sugars, saturatedFatG: saturated, saltG: salt,
    fiberG: number(n.fiberG.value), fatG: fat,
  };
}

function fromLabel(n: NutritionFacts): boolean {
  return n.proteinG.provenance === 'observed' && n.caloriesKcal.provenance === 'observed' &&
    (n.sugarsG.provenance === 'observed' || (n.sugarsG.value === null && n.carbsG.provenance === 'observed')) &&
    (n.saturatedFatG.provenance === 'observed' || (n.saturatedFatG.value === null && n.fatG.provenance === 'observed')) &&
    (n.saltG.provenance === 'observed' || n.sodiumMg.provenance === 'observed');
}

function features(n: NutritionFacts, values: Nutrients, serving: Serving, plan: GoalMatchUserPlan,
  semantics: ProductSemantics, source = semantics.sugarSource.value, processing = semantics.processing.value): HealthFeatures {
  const scale = n.basis === 'per_serving' ? 100 / serving.amount : 1;
  return {
    caloriesKcal: values.caloriesKcal * scale,
    proteinG: values.proteinG === null ? null : values.proteinG * scale,
    sugarsG: values.sugarsG * scale,
    saturatedFatG: values.saturatedFatG * scale,
    saltG: values.saltG * scale,
    fiberG: values.fiberG === null ? null : values.fiberG * scale,
    servingMultiplier: serving.amount / 100,
    proteinTargetG: plan.targets.proteinG,
    sugarSource: source,
    processing,
    productForm: n.basis === 'per_100ml' ? 'beverage'
      : semantics.productForm.confidence === 'low' || semantics.productForm.value === 'unknown'
        ? 'food' : semantics.productForm.value,
  };
}

function finiteFeatures(f: HealthFeatures): boolean {
  const quantities = [f.caloriesKcal, f.proteinG, f.sugarsG, f.saturatedFatG, f.saltG, f.fiberG ?? 0];
  return Number.isFinite(f.servingMultiplier) && f.servingMultiplier > 0 &&
    quantities.every((value) => value === null || (Number.isFinite(value) && Number.isFinite(value * f.servingMultiplier)));
}

function calculationFactors(calc: HealthCalculation): GoalMatchFactor[] {
  return calc.factors.map((f) => {
    const points = Math.round(f.points * 1e6) / 1e6 || 0;
    const impact = points > 0 ? 'positive' : points < 0 ? 'negative' : 'neutral';
    const factorLevel = points === 0 ? 'ok' : 'high';
    return { id: `${f.kind}.${factorLevel}`, kind: f.kind, level: factorLevel,
      impact, points, value: f.value, portionShare: f.portionShare, matches: [] };
  });
}

/** On the 100 g/ml basis there is no eaten amount: portion figures would read as facts about a serving. */
function withoutPortionValues(factor: GoalMatchFactor): GoalMatchFactor {
  return factor.kind === 'whole' ? factor : { ...factor, value: null, portionShare: null };
}

/** v1 restrictions are reused verbatim, converting ONLY their units for this v3 result. */
export function matchEatHealthier(product: Product, plan: GoalMatchUserPlan,
  legacyRestrictions: readonly GoalMatchFactor[]): GoalMatchV3 {
  const restrictions = legacyRestrictions.map((f) => ({ ...f, points: f.points / 10 }));
  const base: GoalMatchV3 = {
    version: GOAL_MATCH_V3_VERSION, goal: 'eat_healthier', state: 'insufficient_data',
    value: null, level: null, unavailableReason: null, portion: null, factors: restrictions,
    confidence: null, range: null, uncertainty: [],
  };
  const unavailable = (reason: GoalMatchUnavailableReason): GoalMatchV3 => ({
    ...base, unavailableReason: reason, factors: restrictions.map((f) => ({ ...f, points: 0 })),
  });
  if (restrictions.some((f) => f.level === 'conflict' && f.kind !== 'avoidedIngredients')) {
    return { ...base, state: 'goal_match', value: 0, level: 'conflict', confidence: 'high', range: { min: 0, max: 0 } };
  }
  const n = product.nutrition;
  if (!n) return unavailable('no_nutrition');
  if (n.basis !== 'per_100g' && n.basis !== 'per_100ml' && n.basis !== 'per_serving') return unavailable('unknown_basis');
  if (number(n.caloriesKcal.value) === null) return unavailable('no_calories');
  const semantics = normalizeProductSemantics(product.semantics, n.servingSize.value !== null);
  const serving = resolveServing(n);
  const scale = n.basis === 'per_serving' ? (serving ? 100 / serving.amount : null) : 1;
  const values = nutrients(n, scale);
  if (!values || !Number.isFinite(plan.targets.proteinG) || plan.targets.proteinG <= 0) return unavailable('missing_nutrients');
  if (!serving) return unavailable('unknown_portion');
  if (!semantics) return unavailable('ai_context_unavailable');
  const source = semantics.sugarSource.confidence === 'low' ? 'unknown' : semantics.sugarSource.value;
  const processing = semantics.processing.confidence === 'low' ? 'unknown' : semantics.processing.value;
  const mainFeatures = features(n, values, serving, plan, semantics, source, processing);
  if (!finiteFeatures(mainFeatures)) return unavailable('missing_nutrients');
  const portion: GoalMatchPortion = {
    basis: serving.source === 'reference' ? 'per_100' : 'serving', amount: serving.amount, unit: serving.unit,
    caloriesKcal: mainFeatures.caloriesKcal * mainFeatures.servingMultiplier,
  };
  const notApplicable = mainFeatures.caloriesKcal <= 4 &&
    mainFeatures.proteinG !== null && mainFeatures.proteinG < 0.5 && values.fatG !== null && values.fatG * (scale ?? 1) < 0.5 &&
    mainFeatures.sugarsG < 0.5 && processing === 'whole_or_minimal';

  const restrictionPoints = restrictions.reduce((sum, f) => sum + f.points, 0);
  const compute = (f: HealthFeatures) => {
    const calc = calculateEatHealthier(f);
    return { ...calc, score: clampHealthScore(calc.score + restrictionPoints) };
  };
  const main = compute(mainFeatures);
  const uncertainSugar = semantics.sugarSource.confidence === 'low' || semantics.sugarSource.value === 'unknown';
  const uncertainProcessing = semantics.processing.confidence === 'low' || semantics.processing.value === 'unknown';
  const sources = uncertainSugar
    ? [...new Set(['intrinsic', 'added', semantics.sugarSource.value] as const)] : [source];
  const processes = uncertainProcessing
    ? [...new Set(['whole_or_minimal', 'ultra_processed', semantics.processing.value] as const)] : [processing];
  const scenarios = [main.score];
  for (const sugar of sources) for (const process of processes) {
    const scenario = features(n, values, serving, plan, semantics, sugar, process);
    if (!finiteFeatures(scenario)) return unavailable('missing_nutrients');
    scenarios.push(compute(scenario).score);
  }
  const min = Math.min(...scenarios), max = Math.max(...scenarios), width = max - min;
  const uncertainty: GoalMatchUncertainty[] = [];
  if (uncertainSugar) {
    const a = compute({ ...mainFeatures, sugarSource: 'intrinsic' }).score;
    const b = compute({ ...mainFeatures, sugarSource: 'added' }).score;
    if (Math.abs(a - b) > 1e-10) uncertainty.push('sugarSource');
  }
  if (uncertainProcessing) {
    const a = compute({ ...mainFeatures, processing: 'whole_or_minimal' }).score;
    const b = compute({ ...mainFeatures, processing: 'ultra_processed' }).score;
    if (Math.abs(a - b) > 1e-10) uncertainty.push('processing');
  }
  if (serving.source === 'reference') uncertainty.push('typicalServing');
  if (values.proteinG === null) uncertainty.push('protein');
  if (values.fiberG === null) uncertainty.push('fiber');
  const estimatedNutrition = product.nutritionMetadata?.basis.quality === 'estimated' ||
    Object.values(product.nutritionMetadata?.fields ?? {}).some(field => field.quality !== 'verified');
  const labelData = fromLabel(n) && !estimatedNutrition;
  if (!labelData) uncertainty.push('nutrition');
  const range = { min: round(min), max: round(max) };
  // A wide range describes uncertainty; it does not make a coherent, complete nutrition input unscorable.
  // Keep the existing central calculation, scenarios and confidence thresholds unchanged.
  if (width > UNCERTAINTY_WIDTH.ambiguous + 1e-10 && checkNutritionSanity(n, serving.amount).length > 0) {
    if (!uncertainty.includes('nutrition')) uncertainty.push('nutrition');
    return { ...unavailable('ambiguous'), portion, confidence: 'low', range, uncertainty };
  }
  if (notApplicable) {
    return { ...base, state: 'not_applicable', portion, factors: restrictions.map((f) => ({ ...f, points: 0 })) };
  }
  const medium = values.proteinG === null || values.fiberG === null || !labelData ||
    (semantics.sugarSource.value === 'mixed' && mainFeatures.sugarsG >= 1);
  const confidence: ConfidenceLevel = serving.source === 'reference' || width > UNCERTAINTY_WIDTH.medium + 1e-10 ? 'low'
    : width <= UNCERTAINTY_WIDTH.high + 1e-10 && !medium ? 'high' : 'medium';
  return {
    ...base, state: 'goal_match', value: round(main.score), level: level(round(main.score)),
    portion, factors: [...(serving.source === 'reference' ? calculationFactors(main).map(withoutPortionValues) : calculationFactors(main)), ...restrictions],
    confidence, range, uncertainty,
  };
}


/** Reuses the exact v3 extraction and calculation for the opt-in v4 core; live routing is unchanged. */
export function extractEatHealthierContext(product: Product, plan: GoalMatchUserPlan) {
  if (plan.goal !== 'eat_healthier') return null;
  const deterministicBase = matchEatHealthier(product, plan, []);
  if (deterministicBase.state === 'insufficient_data' || deterministicBase.value === null && deterministicBase.state !== 'not_applicable') return null;
  const n = product.nutrition!;
  const semantics = normalizeProductSemantics(product.semantics, n.servingSize.value !== null)!;
  const serving = resolveServing(n)!;
  const values = nutrients(n, n.basis === 'per_serving' ? 100 / serving.amount : 1)!;
  const source = semantics.sugarSource.confidence === 'low' ? 'unknown' : semantics.sugarSource.value;
  const processing = semantics.processing.confidence === 'low' ? 'unknown' : semantics.processing.value;
  const input = features(n, values, serving, plan, semantics, source, processing);
  const calculation = calculateEatHealthier(input);
  return { deterministicBase, serving, semantics, values, features: input, calculation,
    riskRamps: { sugars: calculation.risks.sugars / 3, saturatedFat: calculation.risks.saturatedFat / 3, salt: calculation.risks.salt / 2.5 } };
}
