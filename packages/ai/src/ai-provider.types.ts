import type {
  Barcode,
  FoodPreferences,
  MealId,
  MealPlan,
  NutritionTargets,
  Product,
  ProductScore,
} from '@foodlens/core';

export interface ImageInput {
  readonly mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  readonly base64: string;
}

export type AnalyzeProductInput = (
  | { readonly kind: 'image'; readonly image: ImageInput }
  | { readonly kind: 'barcode'; readonly barcode: Barcode }
  | { readonly kind: 'text'; readonly text: string }
) & {
  /** Идентификатор запроса FoodLens для сквозного логирования. */
  readonly requestId?: string;
};

export interface ExplainProductInput {
  readonly product: Product;
  readonly score?: ProductScore;
  /** BCP 47, например "ru" или "en". */
  readonly locale: string;
}

export interface ProductExplanation {
  readonly summary: string;
  readonly highlights: readonly string[];
}

export interface GenerateMealPlanInput {
  readonly targets: NutritionTargets;
  readonly preferences: FoodPreferences;
  /** Первый день плана, YYYY-MM-DD. */
  readonly startDate: string;
  readonly days: number;
  readonly locale: string;
}

export interface ReplaceMealInput {
  readonly plan: MealPlan;
  readonly mealId: MealId;
  readonly reason?: string;
  readonly locale: string;
}
