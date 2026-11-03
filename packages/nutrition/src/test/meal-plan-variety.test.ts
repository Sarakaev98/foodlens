import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sumMeals, type FoodPreferences, type Meal, type MealId, type MealPlan, type MealPlanId, type NutritionTargets } from '@foodlens/core';
import { allowedEmphases, chooseMealPlanVariation } from '../meal-plan/meal-plan-variation';
import { portionGrams, validateMealPlan } from '../meal-plan/validate-meal-plan';

const TARGETS: NutritionTargets = {
  caloriesKcal: 2000, proteinG: 150, fatG: 67, carbsG: 200,
  calculation: { version: 'nutrition-v1', bmrKcal: 1500, tdeeKcal: 2350, goalAdjustmentPercent: -15, macroSplit: { proteinPercent: 30, fatPercent: 30, carbsPercent: 40 } },
};
const NONE: FoodPreferences = { dietaryPreferences: ['none'], allergens: [], avoidedIngredients: [] };

const meal = (overrides: Partial<Meal> = {}): Meal => ({ id: 'm' as MealId, slot: 'lunch', name: 'Обед', description: '', ingredients: ['продукт, 100 г'], portion: '1 тарелка, 350 г', caloriesKcal: 500, proteinG: 37.5, carbsG: 50, fatG: 16.75, ...overrides });
const day = (...meals: readonly Meal[]): MealPlan => ({ id: 'p' as MealPlanId, days: [{ date: '2026-11-03', meals, totals: sumMeals(meals) }] });
const FOUR = (changed: Meal) => day(changed, meal({ slot: 'breakfast' }), meal({ slot: 'dinner' }), meal({ slot: 'snack' }));
const problems = (changed: Meal, preferences = NONE) => validateMealPlan(FOUR(changed), TARGETS, preferences).map((issue) => issue.message).join(' | ');

describe('variation hint', () => {
  it('vegan gets no animal-based emphasis, vegetarian no meat or fish, allergens remove their base', () => {
    assert.deepEqual(allowedEmphases({ dietaryPreferences: ['vegan'], allergens: [] }), ['grains', 'potatoes', 'legumes']);
    assert.deepEqual(allowedEmphases({ dietaryPreferences: ['vegetarian'], allergens: ['milk'] }), ['grains', 'potatoes', 'legumes', 'eggs']);
    for (let step = 0; step < 20; step++) {
      const { emphasis } = chooseMealPlanVariation({ dietaryPreferences: ['vegan'], allergens: [] }, null, () => step / 20);
      assert.ok(['grains', 'potatoes', 'legumes'].includes(emphasis), emphasis);
    }
  });
  it('halal never gets a forbidden hint: there is no pork or alcohol among the hints at all', () => {
    const hints = allowedEmphases({ dietaryPreferences: ['halal'], allergens: [] });
    assert.ok(hints.every((hint) => !/pork|bacon|ham|wine|beer|alcohol/i.test(hint)));
    assert.ok(hints.includes('poultry'));
  });
  it('a new generation gets a different hint than the previous one', () => {
    const previous = chooseMealPlanVariation(NONE, null, () => 0);
    const next = chooseMealPlanVariation(NONE, previous, () => 0);
    assert.notEqual(next.style, previous.style); assert.notEqual(next.emphasis, previous.emphasis);
  });
});

describe('portion sanity', () => {
  it('reads one explicit weight only', () => {
    for (const [text, grams] of [['350 г', 350], ['350 g', 350], ['1 тарелка, 350 г', 350], ['350 мл', 350], ['350 ml', 350], ['1 порция', null], ['2 шт по 50 г', null], ['2 × 50 г', null], ['200 г и 100 мл', null]] as const) {
      assert.equal(portionGrams(text), grams, text);
    }
  });
  it('a normal meal passes, and so do oil-rich and very light dishes', () => {
    assert.equal(problems(meal()), '');
    assert.doesNotMatch(problems(meal({ portion: '60 г', caloriesKcal: 495, proteinG: 0, carbsG: 0, fatG: 55 })), /portion|impossible|too little/);
    assert.doesNotMatch(problems(meal({ portion: '400 г', caloriesKcal: 60, proteinG: 3, carbsG: 9, fatG: 1.3 })), /impossible|too little/);
  });
  it('an obviously invalid portion weight is rejected', () => {
    assert.match(problems(meal({ portion: '0 г' })), /not a real serving/);
    assert.match(problems(meal({ portion: '5000 г' })), /not a real serving/);
  });
  it('an impossible energy density is rejected', () => {
    assert.match(problems(meal({ portion: '40 г' })), /physically impossible/);
    assert.match(problems(meal({ portion: '1 тарелка, 900 г', caloriesKcal: 60, proteinG: 5, carbsG: 8, fatG: 0.8 })), /far too little/);
    assert.match(problems(meal({ portion: '50 г', caloriesKcal: 400, proteinG: 40, carbsG: 50, fatG: 0 })), /weigh more than/);
  });
  it('structure: empty portion or ingredients, zero calories', () => {
    assert.match(problems(meal({ portion: ' ' })), /portion is empty/);
    assert.match(problems(meal({ ingredients: [] })), /ingredients/);
    assert.match(problems(meal({ caloriesKcal: 0 })), /above 0/);
  });
  it('the old checks still work: kcal against macros and restrictions', () => {
    assert.match(problems(meal({ caloriesKcal: 900 })), /does not match its macros/);
    const vegan = validateMealPlan(FOUR(meal({ ingredients: ['курица, 150 г'] })), TARGETS, { ...NONE, dietaryPreferences: ['vegan'] });
    assert.ok(vegan.some((issue) => issue.kind === 'restriction'));
    const soy = validateMealPlan(FOUR(meal({ ingredients: ['соевое молоко, 200 мл'] })), TARGETS, { ...NONE, allergens: ['soy'] });
    assert.ok(soy.some((issue) => issue.kind === 'restriction' && /soy/.test(issue.message)));
  });
});
