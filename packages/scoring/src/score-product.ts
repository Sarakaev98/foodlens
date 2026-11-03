import {
  lowestConfidence,
  SCORE_FACTOR_KINDS,
  type ConfidenceLevel,
  type NutrientValue,
  type NutritionFacts,
  type Product,
  type ProductScore,
  type ProductScoreCeiling,
  type ProductScoreUnscoredReason,
  type ScoreFactor,
  type ScoreFactorImpact,
  type ScoreFactorKind,
  type ScoreFactorLevel,
} from '@foodlens/core';
import {
  ADDITIVE_CLASSES,
  ADDITIVES_RULE,
  BASE_SCORE,
  ENERGY_RULE,
  EXPECTED_FACTORS,
  FIBER_RULE,
  HIGH_LEVEL_CEILING,
  LOW_SCALE_FLOOR,
  MAX_BONUS,
  MIN_KNOWN_NUTRIENTS,
  PARTIAL_DATA_CEILING,
  PARTIAL_DATA_MIN_UNKNOWN,
  PROCESSING_RULE,
  PRODUCT_SCORE_VERSION,
  PROTEIN_RULE,
  REQUIRED_FACTORS,
  SALT_RULE,
  SATURATED_FAT_RULE,
  SCORE_MAX,
  SCORE_MIN,
  SUGARS_RULE,
  type BenefitRule,
  type LimitRule,
  type ProductForm,
} from './product-score-rules';
import type { ScoringEngine } from './scoring-engine';

/** Значения на 100 г или 100 мл. null: основа неизвестна, сравнивать с порогами нельзя. */
interface Per100 {
  readonly form: ProductForm;
  readonly scale: number;
}

type NutritionKind = Exclude<ScoreFactorKind, 'additives' | 'processing'>;

/**
 * Детерминированная оценка продукта 0–10 по правилам из product-score-rules.
 * Чистая функция: одинаковый Product всегда даёт одинаковый результат. AI здесь не участвует.
 */
export function scoreProduct(product: Product): ProductScore {
  const nutrition = product.nutrition;
  const per100 = nutrition ? toPer100(nutrition) : null;

  const nutritionFactors: Record<NutritionKind, ScoreFactor> = {
    energy: limitFactor('energy', nutrition?.caloriesKcal, per100, ENERGY_RULE),
    protein: benefitFactor('protein', nutrition?.proteinG, per100, PROTEIN_RULE),
    sugars: limitFactor('sugars', nutrition?.sugarsG, per100, SUGARS_RULE),
    saturatedFat: limitFactor('saturatedFat', nutrition?.saturatedFatG, per100, SATURATED_FAT_RULE),
    fiber: benefitFactor('fiber', nutrition?.fiberG, per100, FIBER_RULE),
    salt: limitFactor('salt', nutrition?.saltG, per100, SALT_RULE),
  };
  const byKind: Record<ScoreFactorKind, ScoreFactor> = limitBonuses({ ...nutritionFactors, additives: additivesFactor(product), processing: processingFactor(product) });
  const factors = SCORE_FACTOR_KINDS.map((kind) => byKind[kind]);
  const missingFactors = EXPECTED_FACTORS.filter((kind) => byKind[kind].level === 'not_detected');

  const unscoredReason: ProductScoreUnscoredReason | null = !nutrition
    ? 'no_nutrition'
    : !per100
      ? 'unknown_basis'
      : knownNutrients(nutrition) < MIN_KNOWN_NUTRIENTS
        ? 'too_few_factors'
        : null;

  if (unscoredReason) {
    // Факторы остаются для объяснения, но без оценки их баллы ни на что не влияют.
    return { value: null, unscoredReason, confidence: 'low', missingFactors, factors: factors.map(withoutPoints), ceiling: null, version: PRODUCT_SCORE_VERSION };
  }

  const raw = factors.reduce((sum, factor) => sum + factor.points, BASE_SCORE);
  const required = REQUIRED_FACTORS.map((kind) => byKind[kind]);
  const severe = required.filter((factor) => factor.level === 'high');
  const unknown = required.filter((factor) => factor.level === 'not_detected');
  const limit = severe.length > 0
    ? { max: HIGH_LEVEL_CEILING, factors: severe }
    : { max: PARTIAL_DATA_CEILING, factors: unknown.length >= PARTIAL_DATA_MIN_UNKNOWN ? unknown : [] };
  const ceiling: ProductScoreCeiling | null =
    limit.factors.length > 0 && raw > limit.max ? { max: limit.max, factorIds: limit.factors.map((factor) => factor.id) } : null;

  return {
    value: roundScore(calibrateLowScale(ceiling ? Math.min(raw, ceiling.max) : raw)),
    unscoredReason: null,
    confidence: scoreConfidence(missingFactors, unknown.length, product),
    missingFactors,
    factors,
    ceiling,
    version: PRODUCT_SCORE_VERSION,
  };
}

export const productScoringEngine: ScoringEngine = { score: scoreProduct };

/** Известны ли все главные минусы. Если нет, стоит искать данные дальше: оценка пока приблизительная. */
export function hasRequiredFactors(score: ProductScore): boolean {
  return score.value !== null && !REQUIRED_FACTORS.some((kind) => score.missingFactors.includes(kind));
}

/** Сколько значений пищевой ценности известно. Натрий отдельно не считается: это та же соль. */
function knownNutrients(nutrition: NutritionFacts): number {
  const values = [nutrition.caloriesKcal, nutrition.proteinG, nutrition.carbsG, nutrition.sugarsG, nutrition.fatG, nutrition.saturatedFatG, nutrition.fiberG, nutrition.saltG];
  return values.filter((nutrient) => nutrient.value !== null).length;
}

/** Два и больше неизвестных главных минуса: low; один или другой важный фактор: medium. Не выше уверенности в самих значениях. */
function scoreConfidence(missing: readonly ScoreFactorKind[], unknownRequired: number, product: Product): ConfidenceLevel {
  const level: ConfidenceLevel = unknownRequired >= 2 ? 'low' : missing.length > 0 ? 'medium' : 'high';
  return lowestConfidence(level, product.confidence.nutrition ?? 'low');
}

/** Низ шкалы: сумма ниже HIGH_LEVEL_CEILING сжимается линейно, сумма выше не меняется. */
export function calibrateLowScale(raw: number): number {
  if (raw >= HIGH_LEVEL_CEILING) return raw;
  return (HIGH_LEVEL_CEILING * (raw - LOW_SCALE_FLOOR)) / (HIGH_LEVEL_CEILING - LOW_SCALE_FLOOR);
}

/** Ограничение 0–10 и округление до 0.1. */
export function roundScore(raw: number): number {
  const clamped = Math.min(SCORE_MAX, Math.max(SCORE_MIN, raw));
  return Math.round(clamped * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function toPer100(nutrition: NutritionFacts): Per100 | null {
  switch (nutrition.basis) {
    case 'per_100g':
      return { form: 'food', scale: 1 };
    case 'per_100ml':
      return { form: 'drink', scale: 1 };
    case 'per_serving': {
      // Порцию можно пересчитать на 100 г/мл, только если её размер прочитан на упаковке.
      const size = nutrition.servingSize.value;
      if (!size) return null;
      return { form: size.unit === 'ml' ? 'drink' : 'food', scale: 100 / size.amount };
    }
    case 'unknown':
      return null;
  }
}

function factor(kind: ScoreFactorKind, level: ScoreFactorLevel, points: number, value: number | null): ScoreFactor {
  // «Мало сахара» — хороший признак, даже если он не добавляет баллов: показывается как плюс.
  const impact: ScoreFactorImpact = points < 0 ? 'negative' : points > 0 || (level === 'low' && isLimit(kind)) ? 'positive' : 'neutral';
  return { id: `${kind}.${level}`, kind, level, impact, points: round2(points) || 0, value };
}

function isLimit(kind: ScoreFactorKind): boolean {
  return kind === 'energy' || kind === 'sugars' || kind === 'saturatedFat' || kind === 'salt';
}

function per100Value(nutrient: NutrientValue | undefined, per100: Per100 | null): number | null {
  if (!nutrient || nutrient.value === null || !per100) return null;
  return round2(nutrient.value * per100.scale);
}

function limitFactor(kind: ScoreFactorKind, nutrient: NutrientValue | undefined, per100: Per100 | null, rule: LimitRule): ScoreFactor {
  const value = per100Value(nutrient, per100);
  if (value === null || !per100) return factor(kind, 'not_detected', 0, null);
  const low = rule.lowMax[per100.form];
  const high = rule.highAbove[per100.form];
  const level = value <= low ? 'low' : value > high ? 'high' : 'moderate';
  const penalty = Math.min(rule.maxPenalty, (rule.weight[per100.form] * Math.max(0, value - low)) / (high - low));
  return factor(kind, level, -penalty, value);
}

function benefitFactor(kind: ScoreFactorKind, nutrient: NutrientValue | undefined, per100: Per100 | null, rule: BenefitRule): ScoreFactor {
  const value = per100Value(nutrient, per100);
  if (value === null) return factor(kind, 'not_detected', 0, null);
  const level = value >= rule.highFrom ? 'high' : value >= rule.moderateFrom ? 'moderate' : 'low';
  const share = Math.min(1, Math.max(0, (value - rule.moderateFrom) / (rule.highFrom - rule.moderateFrom)));
  return factor(kind, level, rule.maxBonus * share, value);
}

/**
 * Штраф за длину списка плюс ограниченный штраф за технологические классы. Классы ищутся и в списке добавок, и в составе.
 * Без списка и без признаков в составе добавки неизвестны: пустой список ничего не значит.
 */
function additivesFactor(product: Product): ScoreFactor {
  const additives = product.additives.value;
  const classes = additiveClasses(product);
  if (additives === null && classes === 0) return factor('additives', 'not_detected', 0, null);
  const count = additives?.length ?? 0;
  const level = count >= ADDITIVES_RULE.manyFrom ? 'many' : count >= ADDITIVES_RULE.someFrom || classes > 0 ? 'some' : 'none';
  const penalty = Math.min(ADDITIVES_RULE.maxPenalty, count * ADDITIVES_RULE.penaltyEach) + Math.min(ADDITIVES_RULE.maxClassPenalty, classes * ADDITIVES_RULE.classPenalty);
  return factor('additives', level, -penalty, count);
}

function additiveClasses(product: Product): number {
  const additives = product.additives.value ?? [];
  const words = [...additives.map((additive) => additive.name ?? ''), ...(product.ingredients?.value ?? []).map((ingredient) => ingredient.name)];
  return ADDITIVE_CLASSES.filter(({ codes, words: pattern }) => additives.some((additive) => additive.code !== null && codes.test(additive.code)) || words.some((word) => pattern.test(word))).length;
}

/** Обработка из признаков продукта. Неизвестная не учитывается; штраф только за ультрапереработку. */
function processingFactor(product: Product): ScoreFactor {
  switch (product.semantics?.processing.value) {
    case 'whole_or_minimal':
      return factor('processing', 'none', 0, null);
    case 'processed':
      return factor('processing', 'some', 0, null);
    case 'ultra_processed':
      return factor('processing', 'many', -PROCESSING_RULE.ultraProcessedPenalty, null);
    default:
      return factor('processing', 'not_detected', 0, null);
  }
}

/** Сумма бонусов не больше MAX_BONUS: бонусы пропорционально уменьшаются, баллы факторов остаются честными. */
function limitBonuses(factors: Record<ScoreFactorKind, ScoreFactor>): Record<ScoreFactorKind, ScoreFactor> {
  const bonus = Object.values(factors).reduce((sum, item) => sum + Math.max(0, item.points), 0);
  if (bonus <= MAX_BONUS) return factors;
  const scale = MAX_BONUS / bonus;
  const scaled = Object.entries(factors).map(([kind, item]) =>
    [kind, item.points > 0 ? factor(item.kind, item.level, item.points * scale, item.value) : item] as const,
  );
  return Object.fromEntries(scaled) as Record<ScoreFactorKind, ScoreFactor>;
}

function withoutPoints(scoreFactor: ScoreFactor): ScoreFactor {
  return { ...scoreFactor, impact: 'neutral', points: 0 };
}
