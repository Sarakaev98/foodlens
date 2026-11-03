import type { GoalMatch, GoalMatchV4, NutrientValue, Product, ProductScore } from '@foodlens/core';

/**
 * Какие поля пищевой ценности дошли до Product и почему нет оценок. Только для логов:
 * булевы признаки и коды причин, без значений, названия, состава и данных пользователя.
 * Солёность, выведенная из натрия (и наоборот), считается присутствующей: так её видит Product Score.
 */
export function nutritionPresence(product: Product, score: ProductScore, goalMatch: GoalMatch | GoalMatchV4) {
  const n = product.nutrition;
  const present = (nutrient: NutrientValue | undefined): boolean => nutrient !== undefined && nutrient.value !== null;
  return {
    calories: present(n?.caloriesKcal),
    protein: present(n?.proteinG),
    carbs: present(n?.carbsG),
    sugars: present(n?.sugarsG),
    fat: present(n?.fatG),
    saturatedFat: present(n?.saturatedFatG),
    fiber: present(n?.fiberG),
    salt: present(n?.saltG),
    sodium: present(n?.sodiumMg),
    unscoredReason: score.unscoredReason,
    unavailableReason: goalMatch.unavailableReason,
  };
}
