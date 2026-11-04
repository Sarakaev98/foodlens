import type { ProductScore, ProductScoreUnscoredReason, ScoreFactor, ScoreFactorKind } from '@foodlens/core';

type ScoredLevel = Exclude<ScoreFactor['level'], 'not_detected'>;

/** Короткие причины оценки по id фактора ("sugars.high"). Текст детерминирован: никакого AI. */
const REASONS: Readonly<Record<ScoreFactorKind, Partial<Record<ScoredLevel, string>>>> = {
  energy: { low: 'Low in calories', moderate: 'Moderate calories', high: 'High in calories' },
  protein: { low: 'Low in protein', moderate: 'Source of protein', high: 'High in protein' },
  sugars: { low: 'Low in sugar', moderate: 'Moderate sugar', high: 'High in sugar' },
  saturatedFat: { low: 'Low in saturated fat', moderate: 'Moderate saturated fat', high: 'High in saturated fat' },
  fiber: { low: 'Low in fiber', moderate: 'Source of fiber', high: 'High in fiber' },
  salt: { low: 'Low in salt', moderate: 'Moderate salt', high: 'High in salt' },
  additives: { none: 'No additives', some: 'Contains additives', many: 'Many additives' },
  processing: { none: 'Minimally processed', some: 'Processed product', many: 'Ultra-processed product' },
};

/** Название фактора для строки «Not counted: …». */
export const FACTOR_NAMES: Readonly<Record<ScoreFactorKind, string>> = {
  energy: 'calories',
  protein: 'protein',
  sugars: 'sugars',
  saturatedFat: 'saturated fat',
  fiber: 'fiber',
  salt: 'salt',
  additives: 'additives',
  processing: 'processing',
};

const UNITS: Readonly<Record<ScoreFactorKind, string>> = {
  energy: 'kcal',
  protein: 'g',
  sugars: 'g',
  saturatedFat: 'g',
  fiber: 'g',
  salt: 'g',
  additives: '',
  processing: '',
};

/** Главные минусы этикетки: без двух из них оценка строится на слишком малой части картины. */
const REQUIRED_FACTORS: readonly ScoreFactorKind[] = ['sugars', 'saturatedFat', 'salt'];
const PRELIMINARY_MIN_UNKNOWN = 2;

/** Предварительной оценку делают только данные, которых нет. Откуда пришли найденные значения, здесь не важно. */
export function isPreliminaryScore(score: ProductScore): boolean {
  return REQUIRED_FACTORS.filter((kind) => score.missingFactors.includes(kind)).length >= PRELIMINARY_MIN_UNKNOWN;
}

/** Подпись к оценке по неполным данным. null: данные полные, подпись не нужна. */
export function partialScoreNote(score: ProductScore): string | null {
  if (score.missingFactors.length === 0) return null;
  const names = score.missingFactors.map((kind) => FACTOR_NAMES[kind]).join(', ');
  return isPreliminaryScore(score) ? `Preliminary score: no data on ${names}, so it’s approximate.` : `Not counted: ${names}.`;
}

export const UNSCORED_MESSAGES: Readonly<Record<ProductScoreUnscoredReason, string>> = {
  no_nutrition: 'No nutrition label in the photo. Take a photo of it to get a score.',
  unknown_basis: 'The label doesn’t show what amount the values refer to, so they can’t be compared.',
  too_few_factors: 'Too few nutrition values are known. Take a photo of the nutrition label on the package.',
};

/** Текст для оценки без значения. */
export function unscoredMessage(score: ProductScore): string {
  const prefix = 'Not enough data to score.';
  return score.unscoredReason ? `${prefix} ${UNSCORED_MESSAGES[score.unscoredReason]}` : prefix;
}

export function formatScore(value: number): string {
  return value.toFixed(1);
}

export function factorReason(factor: ScoreFactor): string {
  return (factor.level !== 'not_detected' && REASONS[factor.kind][factor.level]) || FACTOR_NAMES[factor.kind];
}

/** «3.6 g per 100 g», для добавок «2 additives». */
export function factorDetail(factor: ScoreFactor, per: 'g' | 'ml'): string | null {
  if (factor.value === null) return null;
  const value = String(factor.value);
  if (factor.kind === 'processing') return null;
  if (factor.kind === 'additives') return factor.value === 0 ? null : `${value} ${factor.value === 1 ? 'additive' : 'additives'}`;
  return `${value} ${UNITS[factor.kind]} per 100 ${per === 'ml' ? 'ml' : 'g'}`;
}

export function scoreVerdict(value: number): string {
  if (value >= 9) return 'Excellent choice';
  if (value >= 7) return 'Good choice';
  if (value >= 5) return 'Average';
  if (value >= 3) return 'Best in moderation';
  if (value >= 1) return 'Poor nutrition';
  return 'Very poor nutrition';
}
