import { SALT_PER_SODIUM, type NutritionFacts } from '@foodlens/core';

export type NutritionSanityIssue = 'sugars_exceed_carbs' | 'saturated_fat_exceeds_fat' | 'macros_exceed_mass'
  | 'energy_mismatch' | 'salt_exceeds_limit' | 'calories_exceed_limit';
const known = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n);
/** Checks only complete comparisons. Values are normalized once, never null -> zero. */
export function checkNutritionSanity(n: NutritionFacts | null, servingAmount?: number): readonly NutritionSanityIssue[] {
  if (!n || n.basis === 'unknown') return [];
  const amount = servingAmount ?? n.servingSize.value?.amount;
  if (n.basis === 'per_serving' && (!known(amount) || amount <= 0)) return [];
  const scale = n.basis === 'per_serving' ? 100 / amount! : 1;
  const value = (v: number | null) => known(v) && Number.isFinite(v * scale) ? v * scale : null;
  const p = value(n.proteinG.value), fat = value(n.fatG.value), carbs = value(n.carbsG.value);
  const sugar = value(n.sugarsG.value), sat = value(n.saturatedFatG.value), fiber = value(n.fiberG.value);
  const sodium = n.sodiumMg.value;
  const salt = value(n.saltG.value ?? (known(sodium) ? sodium * (SALT_PER_SODIUM / 1000) : null));
  const kcal = value(n.caloriesKcal.value);
  const issues: NutritionSanityIssue[] = [];
  if (sugar !== null && carbs !== null && sugar > carbs + .5) issues.push('sugars_exceed_carbs');
  if (sat !== null && fat !== null && sat > fat + .5) issues.push('saturated_fat_exceeds_fat');
  if (p !== null && fat !== null && carbs !== null && salt !== null && p + fat + carbs + salt > 105) issues.push('macros_exceed_mass');
  if (p !== null && fat !== null && carbs !== null && fiber !== null && kcal !== null) {
    const difference = Math.abs(4 * p + 4 * carbs + 9 * fat + 2 * fiber - kcal);
    if (difference > 40 && difference > .35 * kcal) issues.push('energy_mismatch');
  }
  if (salt !== null && salt > 30) issues.push('salt_exceeds_limit');
  if (kcal !== null && kcal > 900) issues.push('calories_exceed_limit');
  return issues;
}
