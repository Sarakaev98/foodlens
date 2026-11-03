import type {
  ActivityLevel,
  AllergenCode,
  BiologicalSex,
  DietaryPreference,
  NutritionGoal,
  UserNutritionProfileField,
} from '@foodlens/core';

/** Подписи значений. Record требует подпись для каждого значения, новый enum не забудется. */
export const GOAL_LABELS: Record<NutritionGoal, string> = {
  lose_weight: 'Lose weight',
  maintain_weight: 'Maintain weight',
  gain_weight: 'Gain weight',
  eat_healthier: 'Eat healthier',
};

export const SEX_LABELS: Record<BiologicalSex, string> = {
  female: 'Female',
  male: 'Male',
};

export const ACTIVITY_LEVEL_LABELS: Record<ActivityLevel, { label: string; description: string }> = {
  sedentary: { label: 'Sedentary', description: 'Desk job, little or no exercise' },
  light: { label: 'Light', description: '1–3 workouts a week' },
  moderate: { label: 'Moderate', description: '3–5 workouts a week' },
  active: { label: 'Active', description: '6–7 workouts a week' },
  very_active: { label: 'Very active', description: 'Physical job or training twice a day' },
};

export const DIETARY_PREFERENCE_LABELS: Record<DietaryPreference, string> = {
  none: 'No restrictions',
  vegetarian: 'Vegetarian',
  vegan: 'Vegan',
  pescatarian: 'Pescatarian',
};

export const ALLERGEN_LABELS: Record<AllergenCode, string> = {
  gluten: 'Gluten',
  crustaceans: 'Crustaceans',
  eggs: 'Eggs',
  fish: 'Fish',
  peanuts: 'Peanuts',
  soy: 'Soy',
  milk: 'Milk',
  tree_nuts: 'Tree nuts',
  celery: 'Celery',
  mustard: 'Mustard',
  sesame: 'Sesame',
  sulphites: 'Sulphites',
  lupin: 'Lupin',
  molluscs: 'Molluscs',
};

export const PROFILE_FIELD_LABELS: Record<UserNutritionProfileField, string> = {
  goal: 'Goal',
  age: 'Age',
  sex: 'Sex',
  heightCm: 'Height',
  weightKg: 'Weight',
  activityLevel: 'Activity',
  dietaryPreferences: 'Diet',
  allergens: 'Allergens',
  avoidedIngredients: 'Avoid in ingredients',
};
