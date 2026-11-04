import assert from 'node:assert/strict';
import { it } from 'node:test';
import { dirname, join } from 'node:path';
import { Logger, Module } from '@nestjs/common';
import type { Provider } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FireworksProductTextAI, GoogleNutritionSearch, FIREWORKS_PRODUCT_MODEL } from '@foodlens/ai';
import { observed, NOT_DETECTED, type Product } from '@foodlens/core';
import { loadAppConfig, type AppConfig } from '../../../config/app-config';
import { APP_CONFIG } from '../../../config/app-config.module';
import { LABEL_TEXT_AI, createLabelTextAI } from '../label-text-ai.factory';
import { ScanModule } from '../scan.module';
import { IngredientsDisplayService } from '../ingredients-display.service';
import { ScanService } from '../scan.service';
import { createLabelScanAIProvider, createScanAIProvider } from '../scan-ai-provider.factory';
import { createProductTextAI } from '../../ai/product-ai-support.factory';
import { demoProduct } from '../../goal-match/test/goal-match-v4.fixtures';
import type { NutritionTargetsService } from '../../nutrition-targets/nutrition-targets.service';
Logger.overrideLogger(false);
const base = { DATABASE_URL: 'test', AI_PROVIDER: 'google', PRODUCT_SCAN_AI_PROVIDER: 'google',
  LABEL_SCAN_AI_PROVIDER: 'fireworks', MEAL_SCAN_AI_PROVIDER: 'fireworks', MEAL_PLAN_PROVIDER: 'fireworks',
  FIREWORKS_API_KEY: 'fake-fireworks', GOOGLE_API_KEY: 'fake-google', GOOGLE_CLOUD_PROJECT: 'fake', GOAL_MATCH_AI: 'off' };
const config = (extra: Record<string, string> = {}) => loadAppConfig({ ...base, ...extra });
const source = (): Product => ({
  ...demoProduct({ id: 'label-translation', name: 'Шоколад', portion: 100, values: [350, 6, 7.5, 65, 12, 4, 2, 3],
    sugarSource: 'added', processing: 'ultra_processed', productForm: 'food', ingredients: [] }),
  ingredients: observed([{ name: 'молоко', percent: 20 }, { name: 'сахар', percent: null }, { name: 'эмульгатор (лецитин E322)', percent: null }]),
  additives: observed([{ code: 'E322', name: 'лецитин' }]),
});
const words: Record<string, string> = { 'молоко': 'milk', 'сахар': 'sugar', 'эмульгатор': 'emulsifier', 'лецитин': 'lecithin', 'Шоколад': 'Chocolate' };
type Call = { url: string; body: any };
function translationResponse(url: unknown, init?: RequestInit): Response {
  const body = JSON.parse(String(init?.body));
  const meta = String(url).includes('fireworks.ai');
  const prompt = meta ? body.messages[1].content : body.contents[0].parts[0].text;
  const { segments } = JSON.parse(prompt);
  const output = { translations: segments.map((s: { id: number; text: string }) => {
    assert.ok(words[s.text], `Unexpected synthetic segment ${s.text}`);
    return { id: s.id, text: words[s.text] };
  }) };
  return meta ? Response.json({ model: FIREWORKS_PRODUCT_MODEL, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(output), tool_calls: [] } }] })
    : Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(output) }] } }] });
}
async function withFetch<T>(reply: (url: unknown, init?: RequestInit) => Response | Promise<Response>, work: (calls: Call[]) => Promise<T>): Promise<T> {
  const original = globalThis.fetch, calls: Call[] = [];
  globalThis.fetch = (async (url, init) => { calls.push({ url: String(url), body: JSON.parse(String(init?.body)) }); return reply(url, init); }) as typeof fetch;
  try { return await work(calls); } finally { globalThis.fetch = original; }
}
// Use the actual ScanModule registration, not a separately re-created wiring in the test.
async function labelContext(c: AppConfig) {
  const registered = Reflect.getMetadata('providers', ScanModule) as Provider[];
  const selected = registered.filter(p => typeof p === 'object' && p !== null && 'provide' in p && [LABEL_TEXT_AI, IngredientsDisplayService].includes(p.provide as any));
  assert.equal(selected.length, 2, 'Label must explicitly inject its selected translator');
  @Module({ providers: [{ provide: APP_CONFIG, useValue: c }, ...selected] })
  class LabelFixtureModule {}
  return NestFactory.createApplicationContext(LabelFixtureModule, { logger: false });
}
it('Label translator selection is independent of Product, web search and legacy AI_PROVIDER', () => {
  for (const product of ['google', 'fireworks']) {
    const meta = config({ PRODUCT_SCAN_AI_PROVIDER: product, WEB_SEARCH_LOOKUP: 'gemini', AI_PROVIDER: 'mock' });
    assert.ok(createLabelTextAI(meta) instanceof FireworksProductTextAI);
    const google = createLabelTextAI(config({ PRODUCT_SCAN_AI_PROVIDER: product, LABEL_SCAN_AI_PROVIDER: 'google' }));
    assert.equal(google.constructor, GoogleNutritionSearch);
  }
  assert.equal(createProductTextAI(config()).constructor, GoogleNutritionSearch);
});
it('actual Label DI sends one batch to the selected provider with identical prompt, original text, structure and cache rules', async () => {
  const captured: Record<string, Call[]> = {};
  for (const provider of ['fireworks', 'google']) await withFetch(translationResponse, async calls => {
    const c = config({ LABEL_SCAN_AI_PROVIDER: provider, PRODUCT_SCAN_AI_PROVIDER: provider === 'fireworks' ? 'google' : 'fireworks' });
    const app = await labelContext(c);
    try {
      const display = app.get(IngredientsDisplayService), p = source(), copy = structuredClone(p);
      const result = await display.decorate(p);
      assert.equal(calls.length, 1);
      assert.match(calls[0]!.url, provider === 'fireworks' ? /api.fireworks.ai/ : /aiplatform.googleapis.com/);
      assert.deepEqual(result.ingredients, p.ingredients); assert.deepEqual(p, copy);
      assert.equal(result.nameDisplay, 'Chocolate');
      assert.deepEqual(result.ingredientsDisplay!.items, [{ name: 'milk', percent: 20 }, { name: 'sugar', percent: null }, { name: 'emulsifier (lecithin E322)', percent: null }]);
      assert.deepEqual(result.additivesDisplay, [{ code: 'E322', name: 'lecithin' }]);
      assert.deepEqual(await display.decorate(p), result); assert.equal(calls.length, 1);
      captured[provider] = calls;
    } finally { await app.close(); }
  });
  assert.equal(captured.fireworks![0]!.body.messages[0].content, captured.google![0]!.body.systemInstruction.parts[0].text);
  assert.equal(captured.fireworks![0]!.body.messages[1].content, captured.google![0]!.body.contents[0].parts[0].text);
  assert.equal(captured.fireworks![0]!.body.max_tokens, captured.google![0]!.body.generationConfig.maxOutputTokens);
});
it('English text and missing ingredients never send an unnecessary translation request', async () => withFetch(() => { throw Error('Unexpected request'); }, async calls => {
  const app = await labelContext(config());
  try {
    const display = app.get(IngredientsDisplayService);
    const p = { ...source(), name: observed('Chocolate'), ingredients: observed([{ name: 'milk', percent: null }]), additives: NOT_DETECTED };
    const result = await display.decorate(p); assert.equal(result.ingredientsDisplay!.status, 'unchanged');
    const empty = { ...p, ingredients: NOT_DETECTED }; assert.equal(await display.decorate(empty), empty);
    assert.equal(calls.length, 0);
  } finally { await app.close(); }
}));
it('Fireworks translation works without Google credentials; Google credentials cannot rescue a missing Fireworks key', async () => withFetch(translationResponse, async calls => {
  const display = new IngredientsDisplayService(createLabelTextAI(config({ GOOGLE_API_KEY: '', GOOGLE_CLOUD_PROJECT: '' })));
  assert.equal((await display.decorate(source())).ingredientsDisplay!.status, 'translated'); assert.equal(calls.length, 1);
  const missing = new IngredientsDisplayService(createLabelTextAI(config({ FIREWORKS_API_KEY: '' })));
  const p = await missing.decorate(source()); assert.equal(p.ingredientsDisplay!.status, 'fallback');
  assert.deepEqual(p.ingredientsDisplay!.items, source().ingredients.value); assert.equal(calls.length, 1);
  assert.ok(calls.every(c => c.url.includes('fireworks.ai')));
}));
it('API/network/JSON/schema/refusal failures retain original display with no Gemini fallback or automatic retry', async () => {
  const failures = [
    () => new Response('private provider error', { status: 401 }),
    () => new Response(null, { status: 429 }),
    () => new Response(null, { status: 500 }),
    () => { throw Error('private network details'); },
    () => new Response('not JSON'),
    () => Response.json({ model: FIREWORKS_PRODUCT_MODEL, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{broken' } }] }),
    () => Response.json({ model: FIREWORKS_PRODUCT_MODEL, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{"translations":[]}' } }] }),
    () => Response.json({ model: FIREWORKS_PRODUCT_MODEL, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'null', refusal: 'private refusal' } }] }),
  ];
  for (const fail of failures) await withFetch(fail, async calls => {
    const app = await labelContext(config());
    try {
      const display = app.get(IngredientsDisplayService), original = source(), result = await display.decorate(original);
      assert.equal(result.ingredientsDisplay!.status, 'fallback'); assert.deepEqual(result.ingredientsDisplay!.items, original.ingredients.value);
      assert.deepEqual(result.ingredients, original.ingredients); assert.equal(result.nameDisplay, undefined);
      await display.decorate(original); assert.equal(calls.length, 1); assert.match(calls[0]!.url, /fireworks.ai/);
    } finally { await app.close(); }
  });
});
it('Label translation deadline preserves the original cached fallback and never contacts Google', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  await withFetch(() => new Promise<Response>(() => undefined), async calls => {
    const app = await labelContext(config());
    try {
      const display = app.get(IngredientsDisplayService), pending = display.decorate(source());
      t.mock.timers.tick(12001);
      const result = await pending; assert.equal(result.ingredientsDisplay!.status, 'fallback');
      await display.decorate(source()); assert.equal(calls.length, 1); assert.match(calls[0]!.url, /fireworks.ai/);
    } finally { await app.close(); }
  });
});
it('concurrent identical requests share the existing pending translation', async () => {
  let finish!: () => void;
  await withFetch((url, init) => new Promise(resolve => { finish = () => resolve(translationResponse(url, init)); }), async calls => {
    const app = await labelContext(config());
    try {
      const display = app.get(IngredientsDisplayService), a = display.decorate(source()), b = display.decorate(source());
      assert.equal(calls.length, 1); finish(); assert.deepEqual(await a, await b); assert.equal(calls.length, 1);
    } finally { await app.close(); }
  });
});
it('full Label pipeline uses Meta for both photo and translation while scores and original facts stay unchanged', async () => {
  const { MOCK_META_PRODUCT_ANALYSIS: raw } = require(join(dirname(require.resolve('@foodlens/ai')), 'providers/mock/mock-product-analysis.js'));
  const fixture = { ...structuredClone(raw), identity: { ...raw.identity, name: { value: 'Шоколад', evidence: 'visible_text' } },
    ingredients: { visible: true, items: [{ name: 'молоко', percent: null }] }, additives: [] };
  await withFetch((url, init) => {
    const body = JSON.parse(String(init?.body)); assert.match(String(url), /fireworks.ai/);
    if (body.response_format.json_schema.name === 'product_analysis') return Response.json({ model: FIREWORKS_PRODUCT_MODEL, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(fixture) } }] });
    return translationResponse(url, init);
  }, async calls => {
    const c = config({ GOOGLE_API_KEY: '', GOOGLE_CLOUD_PROJECT: '' }), app = await labelContext(c);
    try {
      const plans = { findPlanForUser: async () => null } as unknown as NutritionTargetsService;
      const vision = createLabelScanAIProvider(c), product = createScanAIProvider(c);
      const translated = new ScanService(product, plans, undefined, undefined, async () => null, app.get(IngredientsDisplayService), vision);
      const plain = new ScanService(product, plans, undefined, undefined, async () => null, undefined, vision);
      const file = { mimetype: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]), size: 6 };
      const a = await translated.analyze(file, 'test', { mode: 'nutrition_label' });
      assert.equal(calls.length, 2); assert.equal(a.product.nameDisplay, 'Chocolate');
      const b = await plain.analyze(file, 'test', { mode: 'nutrition_label' });
      assert.equal(calls.length, 3); assert.deepEqual(a.score, b.score); assert.deepEqual(a.goalMatch, b.goalMatch);
      for (const k of ['nutrition', 'nutritionMetadata', 'ingredients', 'allergens', 'additives', 'semantics'] as const) assert.deepEqual(a.product[k], b.product[k]);
      assert.ok(calls.every(call => call.url.includes('fireworks.ai')));
    } finally { await app.close(); }
  });
});
