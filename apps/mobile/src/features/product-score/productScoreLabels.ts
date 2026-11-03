import type { ProductScore, ProductScoreUnscoredReason, ScoreFactor, ScoreFactorKind } from '@foodlens/core';

type ScoredLevel = Exclude<ScoreFactor['level'], 'not_detected'>;

/** Короткие причины оценки по id фактора ("sugars.high"). Текст детерминирован: никакого AI. */
const REASONS: Readonly<Record<ScoreFactorKind, Partial<Record<ScoredLevel, string>>>> = {
  energy: { low: 'Низкая калорийность', moderate: 'Умеренная калорийность', high: 'Высокая калорийность' },
  protein: { low: 'Мало белка', moderate: 'Источник белка', high: 'Много белка' },
  sugars: { low: 'Мало сахара', moderate: 'Умеренно сахара', high: 'Много сахара' },
  saturatedFat: { low: 'Мало насыщенных жиров', moderate: 'Умеренно насыщенных жиров', high: 'Много насыщенных жиров' },
  fiber: { low: 'Мало клетчатки', moderate: 'Источник клетчатки', high: 'Много клетчатки' },
  salt: { low: 'Мало соли', moderate: 'Умеренно соли', high: 'Много соли' },
  additives: { none: 'Без пищевых добавок', some: 'Есть пищевые добавки', many: 'Много пищевых добавок' },
  processing: { none: 'Минимальная обработка', some: 'Продукт с обработкой', many: 'Ультрапереработанный продукт' },
};

/** Название фактора для строки «Не учтено: …». */
export const FACTOR_NAMES: Readonly<Record<ScoreFactorKind, string>> = {
  energy: 'калорийность',
  protein: 'белок',
  sugars: 'сахара',
  saturatedFat: 'насыщенные жиры',
  fiber: 'клетчатка',
  salt: 'соль',
  additives: 'добавки',
  processing: 'обработка',
};

const UNITS: Readonly<Record<ScoreFactorKind, string>> = {
  energy: 'ккал',
  protein: 'г',
  sugars: 'г',
  saturatedFat: 'г',
  fiber: 'г',
  salt: 'г',
  additives: 'шт.',
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
  return isPreliminaryScore(score) ? `Предварительная оценка: нет данных (${names}), поэтому она приблизительная.` : `Не учтено: ${names}.`;
}

export const UNSCORED_MESSAGES: Readonly<Record<ProductScoreUnscoredReason, string>> = {
  no_nutrition: 'На фото нет таблицы пищевой ценности. Сфотографируйте её, чтобы получить оценку.',
  unknown_basis: 'Не видно, к какому количеству относятся значения на этикетке, поэтому сравнить их нельзя.',
  too_few_factors: 'Известно слишком мало значений пищевой ценности. Сфотографируйте таблицу на упаковке.',
};

/** Текст для оценки без значения. */
export function unscoredMessage(score: ProductScore): string {
  const prefix = 'Недостаточно данных для оценки.';
  return score.unscoredReason ? `${prefix} ${UNSCORED_MESSAGES[score.unscoredReason]}` : prefix;
}

export function formatScore(value: number): string {
  return value.toFixed(1).replace('.', ',');
}

export function factorReason(factor: ScoreFactor): string {
  return (factor.level !== 'not_detected' && REASONS[factor.kind][factor.level]) || FACTOR_NAMES[factor.kind];
}

/** «3,6 г на 100 г», для добавок «2 шт.». */
export function factorDetail(factor: ScoreFactor, per: 'g' | 'ml'): string | null {
  if (factor.value === null) return null;
  const value = String(factor.value).replace('.', ',');
  if (factor.kind === 'processing') return null;
  if (factor.kind === 'additives') return factor.value === 0 ? null : `${value} ${UNITS.additives}`;
  return `${value} ${UNITS[factor.kind]} на 100 ${per === 'ml' ? 'мл' : 'г'}`;
}

export function scoreVerdict(value: number): string {
  if (value >= 9) return 'Отличный выбор';
  if (value >= 7) return 'Хороший выбор';
  if (value >= 5) return 'Средне';
  if (value >= 3) return 'Лучше нечасто';
  if (value >= 1) return 'Слабый состав';
  return 'Крайне слабый состав';
}
