import { ALLERGEN_CODES } from '../product';
import {
  numberInRange,
  oneOf,
  trimmedText,
  uniqueListOf,
  type FieldValidator,
  type ValidationIssue,
  type ValidationResult,
} from '../common';
import {
  ACTIVITY_LEVELS,
  BIOLOGICAL_SEXES,
  DIETARY_PREFERENCES,
  normalizeDietaryPreferences,
  isLegacyDietaryPreference,
  NUTRITION_GOALS,
  type DietaryPreference,
  type UserNutritionProfileField,
  type UserNutritionProfileInput,
} from './user-nutrition-profile';

/** Границы правдоподобных значений. Это защита от опечаток, а не медицинские правила. */
export const PROFILE_LIMITS = {
  age: { min: 13, max: 120, integer: true },
  heightCm: { min: 100, max: 250 },
  weightKg: { min: 30, max: 300 },
  avoidedIngredients: { maxItems: 50, maxLength: 60 },
} as const;

const dietaryPreferencesValidator: FieldValidator<DietaryPreference[]> = (value, field) => {
  // Legacy clients may still send removed values; unknown new values remain validation errors.
  const legacy = Array.isArray(value) && value.some(isLegacyDietaryPreference);
  const candidate = legacy ? value.filter(item => !isLegacyDietaryPreference(item)) : value;
  const parsed = uniqueListOf(oneOf(DIETARY_PREFERENCES), { maxItems: DIETARY_PREFERENCES.length })(candidate, field);
  if (legacy && parsed.ok) return { ok: true, value: normalizeDietaryPreferences(parsed.value) };
  if (!parsed.ok) return parsed;
  if (parsed.value.length === 0) return { ok: false, issue: { field, code: 'required' } };
  if (parsed.value.includes('none') && parsed.value.length > 1) {
    return { ok: false, issue: { field, code: 'exclusive_value', params: { value: 'none' } } };
  }
  if (parsed.value.length > 1) return { ok: false, issue: { field, code: 'too_many', params: { max: 1 } } };
  return parsed;
};

const fieldValidators: { [K in UserNutritionProfileField]: FieldValidator<UserNutritionProfileInput[K]> } = {
  goal: oneOf(NUTRITION_GOALS),
  age: numberInRange(PROFILE_LIMITS.age),
  sex: oneOf(BIOLOGICAL_SEXES),
  heightCm: numberInRange(PROFILE_LIMITS.heightCm),
  weightKg: numberInRange(PROFILE_LIMITS.weightKg),
  activityLevel: oneOf(ACTIVITY_LEVELS),
  dietaryPreferences: dietaryPreferencesValidator,
  allergens: uniqueListOf(oneOf(ALLERGEN_CODES), { maxItems: ALLERGEN_CODES.length }),
  avoidedIngredients: uniqueListOf(trimmedText({ maxLength: PROFILE_LIMITS.avoidedIngredients.maxLength }), {
    maxItems: PROFILE_LIMITS.avoidedIngredients.maxItems,
    key: (text) => text.toLowerCase(),
  }),
};

const PROFILE_FIELDS = Object.keys(fieldValidators) as UserNutritionProfileField[];

/**
 * Проверяет и нормализует профиль целиком (обрезает пробелы, убирает дубликаты).
 * Поля, которых нет в модели, отбрасываются.
 */
export function validateUserNutritionProfileInput(input: unknown): ValidationResult<UserNutritionProfileInput> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, issues: [{ field: '', code: 'invalid_type' }] };
  }
  const source = input as Record<string, unknown>;
  const issues: ValidationIssue[] = [];
  const value: Record<string, unknown> = {};

  for (const field of PROFILE_FIELDS) {
    const result = fieldValidators[field](source[field], field);
    if (result.ok) value[field] = result.value;
    else issues.push(result.issue);
  }

  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: value as unknown as UserNutritionProfileInput };
}

/** Проверяет только перечисленные поля, например один шаг onboarding. */
export function validateUserNutritionProfileFields(
  input: Partial<Record<UserNutritionProfileField, unknown>>,
  fields: readonly UserNutritionProfileField[],
): readonly ValidationIssue[] {
  return fields.flatMap((field) => {
    const result = fieldValidators[field](input[field], field);
    return result.ok ? [] : [result.issue];
  });
}
