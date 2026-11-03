import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AIProvider, GenerateMealPlanInput } from '@foodlens/ai';
import { sumMeals, type GoalMatchUserPlan, type Meal, type MealId, type MealPlan, type MealPlanId, type MealSlot } from '@foodlens/core';
import type { NutritionTargetsService } from '../../nutrition-targets/nutrition-targets.service';
import { MealPlanService, RECENT_MEAL_NAMES } from '../meal-plan.service';

const PROFILE: GoalMatchUserPlan = {
  goal: 'lose_weight',
  targets: {
    caloriesKcal: 2000, proteinG: 150, fatG: 67, carbsG: 200,
    calculation: { version: 'nutrition-v1', bmrKcal: 1500, tdeeKcal: 2350, goalAdjustmentPercent: -15, macroSplit: { proteinPercent: 30, fatPercent: 30, carbsPercent: 40 } },
  },
  dietaryPreferences: ['vegan'], allergens: [], avoidedIngredients: [],
};

function meal(slot: MealSlot, ingredients: readonly string[], overrides: Partial<Meal> = {}): Meal {
  return { id: slot as MealId, slot, name: slot, description: '', ingredients, portion: '1 порция', caloriesKcal: 500, proteinG: 37.5, carbsG: 50, fatG: 16.75, ...overrides };
}
function plan(...meals: readonly Meal[]): MealPlan {
  return { id: 'plan' as MealPlanId, days: [{ date: '2026-11-02', meals, totals: sumMeals(meals) }] };
}
const GOOD = plan(meal('breakfast', ['гречка, 80 г']), meal('lunch', ['чечевица, 90 г']), meal('dinner', ['рис, 80 г']), meal('snack', ['банан, 100 г']));
const WITH_CHICKEN = plan(meal('breakfast', ['гречка, 80 г']), meal('lunch', ['курица, 120 г']), meal('dinner', ['рис, 80 г']), meal('snack', ['банан, 100 г']));
const TOO_SMALL = plan(meal('breakfast', ['гречка, 80 г']));

function setup(answers: readonly (MealPlan | Error)[], profile: GoalMatchUserPlan | null = PROFILE) {
  const calls: GenerateMealPlanInput[] = [];
  const ai = {
    generateMealPlan: async (input: GenerateMealPlanInput) => {
      calls.push(input);
      const answer = answers[calls.length - 1];
      if (!answer) throw new Error('unexpected extra AI call');
      if (answer instanceof Error) throw answer;
      return answer;
    },
  } as unknown as AIProvider;
  const targets = { findPlanForUser: async () => profile } as unknown as NutritionTargetsService;
  return { service: new MealPlanService(ai, targets), calls };
}

const status = (expected: number, code?: string) => (error: { getStatus(): number; getResponse(): unknown }) =>
  error.getStatus() === expected && (!code || (error.getResponse() as { code: string }).code === code);

describe('MealPlanService', () => {
  it('хороший план: один вызов AI, цели и ограничения из профиля', async () => {
    const { service, calls } = setup([GOOD]);
    const result = await service.generate('user');
    assert.equal(calls.length, 1);
    assert.equal(result.withinTargets, true);
    assert.deepEqual(calls[0]!.preferences.dietaryPreferences, ['vegan']);
    assert.equal(calls[0]!.targets.caloriesKcal, 2000);
    assert.equal(calls[0]!.correction, undefined);
  });

  it('нарушение диеты: ровно один повтор с описанием проблемы', async () => {
    const { service, calls } = setup([WITH_CHICKEN, GOOD]);
    const result = await service.generate('user');
    assert.equal(calls.length, 2);
    assert.match(calls[1]!.correction!.join(' '), /курица/);
    assert.equal(result.plan, GOOD);
  });

  it('нарушение после повтора: план не показывается, третьего вызова нет', async () => {
    const { service, calls } = setup([WITH_CHICKEN, WITH_CHICKEN]);
    await assert.rejects(service.generate('user'), status(422, 'MEAL_PLAN_INVALID'));
    assert.equal(calls.length, 2);
  });

  it('калории мимо цели после повтора: безопасный план показывается с withinTargets=false', async () => {
    const { service, calls } = setup([TOO_SMALL, TOO_SMALL]);
    const result = await service.generate('user');
    assert.equal(calls.length, 2);
    assert.equal(result.withinTargets, false);
  });

  it('безопасный первый план важнее небезопасного исправленного', async () => {
    const { service } = setup([TOO_SMALL, WITH_CHICKEN]);
    assert.equal((await service.generate('user')).plan, TOO_SMALL);
  });

  it('сбой исправления не теряет безопасный план', async () => {
    const { service } = setup([TOO_SMALL, new Error('down')]);
    assert.equal((await service.generate('user')).plan, TOO_SMALL);
  });

  it('сбой AI: понятная ошибка 503 без лишних вызовов', async () => {
    const { service, calls } = setup([new Error('secret upstream text')]);
    await assert.rejects(service.generate('user'), status(503, 'MEAL_PLAN_UNAVAILABLE'));
    assert.equal(calls.length, 1);
  });

  it('нет профиля: 404 и AI не вызывается', async () => {
    const { service, calls } = setup([GOOD], null);
    await assert.rejects(service.generate('user'), status(404));
    assert.equal(calls.length, 0);
  });

  it('последний план возвращается без вызова AI, пока цели не изменились', async () => {
    let profile: GoalMatchUserPlan = PROFILE;
    const { service } = setup([GOOD]);
    (service as unknown as { nutritionTargets: { findPlanForUser: () => Promise<GoalMatchUserPlan> } }).nutritionTargets = { findPlanForUser: async () => profile };
    assert.equal(await service.getLatest('user'), null);
    await service.generate('user');
    assert.equal((await service.getLatest('user'))?.plan, GOOD);
    profile = { ...PROFILE, targets: { ...PROFILE.targets, caloriesKcal: 1800 } };
    assert.equal(await service.getLatest('user'), null);
  });
});

describe('MealPlanService: разнообразие', () => {
  const named = (prefix: string) => plan(...(['breakfast', 'lunch', 'dinner', 'snack'] as const).map((slot) => meal(slot, ['чечевица, 90 г'], { name: `${prefix} ${slot}` })));

  it('первый план без истории, следующий получает названия прошлых блюд и другую подсказку', async () => {
    const { service, calls } = setup([named('A'), named('B')]);
    service.random = () => 0;
    await service.generate('user');
    await service.generate('user');
    assert.deepEqual(calls[0]!.recentMealNames, []);
    assert.deepEqual(calls[1]!.recentMealNames, ['A breakfast', 'A lunch', 'A dinner', 'A snack']);
    assert.ok(calls[0]!.variation && calls[1]!.variation);
    assert.notDeepEqual(calls[1]!.variation, calls[0]!.variation);
  });
  it('история новыми вперёд, без повторов и не длиннее 12', async () => {
    const { service, calls } = setup(['A', 'B', 'C', 'D', 'A'].map(named));
    for (let index = 0; index < 5; index++) await service.generate('user');
    assert.equal(RECENT_MEAL_NAMES, 12);
    assert.deepEqual(calls[4]!.recentMealNames, ['D breakfast', 'D lunch', 'D dinner', 'D snack', 'C breakfast', 'C lunch', 'C dinner', 'C snack', 'B breakfast', 'B lunch', 'B dinner', 'B snack']);
  });
  it('веган не получает подсказку на животный продукт', async () => {
    const { service, calls } = setup([GOOD]);
    for (const value of [0, 0.3, 0.6, 0.99]) {
      service.random = () => value;
      calls.length = 0;
      (service as unknown as { ai: { generateMealPlan: (input: GenerateMealPlanInput) => Promise<MealPlan> } }).ai.generateMealPlan = async (input) => { calls.push(input); return GOOD; };
      await service.generate('user');
      assert.ok(['grains', 'potatoes', 'legumes'].includes(calls[0]!.variation!.emphasis), calls[0]!.variation!.emphasis);
    }
  });
  it('исправление получает проблемы порции вместе с историей и той же подсказкой', async () => {
    const heavy = plan(meal('breakfast', ['гречка, 80 г'], { portion: '40 г' }), meal('lunch', ['чечевица, 90 г']), meal('dinner', ['рис, 80 г']), meal('snack', ['банан, 100 г']));
    const { service, calls } = setup([named('A'), heavy, GOOD]);
    await service.generate('user');
    await service.generate('user');
    assert.equal(calls.length, 3);
    assert.match(calls[2]!.correction!.join(' '), /physically impossible/);
    assert.deepEqual(calls[2]!.recentMealNames, calls[1]!.recentMealNames);
    assert.deepEqual(calls[2]!.variation, calls[1]!.variation);
  });
  it('GET /meal-plan по-прежнему не вызывает AI', async () => {
    const { service, calls } = setup([GOOD]);
    await service.generate('user');
    await service.getLatest('user'); await service.getLatest('user');
    assert.equal(calls.length, 1);
  });
});
