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
  lose_weight: 'Снизить вес',
  maintain_weight: 'Поддерживать вес',
  gain_weight: 'Набрать вес',
  eat_healthier: 'Питаться здоровее',
};

export const SEX_LABELS: Record<BiologicalSex, string> = {
  female: 'Женский',
  male: 'Мужской',
};

export const ACTIVITY_LEVEL_LABELS: Record<ActivityLevel, { label: string; description: string }> = {
  sedentary: { label: 'Минимальная', description: 'Сидячая работа, почти без тренировок' },
  light: { label: 'Лёгкая', description: '1–3 тренировки в неделю' },
  moderate: { label: 'Умеренная', description: '3–5 тренировок в неделю' },
  active: { label: 'Высокая', description: '6–7 тренировок в неделю' },
  very_active: { label: 'Очень высокая', description: 'Физическая работа или тренировки дважды в день' },
};

export const DIETARY_PREFERENCE_LABELS: Record<DietaryPreference, string> = {
  none: 'Без ограничений',
  vegetarian: 'Вегетарианство',
  vegan: 'Веганство',
  pescatarian: 'Пескетарианство',
  halal: 'Халяль',
  other: 'Другое',
};

export const ALLERGEN_LABELS: Record<AllergenCode, string> = {
  gluten: 'Глютен',
  crustaceans: 'Ракообразные',
  eggs: 'Яйца',
  fish: 'Рыба',
  peanuts: 'Арахис',
  soy: 'Соя',
  milk: 'Молоко',
  tree_nuts: 'Орехи',
  celery: 'Сельдерей',
  mustard: 'Горчица',
  sesame: 'Кунжут',
  sulphites: 'Сульфиты',
  lupin: 'Люпин',
  molluscs: 'Моллюски',
};

export const PROFILE_FIELD_LABELS: Record<UserNutritionProfileField, string> = {
  goal: 'Цель',
  age: 'Возраст',
  sex: 'Пол',
  heightCm: 'Рост',
  weightKg: 'Вес',
  activityLevel: 'Активность',
  dietaryPreferences: 'Тип питания',
  allergens: 'Аллергены',
  avoidedIngredients: 'Не хочу в составе',
};
