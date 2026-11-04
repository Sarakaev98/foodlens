import assert from 'node:assert/strict';
import { it } from 'node:test';
import { Logger } from '@nestjs/common';
import { AIProviderError } from '@foodlens/ai';
import { loadAppConfig } from '../../../config/app-config';
import { createMealPlanProvider } from '../meal-plan-provider.factory';
Logger.overrideLogger(false);
const base = { DATABASE_URL: 'postgresql://test', AI_PROVIDER: 'google', GOAL_MATCH_AI: 'off' };
it('Meal Plan defaults to Google independently of scan selection', () => {
  const c = loadAppConfig({ ...base, AI_PROVIDER: 'meta', FIREWORKS_API_KEY: 'test' });
  assert.equal(c.mealPlan.provider, 'google'); assert.equal(c.ai.provider, 'meta');
  assert.equal(c.mealPlan.timeoutMs, 60000);
});
it('Fireworks is independent and keeps the main provider/Goal Match unchanged', () => {
  const c = loadAppConfig({ ...base, MEAL_PLAN_PROVIDER: 'fireworks', FIREWORKS_API_KEY: ' test ', FIREWORKS_MEAL_PLAN_TIMEOUT_MS: '100' });
  assert.equal(c.mealPlan.provider, 'fireworks'); assert.equal(c.mealPlan.fireworksApiKey, 'test');
  assert.equal(c.ai.provider, 'google'); assert.equal(c.goalMatchAi.mode, 'off'); assert.equal(c.mealPlan.timeoutMs, 100);
});
it('invalid provider and timeout fail startup', () => {
  assert.throws(() => loadAppConfig({ ...base, MEAL_PLAN_PROVIDER: 'automatic' }), /MEAL_PLAN_PROVIDER/);
  assert.throws(() => loadAppConfig({ ...base, FIREWORKS_MEAL_PLAN_TIMEOUT_MS: '-1' }), /TIMEOUT/);
});
it('selected Fireworks without a key fails; configured Gemini is never called', async () => {
  const c = loadAppConfig({ ...base, MEAL_PLAN_PROVIDER: 'fireworks', GOOGLE_API_KEY: 'gemini', GOOGLE_CLOUD_PROJECT: 'project' });
  await assert.rejects(createMealPlanProvider(c).generateMealPlan({ goal: 'lose_weight', startDate: '2026-11-04', days: 1, locale: 'en', targets: { caloriesKcal: 2000, proteinG: 150, carbsG: 200, fatG: 67 }, preferences: { dietaryPreferences: ['none'], allergens: [], avoidedIngredients: [] } } as never), e => e instanceof AIProviderError && e.provider === 'fireworks' && e.code === 'not_configured');
});

it('factory routes exclusively to the selected transport; default uses Gemini', async () => {
  const original = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (url) => { urls.push(String(url)); return new Response(null, { status: 429 }); }) as typeof fetch;
  try {
    const configured = { ...base, GOOGLE_API_KEY: 'fake', GOOGLE_CLOUD_PROJECT: 'test', FIREWORKS_API_KEY: 'fake' };
    for (const [provider, expected] of [['fireworks', 'fireworks'], [undefined, 'google']] as const) {
      const before = urls.length;
      const c = loadAppConfig({ ...configured, MEAL_PLAN_PROVIDER: provider });
      await assert.rejects(createMealPlanProvider(c).generateMealPlan({ goal: 'lose_weight', startDate: '2026-11-04', days: 1, locale: 'en', targets: { caloriesKcal: 2000, proteinG: 150, carbsG: 200, fatG: 67 }, preferences: { dietaryPreferences: ['none'], allergens: [], avoidedIngredients: [] } } as never), e => e instanceof AIProviderError && e.provider === expected);
      assert.equal(urls.length, before + 1);
      assert.match(urls[before]!, expected === 'fireworks' ? /^https:\/\/api.fireworks.ai\// : /^https:\/\/aiplatform.googleapis.com\//);
    }
  } finally { globalThis.fetch = original; }
});
