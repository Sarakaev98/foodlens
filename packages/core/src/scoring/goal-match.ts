import type { GoalMatchAiMetadata } from './goal-match-ai';
import type { NutritionTargets } from '../nutrition';
import type { ConfidenceLevel } from '../common';
import type { FoodPreferences, NutritionGoal } from '../user';

/**
 * Насколько продукт подходит цели конкретного пользователя (Goal Match).
 * Отдельно от ProductScore: оценка продукта объективна, Goal Match зависит от профиля и дневных целей.
 */
export interface GoalMatchV1 {
  /** 0–100, целое. null: персональную оценку посчитать нельзя (см. unavailableReason). */
  readonly value: number | null;
  /** Уровень по value. conflict: продукт противоречит ограничениям профиля, value = 0. */
  readonly level: GoalMatchLevel | null;
  /** Почему value нет. null, если value посчитано. */
  readonly unavailableReason: GoalMatchUnavailableReason | null;
  /** Цель, для которой посчитано. null, если профиля нет. */
  readonly goal: NutritionGoal | null;
  /** Количество, с которым сравниваются дневные цели. null, если сравнивать не с чем. */
  readonly portion: GoalMatchPortion | null;
  readonly factors: readonly GoalMatchFactor[];
  /** Версия правил, например "goal-match-v1". */
  readonly version: 'goal-match-v1';
  readonly state?: never;
  readonly confidence?: never;
  readonly range?: never;
}

/** Version discriminates units: v1 value/points use 0–100, v3 value/points/range use 0–10. */
export type GoalMatch = GoalMatchV1 | GoalMatchV3;
export type GoalMatchState = 'unavailable' | 'goal_match' | 'insufficient_data' | 'not_applicable';
export type GoalMatchUncertainty = 'sugarSource' | 'processing' | 'typicalServing' | 'protein' | 'fiber' | 'nutrition';

export interface GoalMatchV3 extends Omit<GoalMatchV1, 'version' | 'state' | 'confidence' | 'range'> {
  /** v3 only: 0–10, rounded to one decimal; v1 remains 0–100. */
  readonly value: number | null;
  readonly version: 'goal-match-v3';
  readonly state: GoalMatchState;
  readonly confidence: ConfidenceLevel | null;
  readonly range: { readonly min: number; readonly max: number } | null;
  /** Sources of uncertainty for short, deterministic mobile notes. */
  readonly uncertainty: readonly GoalMatchUncertainty[];
}

export type GoalMatchLevel = 'great' | 'good' | 'fair' | 'poor' | 'conflict';

export type GoalMatchUnavailableReason =
  /** Пользователь ещё не заполнил профиль: целей нет, угадывать их нельзя. */
  | 'no_profile'
  /** Профиль не удалось загрузить (например, база недоступна). Скан при этом работает. */
  | 'profile_unavailable'
  /** На фото нет таблицы пищевой ценности. */
  | 'no_nutrition'
  /** Непонятно, к какому количеству относятся значения на этикетке. */
  | 'unknown_basis'
  /** Не прочитана калорийность: без неё нельзя сравнить продукт с дневным планом. */
  | 'no_calories'
  | 'missing_nutrients'
  | 'unknown_portion'
  | 'ai_context_unavailable'
  | 'ambiguous';

/**
 * serving: порция с упаковки (или значения на этикетке указаны на порцию).
 * per_100: размер порции не указан, доля дневной нормы калорий не считается.
 */
export interface GoalMatchPortion {
  readonly basis: 'serving' | 'per_100';
  /** Размер в граммах или миллилитрах. null: значения указаны на порцию, но её размер не виден. */
  readonly amount: number | null;
  readonly unit: 'g' | 'ml' | null;
  /** Калорийность этого количества. null, если калорийность не прочитана. */
  readonly caloriesKcal: number | null;
}

export const GOAL_MATCH_FACTOR_KINDS = [
  'calories',
  'energyDensity',
  'protein',
  'fat',
  'carbs',
  'sugars',
  'saturatedFat',
  'salt',
  'allergens',
  'diet',
  'avoidedIngredients',
  'fiber',
  'whole',
  'processing',
] as const;

export type GoalMatchFactorKind = (typeof GOAL_MATCH_FACTOR_KINDS)[number];

/**
 * Уровни нутриентов: low / moderate / high относительно плана пользователя.
 * Уровни ограничений: ok (конфликтов нет), may_contain (следы аллергена), conflict.
 * not_counted: данных нет на этикетке или сравнение не имеет смысла, фактор не учтён.
 */
export type GoalMatchFactorLevel = 'low' | 'moderate' | 'high' | 'ok' | 'may_contain' | 'conflict' | 'not_counted';

export interface GoalMatchFactor {
  /** Например "protein.high". */
  readonly id: `${GoalMatchFactorKind}.${GoalMatchFactorLevel}`;
  readonly kind: GoalMatchFactorKind;
  readonly level: GoalMatchFactorLevel;
  readonly impact: 'positive' | 'negative' | 'neutral';
  /** Actual signed contribution: v1 uses 0–100 units; v3 uses 0–10 after bonus cap / risk discounts. */
  readonly points: number;
  /**
   * calories: доля дневной цели калорий в порции, %. energyDensity: ккал на 100 г (только для еды).
   * v1 nutrients: ratio of nutrient density to the daily plan (1 = matches the plan).
   * v3 nutrients: grams in the serving; whole: unscaled processing bonus (1 or 0.3).
   * Ограничения: null.
   */
  readonly value: number | null;
  /** Сколько процентов дневной цели или нормы даёт порция. null без размера порции и для ограничений. */
  readonly portionShare: number | null;
  /**
   * Для ограничений: коды аллергенов (allergens), коды аллергенов или категории продукта (diet),
   * слова из списка «избегать» (avoidedIngredients). Для diet.not_counted — непроверенные dietaryPreferences. Для остальных пусто.
   */
  readonly matches: readonly string[];
}

/** Всё, что Goal Match знает о пользователе: цель, дневные цели из Nutrition Engine и ограничения. */
export interface GoalMatchUserPlan extends FoodPreferences {
  readonly goal: NutritionGoal;
  readonly targets: NutritionTargets;
}

/** Deliberately not in the live GoalMatch union until API/mobile integration is enabled. */
export interface GoalMatchV4 extends Omit<GoalMatchV3, 'version' | 'unavailableReason'> {
  readonly version: 'goal-match-v4';
  readonly unavailableReason: GoalMatchV4UnavailableReason | null;
  readonly source: 'ai' | 'deterministic'; readonly ai: GoalMatchAiMetadata | null;
  readonly deterministic: GoalMatchV3; readonly adjusted: boolean; readonly ai_disagreement: boolean;
}

export type GoalMatchV4UnavailableReason = GoalMatchUnavailableReason | 'invalid_nutrition';
