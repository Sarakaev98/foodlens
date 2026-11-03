import type { ProcessingLevel, ProductForm, SugarSource } from '@foodlens/core';
import {
  clampHealthScore, EAT_HEALTHIER_BASE, FIBER_BONUS_MAX, FREE_SUGAR_LIMIT_G,
  MAX_HEALTH_BONUS, MIN_PROTEIN_PER_SERVING_G, PROTEIN_BONUS_MAX,
  ramp, SALT_LIMIT_G, SATURATED_FAT_LIMIT_G, SORTED_RISK_WEIGHTS,
} from './goal-match-v3-rules';

/** Already validated, normalized quantities. No user name, brand, category or Product Score is an input. */
export interface HealthFeatures {
  readonly caloriesKcal: number;
  readonly proteinG: number | null;
  readonly sugarsG: number;
  readonly saturatedFatG: number;
  readonly saltG: number;
  readonly fiberG: number | null;
  readonly servingMultiplier: number;
  readonly proteinTargetG: number;
  readonly sugarSource: SugarSource;
  readonly processing: ProcessingLevel;
  readonly productForm: ProductForm;
}

export type HealthFactorKind = 'protein' | 'fiber' | 'whole' | 'processing' | 'sugars' | 'saturatedFat' | 'salt';

export interface HealthFactor {
  readonly kind: HealthFactorKind;
  /** Actual contribution to the 0–10 calculation after bonus cap / risk discount. */
  readonly points: number;
  readonly value: number | null;
  readonly portionShare: number | null;
}

/** The raw score is deliberately not rounded: ranges and classification use the same underlying result. */
export interface HealthCalculation {
  readonly score: number;
  readonly factors: readonly HealthFactor[];
  readonly risks: Readonly<Record<'sugars' | 'saturatedFat' | 'salt', number>>;
}

function per100Kcal(amount: number, energy: number): number {
  return energy > 0 ? amount * 100 / energy : amount > 0 ? Infinity : 0;
}

export function calculateEatHealthier(input: HealthFeatures): HealthCalculation {
  const m = input.servingMultiplier;
  const proteinServing = input.proteinG === null ? null : input.proteinG * m;
  const proteinShare = proteinServing === null ? null : proteinServing / input.proteinTargetG;
  const proteinDensity = input.proteinG === null ? 0 : input.caloriesKcal > 0
    ? 4 * input.proteinG / input.caloriesKcal
    : input.proteinG > 0 ? 1 : 0;
  const protein = proteinServing === null || proteinServing < MIN_PROTEIN_PER_SERVING_G ? 0 : PROTEIN_BONUS_MAX * Math.sqrt(
    ramp(proteinDensity, 0.10, 0.35) * ramp(proteinShare!, 0.02, 0.12),
  );
  const fiberServing = input.fiberG === null ? null : input.fiberG * m;
  const fiber = input.fiberG === null ? 0 : FIBER_BONUS_MAX *
    ramp(per100Kcal(input.fiberG, input.caloriesKcal), 1, 3) * ramp(fiberServing!, 0.5, 3);
  const whole = input.processing === 'whole_or_minimal' ? 1 : input.processing === 'processed' ? 0.3 : 0;
  const upf = input.processing === 'ultra_processed' ? 0.5 : 0;
  const bonusSum = protein + fiber + whole;
  const bonusScale = bonusSum > MAX_HEALTH_BONUS ? MAX_HEALTH_BONUS / bonusSum : 1;
  const sugarCoefficient = input.sugarSource === 'intrinsic' || input.sugarSource === 'none'
    ? 0 : input.sugarSource === 'mixed' ? 0.5 : 1;
  const freeSugar = input.sugarsG * sugarCoefficient;
  const sugarShare = freeSugar * m / FREE_SUGAR_LIMIT_G;
  const saturatedShare = input.saturatedFatG * m / SATURATED_FAT_LIMIT_G;
  const saltShare = input.saltG * m / SALT_LIMIT_G;
  const sugarConcentration = input.productForm === 'beverage'
    ? ramp(freeSugar, 2.5, 10) : ramp(freeSugar, 5, 22.5);
  const risks = {
    sugars: 3 * Math.max(ramp(sugarShare, 0.1, 0.5), sugarConcentration),
    saturatedFat: 3 * Math.max(ramp(saturatedShare, 0.1, 0.5),
      ramp(per100Kcal(input.saturatedFatG, input.caloriesKcal), 1.5, 5)),
    salt: 2.5 * Math.max(ramp(saltShare, 0.1, 0.4), ramp(input.saltG, 0.75, 2)),
  };
  const ordered = (Object.keys(risks) as (keyof typeof risks)[])
    .map((kind, index) => ({ kind, raw: risks[kind], index }))
    .sort((a, b) => b.raw - a.raw || a.index - b.index);
  const shares = { sugars: sugarShare, saturatedFat: saturatedShare, salt: saltShare };
  const amounts = { sugars: freeSugar * m, saturatedFat: input.saturatedFatG * m, salt: input.saltG * m };
  const riskFactors: HealthFactor[] = ordered.map((item, index) => ({
    kind: item.kind, points: -item.raw * SORTED_RISK_WEIGHTS[index]!,
    value: amounts[item.kind], portionShare: shares[item.kind] * 100,
  }));
  const factors: HealthFactor[] = [
    { kind: 'protein', points: protein * bonusScale, value: proteinServing, portionShare: proteinShare === null ? null : proteinShare * 100 },
    { kind: 'fiber', points: fiber * bonusScale, value: fiberServing, portionShare: null },
    { kind: 'whole', points: whole * bonusScale, value: whole, portionShare: null },
    ...riskFactors,
    { kind: 'processing', points: -upf, value: null, portionShare: null },
  ];
  return {
    score: clampHealthScore(EAT_HEALTHIER_BASE + factors.reduce((sum, factor) => sum + factor.points, 0)),
    factors,
    risks,
  };
}
