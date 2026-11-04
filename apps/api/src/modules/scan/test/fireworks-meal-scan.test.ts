import assert from 'node:assert/strict';
import { it } from 'node:test';
import { Logger } from '@nestjs/common';
import { FireworksMealPhotoProvider, GoogleProvider, MockProvider, FIREWORKS_MEAL_PHOTO_MODEL, MOCK_MEAL_PHOTO_OUTPUT as raw } from '@foodlens/ai';
import type { MealPhotoAiOutput } from '@foodlens/ai';
import { loadAppConfig } from '../../../config/app-config';
import { createAIProvider } from '../../ai/ai-provider.factory';
import { createScanAIProvider, createLabelScanAIProvider } from '../scan-ai-provider.factory';
import { createMealScanAIProvider } from '../meal-scan-ai-provider.factory';
import { MealPhotoService } from '../meal-photo.service';
import { ScanError } from '../scan-error';
import { TodayService } from '../../today/today.service';
Logger.overrideLogger(false);
const base = { DATABASE_URL: 'test', AI_PROVIDER: 'google', PRODUCT_SCAN_AI_PROVIDER: 'fireworks', LABEL_SCAN_AI_PROVIDER: 'fireworks', MEAL_PLAN_PROVIDER: 'fireworks', FIREWORKS_API_KEY: 'fake', GOOGLE_API_KEY: 'fake', GOOGLE_CLOUD_PROJECT: 'fake' };
const file = { mimetype: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]), size: 6 };
const envelope = (output: unknown) => ({ model: FIREWORKS_MEAL_PHOTO_MODEL, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(output) } }] });
it('Meal-only config is independent, explicit, and preserves the legacy default', () => {
  const before = loadAppConfig(base), c = loadAppConfig({ ...base, MEAL_SCAN_AI_PROVIDER: 'fireworks' });
  assert.ok(createMealScanAIProvider(c) instanceof FireworksMealPhotoProvider);
  assert.ok(createMealScanAIProvider(before) instanceof GoogleProvider);
  assert.ok(createMealScanAIProvider(loadAppConfig({ ...base, AI_PROVIDER: 'mock' })) instanceof MockProvider);
  assert.ok(createMealScanAIProvider(loadAppConfig({ ...base, MEAL_SCAN_AI_PROVIDER: 'google', AI_PROVIDER: 'mock' })) instanceof GoogleProvider);
  assert.ok(createAIProvider(c) instanceof GoogleProvider);
  for (const key of ['ai', 'scanAi', 'labelAi', 'mealPlan', 'goalMatchAi', 'productLookup'] as const) assert.deepEqual(c[key], before[key]);
  assert.equal(createScanAIProvider(c).name, createScanAIProvider(before).name);
  assert.equal(createLabelScanAIProvider(c).name, createLabelScanAIProvider(before).name);
  assert.throws(() => loadAppConfig({ ...base, MEAL_SCAN_AI_PROVIDER: 'auto' }), /MEAL_SCAN_AI_PROVIDER/);
  assert.throws(() => loadAppConfig({ ...base, FIREWORKS_MEAL_SCAN_TIMEOUT_MS: '0' }), /FIREWORKS_MEAL_SCAN_TIMEOUT_MS/);
  assert.equal(c.mealScanAi.timeoutMs, 45000);
});
async function scenario(provider: 'google' | 'fireworks', output: unknown, repeat = false) {
  const original = globalThis.fetch; const urls: string[] = [];
  globalThis.fetch = (async (url) => {
    urls.push(String(url));
    return Response.json(provider === 'fireworks' ? envelope(output) : { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(output) }] } }] });
  }) as typeof fetch;
  try {
    const service = new MealPhotoService(createMealScanAIProvider(loadAppConfig({ ...base, MEAL_SCAN_AI_PROVIDER: provider })));
    const result = await service.analyze(file);
    if (repeat) assert.deepEqual(await service.analyze(file), result);
    return { result, urls };
  } finally { globalThis.fetch = original; }
}
for (const [name, output] of [
  ['multi-component meal', raw],
  ['nullable range and inconsistent model total', { ...raw, total_kcal: 1, kcal_min: null, kcal_max: null }],
  ['one invalid component and inconsistent calories', { ...raw, items: [{ ...raw.items[0]!, kcal: 1 }, ...raw.items.slice(1), { ...raw.items[0]!, name: 'invalid', kcal: -10 }] }],
] as const) it(`${name}: exact normalization/weights/calories/macros parity with Gemini`, async () => {
  const g = await scenario('google', output), m = await scenario('fireworks', output);
  assert.deepEqual(m.result, g.result); assert.deepEqual(Object.keys(m.result), ['estimate']);
  assert.equal(m.urls.length, 1); assert.match(m.urls[0]!, /fireworks.ai/);
});
it('original no-cache behavior stays: two deliberate analyses make two requests, never return a Gemini result', async () => {
  const m = await scenario('fireworks', raw, true); assert.equal(m.urls.length, 2);
  assert.ok(m.urls.every(url => url.includes('fireworks.ai')));
});
it('unchanged Add to Today accepts the estimate and stays idempotent', async () => {
  const { result: { estimate } } = await scenario('fireworks', raw);
  const today = new TodayService();
  const input = { id: 'meal-test', date: '2026-11-04', name: estimate.mealName, source: 'meal_photo_estimate', ...estimate.total };
  const first = today.add('test', input), second = today.add('test', input);
  assert.deepEqual(first, second); assert.equal(second.entries.length, 1); assert.deepEqual(second.totals, estimate.total);
});
it('non-food, missing fields and impossible quantities retain existing scan error codes for both providers', async () => {
  const noFood = { ...raw, is_food: false, items: [] };
  const incomplete = { ...raw } as Record<string, unknown>; delete incomplete.confidence;
  const badItems = { ...raw, items: raw.items.map(item => ({ ...item, kcal: -1 })) };
  for (const provider of ['google', 'fireworks'] as const) for (const [output, code, status] of [[noFood, 'MEAL_NOT_RECOGNIZED', 422], [incomplete, 'AI_BAD_RESPONSE', 502], [badItems, 'AI_BAD_RESPONSE', 502]] as const) {
    await assert.rejects(scenario(provider, output), (e: unknown) => e instanceof ScanError && e.code === code && e.status === status);
  }
});
it('missing key, HTTP, timeout and malformed JSON never call Gemini or retry', async () => {
  const original = globalThis.fetch;
  try {
    for (const [kind, code] of [['key', 'AI_NOT_CONFIGURED'], ['http', 'AI_RATE_LIMITED'], ['timeout', 'AI_TIMEOUT'], ['json', 'AI_BAD_RESPONSE'], ['network', 'AI_UNAVAILABLE']] as const) {
      const urls: string[] = [];
      globalThis.fetch = (async url => { urls.push(String(url));
        if (kind === 'timeout') return new Promise<Response>(() => undefined);
        if (kind === 'network') throw Error('fake secret response');
        return kind === 'http' ? new Response('private error', { status: 429 }) : new Response('not JSON');
      }) as typeof fetch;
      const c = loadAppConfig({ ...base, MEAL_SCAN_AI_PROVIDER: 'fireworks', FIREWORKS_API_KEY: kind === 'key' ? '' : 'fake', FIREWORKS_MEAL_SCAN_TIMEOUT_MS: '15' });
      await assert.rejects(new MealPhotoService(createMealScanAIProvider(c)).analyze(file), (e: unknown) => e instanceof ScanError && e.code === code && !e.message.includes('private') && !e.message.includes('secret'));
      assert.equal(urls.length, kind === 'key' ? 0 : 1); assert.ok(urls.every(url => url.includes('fireworks.ai')));
    }
  } finally { globalThis.fetch = original; }
});
it('invalid image is rejected before selecting or contacting a model', async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = (async () => { calls++; throw Error('Unexpected request'); }) as typeof fetch;
  try {
    const svc = new MealPhotoService(createMealScanAIProvider(loadAppConfig({ ...base, MEAL_SCAN_AI_PROVIDER: 'fireworks' })));
    await assert.rejects(svc.analyze(undefined), (e: unknown) => e instanceof ScanError && e.code === 'IMAGE_MISSING');
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});
