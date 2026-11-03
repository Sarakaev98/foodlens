export { calculateNutritionTargets, type NutritionTargetsInput } from './calculate-nutrition-targets';
export { NUTRITION_CALCULATION_VERSION } from './nutrition-coefficients';
export { allowedEmphases, chooseMealPlanVariation, type MealPlanVariation } from './meal-plan/meal-plan-variation';
export {
  MEAL_PHOTO_LIMITS, normalizeMealPhotoEstimate,
  type MealPhotoNormalization, type MealPhotoNormalizationReport, type RawMealPhotoEstimate,
} from './meal-photo/normalize-meal-photo';
export { portionGrams } from './meal-plan/validate-meal-plan';
export { detectAllergens, MEAL_PLAN_TOLERANCE, validateMealPlan, type MealPlanIssue, type MealPlanIssueKind } from './meal-plan/validate-meal-plan';
