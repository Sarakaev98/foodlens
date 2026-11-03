import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CachedProductLookupProvider, LOOKUP_FOUND_TTL_MS, LOOKUP_NOT_FOUND_TTL_MS } from '../cached-product-lookup.provider';
import { mapOpenFoodFactsProduct } from '../open-food-facts.mapper';
import { OFF_REQUEST_FIELDS, OPEN_FOOD_FACTS_MAX_PER_MINUTE, OpenFoodFactsError, OpenFoodFactsProductLookupProvider } from '../open-food-facts.provider';
import type { ProductLookupProvider, ProductLookupResult } from '../product-lookup.provider';
import { BARCODE, OFF_NUTRIENTS, offFound, offNotFound, offProduct } from './open-food-facts.fixtures';

const map = (overrides: Record<string, unknown> = {}) => mapOpenFoodFactsProduct(offProduct(overrides), BARCODE)!;
const nutrition = (nutrients: unknown, extra: Record<string, unknown> = {}) => ({ nutrition: { aggregated_set: { nutrients, per: '100g', preparation: 'as_sold', ...extra } } });

describe('Open Food Facts mapping', () => {
  it('takes identity and nutrition from the v3.6 aggregated set', () => {
    const result = map();
    assert.equal(result.name, 'Чокопай'); assert.equal(result.brand, 'Lotte');
    assert.equal(result.nutrition!.basis, 'per_100g');
    const { caloriesKcal, proteinG, carbsG, sugarsG, fatG, saturatedFatG, fiberG, saltG } = result.nutrition!.values;
    assert.deepEqual([caloriesKcal, proteinG, carbsG, sugarsG, fatG, saturatedFatG, fiberG, saltG], [430, 4.5, 63, 38, 18, 9, 1.2, 0.4]);
    assert.deepEqual(result.nutrition!.derived, []);
  });
  it('a zero counts only when it comes from the package or the manufacturer, without a modifier', () => {
    const zero = (extra: Record<string, unknown>) => ({ value: 0, unit: 'g', ...extra });
    const fields = [['sugars', 'sugarsG'], ['saturated-fat', 'saturatedFatG'], ['salt', 'saltG'], ['fiber', 'fiberG'], ['proteins', 'proteinG']] as const;
    const value = (name: string, key: string, item: unknown) => mapOpenFoodFactsProduct(offProduct(nutrition({ ...OFF_NUTRIENTS, [name]: item })), BARCODE)!.nutrition!.values[key as 'sugarsG'];
    for (const [name, key] of fields) {
      assert.equal(value(name, key, zero({ source: 'manufacturer' })), 0, name);
      assert.equal(value(name, key, zero({ source: 'packaging' })), 0, name);
      for (const unconfirmed of [{}, { source: 'estimate' }, { source: 'unknown' }, { source: 'manufacturer', modifier: '<' }, { source: 'packaging', modifier: '~' }, { source: 'manufacturer', modifier: '-' }]) {
        assert.equal(value(name, key, zero(unconfirmed)), null, `${name} ${JSON.stringify(unconfirmed)}`);
      }
    }
  });
  const basis = (extra: Record<string, unknown>) => mapOpenFoodFactsProduct(offProduct(extra), BARCODE)!.nutrition!.basis;
  it('OFF categories decide: Coca-Cola, water and milk are beverages, per 100 g is read as per 100 ml', () => {
    const cola = { product_name: 'Coca-Cola', serving_quantity: 250, serving_quantity_unit: 'ml', categories_tags: ['en:beverages-and-beverages-preparations', 'en:beverages', 'en:carbonated-drinks', 'en:sodas', 'en:colas'] };
    assert.equal(basis(cola), 'per_100ml');
    assert.equal(basis({ categories_tags: ['en:beverages', 'en:waters'] }), 'per_100ml');
    assert.equal(basis({ categories_tags: ['en:dairies', 'en:milks'] }), 'per_100ml');
    const mapped = mapOpenFoodFactsProduct(offProduct(cola), BARCODE)!;
    assert.equal(mapped.nutrition!.values.sugarsG, 38, 'values do not change');
    assert.deepEqual(mapped.servingSize, { amount: 250, unit: 'ml' });
  });
  it('oil, sauce, dressing and similar in ml are not beverages', () => {
    const ml = { serving_quantity_unit: 'ml', product_quantity_unit: 'ml' };
    for (const categories of [['en:plant-based-foods-and-beverages', 'en:fats', 'en:vegetable-oils', 'en:olive-oils'], ['en:condiments', 'en:sauces'], ['en:dressings'], ['en:salad-dressings'], ['en:vinegars'], ['en:syrups'], ['en:cooking-creams']]) {
      assert.equal(basis({ ...ml, categories_tags: categories }), 'per_100g', categories.join());
      assert.equal(mapOpenFoodFactsProduct(offProduct({ ...ml, categories_tags: categories }), BARCODE)!.beverage, 'not_beverage');
    }
  });
  it('an exclusion wins over a beverage tag, and a food category is not a beverage', () => {
    assert.equal(basis({ categories_tags: ['en:beverages', 'en:sauces'] }), 'per_100g');
    assert.equal(basis({ product_name: 'Water biscuits', serving_quantity_unit: 'ml', categories_tags: ['en:biscuits'] }), 'per_100g');
  });
  it('categories_hierarchy counts as well', () => {
    assert.equal(basis({ categories_hierarchy: ['en:beverages', 'en:waters'] }), 'per_100ml');
  });
  it('no categories: unknown, the base stays as in OFF, whatever the unit or the name says', () => {
    for (const extra of [{ product_name: 'Неизвестный продукт', serving_quantity_unit: 'ml' }, { product_quantity_unit: 'ml' }, { product_name: 'Coca-Cola', serving_quantity_unit: 'ml' }, { product_name: 'Olive oil', serving_quantity_unit: 'ml' }, {}]) {
      assert.equal(basis(extra), 'per_100g', JSON.stringify(extra));
      assert.equal(mapOpenFoodFactsProduct(offProduct(extra), BARCODE)!.beverage, 'unknown');
    }
  });
  it('the request asks OFF for the categories', () => {
    assert.ok(OFF_REQUEST_FIELDS.includes('categories_tags')); assert.ok(OFF_REQUEST_FIELDS.includes('categories_hierarchy'));
  });
  it('per 100 ml in OFF stays per 100 ml for any product', () => {
    const set = { aggregated_set: { nutrients: OFF_NUTRIENTS, per: '100ml', preparation: 'as_sold' } };
    assert.equal(mapOpenFoodFactsProduct(offProduct({ categories_tags: ['en:sauces'], nutrition: set }), BARCODE)!.nutrition!.basis, 'per_100ml');
  });
  it('a value above zero is not affected by the zero rule', () => {
    const { values } = mapOpenFoodFactsProduct(offProduct(nutrition({ ...OFF_NUTRIENTS, sugars: { value: 3, unit: 'g' } })), BARCODE)!.nutrition!;
    assert.equal(values.sugarsG, 3);
  });
  it('drops database estimates: source estimate and the ~ modifier never become values', () => {
    const estimated = { ...OFF_NUTRIENTS, sugars: { ...OFF_NUTRIENTS.sugars, source: 'estimate' }, salt: { ...OFF_NUTRIENTS.salt, modifier: '~' } };
    const { values } = mapOpenFoodFactsProduct(offProduct(nutrition(estimated)), BARCODE)!.nutrition!;
    assert.equal(values.sugarsG, null); assert.equal(values.saltG, null);
    assert.equal(map().nutrition!.values.sodiumMg, null, 'the fixture sodium is marked ~');
  });
  it('a missing value stays null, a real 0 stays 0, garbage is dropped', () => {
    const { fiber: _fiber, ...rest } = OFF_NUTRIENTS;
    const { values } = mapOpenFoodFactsProduct(offProduct(nutrition({ ...rest, sugars: { ...OFF_NUTRIENTS.sugars, value: 0 },
      fat: { ...OFF_NUTRIENTS.fat, value: -1 }, salt: { ...OFF_NUTRIENTS.salt, value: 'n/a' }, proteins: { ...OFF_NUTRIENTS.proteins, value: 500 } })), BARCODE)!.nutrition!;
    assert.equal(values.fiberG, null); assert.equal(values.sugarsG, 0);
    assert.equal(values.fatG, null); assert.equal(values.saltG, null); assert.equal(values.proteinG, null);
  });
  it('kcal comes from kJ only as a derived value; units convert', () => {
    const { 'energy-kcal': _kcal, ...noKcal } = OFF_NUTRIENTS;
    const result = mapOpenFoodFactsProduct(offProduct(nutrition({ ...noKcal, sodium: { value: 160, unit: 'mg', source: 'manufacturer' } })), BARCODE)!.nutrition!;
    assert.equal(result.values.caloriesKcal, 430); assert.deepEqual(result.derived, ['caloriesKcal']);
    assert.equal(result.values.sodiumMg, 160);
  });
  it('per 100 ml is kept; per serving or prepared sets are not used', () => {
    assert.equal(mapOpenFoodFactsProduct(offProduct(nutrition(OFF_NUTRIENTS, { per: '100ml' })), BARCODE)!.nutrition!.basis, 'per_100ml');
    assert.equal(mapOpenFoodFactsProduct(offProduct(nutrition(OFF_NUTRIENTS, { per: 'serving' })), BARCODE)!.nutrition, null);
    assert.equal(mapOpenFoodFactsProduct(offProduct(nutrition(OFF_NUTRIENTS, { preparation: 'prepared' })), BARCODE)!.nutrition, null);
    assert.equal(mapOpenFoodFactsProduct(offProduct({ nutrition: { aggregated_set: { nutrients: {} } } }), BARCODE)!.nutrition, null);
  });
  it('serving only when explicit: field, serving set or a parsable size; an estimate set is ignored', () => {
    assert.equal(map().servingSize, null);
    assert.deepEqual(map({ serving_quantity: 28, serving_quantity_unit: 'g' }).servingSize, { amount: 28, unit: 'g' });
    assert.deepEqual(map({ serving_size: '30 g' }).servingSize, { amount: 30, unit: 'g' });
    const sets = (source: string) => ({ nutrition: { aggregated_set: offProduct().nutrition.aggregated_set, input_sets: [{ per: 'serving', per_quantity: 15, per_unit: 'g', source }] } });
    assert.deepEqual(map(sets('manufacturer')).servingSize, { amount: 15, unit: 'g' });
    assert.equal(map(sets('estimate')).servingSize, null);
    assert.equal(map({ serving_size: 'one piece' }).servingSize, null);
  });
  it('ingredients split at the top level and prefer Russian text', () => {
    const names = map().ingredients!.map((item) => item.name);
    assert.deepEqual(names, ['мука пшеничная', 'сахар', 'шоколадная глазурь (какао-масло, эмульгатор)', 'яйца']);
    assert.ok(map().ingredients!.every((item) => item.percent === null));
    assert.equal(map({ ingredients_text_ru: 'сахар' }).ingredients!.length, 1);
    assert.equal(map({ ingredients_text: '  ' }).ingredients, null);
  });
  it('allergens and additives map to our codes; empty lists mean unknown, never none', () => {
    const { allergens, additives } = map();
    assert.deepEqual(allergens!.map((a) => [a.code, a.presence]), [['gluten', 'contains'], ['eggs', 'contains'], ['milk', 'contains'], ['soy', 'may_contain']]);
    assert.ok(allergens!.every((a) => a.provenance === 'open_food_facts'));
    assert.deepEqual(additives!.map((a) => a.code), ['E322', 'E476']);
    const empty = map({ allergens_tags: [], traces_tags: [], additives_tags: [] });
    assert.equal(empty.allergens, null); assert.equal(empty.additives, null);
    assert.equal(map({ allergens_tags: ['en:unknown-thing'], traces_tags: [] }).allergens, null);
  });
  it('Nutri-Score is not read; NOVA stays as a fact about processing', () => {
    const mapped = map({ nutriscore_score: 25, nutriscore_grade: 'e', nova_group: 4 });
    for (const term of ['nutriscore', '"grade"']) assert.ok(!JSON.stringify(mapped).includes(term), term);
    assert.equal(mapped!.nova, 4);
  });
  it('no product → null', () => {
    assert.equal(mapOpenFoodFactsProduct(undefined, BARCODE), null);
  });
});

describe('OpenFoodFactsProductLookupProvider (stubbed HTTP)', () => {
  const provider = (transport: () => Promise<Response>, now?: () => number) => {
    const calls: { url: string; init: RequestInit }[] = [];
    const lookup = new OpenFoodFactsProductLookupProvider({ contact: 'unit-contact', ...(now ? { now } : {}),
      fetch: (async (url: unknown, init: RequestInit) => { calls.push({ url: String(url), init }); return transport(); }) as typeof fetch });
    return { lookup, calls };
  };
  const fails = async (lookup: OpenFoodFactsProductLookupProvider, code: string) =>
    assert.rejects(lookup.lookup(BARCODE), (error: unknown) => error instanceof OpenFoodFactsError && error.code === code);

  it('makes one read-only v3.6 GET by exact barcode with the custom User-Agent, timeout and no credentials', async () => {
    const { lookup, calls } = provider(async () => offFound());
    const result = await lookup.lookup(BARCODE);
    assert.equal(result!.provider, 'open_food_facts'); assert.equal(calls.length, 1);
    const { url, init } = calls[0]!;
    assert.ok(url.startsWith(`https://world.openfoodfacts.org/api/v3.6/product/${BARCODE}.json?fields=`), url);
    assert.ok(!url.includes('search'));
    assert.equal(init.method, 'GET'); assert.equal(init.body, undefined);
    assert.equal(new Headers(init.headers).get('user-agent'), 'FoodLens/0.1.0 (unit-contact)');
    assert.ok(init.signal instanceof AbortSignal);
  });
  it('404 → null, without an error', async () => {
    assert.equal(await provider(async () => offNotFound()).lookup.lookup(BARCODE), null);
  });
  it('429, 503, network failure and bad JSON raise a typed error, which never contains the transport text', async () => {
    await fails(provider(async () => new Response('', { status: 429 })).lookup, 'rate_limited');
    await fails(provider(async () => new Response('', { status: 503 })).lookup, 'unavailable');
    await fails(provider(async () => { throw new Error('socket'); }).lookup, 'unavailable');
    await fails(provider(async () => new Response('<html>')).lookup, 'invalid_response');
  });
  it('after a 429 the base is not asked again for a minute', async () => {
    let time = 0;
    const { lookup, calls } = provider(async () => new Response('', { status: 429 }), () => time);
    await fails(lookup, 'rate_limited'); await fails(lookup, 'rate_limited');
    assert.equal(calls.length, 1);
    time = 60_001;
    await fails(lookup, 'rate_limited');
    assert.equal(calls.length, 2);
  });
  it('stays under the official 15 requests per minute', async () => {
    let time = 0;
    const { lookup, calls } = provider(async () => offNotFound(), () => time);
    for (let i = 0; i < OPEN_FOOD_FACTS_MAX_PER_MINUTE; i++) await lookup.lookup(BARCODE);
    await fails(lookup, 'rate_limited');
    assert.equal(calls.length, OPEN_FOOD_FACTS_MAX_PER_MINUTE); assert.ok(OPEN_FOOD_FACTS_MAX_PER_MINUTE < 15);
    time = 60_001;
    assert.equal(await lookup.lookup(BARCODE), null);
  });
});

describe('CachedProductLookupProvider', () => {
  const result = { barcode: BARCODE } as ProductLookupResult;
  function counting(answer: () => Promise<ProductLookupResult | null>) {
    let time = 0;
    const counter = { calls: 0, advance: (ms: number) => { time += ms; } };
    const inner: ProductLookupProvider = { name: 'inner', lookup: () => (counter.calls++, answer()) };
    return { counter, cached: new CachedProductLookupProvider(inner, () => time) };
  }
  it('a repeat analysis of a barcode does not go to the network until the TTL ends', async () => {
    const { counter, cached } = counting(async () => result);
    assert.equal(await cached.lookup(BARCODE), result);
    assert.equal(await cached.lookup(BARCODE), result);
    assert.equal(counter.calls, 1);
    counter.advance(LOOKUP_FOUND_TTL_MS + 1);
    await cached.lookup(BARCODE);
    assert.equal(counter.calls, 2);
  });
  it('not found is cached for a shorter time', async () => {
    const { counter, cached } = counting(async () => null);
    await cached.lookup(BARCODE); await cached.lookup(BARCODE);
    assert.equal(counter.calls, 1);
    counter.advance(LOOKUP_NOT_FOUND_TTL_MS + 1);
    await cached.lookup(BARCODE);
    assert.equal(counter.calls, 2);
  });
  it('errors are not cached; concurrent lookups share one request', async () => {
    const failing = counting(async () => { throw new Error('down'); });
    await assert.rejects(failing.cached.lookup(BARCODE)); await assert.rejects(failing.cached.lookup(BARCODE));
    assert.equal(failing.counter.calls, 2);
    const shared = counting(async () => result);
    await Promise.all([shared.cached.lookup(BARCODE), shared.cached.lookup(BARCODE)]);
    assert.equal(shared.counter.calls, 1);
  });
});
