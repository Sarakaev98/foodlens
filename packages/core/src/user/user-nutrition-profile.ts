import type { Brand } from '../common';
import type { AllergenCode } from '../product';

export const NUTRITION_GOALS = ['lose_weight', 'maintain_weight', 'gain_weight', 'eat_healthier'] as const;
export type NutritionGoal = (typeof NUTRITION_GOALS)[number];

export const ACTIVITY_LEVELS = ['sedentary', 'light', 'moderate', 'active', 'very_active'] as const;
export type ActivityLevel = (typeof ACTIVITY_LEVELS)[number];

/** Биологический пол нужен только для формул расчёта энергозатрат. */
export const BIOLOGICAL_SEXES = ['female', 'male'] as const;
export type BiologicalSex = (typeof BIOLOGICAL_SEXES)[number];

/** Новое значение добавляется сюда (и в enum Prisma), остальной код подхватит его через тип. */
export const DIETARY_PREFERENCES = ['none', 'vegetarian', 'vegan', 'pescatarian', 'halal', 'other'] as const;
export type DietaryPreference = (typeof DIETARY_PREFERENCES)[number];

export type UserNutritionProfileId = Brand<string, 'UserNutritionProfileId'>;

/** ISO 8601 дата-время в UTC, например "2026-10-27T12:00:00.000Z". */
export type IsoDateTime = string;

/** Параметры тела: вход для расчёта целей питания (Nutrition Target Engine). */
export interface BodyMetrics {
  readonly age: number;
  readonly sex: BiologicalSex;
  readonly heightCm: number;
  readonly weightKg: number;
  readonly activityLevel: ActivityLevel;
}

/** Пищевые ограничения: вход для Meal Plan и персональной оценки продукта. */
export interface FoodPreferences {
  readonly dietaryPreferences: readonly DietaryPreference[];
  readonly allergens: readonly AllergenCode[];
  /** Свободный текст пользователя, например "кинза". */
  readonly avoidedIngredients: readonly string[];
}

/** Данные профиля, которые задаёт пользователь (onboarding, редактирование, PUT /profile). */
export interface UserNutritionProfileInput extends BodyMetrics, FoodPreferences {
  readonly goal: NutritionGoal;
}

/** Сохранённый профиль питания пользователя. Не зависит от UI и способа хранения. */
export interface UserNutritionProfile extends UserNutritionProfileInput {
  readonly id: UserNutritionProfileId;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

export type UserNutritionProfileField = keyof UserNutritionProfileInput;
