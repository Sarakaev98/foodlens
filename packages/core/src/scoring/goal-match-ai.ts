import type { ConfidenceLevel } from '../common';
import type { Additive, ProcessingLevel, ProductForm, SugarSource } from '../product';

export const GOAL_MATCH_AI_BANDS = ['excellent_fit', 'good_fit', 'mixed_fit', 'poor_fit', 'very_poor_fit'] as const;
export type GoalMatchAiBand = typeof GOAL_MATCH_AI_BANDS[number];
export const GOAL_MATCH_AI_DIMENSIONS = ['nutrientDensity', 'processing', 'sugar', 'fatQuality', 'sodium', 'portion'] as const;
export type GoalMatchAiDimension = typeof GOAL_MATCH_AI_DIMENSIONS[number];
export const GOAL_MATCH_AI_DIMENSION_VALUES = ['strong_positive', 'positive', 'neutral', 'negative', 'strong_negative', 'not_assessed'] as const;
export type GoalMatchAiDimensionValue = typeof GOAL_MATCH_AI_DIMENSION_VALUES[number];
export const GOAL_MATCH_AI_FACTOR_CODES = ['high_protein', 'fiber_source', 'whole_food', 'intrinsic_sugar', 'low_sugar',
  'good_fat_profile', 'low_salt', 'fits_portion', 'ultra_processed', 'added_sugar', 'high_sugar',
  'high_saturated_fat', 'high_salt', 'sweeteners', 'fried_or_refined_oil', 'refined_starch',
  'low_nutrient_density', 'energy_dense'] as const;
export type GoalMatchAiFactorCode = typeof GOAL_MATCH_AI_FACTOR_CODES[number];
export const GOAL_MATCH_AI_WARNINGS = ['fiber_unknown', 'serving_estimated', 'ingredients_missing', 'sweeteners', 'contains_alcohol', 'caffeine'] as const;
export type GoalMatchAiWarning = typeof GOAL_MATCH_AI_WARNINGS[number];
export type GoalMatchAiNutrientLevel = 'high' | 'moderate' | 'low' | 'unknown';
export interface GoalMatchAiPer100 {
  readonly kcal: number; readonly proteinG: number | null; readonly fatG: number | null;
  readonly saturatedFatG: number; readonly carbsG: number | null; readonly sugarsG: number;
  readonly fiberG: number | null; readonly saltG: number;
}
export interface GoalMatchAiInput {
  readonly version: 'goal-match-ai-input-v1'; readonly goal: 'eat_healthier'; readonly locale: 'ru';
  readonly product: {
    readonly name: string | null; readonly brand: string | null; readonly category: string | null;
    readonly ingredients: readonly string[] | null; readonly ingredientsStatus: 'observed' | 'unknown';
    readonly additives: readonly Additive[] | null;
    readonly basis: 'per_100g' | 'per_100ml' | 'per_serving';
    readonly per100: GoalMatchAiPer100;
    readonly serving: { readonly amount: number; readonly unit: 'g' | 'ml'; readonly source: 'label' | 'ai' };
  };
  readonly semantics: {
    readonly sugarSource: { readonly value: SugarSource; readonly confidence: ConfidenceLevel };
    readonly processing: { readonly value: ProcessingLevel; readonly confidence: ConfidenceLevel };
    readonly productForm: { readonly value: ProductForm; readonly confidence: ConfidenceLevel };
  };
  readonly facts: {
    readonly perServing: { readonly kcal: number; readonly proteinG: number | null; readonly sugarsG: number;
      readonly freeSugarsG: number; readonly saturatedFatG: number; readonly saltG: number; readonly fiberG: number | null };
    readonly share: { readonly dailyKcalPct: number; readonly proteinTargetPct: number | null;
      readonly freeSugarLimitPct: number; readonly saturatedFatLimitPct: number; readonly saltLimitPct: number };
    readonly density: { readonly proteinKcalPct: number | null; readonly fiberPer100kcal: number | null;
      readonly saturatedFatPer100kcal: number | null };
    readonly levels: { readonly protein: GoalMatchAiNutrientLevel; readonly fiber: GoalMatchAiNutrientLevel;
      readonly freeSugar: GoalMatchAiNutrientLevel; readonly saturatedFat: GoalMatchAiNutrientLevel; readonly salt: GoalMatchAiNutrientLevel };
  };
  readonly user: { readonly dailyKcal: number; readonly proteinTargetG: number; readonly fatTargetG: number; readonly carbsTargetG: number };
  /** Nutrient keys (e.g. proteinG), or canonical paths for non-nutrient missing data. */
  readonly missing: readonly string[];
}
export interface GoalMatchAiFactor {
  readonly code: GoalMatchAiFactorCode; readonly direction: 'positive' | 'negative';
  readonly impact: 'high' | 'medium' | 'low';
  /** Canonical paths to scalar leaves, or the explicitly supported ingredient string list. */
  readonly facts: readonly string[]; readonly text: string;
}
export interface GoalMatchAiOutput {
  readonly version: 'goal-match-ai-v1'; readonly band: GoalMatchAiBand; readonly score: number;
  readonly confidence: ConfidenceLevel;
  readonly dimensions: Readonly<Record<GoalMatchAiDimension, GoalMatchAiDimensionValue>>;
  readonly factors: readonly GoalMatchAiFactor[]; readonly summary: string; readonly warnings: readonly GoalMatchAiWarning[];
}
export interface GoalMatchAiMetadata extends GoalMatchAiOutput {
  readonly inputVersion: 'goal-match-ai-input-v1'; readonly promptVersion: 'eat-healthier-rubric-v2';
  readonly model: string; readonly cacheHit: boolean;
}
