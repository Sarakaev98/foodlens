import {
  normalizeDietaryPreferences,
  type ActivityLevel,
  type AllergenCode,
  type BiologicalSex,
  type DietaryPreference,
  type NutritionGoal,
  type UserNutritionProfile,
  type UserNutritionProfileId,
} from '@foodlens/core';
import type {
  DbActivityLevel,
  DbAllergen,
  DbBiologicalSex,
  DbDietaryPreference,
  DbNutritionGoal,
  DbUserNutritionProfile,
} from '@foodlens/database';

/** Ошибка компиляции здесь значит, что enum в Prisma разошёлся с типом в @foodlens/core. */
type SameValues<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const ENUMS_IN_SYNC: SameValues<NutritionGoal, DbNutritionGoal> &
  SameValues<BiologicalSex, DbBiologicalSex> &
  SameValues<ActivityLevel, DbActivityLevel> &
  SameValues<DietaryPreference, DbDietaryPreference> &
  SameValues<AllergenCode, DbAllergen> = true;
void ENUMS_IN_SYNC;

export function toUserNutritionProfile(row: DbUserNutritionProfile): UserNutritionProfile {
  return {
    id: row.id as UserNutritionProfileId,
    goal: row.goal,
    age: row.age,
    sex: row.sex,
    heightCm: row.heightCm,
    weightKg: row.weightKg,
    activityLevel: row.activityLevel,
    dietaryPreferences: normalizeDietaryPreferences(row.dietaryPreferences),
    allergens: row.allergens,
    avoidedIngredients: row.avoidedIngredients,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
