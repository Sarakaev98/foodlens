import {
  validateUserNutritionProfileInput,
  normalizeDietaryPreferences,
  type UserNutritionProfileField,
  type UserNutritionProfileInput,
  type ValidationResult,
} from '@foodlens/core';
import type { UserNutritionProfileDraft } from './types/profile.types';

export const ALL_PROFILE_FIELDS: readonly UserNutritionProfileField[] = [
  'goal',
  'age',
  'sex',
  'heightCm',
  'weightKg',
  'activityLevel',
  'dietaryPreferences',
  'allergens',
  'avoidedIngredients',
];

export const EMPTY_PROFILE_DRAFT: UserNutritionProfileDraft = {
  dietaryPreferences: ['none'],
  allergens: [],
  avoidedIngredients: [],
};

export function draftFromProfile(profile: UserNutritionProfileInput): UserNutritionProfileDraft {
  return {
    goal: profile.goal,
    age: profile.age,
    sex: profile.sex,
    heightCm: profile.heightCm,
    weightKg: profile.weightKg,
    activityLevel: profile.activityLevel,
    dietaryPreferences: normalizeDietaryPreferences(profile.dietaryPreferences),
    allergens: [...profile.allergens],
    avoidedIngredients: [...profile.avoidedIngredients],
  };
}

/** Превращает черновик в готовые к отправке данные по общим правилам validation. */
export function completeDraft(draft: UserNutritionProfileDraft): ValidationResult<UserNutritionProfileInput> {
  return validateUserNutritionProfileInput(draft);
}
