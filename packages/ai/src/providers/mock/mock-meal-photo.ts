import type { MealPhotoAiOutput } from '../../meal-photo/meal-photo-output-schema';

/** Демо-тарелка для AI_PROVIDER=mock. Проходит ту же проверку и нормализацию, что и настоящий ответ. */
export const MOCK_MEAL_PHOTO_OUTPUT: MealPhotoAiOutput = {
  is_food: true,
  meal_name: 'Курица с рисом и овощами',
  items: [
    { name: 'Куриная грудка на гриле', grams: 150, kcal: 248, protein_g: 46, carbs_g: 0, fat_g: 6, confidence: 'medium' },
    { name: 'Рис отварной', grams: 180, kcal: 234, protein_g: 5, carbs_g: 51, fat_g: 1, confidence: 'medium' },
    { name: 'Овощи', grams: 100, kcal: 35, protein_g: 2, carbs_g: 7, fat_g: 0, confidence: 'high' },
    { name: 'Соус', grams: 30, kcal: 90, protein_g: 0, carbs_g: 4, fat_g: 8, confidence: 'low' },
  ],
  total_kcal: 607,
  kcal_min: 500,
  kcal_max: 720,
  confidence: 'medium',
  assumptions: ['Возможно, при приготовлении использовано масло'],
};
