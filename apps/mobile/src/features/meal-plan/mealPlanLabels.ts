import type { MealSlot } from '@foodlens/core';
import type { MealPlanFailure } from './hooks/useMealPlan';

export const MEAL_SLOT_LABELS: Readonly<Record<MealSlot, string>> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
};

export const MEAL_PLAN_LOADING_TEXT = 'Building a meal plan around your goals and preferences';

export const MEAL_PLAN_FAILURES: Readonly<Record<MealPlanFailure, string>> = {
  restrictions: 'Couldn’t build a plan that fits all your restrictions. Please try again.',
  unavailable: 'Couldn’t build a plan right now. Please try again a bit later.',
  no_connection: 'No connection. Check your internet connection and try again.',
};
