import type { ConfidenceLevel } from '../common';
import type { Product } from '../product';
import type { GoalMatch } from './goal-match';

/**
 * Результат Scoring Engine. Формат общий для scoring, AI (explainProduct) и UI.
 * Оценка объективная: зависит только от данных продукта, не от целей пользователя.
 */
export interface ProductScore {
  /** Итоговая оценка 0.0–10.0 с одним знаком после запятой. null: данных для оценки недостаточно. */
  readonly value: number | null;
  /** Почему оценки нет. null, если value посчитано. */
  readonly unscoredReason: ProductScoreUnscoredReason | null;
  /** Насколько полны данные под оценкой. Оценка по неполной этикетке приблизительная. */
  readonly confidence: ConfidenceLevel;
  /** Какие важные факторы неизвестны: они не считаются нулём и не штрафуются, их вклад просто исключён. */
  readonly missingFactors: readonly ScoreFactorKind[];
  /** Все учтённые и неучтённые факторы: из них строится объяснение оценки. */
  readonly factors: readonly ScoreFactor[];
  /** Потолок, который сработал: серьёзный минус не перекрывается плюсами. null, если не сработал. */
  readonly ceiling: ProductScoreCeiling | null;
  /** Версия правил, например "product-score-v1". Меняется при изменении порогов или весов. */
  readonly version: string;
}

export interface ProductScoreCeiling {
  /** Максимально возможная оценка при этих факторах. */
  readonly max: number;
  /** Факторы, из-за которых сработал потолок, например ["sugars.high"]. */
  readonly factorIds: readonly ScoreFactor['id'][];
}

export type ProductScoreUnscoredReason =
  /** На фото нет таблицы пищевой ценности. */
  | 'no_nutrition'
  /** Непонятно, к какому количеству относятся значения (нет основы или размера порции). */
  | 'unknown_basis'
  /** Известно слишком мало значений пищевой ценности: оценка была бы случайной. */
  | 'too_few_factors';

export type ScoreFactorImpact = 'positive' | 'negative' | 'neutral';

export const SCORE_FACTOR_KINDS = ['energy', 'protein', 'sugars', 'saturatedFat', 'fiber', 'salt', 'additives', 'processing'] as const;

export type ScoreFactorKind = (typeof SCORE_FACTOR_KINDS)[number];

/** Уровень значения по порогам правил. not_detected: значения нет на этикетке, фактор не учтён. */
export type ScoreFactorLevel = 'low' | 'moderate' | 'high' | 'none' | 'some' | 'many' | 'not_detected';

export interface ScoreFactor {
  /** Машинный идентификатор фактора, например "sugars.high". */
  readonly id: `${ScoreFactorKind}.${ScoreFactorLevel}`;
  readonly kind: ScoreFactorKind;
  readonly level: ScoreFactorLevel;
  readonly impact: ScoreFactorImpact;
  /**
   * Вклад в оценку в баллах (со знаком), до потолка и ограничения 0–10. 0 для неучтённых факторов.
   * impact: negative при штрафе; positive при бонусе или уровне low у нутриента, которого должно быть мало.
   */
  readonly points: number;
  /**
   * Значение, по которому выбран уровень: на 100 г или 100 мл (единица в имени нутриента),
   * для добавок количество, для обработки всегда null. null, если значения нет.
   */
  readonly value: number | null;
}

/** Ответ сканирования: нормализованный продукт, его объективная оценка и персональный Goal Match. */
export interface ProductScanResult {
  readonly product: Product;
  readonly score: ProductScore;
  /** Не влияет на score. Всегда есть: без профиля или данных value = null и указана причина. */
  readonly goalMatch: GoalMatch;
}
