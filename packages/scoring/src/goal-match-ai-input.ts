import type { ConfidenceLevel, GoalMatchAiInput, GoalMatchAiNutrientLevel, GoalMatchV3, GoalMatchV4, GoalMatchUserPlan, Product } from '@foodlens/core';
import { matchGoal, goalMatchUnavailable } from './match-goal';
import { extractEatHealthierContext } from './goal-match-v3';
import { checkNutritionSanity } from './nutrition-sanity';

const round = (x: number): number => Math.round((x + Number.EPSILON) * 10) / 10;
const optional = (x: number | null): number | null => x === null || !Number.isFinite(x) ? null : round(x);
const level = (x: number | null): GoalMatchAiNutrientLevel => x === null ? 'unknown' : x >= .8 ? 'high' : x >= .3 ? 'moderate' : 'low';
export function deterministicV4(deterministic: GoalMatchV3): GoalMatchV4 {
  return { ...deterministic, version: 'goal-match-v4', source: 'deterministic', ai: null,
    deterministic, adjusted: false, ai_disagreement: false };
}
export type GoalMatchV4Preparation = { readonly state: 'terminal'; readonly result: GoalMatchV4 } | {
  readonly state: 'ready'; readonly input: GoalMatchAiInput; readonly deterministic: GoalMatchV3;
  readonly deterministicBase: GoalMatchV3;
  readonly dataConfidence: ConfidenceLevel;
  readonly riskRamps: { readonly sugars: number; readonly saturatedFat: number; readonly salt: number };
  readonly restrictions: GoalMatchV3['factors'];
};
/** Pure opt-in v4 guards/input. Not wired into ScanService or the existing matchGoal router. */
export function prepareGoalMatchV4(product: Product, profile: GoalMatchUserPlan | null | 'unavailable'): GoalMatchV4Preparation {
  const plan = profile === 'unavailable' ? null : profile;
  if (plan && plan.goal !== 'eat_healthier') throw new Error('v4 supports eat_healthier only');
  const original = profile === 'unavailable' ? goalMatchUnavailable('profile_unavailable') : matchGoal(product, plan);
  const deterministic: GoalMatchV3 = original.version === 'goal-match-v3' ? original
    : { ...original, version: 'goal-match-v3', state: 'unavailable', confidence: null, range: null, uncertainty: [] };
  const terminal = () => ({ state: 'terminal' as const, result: deterministicV4(deterministic) });
  if (!plan || deterministic.state === 'insufficient_data' || deterministic.state === 'unavailable' || deterministic.level === 'conflict') return terminal();
  const context = extractEatHealthierContext(product, plan);
  if (!context) return terminal();
  if (checkNutritionSanity(product.nutrition, context.serving.amount).length) {
    return { state: 'terminal', result: { ...deterministicV4(deterministic), state: 'insufficient_data',
      value: null, level: null, unavailableReason: 'invalid_nutrition', confidence: null, range: null,
      factors: deterministic.factors.filter(f => ['allergens', 'diet', 'avoidedIngredients'].includes(f.kind)).map(f => ({ ...f, points: 0 })) } };
  }
  if (deterministic.state === 'not_applicable') return terminal();
  // AI input speaks about a real serving; 100 g/ml is only the label basis, so this stays a deterministic estimate.
  if (context.serving.source === 'reference') return terminal();
  if (!Number.isFinite(plan.targets.caloriesKcal) || plan.targets.caloriesKcal <= 0 ||
      ![plan.targets.fatG, plan.targets.carbsG].every(value => Number.isFinite(value) && value >= 0)) {
    return { state: 'terminal', result: { ...deterministicV4(deterministic), state: 'insufficient_data',
      value: null, level: null, unavailableReason: 'missing_nutrients', confidence: null, range: null,
      factors: deterministic.factors.filter(f => ['allergens', 'diet', 'avoidedIngredients'].includes(f.kind)).map(f => ({ ...f, points: 0 })) } };
  }
  const { features: f, serving, semantics, calculation, riskRamps, deterministicBase } = context;
  const scale = product.nutrition!.basis === 'per_serving' ? 100 / serving.amount : 1;
  const raw = (value: number | null) => value === null || !Number.isFinite(value) || value < 0 ? null : value * scale;
  const fat = raw(product.nutrition!.fatG.value), carbs = raw(product.nutrition!.carbsG.value);
  const nutrientPer100 = { kcal: f.caloriesKcal, proteinG: f.proteinG, fatG: fat, saturatedFatG: f.saturatedFatG,
    carbsG: carbs, sugarsG: f.sugarsG, fiberG: f.fiberG, saltG: f.saltG };
  const per100 = Object.fromEntries(Object.entries(nutrientPer100).map(([k,v]) => [k, optional(v)])) as unknown as GoalMatchAiInput['product']['per100'];
  const free = f.sugarsG * (f.sugarSource === 'intrinsic' || f.sugarSource === 'none' ? 0 : f.sugarSource === 'mixed' ? .5 : 1);
  const m = f.servingMultiplier;
  const density = (v: number | null) => v === null || f.caloriesKcal === 0 ? null : optional(v * 100 / f.caloriesKcal);
  const bonus = (kind: 'protein' | 'fiber', max: number) => calculation.factors.find(x => x.kind === kind)!.points / max;
  const missing = Object.entries(per100).filter(([,v]) => v === null).map(([k]) => k);
  const ingredients = product.ingredients.provenance === 'observed' ? product.ingredients.value.map(x => x.name) : null;
  if (ingredients === null) missing.push('product.ingredients');
  if (product.additives.value === null) missing.push('product.additives');
  const input: GoalMatchAiInput = {
    version: 'goal-match-ai-input-v1', goal: 'eat_healthier', locale: 'en',
    product: { name: product.name.value, brand: product.brand.value, category: product.category.value,
      ingredients, ingredientsStatus: product.ingredients.provenance === 'observed' && ingredients !== null ? 'observed' : 'unknown',
      additives: product.additives.value?.map(x => ({ code: x.code, name: x.name })) ?? null,
      basis: product.nutrition!.basis as GoalMatchAiInput['product']['basis'], per100,
      serving: { amount: round(serving.amount), unit: serving.unit, source: 'label' } },
    semantics: { sugarSource: { value: f.sugarSource, confidence: semantics.sugarSource.confidence },
      processing: { value: f.processing, confidence: semantics.processing.confidence },
      productForm: { value: f.productForm, confidence: semantics.productForm.confidence } },
    facts: {
      perServing: { kcal: round(f.caloriesKcal*m), proteinG: optional(f.proteinG === null ? null : f.proteinG*m),
        sugarsG: round(f.sugarsG*m), freeSugarsG: round(free*m), saturatedFatG: round(f.saturatedFatG*m), saltG: round(f.saltG*m),
        fiberG: optional(f.fiberG === null ? null : f.fiberG*m) },
      share: { dailyKcalPct: round(f.caloriesKcal*m / plan.targets.caloriesKcal*100),
        proteinTargetPct: optional(f.proteinG === null ? null : f.proteinG*m / plan.targets.proteinG*100),
        freeSugarLimitPct: round(free*m/50*100), saturatedFatLimitPct: round(f.saturatedFatG*m/20*100), saltLimitPct: round(f.saltG*m/5*100) },
      density: { proteinKcalPct: f.proteinG === null ? null : f.caloriesKcal > 0 ? round(4*f.proteinG/f.caloriesKcal*100) : f.proteinG > 0 ? 100 : 0,
        fiberPer100kcal: density(f.fiberG), saturatedFatPer100kcal: density(f.saturatedFatG) },
      levels: { protein: level(f.proteinG === null ? null : bonus('protein',2.5)),
        fiber: level(f.fiberG === null ? null : bonus('fiber',1.5)), freeSugar: level(riskRamps.sugars),
        saturatedFat: level(riskRamps.saturatedFat), salt: level(riskRamps.salt) },
    },
    user: { dailyKcal: round(plan.targets.caloriesKcal), proteinTargetG: round(plan.targets.proteinG),
      fatTargetG: round(plan.targets.fatG), carbsTargetG: round(plan.targets.carbsG) }, missing,
  };
  const dataConfidence: ConfidenceLevel = f.proteinG === null && f.fiberG === null ? 'low' : deterministic.confidence ?? 'medium';
  return { state: 'ready', input, deterministic, deterministicBase, dataConfidence, riskRamps,
    restrictions: deterministic.factors.filter(f => ['allergens', 'diet', 'avoidedIngredients'].includes(f.kind)) };
}
export function buildGoalMatchAiInput(product: Product, plan: GoalMatchUserPlan): GoalMatchAiInput | null {
  const prepared = prepareGoalMatchV4(product, plan);
  return prepared.state === 'ready' ? prepared.input : null;
}
