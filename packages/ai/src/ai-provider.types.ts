import type {
  Barcode,
  FoodPreferences,
  MealId,
  MealPlan,
  NutritionGoal,
  NutritionTargets,
  Product,
  ProductScore,
} from '@foodlens/core';
import type { PRODUCT_IMAGE_ROLES } from './product-images';

export interface ImageInput {
  readonly mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  readonly base64: string;
}

export type ProductImageRole = (typeof PRODUCT_IMAGE_ROLES)[number];

/** Фото продукта; role только подсказка, содержимое анализируется всегда. */
export interface ProductImageInput extends ImageInput {
  readonly role?: ProductImageRole;
}

/** Одно фото готового блюда. */
export interface AnalyzeMealPhotoInput {
  readonly image: ImageInput;
  /** Идентификатор запроса FoodLens для сквозного логирования. */
  readonly requestId?: string;
}

export type AnalyzeProductInput = (
  | { readonly kind: 'image'; readonly image: ImageInput }
  /** 1–3 фото одного продукта, один запрос к AI. Порядок сохраняется. */
  | { readonly kind: 'image'; readonly images: readonly ProductImageInput[] }
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
  readonly goal: NutritionGoal;
  readonly targets: NutritionTargets;
  readonly preferences: FoodPreferences;
  /** Первый день плана, YYYY-MM-DD. */
  readonly startDate: string;
  readonly days: number;
  /** 3: без перекуса; по умолчанию 4. */
  readonly mealsPerDay?: 3 | 4;
  readonly locale: string;
  /** Единственная попытка исправления: что было не так в прошлом ответе. */
  readonly correction?: readonly string[];
  /** Названия недавних блюд пользователя: модель их не повторяет. */
  readonly recentMealNames?: readonly string[];
  /** Мягкая подсказка для разнообразия, выбранная кодом с учётом ограничений профиля. */
  readonly variation?: { readonly style: string; readonly emphasis: string };
}

export interface ReplaceMealInput {
  readonly plan: MealPlan;
  readonly mealId: MealId;
  readonly reason?: string;
  readonly locale: string;
}
