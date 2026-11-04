import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { NutritionTargets } from '@foodlens/core';
import type { GenerateMealPlanInput } from '../ai-provider.types';
import { AIProviderError } from '../errors';
import { GoogleMealPlanProvider } from '../providers/google/google-meal-plan-provider';

const targets: NutritionTargets = {
  caloriesKcal: 2000, proteinG: 150, fatG: 67, carbsG: 200,
  calculation: { version: 'nutrition-v1', bmrKcal: 1500, tdeeKcal: 2350, goalAdjustmentPercent: -15, macroSplit: { proteinPercent: 30, fatPercent: 30, carbsPercent: 40 } },
};
const input: GenerateMealPlanInput = {
  goal: 'lose_weight', targets, startDate: '2026-11-02', days: 1, locale: 'en',
  preferences: { dietaryPreferences: ['vegan'], allergens: ['soy'], avoidedIngredients: ['кинза'] },
};
const meal = { slot: 'breakfast', name: 'Каша', description: 'Завтрак', ingredients: ['рис, 80 г'], portion: '1 тарелка', calories_kcal: 500, protein_g: 20.4, carbs_g: 80.2, fat_g: 10 };
const envelope = (output: unknown, finishReason = 'STOP') => ({ candidates: [{ finishReason, content: { parts: [{ text: JSON.stringify(output) }] } }] });

function provider(respond: () => Response, requests: RequestInit[] = []) {
  return new GoogleMealPlanProvider({
    apiKey: 'test', project: 'test-project', location: 'global', model: 'gemini-3.5-flash-lite', createId: () => 'id',
    fetch: (async (_url: string, init: RequestInit) => { requests.push(init); return respond(); }) as typeof fetch,
  });
}

describe('GoogleMealPlanProvider', () => {
  it('план из структурированного ответа: итоги считает код', async () => {
    const plan = await provider(() => Response.json(envelope({ meals: [meal, { ...meal, slot: 'lunch' }] }))).generate(input);
    assert.equal(plan.days[0]!.date, '2026-11-02');
    assert.deepEqual(plan.days[0]!.totals, { caloriesKcal: 1000, proteinG: 41, carbsG: 160, fatG: 20 });
    assert.equal(plan.days[0]!.meals[0]!.caloriesKcal, 500);
  });

  it('в запрос идут только цели и ограничения, плюс текст исправления при повторе', async () => {
    const requests: RequestInit[] = [];
    await provider(() => Response.json(envelope({ meals: [meal] })), requests).generate({ ...input, mealsPerDay: 3, correction: ['No soy'] });
    const body = JSON.parse(String(requests[0]!.body));
    const user = JSON.parse(body.contents[0].parts[0].text);
    assert.deepEqual(user.dietaryPreferences, ['vegan']);
    assert.deepEqual(user.allergens, ['soy']);
    assert.deepEqual(user.avoidedIngredients, ['кинза']);
    assert.deepEqual(user.slots, ['breakfast', 'lunch', 'dinner']);
    assert.deepEqual(user.fixTheseProblemsFromThePreviousAttempt, ['No soy']);
    assert.equal(user.targets.caloriesKcal, 2000);
    assert.equal(user.targets.calculation, undefined);
  });

  it('недавние блюда и подсказка разнообразия идут в запрос, prompt запрещает повторы и не подталкивает к продукту', async () => {
    const requests: RequestInit[] = [];
    const recentMealNames = ['Chicken with Rice', 'Oatmeal with Berries'];
    await provider(() => Response.json(envelope({ meals: [meal] })), requests).generate({ ...input, recentMealNames, variation: { style: 'Mediterranean', emphasis: 'legumes' } });
    const body = JSON.parse(String(requests[0]!.body));
    const user = JSON.parse(body.contents[0].parts[0].text);
    assert.deepEqual(user.recentMealNames, recentMealNames);
    assert.deepEqual(user.variation, { style: 'Mediterranean', emphasis: 'legumes' });
    const system: string = body.systemInstruction.parts[0].text;
    assert.match(system, /Never repeat any dish from recentMealNames/);
    assert.match(system, /near-identical variant/);
    assert.match(system, /different primary protein sources/);
    assert.doesNotMatch(system, /гречка/);
    assert.match(system, /Write name, description, ingredients and portion in natural English/);
    assert.doesNotMatch(system, /[\u0400-\u04ff]/);
    const plain: RequestInit[] = [];
    await provider(() => Response.json(envelope({ meals: [meal] })), plain).generate(input);
    const first = JSON.parse(JSON.parse(String(plain[0]!.body)).contents[0].parts[0].text);
    assert.equal(first.recentMealNames, undefined); assert.equal(first.variation, undefined);
  });

  const failsWith = async (code: string, respond: () => Response) => {
    await assert.rejects(provider(respond).generate(input), (error: AIProviderError) => error.code === code);
  };

  it('ошибки HTTP становятся кодами провайдера', async () => {
    await failsWith('rate_limited', () => new Response(null, { status: 429 }));
    await failsWith('authentication_failed', () => new Response(null, { status: 403 }));
    await failsWith('unavailable', () => new Response(null, { status: 500 }));
  });

  it('ответ не по схеме, обрезанный или с нулевыми калориями отвергается', async () => {
    await failsWith('invalid_response', () => Response.json(envelope({ meals: [{ ...meal, slot: 'brunch' }] })));
    await failsWith('invalid_response', () => Response.json(envelope({ meals: [meal] }, 'MAX_TOKENS')));
    await failsWith('invalid_response', () => Response.json(envelope({ meals: [{ ...meal, calories_kcal: 0 }] })));
    await failsWith('invalid_response', () => Response.json(envelope({ meals: [] })));
  });

  it('без ключа запроса нет', async () => {
    let called = false;
    const unconfigured = new GoogleMealPlanProvider({ apiKey: '', project: 'p', location: 'global', model: 'm', fetch: (async () => { called = true; return new Response(); }) as typeof fetch });
    await assert.rejects(unconfigured.generate(input), (error: AIProviderError) => error.code === 'not_configured');
    assert.equal(called, false);
  });
});
