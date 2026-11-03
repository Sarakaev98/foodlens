import { normalizeDietaryPreferences } from '@foodlens/core';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sumMeals, type FoodPreferences, type Meal, type MealId, type MealPlan, type MealPlanId, type MealSlot, type NutritionTargets } from '@foodlens/core';
import { validateMealPlan } from '../meal-plan/validate-meal-plan';

const TARGETS: NutritionTargets = {
  caloriesKcal: 2000, proteinG: 150, fatG: 67, carbsG: 200,
  calculation: { version: 'nutrition-v1', bmrKcal: 1500, tdeeKcal: 2350, goalAdjustmentPercent: -15, macroSplit: { proteinPercent: 30, fatPercent: 30, carbsPercent: 40 } },
};

const NO_RESTRICTIONS: FoodPreferences = { dietaryPreferences: ['none'], allergens: [], avoidedIngredients: [] };

function meal(slot: MealSlot, name: string, ingredients: readonly string[]): Meal {
  return { id: slot as MealId, slot, name, description: '', ingredients, portion: '1 порция', caloriesKcal: 500, proteinG: 37.5, carbsG: 50, fatG: 16.75 };
}

function plan(...meals: readonly Meal[]): MealPlan {
  return { id: 'plan' as MealPlanId, days: [{ date: '2026-11-02', meals, totals: sumMeals(meals) }] };
}

const PLANT_DAY = plan(
  meal('breakfast', 'Гречка с грибами', ['гречка, 80 г', 'шампиньоны, 100 г', 'растительное масло, 10 г']),
  meal('lunch', 'Чечевичный суп', ['чечевица, 90 г', 'морковь, 50 г', 'овощной бульон, 300 мл']),
  meal('dinner', 'Рис с нутом', ['рис, 80 г', 'нут, 120 г', 'помидоры, 100 г']),
  meal('snack', 'Смузи', ['банан, 100 г', 'кокосовое молоко, 200 мл']),
);

const issues = (mealPlan: MealPlan, preferences: FoodPreferences) => validateMealPlan(mealPlan, TARGETS, preferences);
const restrictions = (mealPlan: MealPlan, preferences: Partial<FoodPreferences>) =>
  issues(mealPlan, { ...NO_RESTRICTIONS, ...preferences }).filter((issue) => issue.kind === 'restriction');
const withMeal = (name: string, ingredients: readonly string[]) => plan(...PLANT_DAY.days[0]!.meals.slice(0, 3), meal('snack', name, ingredients));

describe('validateMealPlan: ограничения', () => {
  it('растительный день проходит веганскую проверку, несмотря на кокосовое молоко и овощной бульон', () => {
    assert.deepEqual(issues(PLANT_DAY, { ...NO_RESTRICTIONS, dietaryPreferences: ['vegan'] }), []);
  });

  it('веган: продукты животного происхождения находятся в любом падеже', () => {
    for (const food of ['курица, 100 г', 'творог, 150 г', 'яйцо, 1 шт', 'сливочное масло, 10 г', 'мёд, 10 г', 'лосось, 120 г', 'креветки, 100 г', 'греческий йогурт, 100 г']) {
      assert.equal(restrictions(withMeal('Перекус', [food]), { dietaryPreferences: ['vegan'] }).length, 1, food);
    }
  });

  it('вегетарианцу можно яйца и молоко, но нельзя мясо и рыбу', () => {
    assert.deepEqual(restrictions(withMeal('Омлет с сыром', ['яйцо, 2 шт', 'сыр, 30 г']), { dietaryPreferences: ['vegetarian'] }), []);
    assert.equal(restrictions(withMeal('Бутерброд', ['ветчина, 50 г']), { dietaryPreferences: ['vegetarian'] }).length, 1);
    assert.equal(restrictions(withMeal('Салат', ['тунец, 80 г']), { dietaryPreferences: ['vegetarian'] }).length, 1);
  });

  it('пескетарианцу можно рыбу; legacy диета становится нейтральной', () => {
    assert.deepEqual(restrictions(withMeal('Салат', ['тунец, 80 г']), { dietaryPreferences: ['pescatarian'] }), []);
    assert.equal(restrictions(withMeal('Рагу', ['свинина, 100 г']), { dietaryPreferences: normalizeDietaryPreferences(['halal']) }).length, 0);
    assert.deepEqual(restrictions(withMeal('Рагу', ['говядина, 100 г']), { dietaryPreferences: normalizeDietaryPreferences(['halal']) }), []);
  });

  it('аллергены: названные продукты находятся, похожие слова нет', () => {
    assert.equal(restrictions(withMeal('Перекус', ['грецкий орех, 30 г']), { allergens: ['tree_nuts'] }).length, 1);
    assert.equal(restrictions(withMeal('Перекус', ['арахисовая паста, 20 г']), { allergens: ['peanuts'] }).length, 1);
    assert.equal(restrictions(withMeal('Паста', ['спагетти, 80 г']), { allergens: ['gluten'] }).length, 1);
    assert.deepEqual(restrictions(withMeal('Куркума и курага', ['куркума, 2 г', 'курага, 30 г']), { dietaryPreferences: ['vegan'] }), []);
    assert.deepEqual(restrictions(withMeal('Сырые овощи', ['сырая морковь, 100 г']), { allergens: ['milk'] }), []);
    assert.deepEqual(restrictions(withMeal('Печенье', ['печенье овсяное, 30 г']), { dietaryPreferences: ['vegetarian'] }), []);
    assert.deepEqual(restrictions(withMeal('Закуска', ['кабачковая икра, 100 г']), { allergens: ['fish'] }), []);
  });

  it('заменитель не прячет свой аллерген: соевое молоко это соя, арахисовое масло это арахис', () => {
    assert.equal(restrictions(withMeal('Смузи', ['соевое молоко, 200 мл']), { allergens: ['soy'] }).length, 1);
    assert.equal(restrictions(withMeal('Смузи', ['миндальное молоко, 200 мл']), { allergens: ['tree_nuts'] }).length, 1);
    assert.equal(restrictions(withMeal('Тост', ['арахисовое масло, 20 г']), { allergens: ['peanuts'] }).length, 1);
    assert.deepEqual(restrictions(withMeal('Смузи', ['соевое молоко, 200 мл']), { allergens: ['milk'], dietaryPreferences: ['vegan'] }), []);
  });

  it('нежелательный продукт из профиля находится в другом падеже', () => {
    assert.equal(restrictions(withMeal('Суп с кинзой', ['кинза, 5 г']), { avoidedIngredients: ['Кинза'] }).length, 1);
    assert.deepEqual(restrictions(PLANT_DAY, { avoidedIngredients: ['кинза'] }), []);
  });

  it('«без молока» в названии не считается молоком', () => {
    assert.deepEqual(restrictions(withMeal('Каша без молока', ['рис, 60 г']), { allergens: ['milk'] }), []);
  });
});

describe('validateMealPlan: калории и БЖУ', () => {
  it('сумма блюд в пределах допуска проходит', () => {
    assert.deepEqual(issues(PLANT_DAY, NO_RESTRICTIONS), []);
  });

  it('калории далеко от цели: проблема nutrition, а не restriction', () => {
    const small = plan(meal('breakfast', 'Рис', ['рис, 50 г']));
    const found = issues(small, NO_RESTRICTIONS);
    assert.ok(found.some((issue) => issue.kind === 'nutrition' && /calories/.test(issue.message)));
    assert.ok(found.every((issue) => issue.kind === 'nutrition'));
  });

  it('калории блюда не сходятся с его БЖУ', () => {
    const wrong = { ...PLANT_DAY.days[0]!.meals[3]!, caloriesKcal: 900 };
    const found = issues(plan(...PLANT_DAY.days[0]!.meals.slice(0, 3), wrong), NO_RESTRICTIONS);
    assert.ok(found.some((issue) => /does not match its macros/.test(issue.message)));
  });

  it('пустой план не проходит', () => {
    assert.equal(issues(plan(), NO_RESTRICTIONS).length, 1);
  });
});
