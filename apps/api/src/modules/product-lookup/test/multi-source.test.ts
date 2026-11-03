import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MockProvider } from '@foodlens/ai';
import { NOT_DETECTED, observed, type NutrientKey, type NutritionFacts, type Product } from '@foodlens/core';
import type { AppConfig } from '../../../config/app-config';
import { CachedProductLookupProvider } from '../cached-product-lookup.provider';
import { FatSecretError, FatSecretProductLookupProvider, mapFatSecretFood, toGtin13 } from '../fatsecret.provider';
import { MultiSourceProductLookup, missingCriticalNutrients } from '../multi-source-product-lookup';
import { mapOpenFoodFactsProduct } from '../open-food-facts.mapper';
import { createProductLookupSources } from '../product-lookup.module';
import type { ProductLookupProvider, ProductLookupResult } from '../product-lookup.provider';
import { BARCODE, offProduct, OFF_NUTRIENTS } from './open-food-facts.fixtures';

const KEYS: readonly NutrientKey[] = ['caloriesKcal', 'proteinG', 'carbsG', 'sugarsG', 'fatG', 'saturatedFatG', 'fiberG', 'saltG', 'sodiumMg'];
const nothing = Object.fromEntries(KEYS.map((key) => [key, null])) as Record<NutrientKey, number | null>;

async function label(overrides: Partial<NutritionFacts> = {}, confidence: Partial<Product['confidence']> = {}): Promise<Product> {
  const base = await new MockProvider().analyzeProduct({ kind: 'image', image: { mimeType: 'image/jpeg', base64: 'AA' } });
  return { ...base, confidence: { ...base.confidence, nutrition: 'high', overall: 'high', ...confidence }, nutrition: {
    basis: 'per_100g', servingSize: NOT_DETECTED, caloriesKcal: observed(430), proteinG: observed(4.5), carbsG: observed(63), fatG: observed(18),
    sugarsG: NOT_DETECTED, saturatedFatG: NOT_DETECTED, fiberG: observed(1.2), saltG: NOT_DETECTED, sodiumMg: NOT_DETECTED, ...overrides,
  } };
}

/** OFF как у реального Choco Pie: продукт есть, но без сахаров, насыщенных жиров и соли. */
function offPartial(): ProductLookupResult {
  const { sugars: _s, 'saturated-fat': _f, salt: _a, sodium: _n, ...rest } = OFF_NUTRIENTS;
  return mapOpenFoodFactsProduct(offProduct({ nutrition: { aggregated_set: { nutrients: rest, per: '100g', preparation: 'as_sold' } } }), BARCODE)!;
}
const offFull = (): ProductLookupResult => mapOpenFoodFactsProduct(offProduct(), BARCODE)!;

function second(values: Partial<Record<NutrientKey, number>>, extra: Partial<ProductLookupResult> = {}): ProductLookupResult {
  return { provider: 'fatsecret', match: 'exact_barcode', barcode: BARCODE, name: 'Other name', brand: 'Other brand', servingSize: null,
    nutrition: { basis: 'per_100g', values: { ...nothing, caloriesKcal: 430, proteinG: 4.5, carbsG: 63, fatG: 18, ...values }, derived: [] },
    ingredients: null, allergens: null, additives: null, ...extra };
}
function source(name: string, answer: () => Promise<ProductLookupResult | null>) {
  const calls: string[] = [];
  const provider: ProductLookupProvider = { name, lookup: (barcode) => (calls.push(barcode!), answer()) };
  return { provider, calls };
}
const run = async (product: Product, first: ProductLookupResult | null, next: () => Promise<ProductLookupResult | null>) => {
  const off = source('open_food_facts', async () => first);
  const fat = source('fatsecret', next);
  const enriched = await new MultiSourceProductLookup([off.provider, fat.provider]).begin(BARCODE).enrich(product);
  return { ...enriched, offCalls: off.calls, fatCalls: fat.calls };
};
const unused = async (): Promise<ProductLookupResult | null> => { throw new Error('must not be called'); };

describe('MultiSourceProductLookup: cost control', () => {
  it('1. Gemini read everything: the second source is not called', async () => {
    const product = await label({ sugarsG: observed(38), saturatedFatG: observed(9), saltG: observed(0.4) });
    const { steps, fatCalls } = await run(product, null, unused);
    assert.deepEqual(fatCalls, []); assert.equal(steps[1]!.status, 'not_needed');
  });
  it('2. OFF fills all critical fields: the second source is not called', async () => {
    const { product, fatCalls } = await run(await label(), offFull(), unused);
    assert.deepEqual(fatCalls, []); assert.equal(product.nutrition!.sugarsG.value, 38);
  });
  it('sodium alone covers salt: not called', async () => {
    const product = await label({ sugarsG: observed(38), saturatedFatG: observed(9), sodiumMg: observed(160) });
    assert.deepEqual(missingCriticalNutrients(product), []);
    assert.deepEqual((await run(product, null, unused)).fatCalls, []);
  });
  it('3. OFF is partial: the second source is called once, with the barcode only', async () => {
    const { fatCalls } = await run(await label(), offPartial(), async () => null);
    assert.deepEqual(fatCalls, [BARCODE]);
  });
  it('OFF not found or failing still leads to the second source', async () => {
    assert.equal((await run(await label(), null, async () => second({ sugarsG: 28 }))).product.nutrition!.sugarsG.value, 28);
    const off = source('open_food_facts', async () => { throw new Error('down'); });
    const fat = source('fatsecret', async () => second({ sugarsG: 28 }));
    const { product, steps } = await new MultiSourceProductLookup([off.provider, fat.provider]).begin(BARCODE).enrich(await label());
    assert.equal(product.nutrition!.sugarsG.value, 28); assert.equal(steps[0]!.status, 'error');
  });
  it('the first source starts immediately, before the photo result is known', async () => {
    const off = source('open_food_facts', async () => null);
    new MultiSourceProductLookup([off.provider]).begin(BARCODE);
    assert.deepEqual(off.calls, [BARCODE]);
  });
  it('no sources: the product passes through unchanged', async () => {
    const product = await label();
    const enriched = await new MultiSourceProductLookup([]).begin(BARCODE).enrich(product);
    assert.equal(enriched.product, product); assert.deepEqual(enriched.steps, []);
  });
});

describe('MultiSourceProductLookup: filling and trust', () => {
  it('4–6. fills sugars, saturated fat and sodium, derives salt, with provenance per field', async () => {
    const { product } = await run(await label(), offPartial(), async () => second({ sugarsG: 28, saturatedFatG: 7, sodiumMg: 200 }));
    const n = product.nutrition!;
    assert.deepEqual([n.sugarsG.value, n.sugarsG.provenance], [28, 'fatsecret']);
    assert.deepEqual([n.saturatedFatG.value, n.saturatedFatG.provenance], [7, 'fatsecret']);
    assert.deepEqual([n.sodiumMg.value, n.sodiumMg.provenance], [200, 'fatsecret']);
    assert.deepEqual([n.saltG.value, n.saltG.provenance], [0.5, 'inferred']);
    assert.equal(n.proteinG.provenance, 'observed');
  });
  it('7. the label beats any provider', async () => {
    const product = await label({ sugarsG: observed(25) });
    const { product: merged, steps } = await run(product, offPartial(), async () => second({ sugarsG: 30, saltG: 0.4 }));
    assert.equal(merged.nutrition!.sugarsG.value, 25); assert.equal(merged.nutrition!.sugarsG.provenance, 'observed');
    assert.ok(steps[1]!.report!.conflicts.some((c) => c.field === 'sugarsG'));
  });
  it('8. an OFF value beats a weaker name-only match, which is ignored entirely', async () => {
    const { product, steps } = await run(await label(), offFull(), unused);
    assert.equal(product.nutrition!.sugarsG.provenance, 'open_food_facts');
    assert.equal(steps[1]!.status, 'not_needed');
    const partial = await run(await label(), offPartial(), async () => second({ sugarsG: 28 }, { match: 'name_only' }));
    assert.equal(partial.product.nutrition!.sugarsG.value, null);
    assert.equal(partial.steps[1]!.report!.skipped, 'low_confidence_match');
  });
  it('9. two databases strongly disagree: the field stays unresolved and confidence is low', async () => {
    const off = mapOpenFoodFactsProduct(offProduct(), BARCODE)!;
    const noSalt = { ...off, nutrition: { ...off.nutrition!, values: { ...off.nutrition!.values, saltG: null } } };
    const { product, steps } = await run(await label(), noSalt, async () => second({ sugarsG: 20, saltG: 0.4 }));
    assert.equal(product.nutrition!.sugarsG.value, null); assert.equal(product.nutrition!.sugarsG.provenance, 'not_detected');
    assert.deepEqual(steps[1]!.report!.unresolved, ['sugarsG']);
    assert.equal(product.nutrition!.saltG.value, 0.4, 'other fields still fill');
    assert.equal(product.confidence.nutrition, 'low');
  });
  it('11. close agreement keeps the first database value and records confirmation', async () => {
    const off = mapOpenFoodFactsProduct(offProduct(), BARCODE)!;
    const noSalt = { ...off, nutrition: { ...off.nutrition!, values: { ...off.nutrition!.values, saltG: null, sugarsG: 28 } } };
    const { product, steps } = await run(await label(), noSalt, async () => second({ sugarsG: 27, saltG: 0.4 }));
    assert.deepEqual([product.nutrition!.sugarsG.value, product.nutrition!.sugarsG.provenance], [28, 'open_food_facts']);
    assert.ok(steps[1]!.report!.confirmed.includes('sugarsG'));
    assert.deepEqual(steps[1]!.report!.unresolved, []);
  });
  it('10. macros far from the photo: the provider is rejected, nothing is filled', async () => {
    const { product, steps } = await run(await label(), offPartial(), async () => second({ sugarsG: 28, caloriesKcal: 120, fatG: 3 }));
    assert.equal(product.nutrition!.sugarsG.value, null);
    assert.equal(steps[1]!.report!.skipped, 'different_product');
  });
  it('12. name-only data never reaches scoring, even with no other data at all', async () => {
    const base = await label();
    const { product } = await run({ ...base, nutrition: null }, null, async () => second({ sugarsG: 28 }, { match: 'name_only' }));
    assert.equal(product.nutrition, null);
  });
  it('medium match: used when macros agree, refused when they cannot be checked', async () => {
    const verified = await run(await label(), null, async () => second({ sugarsG: 28 }, { match: 'verified_attributes' }));
    assert.equal(verified.product.nutrition!.sugarsG.value, 28);
    const base = await label();
    const unchecked = await run({ ...base, nutrition: null }, null, async () => second({ sugarsG: 28 }, { match: 'verified_attributes' }));
    assert.equal(unchecked.product.nutrition, null);
    assert.equal(unchecked.steps[1]!.report!.skipped, 'unverified_match');
    const weak = await run(await label({ proteinG: NOT_DETECTED, carbsG: NOT_DETECTED, fatG: NOT_DETECTED }), null,
      async () => second({ sugarsG: 28 }, { match: 'verified_attributes' }));
    assert.equal(weak.product.nutrition!.sugarsG.value, null);
  });
  it('nutrition-only provider is fine: ingredients keep their priority and identity stays', async () => {
    const base = await label();
    const product = { ...base, ingredients: NOT_DETECTED, name: NOT_DETECTED };
    const merged = (await run(product, offPartial(), async () => second({ sugarsG: 28 }))).product;
    assert.equal(merged.ingredients.provenance, 'open_food_facts'); assert.equal(merged.name.value, 'Чокопай');
    assert.equal(merged.nutrition!.sugarsG.value, 28);
    const fromSecond = (await run(product, null, async () => second({ sugarsG: 28 }, { ingredients: [{ name: 'сахар', percent: null }] }))).product;
    assert.equal(fromSecond.ingredients.provenance, 'fatsecret');
  });
  it('serving: label first, then the first exact-barcode database; never AI', async () => {
    const off = { ...offPartial(), servingSize: { amount: 30, unit: 'g' as const } };
    const merged = (await run(await label(), off, async () => second({ sugarsG: 28 }, { servingSize: { amount: 28, unit: 'g' } }))).product;
    assert.deepEqual([merged.nutrition!.servingSize.value, merged.nutrition!.servingSize.provenance], [{ amount: 30, unit: 'g' }, 'open_food_facts']);
    const none = (await run(await label(), offPartial(), async () => second({ sugarsG: 28 }))).product;
    assert.equal(none.nutrition!.servingSize.value, null);
  });
});

describe('MultiSourceProductLookup: failures', () => {
  it('13–14. a timed-out or rate-limited second source leaves the scan as it was', async () => {
    for (const code of ['unavailable', 'rate_limited'] as const) {
      const { product, steps } = await run(await label(), offPartial(), async () => { throw new FatSecretError(code); });
      assert.equal(product.nutrition!.sugarsG.value, null);
      assert.equal(steps[1]!.status, 'error'); assert.equal(steps[1]!.error, `FatSecret: ${code}`);
    }
  });
  it('not found is a normal outcome', async () => {
    const { steps } = await run(await label(), offPartial(), async () => null);
    assert.equal(steps[1]!.status, 'miss');
  });
  it('15. each source has its own cache: repeat scans cost no second request', async () => {
    const off = source('open_food_facts', async () => offPartial());
    const fat = source('fatsecret', async () => second({ sugarsG: 28 }));
    const lookups = new MultiSourceProductLookup([new CachedProductLookupProvider(off.provider), new CachedProductLookupProvider(fat.provider)]);
    for (let i = 0; i < 3; i++) await lookups.begin(BARCODE).enrich(await label());
    assert.equal(off.calls.length, 1); assert.equal(fat.calls.length, 1);
  });
});

describe('Confidence after merge', () => {
  const confidence = async (product: Product, first: ProductLookupResult | null) => (await run(product, first, async () => null)).product.confidence;
  it('label confirmed by an exact barcode without conflicts → high', async () => {
    const product = await label({ sugarsG: observed(38), saturatedFatG: observed(9), saltG: observed(0.4), fiberG: observed(1.2) }, { nutrition: 'medium' });
    assert.equal((await confidence(product, offFull())).nutrition, 'high');
  });
  it('filled from a database → at most medium, also overall', async () => {
    const result = await confidence(await label(), offFull());
    assert.equal(result.nutrition, 'medium'); assert.equal(result.overall, 'medium');
  });
  it('a conflict → at most medium, and a low-quality photo is never raised', async () => {
    assert.equal((await confidence(await label({ sugarsG: observed(20), saturatedFatG: observed(9), saltG: observed(0.4) }), offFull())).nutrition, 'medium');
    assert.equal((await confidence(await label({ sugarsG: observed(38), saturatedFatG: observed(9), saltG: observed(0.4) }, { nutrition: 'low' }), offFull())).nutrition, 'low');
  });
  it('no database data: confidence stays exactly as it was', async () => {
    const product = await label();
    assert.deepEqual((await confidence(product, null)), product.confidence);
  });
});

describe('FatSecret adapter (documented response, stubbed HTTP)', () => {
  const food = (servings: unknown) => ({ food_id: '1', food_name: 'Choco Pie', brand_name: 'Orion', food_type: 'Brand', servings: { serving: servings } });
  const serving = (extra: Record<string, unknown> = {}) => ({ serving_id: '2', metric_serving_amount: '30.000', metric_serving_unit: 'g', measurement_description: 'piece',
    calories: '129', carbohydrate: '18.9', protein: '1.35', fat: '5.4', saturated_fat: '2.7', sugar: '11.4', fiber: '0.3', sodium: '60', ...extra });

  it('converts a serving to 100 g, keeps name and brand, and leaves salt to the merge', () => {
    const result = mapFatSecretFood(food(serving()), BARCODE)!;
    assert.equal(result.match, 'exact_barcode'); assert.equal(result.name, 'Choco Pie'); assert.equal(result.brand, 'Orion');
    const v = result.nutrition!.values;
    assert.deepEqual([v.caloriesKcal, v.carbsG, v.proteinG, v.fatG, v.saturatedFatG, v.sugarsG, v.fiberG, v.sodiumMg, v.saltG], [430, 63, 4.5, 18, 9, 38, 1, 200, null]);
    assert.equal(result.nutrition!.basis, 'per_100g'); assert.deepEqual(result.servingSize, { amount: 30, unit: 'g' });
    assert.equal(result.ingredients, null);
  });
  it('a missing nutrient stays null and a real 0 stays 0', () => {
    const { sugar: _sugar, ...rest } = serving({ fiber: '0' });
    const v = mapFatSecretFood(food(rest), BARCODE)!.nutrition!.values;
    assert.equal(v.sugarsG, null); assert.equal(v.fiberG, 0);
  });
  it('prefers the default serving, handles a list and ml, and skips servings without weight', () => {
    const list = [serving({ metric_serving_amount: undefined, metric_serving_unit: undefined }), serving({ metric_serving_amount: '330', metric_serving_unit: 'ml', calories: '33', is_default: '1' })];
    const result = mapFatSecretFood(food(list), BARCODE)!;
    assert.equal(result.nutrition!.basis, 'per_100ml'); assert.equal(result.nutrition!.values.caloriesKcal, 10);
    assert.equal(mapFatSecretFood(food(serving({ metric_serving_unit: 'oz' })), BARCODE)!.nutrition, null);
  });
  it('"100 g" is the table basis, not a serving', () => {
    assert.equal(mapFatSecretFood(food(serving({ metric_serving_amount: '100', measurement_description: 'g' })), BARCODE)!.servingSize, null);
  });
  it('barcodes become GTIN-13', () => {
    assert.equal(toGtin13('012345678905'), '0012345678905'); assert.equal(toGtin13('12345670'), '0000012345670');
    assert.equal(toGtin13(BARCODE), BARCODE); assert.equal(toGtin13('04607084351385'), '4607084351385'); assert.equal(toGtin13('14607084351385'), null);
  });

  function client(answers: (url: string) => Response, config: Record<string, unknown> = {}, now?: () => number) {
    const calls: { url: string; init: RequestInit }[] = [];
    const provider = new FatSecretProductLookupProvider({ clientId: 'unit-client-id', clientSecret: 'unit-client-secret', ...config, ...(now ? { now } : {}),
      fetch: (async (url: unknown, init: RequestInit) => { calls.push({ url: String(url), init }); return answers(String(url)); }) as typeof fetch });
    return { provider, calls };
  }
  const token = () => new Response(JSON.stringify({ access_token: 'unit-token', expires_in: 86400, token_type: 'Bearer' }));
  const found = () => new Response(JSON.stringify({ food: food(serving()) }));

  it('uses a client-credentials token once and sends only the GTIN', async () => {
    const { provider, calls } = client((url) => (url.includes('oauth') ? token() : found()));
    await provider.lookup(BARCODE); await provider.lookup(BARCODE);
    assert.equal(calls.filter((call) => call.url.includes('oauth')).length, 1);
    const search = new URL(calls[1]!.url);
    assert.equal(search.origin + search.pathname, 'https://platform.fatsecret.com/rest/food/barcode/find-by-id/v2');
    assert.equal(search.searchParams.get('barcode'), BARCODE); assert.equal(search.searchParams.get('region'), null);
    assert.equal(calls[1]!.init.body, undefined);
    assert.equal(new Headers(calls[1]!.init.headers).get('authorization'), 'Bearer unit-token');
    assert.match(String(calls[0]!.init.body), /scope=barcode$/);
  });
  it('asks for localization scope only with a region', async () => {
    const { provider, calls } = client((url) => (url.includes('oauth') ? token() : found()), { region: 'RU', language: 'ru' });
    await provider.lookup(BARCODE);
    assert.match(String(calls[0]!.init.body), /scope=barcode\+localization/);
    assert.equal(new URL(calls[1]!.url).searchParams.get('region'), 'RU');
  });
  it('code 211 is not found; other API errors and auth failures are typed', async () => {
    const answer = (body: unknown) => (url: string) => (url.includes('oauth') ? token() : new Response(JSON.stringify(body)));
    assert.equal(await client(answer({ error: { code: 211, message: 'No food item detected' } })).provider.lookup(BARCODE), null);
    await assert.rejects(client(answer({ error: { code: 14, message: 'Missing scope' } })).provider.lookup(BARCODE), (e: unknown) => e instanceof FatSecretError && e.code === 'not_authorized');
    await assert.rejects(client(() => new Response('', { status: 401 })).provider.lookup(BARCODE), (e: unknown) => e instanceof FatSecretError && e.code === 'not_authorized');
  });
  it('13–14. network failure and 429 are typed, and a 429 pauses further calls', async () => {
    await assert.rejects(client(() => { throw new Error('timeout'); }).provider.lookup(BARCODE), (e: unknown) => e instanceof FatSecretError && e.code === 'unavailable');
    let time = 0;
    const { provider, calls } = client((url) => (url.includes('oauth') ? token() : new Response('', { status: 429 })), {}, () => time);
    await assert.rejects(provider.lookup(BARCODE)); await assert.rejects(provider.lookup(BARCODE));
    assert.equal(calls.length, 2);
    time = 60_001;
    await assert.rejects(provider.lookup(BARCODE));
    assert.equal(calls.length, 3);
  });
  it('17. errors never contain the credentials or the token', async () => {
    const { provider } = client((url) => (url.includes('oauth') ? token() : new Response('unit-token', { status: 500 })));
    const error = await provider.lookup(BARCODE).catch((e: unknown) => e);
    const text = `${String(error)} ${JSON.stringify(error)}`;
    for (const secret of ['unit-client-id', 'unit-client-secret', 'unit-token']) assert.ok(!text.includes(secret), secret);
  });
  it('an invalid token is dropped, so the next call gets a new one', async () => {
    let tokens = 0;
    const { provider } = client((url) => { if (url.includes('oauth')) { tokens++; return token(); } return new Response(JSON.stringify({ error: { code: 13 } })); });
    await assert.rejects(provider.lookup(BARCODE)); await assert.rejects(provider.lookup(BARCODE));
    assert.equal(tokens, 2);
  });
});

describe('Source wiring', () => {
  const config = (fatSecret: Record<string, unknown>, provider = 'open_food_facts') =>
    ({ productLookup: { provider, contact: 'unit', webSearch: 'off', fatSecret: { clientId: '', clientSecret: '', region: undefined, language: undefined, ...fatSecret } } }) as unknown as AppConfig;
  const names = (c: AppConfig) => createProductLookupSources(c).map((source) => source.name);
  it('without keys FatSecret is not connected, whatever else is set', () => {
    assert.deepEqual(names(config({})), ['open_food_facts']);
    assert.deepEqual(names(config({ clientId: 'id' })), ['open_food_facts']);
    assert.deepEqual(names(config({ clientSecret: 'secret' })), ['open_food_facts']);
  });
  it('with both keys it comes second, after OFF', () => {
    assert.deepEqual(names(config({ clientId: 'id', clientSecret: 'secret' })), ['open_food_facts', 'fatsecret']);
  });
  it('PRODUCT_LOOKUP=none turns every source off', () => {
    assert.deepEqual(names(config({ clientId: 'id', clientSecret: 'secret' }, 'none')), []);
  });
});
