import type { AllergenCode, ConfidenceLevel, NutritionBasis, ProductCategory } from '@foodlens/core';

export const CATEGORY_LABELS: Readonly<Record<ProductCategory, string>> = {
  beverage: 'Напиток',
  water: 'Вода',
  juice: 'Сок',
  dairy: 'Молочный продукт',
  yogurt: 'Йогурт',
  cheese: 'Сыр',
  meat: 'Мясо',
  fish: 'Рыба',
  nuts: 'Орехи',
  snack: 'Снек',
  chocolate: 'Шоколад',
  sweets: 'Сладости',
  bakery: 'Выпечка',
  bread: 'Хлеб',
  cereal: 'Злаки и хлопья',
  sauce: 'Соус',
  ready_meal: 'Готовое блюдо',
  protein_product: 'Протеиновый продукт',
  fruit: 'Фрукты',
  vegetable: 'Овощи',
  other: 'Другое',
};

export const ALLERGEN_LABELS: Readonly<Record<AllergenCode, string>> = {
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

export const CONFIDENCE_LABELS: Readonly<Record<ConfidenceLevel, string>> = {
  high: 'высокая',
  medium: 'средняя',
  low: 'низкая',
};

export const BASIS_LABELS: Readonly<Record<NutritionBasis, string>> = {
  per_100g: 'на 100 г',
  per_100ml: 'на 100 мл',
  per_serving: 'на порцию',
  unknown: 'основа не указана',
};

export const NOT_DETECTED_LABEL = 'Не обнаружено';
