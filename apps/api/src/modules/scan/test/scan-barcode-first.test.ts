import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Logger } from '@nestjs/common';
import { MockProvider, type AIProvider, type DiscoveredSource, type SourceDiscoveryInput } from '@foodlens/ai';
import { NOT_DETECTED, observed, type NutritionFacts, type Product } from '@foodlens/core';
import { scoreProduct } from '@foodlens/scoring';
import { eatHealthierPlan } from '../../goal-match/test/goal-match-v4.fixtures';
import type { GoalMatchService } from '../../goal-match/goal-match.service';
import type { NutritionTargetsService } from '../../nutrition-targets/nutrition-targets.service';
import { CachedProductLookupProvider } from '../../product-lookup/cached-product-lookup.provider';
import { GeminiSearchProductLookupProvider, type NutritionSearcher } from '../../product-lookup/gemini-search-lookup.provider';
import { MultiSourceProductLookup } from '../../product-lookup/multi-source-product-lookup';
import { mapOpenFoodFactsProduct } from '../../product-lookup/open-food-facts.mapper';
import type { ProductLookupResult } from '../../product-lookup/product-lookup.provider';
import { BARCODE, offProduct, OFF_NUTRIENTS } from '../../product-lookup/test/open-food-facts.fixtures';
import { semanticsFromIngredients } from '../barcode-product';
import { ScanService } from '../scan.service';

// AI, Open Food Facts, поиск и страницы подставные: тест не выходит в сеть.
Logger.overrideLogger(false);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const FILE = { mimetype: 'image/jpeg', buffer: JPEG, size: JPEG.length };
const plans = { findPlanForUser: async () => eatHealthierPlan() } as unknown as NutritionTargetsService;

const { sugars: _s, 'saturated-fat': _f, salt: _a, sodium: _n, ...offMacros } = OFF_NUTRIENTS;
const nutrients = (values: Record<string, unknown>) => offProduct({ nutrition: { aggregated_set: { nutrients: values, per: '100g', preparation: 'as_sold' } } });
const offComplete = () => mapOpenFoodFactsProduct(offProduct(), BARCODE)!;
const offPartial = () => mapOpenFoodFactsProduct(nutrients(offMacros), BARCODE)!;

interface Facts { title?: string; barcode?: string | null; kcal?: number; protein?: number; carbs?: number; fat?: number; sugars?: number; saturated?: number; salt?: number }
function html({ title = 'Чокопай Lotte', barcode = BARCODE, kcal = 430, protein = 4.5, carbs = 63, fat = 18, sugars = 38, saturated = 9, salt = 0.4 }: Facts = {}): string {
  return `<title>${title}</title><p>${barcode ? `Штрихкод: ${barcode}.` : ''} Состав: сахар, арахис, какао-масло, эмульгатор лецитин. Пищевая ценность на 100 г: ${kcal} ккал, белки ${protein} г, углеводы ${carbs} г, в т.ч. сахара ${sugars} г, жиры ${fat} г, в т.ч. насыщенные ${saturated} г, соль ${salt} г</p>`;
}
const SNICKERS = { title: 'Snickers лесной орех', barcode: BARCODE, kcal: 510, protein: 7.3, carbs: 55, fat: 28, sugars: 48, saturated: 10, salt: 0.37 };

async function labelProduct(overrides: Partial<NutritionFacts> = {}, identity: Partial<Product> = {}): Promise<Product> {
  const base = await new MockProvider().analyzeProduct({ kind: 'image', image: { mimeType: 'image/jpeg', base64: 'AA' } });
  return { ...base, brand: observed('Lotte'), name: observed('Чокопай'), ...identity, nutrition: {
    basis: 'per_100g', servingSize: NOT_DETECTED, caloriesKcal: observed(430), proteinG: observed(4.5), carbsG: observed(63), fatG: observed(18),
    sugarsG: NOT_DETECTED, saturatedFatG: NOT_DETECTED, fiberG: NOT_DETECTED, saltG: NOT_DETECTED, sodiumMg: NOT_DETECTED, ...overrides,
  } };
}
const snickersLabel = () => labelProduct({ caloriesKcal: observed(514), proteinG: observed(7.5), carbsG: observed(56), fatG: observed(28.6) }, { brand: observed('Snickers'), name: observed('Snickers лесной орех') });

interface Setup { off?: ProductLookupResult | null; pages?: Readonly<Record<string, string>>; label?: Product; aiError?: Error }
function setup({ off = null, pages = {}, label, aiError }: Setup) {
  const calls = { ai: 0, off: [] as (string | null)[], search: [] as SourceDiscoveryInput[], inputs: [] as any[] };
  const logs: { message: string; fields: any }[] = [];
  const logger = { log: (message: string, fields: unknown) => logs.push({ message, fields }), warn: (message: string, fields: unknown) => logs.push({ message, fields }) };
  const ai = { name: 'stub', analyzeProduct: async (input: unknown) => {
    calls.ai++;
    calls.inputs.push(input);
    if (aiError) throw aiError;
    return label ?? await labelProduct();
  } } as unknown as AIProvider;
  const searcher: NutritionSearcher = {
    discoverSources: async (input) => {
      calls.search.push(input);
      return { sources: Object.keys(pages).map((domain): DiscoveredSource => ({ url: `https://${domain}/p`, title: domain, domain })), webSearchQueries: 1 };
    },
    extractNutrition: async () => [],
  };
  const reader = { fetchPage: async (url: string) => {
    const domain = new URL(url).hostname;
    return { finalUrl: url, domain, contentType: 'text/html', body: pages[domain]! };
  } };
  const web = new CachedProductLookupProvider(new GeminiSearchProductLookupProvider(searcher, reader, logger));
  const lookups = new MultiSourceProductLookup([{ name: 'open_food_facts', lookup: async (barcode) => (calls.off.push(barcode), off) }, web]);
  const service = new ScanService(ai, plans, undefined, lookups);
  const verdicts = () => logs.filter((line) => line.message === 'web_lookup').map((line) => line.fields);
  return { service, calls, verdicts };
}
async function flow(run: () => Promise<unknown>) {
  const lines: string[] = [];
  const capture = (message: unknown) => { lines.push(String(message)); };
  Logger.overrideLogger({ log: capture, warn: capture, error: capture, debug: capture, verbose: capture });
  try {
    await run();
  } finally {
    Logger.overrideLogger(false);
  }
  return JSON.parse(lines.find((line) => line.startsWith('scan_flow '))!.slice('scan_flow '.length));
}

describe('Barcode-first scan: which steps run', () => {
  it('1. barcode + OFF complete: Gemini is not called, even with a photo', async () => {
    const { service, calls } = setup({ off: offComplete() });
    const result = await service.analyze(FILE, 'user', { barcode: BARCODE });
    assert.equal(calls.ai, 0); assert.equal(calls.search.length, 0);
    assert.notEqual(result.score.value, null);
  });
  it('2. barcode + OFF partial + Tavily completes: Gemini is not called', async () => {
    const { service, calls } = setup({ off: offPartial(), pages: { 'ozon.ru': html() } });
    const result = await service.analyze(undefined, 'user', { barcode: BARCODE });
    assert.equal(calls.ai, 0); assert.equal(calls.search.length, 1);
    assert.equal(result.product.nutrition!.sugarsG.value, 38);
    assert.equal(result.product.nutrition!.sugarsG.provenance, 'web_search');
    assert.notEqual(result.score.value, null);
    assert.equal('needsPhoto' in result, false);
  });
  it('3. barcode + OFF and Tavily incomplete: Gemini fallback runs on the photo, the label stays first', async () => {
    const { service, calls } = setup({ off: offPartial() });
    const result = await service.analyze(FILE, 'user', { barcode: BARCODE });
    assert.equal(calls.ai, 1);
    assert.equal(result.product.nutrition!.proteinG.provenance, 'observed');
    assert.equal(result.product.nutrition!.fiberG.provenance, 'open_food_facts');
    assert.equal(calls.off.length, 1, 'OFF is asked once');
  });
  it('4. no barcode: the photo flow, OFF is skipped', async () => {
    const { service, calls } = setup({ off: offComplete() });
    await service.analyze(FILE, 'user', {});
    assert.equal(calls.ai, 1); assert.deepEqual(calls.off, []);
  });
  it('scan_flow says which path ran and why', async () => {
    const complete = setup({ off: offComplete() });
    assert.deepEqual(await flow(() => complete.service.analyze(FILE, 'user', { barcode: BARCODE })).then(({ offHit, tavilyUsed, geminiCalled, geminiReason }) => ({ offHit, tavilyUsed, geminiCalled, geminiReason })),
      { offHit: true, tavilyUsed: false, geminiCalled: false, geminiReason: 'not_needed' });
    const fallback = setup({ off: offPartial() });
    const line = await flow(() => fallback.service.analyze(FILE, 'user', { barcode: BARCODE }));
    assert.deepEqual([line.geminiCalled, line.geminiReason, line.tavilyUsed], [true, 'missing_critical', true]);
    const nothing = setup({});
    assert.equal((await flow(() => nothing.service.analyze(FILE, 'user', { barcode: BARCODE }))).geminiReason, 'not_found');
    const noPhoto = setup({});
    assert.deepEqual(await flow(() => noPhoto.service.analyze(undefined, 'user', { barcode: BARCODE })).then((item) => [item.geminiCalled, item.geminiReason, item.needsPhoto]), [false, 'no_photo', true]);
  });
});

describe('Barcode-first scan: without a photo', () => {
  it('5. exact barcode trusted nutrition gives Product Score from the existing formula', async () => {
    const { service } = setup({ off: offComplete() });
    const result = await service.analyze(undefined, 'user', { barcode: BARCODE });
    assert.equal(typeof result.score.value, 'number');
    assert.deepEqual(result.score, scoreProduct(result.product));
    assert.equal(result.product.name.value, 'Чокопай');
    assert.equal(result.product.confidence.identity, 'high');
    assert.notEqual(result.product.confidence.overall, 'high', 'database values do not give high confidence');
    assert.equal(result.barcode, BARCODE);
  });
  it('6. exact barcode trusted nutrition gives Goal Match', async () => {
    const { service } = setup({ off: offComplete() });
    assert.equal(typeof (await service.analyze(undefined, 'user', { barcode: BARCODE })).goalMatch.value, 'number');
  });
  it('7. no serving: the existing 100 g estimate', async () => {
    const { service } = setup({ off: offComplete() });
    const { goalMatch, product } = await service.analyze(undefined, 'user', { barcode: BARCODE });
    assert.equal(product.nutrition!.servingSize.value, null);
    assert.equal(goalMatch.portion!.basis, 'per_100'); assert.equal(goalMatch.portion!.amount, 100);
  });
  it('missing ingredients retain a numeric Goal Match with semantic uncertainty', async () => {
    const off = { ...offComplete(), ingredients: null, allergens: null, additives: null };
    const { service, calls } = setup({ off });
    const result = await service.analyze(undefined, 'user', { barcode: BARCODE });
      assert.notEqual(result.score.value, null); assert.equal(typeof result.goalMatch.value, 'number');
      assert.equal(result.goalMatch.unavailableReason, null); assert.equal('needsPhoto' in result, false);
      assert.ok(result.goalMatch.version === 'goal-match-v3');
      assert.equal(result.goalMatch.confidence, 'low');
      assert.ok(result.goalMatch.uncertainty.includes('sugarSource'));
      assert.ok(result.goalMatch.uncertainty.includes('processing'));
      assert.equal(result.product.semantics!.sugarSource.value, 'unknown');
    assert.equal(calls.ai, 0);
  });
  it('with a photo and no ingredients the label supplies what Goal Match needs', async () => {
    const off = { ...offComplete(), ingredients: null, allergens: null, additives: null };
    const { service, calls } = setup({ off });
    const line = await flow(() => service.analyze(FILE, 'user', { barcode: BARCODE }));
    assert.equal(calls.ai, 1); assert.equal(line.geminiReason, 'no_ingredients');
  });
  it('semantics come from the ingredient list, never invented', () => {
    const product = (names: readonly string[] | null, sugars = 10) => ({ ingredients: { value: names?.map((name) => ({ name, percent: null })) ?? null }, nutrition: { sugarsG: { value: sugars } } }) as unknown as Product;
    const read = (item: Product) => { const { sugarSource, processing } = semanticsFromIngredients(item); return [sugarSource.value, processing.value, sugarSource.confidence]; };
    assert.deepEqual(read(product(['сахар', 'какао', 'эмульгатор лецитин'])), ['added', 'ultra_processed', 'medium']);
    assert.deepEqual(read(product(['молоко', 'закваска'])), ['intrinsic', 'whole_or_minimal', 'medium']);
    assert.deepEqual(read(product(['вода', 'соль', 'огурцы'], 0)), ['none', 'processed', 'medium']);
    assert.deepEqual(read(product(null)), ['unknown', 'unknown', 'low']);
  });
  it('ingredients on an accepted page are kept for the product', async () => {
    const { service } = setup({ pages: { 'snickers.ru': html(SNICKERS) } });
    const { product, goalMatch } = await service.analyze(undefined, 'user', { barcode: BARCODE });
    assert.equal(product.ingredients.provenance, 'web_search'); assert.equal(product.ingredients.value![0]!.name, 'сахар');
    assert.equal(typeof goalMatch.value, 'number');
  });
  it('nothing found and no photo: 200, no invented data, a flag that a photo would help', async () => {
    const { service, calls } = setup({});
    const result = await service.analyze(undefined, 'user', { barcode: BARCODE });
    assert.equal(calls.ai, 0);
    assert.equal(result.needsPhoto, true); assert.equal(result.score.value, null);
    assert.equal(result.score.unscoredReason, 'no_nutrition'); assert.equal(result.product.name.value, null);
    assert.equal(result.barcode, BARCODE);
  });
  it('partial data and no photo: what was found is returned with the flag', async () => {
    const { service } = setup({ off: offPartial() });
    const result = await service.analyze(undefined, 'user', { barcode: BARCODE });
    assert.equal(result.needsPhoto, undefined); assert.equal(result.product.name.value, 'Чокопай'); assert.equal(result.product.nutrition!.proteinG.value, 4.5);
  });
  it('no barcode and no photo is still IMAGE_MISSING', async () => {
    await assert.rejects(setup({}).service.analyze(undefined, 'user', {}), { code: 'IMAGE_MISSING' });
    await assert.rejects(setup({}).service.analyze(undefined, 'user', { barcode: 'bad' }), { code: 'IMAGE_MISSING' });
  });
  it('a failed photo fallback keeps the barcode data', async () => {
    const { service } = setup({ off: offPartial(), aiError: new Error('down') });
    const result = await service.analyze(FILE, 'user', { barcode: BARCODE });
    assert.equal(result.product.name.value, 'Чокопай'); assert.equal(result.needsPhoto, undefined);
    await assert.rejects(setup({ aiError: new Error('down') }).service.analyze(FILE, 'user', { barcode: BARCODE }));
  });
});

describe('Web verification against OFF macros', () => {
  it('8. wrong variant is rejected even with matching macros', async () => {
    const off = { ...offPartial(), name: 'Snickers лесной орех', brand: 'Snickers' };
    const { service, verdicts } = setup({ off, pages: { 'snickers.ru': html({ title: 'Snickers Super', barcode: null }) } });
    const result = await service.analyze(undefined, 'user', { barcode: BARCODE });
    assert.notEqual(result.score.value, null); assert.equal(typeof result.score.value, 'number');
    assert.equal(verdicts()[0].pages[0].reason, 'variant_mismatch');
  });
  it('9. same barcode, other macros: recipe_version_conflict, nothing is used', async () => {
    const { service, verdicts } = setup({ off: offPartial(), pages: { 'ozon.ru': html({ carbs: 70.5, fat: 16.1 }) } });
    const result = await service.analyze(undefined, 'user', { barcode: BARCODE });
    assert.equal(result.product.nutritionMetadata!.fields.sugarsG.quality, 'estimated');
    assert.equal(verdicts()[0].status, 'recipe_version_conflict');
  });
  it('10. provenance is preserved per field', async () => {
    const { service } = setup({ off: offPartial(), pages: { 'ozon.ru': html() } });
    const { product } = await service.analyze(undefined, 'user', { barcode: BARCODE });
    assert.equal(product.nutrition!.proteinG.provenance, 'open_food_facts');
    assert.equal(product.nutrition!.sugarsG.provenance, 'web_search');
    const evidence = product.fieldEvidence!.find((item) => item.field === 'sugarsG')!;
    assert.deepEqual([evidence.domain, evidence.tier, evidence.identityMatch, evidence.url], ['ozon.ru', 2, 'exact_barcode', 'https://ozon.ru/p']);
  });
});

describe('Web verification with no reference macros', () => {
  it('a retailer page with the barcode alone is not enough', async () => {
    const { service, verdicts } = setup({ pages: { 'ozon.ru': html(SNICKERS) } });
    const result = await service.analyze(undefined, 'user', { barcode: BARCODE });
    assert.equal(typeof result.score.value, 'number'); assert.equal(result.product.nutritionMetadata!.basis.quality, 'estimated');
    assert.equal(verdicts()[0].pages[0].reason, 'needs_second_source');
  });
  it('the search has only the barcode to go on', async () => {
    const { service, calls } = setup({ pages: { 'ozon.ru': html(SNICKERS) } });
    await service.analyze(undefined, 'user', { barcode: BARCODE });
    assert.deepEqual(calls.search[0], { barcode: BARCODE, brand: null, name: null, serving: null });
  });
  it('two independent pages with the barcode and the same values are enough, macros included', async () => {
    const { service, calls } = setup({ pages: { 'ozon.ru': html(SNICKERS), 'vprok.ru': html({ ...SNICKERS, sugars: 48.2 }) } });
    const { product, score } = await service.analyze(undefined, 'user', { barcode: BARCODE });
    assert.equal(calls.ai, 0);
    assert.equal(product.nutrition!.caloriesKcal.value, 510); assert.equal(product.nutrition!.sugarsG.value, 48);
    assert.equal(product.nutrition!.saltG.provenance, 'web_search');
    assert.equal(product.name.value, 'Snickers лесной орех');
    assert.equal(product.fieldEvidence![0]!.identityMatch, 'two_sources');
    assert.notEqual(score.value, null);
  });
  it('two pages with different macros: nothing is used', async () => {
    const { service } = setup({ pages: { 'ozon.ru': html(SNICKERS), 'vprok.ru': html({ ...SNICKERS, kcal: 300, fat: 10 }) } });
    const { product } = await service.analyze(undefined, 'user', { barcode: BARCODE });
    assert.equal(product.nutrition, null);
  });
  it('the manufacturer page with the exact barcode is enough alone', async () => {
    const { service } = setup({ pages: { 'snickers.ru': html(SNICKERS) } });
    const { product, score } = await service.analyze(undefined, 'user', { barcode: BARCODE });
    assert.equal(product.nutrition!.sugarsG.value, 48); assert.notEqual(score.value, null);
    assert.equal(product.fieldEvidence![0]!.identityMatch, 'exact_barcode');
  });
  it('no barcode on the page, a weak source or too few macros: rejected', async () => {
    const reasons = async (pages: Readonly<Record<string, string>>) => {
      const { service, verdicts } = setup({ pages });
      await service.analyze(undefined, 'user', { barcode: BARCODE });
      return verdicts()[0].pages[0].reason;
    };
    assert.equal(await reasons({ 'snickers.ru': html({ ...SNICKERS, barcode: null }) }), 'no_reference_without_barcode');
    assert.equal(await reasons({ 'kalorii.example': html(SNICKERS) }), 'needs_second_source');
    assert.equal(await reasons({ 'snickers.ru': `<title>Snickers</title><p>${BARCODE}. На 100 г: белки 7 г, сахара 48 г</p>` }), 'too_few_macros_on_page');
  });
});

describe('Goal Match for eat_healthier stays within Product Score', () => {
  const roshen = () => mapOpenFoodFactsProduct(nutrients({ ...offMacros, 'energy-kcal': { ...OFF_NUTRIENTS['energy-kcal'], value: 456 }, sugars: { ...offMacros.carbohydrates, value: 58.6 }, 'saturated-fat': { ...offMacros.fat, value: 11.2 }, salt: { ...offMacros.fat, value: 0.01 }, proteins: { ...offMacros.proteins, value: 3.3 } }), BARCODE)!;
  it('the reconciled v4 value is limited by a lower Product Score', async () => {
    const lookups = new MultiSourceProductLookup([{ name: 'open_food_facts', lookup: async () => roshen() }]);
    const goalMatch = { version: 'goal-match-v4', goal: 'eat_healthier', state: 'goal_match', value: 3.5, level: 'poor', range: null, source: 'ai' };
    const v4 = { enabled: true, evaluate: async () => ({ goalMatch, outcome: 'ai_accepted', aiCalls: 1, cacheHit: false }) } as unknown as GoalMatchService;
    const result = await new ScanService({ name: 'stub' } as unknown as AIProvider, plans, v4, lookups).analyze(undefined, 'user', { barcode: BARCODE });
    assert.ok(result.score.value! < 3.5);
    assert.equal(result.goalMatch.value, result.score.value);
  });
});

describe('Barcode from a gallery photo', () => {
  const bwip = require('bwip-js') as { toBuffer(options: Record<string, unknown>): Promise<Buffer> };
  const photo = async (code: string) => {
    const buffer = await bwip.toBuffer({ bcid: 'ean13', text: code, scale: 3, height: 20, includetext: false, backgroundcolor: 'FFFFFF', paddingwidth: 20, paddingheight: 20 });
    return { mimetype: 'image/png', buffer, size: buffer.length };
  };
  it('a photo with a barcode goes the barcode-first way: OFF, no Gemini', async () => {
    const { service, calls } = setup({ off: { ...offComplete(), barcode: '5449000054227' } });
    const result = await service.analyze(await photo('5449000054227'), 'user', {});
    assert.deepEqual(calls.off, ['5449000054227']); assert.equal(calls.ai, 0);
    assert.equal(result.barcode, '5449000054227'); assert.notEqual(result.score.value, null);
  });
  it('the camera code is kept, the photo is not even read', async () => {
    const { service, calls } = setup({ off: offComplete() });
    const result = await service.analyze(await photo('5449000054227'), 'user', { barcode: BARCODE });
    assert.deepEqual(calls.off, [BARCODE]); assert.equal(result.barcode, BARCODE);
  });
  it('a photo without a barcode stays the photo flow', async () => {
    const { service, calls } = setup({ off: offComplete() });
    const result = await service.analyze(FILE, 'user', {});
    assert.deepEqual(calls.off, []); assert.equal(calls.ai, 1); assert.equal('barcode' in result, false);
  });
  it('the log says where the code came from, with no image data', async () => {
    const lines: string[] = [];
    const capture = (message: unknown) => { lines.push(String(message)); };
    const { service } = setup({ off: offComplete() });
    const image = await photo('5449000054227');
    Logger.overrideLogger({ log: capture, warn: capture, error: capture, debug: capture, verbose: capture });
    try {
      await service.analyze(image, 'user', {});
    } finally {
      Logger.overrideLogger(false);
    }
    const line = JSON.parse(lines.find((item) => item.startsWith('barcode_source '))!.slice('barcode_source '.length));
    assert.deepEqual([line.source, line.barcode], ['image', '5449000054227']);
    assert.equal(typeof line.decodeMs, 'number');
    assert.ok(!lines.join('\n').includes(image.buffer.toString('base64').slice(0, 40)));
  });
});

describe('Gemini only on content photos', () => {
  const png = (seed: number) => {
    const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, seed]);
    return { mimetype: 'image/png', buffer, size: buffer.length };
  };
  const product = () => ({ ...FILE });
  it('barcode-only photo + OFF complete: 0 Gemini calls', async () => {
    const { service, calls } = setup({ off: offComplete() });
    const line = await flow(() => service.analyze(product(), 'user', { barcode: BARCODE, roles: ['product'] }));
    assert.equal(calls.ai, 0);
    assert.deepEqual([line.geminiCalled, line.geminiReason, line.geminiImages], [false, 'not_needed', 0]);
  });
  it('barcode-only photo + OFF incomplete: 0 Gemini calls, the answer asks for a nutrition photo', async () => {
    const { service, calls } = setup({ off: offPartial() });
    const result = await service.analyze(product(), 'user', { barcode: BARCODE, roles: ['product'] });
    assert.equal(calls.ai, 0); assert.equal(result.needsPhoto, undefined);
    assert.equal(result.product.name.value, 'Чокопай');
    const again = setup({ off: offPartial() });
    const line = await flow(() => again.service.analyze(product(), 'user', { barcode: BARCODE, roles: ['product'] }));
    assert.deepEqual([line.geminiCalled, line.geminiReason, line.needsPhoto], [false, 'needs_nutrition_photo', false]);
  });
  it('a barcode found on the photo itself and nothing else: the same, without Gemini', async () => {
    const lookups = new MultiSourceProductLookup([{ name: 'open_food_facts', lookup: async () => offPartial() }]);
    let ai = 0;
    const provider = { name: 'stub', analyzeProduct: async () => { ai++; return labelProduct(); } } as unknown as AIProvider;
    const result = await new ScanService(provider, plans, undefined, lookups, async () => '5449000022431').analyze(product(), 'user', { roles: ['product'] });
    assert.equal(ai, 0); assert.equal(result.barcode, '5449000022431'); assert.equal(result.needsPhoto, true);
  });
  it('barcode + nutrition photo: 1 Gemini call with only that photo', async () => {
    const { service, calls } = setup({ off: offPartial() });
    await service.analyze([product(), png(1)], 'user', { barcode: BARCODE, roles: ['product', 'nutrition'] });
    assert.equal(calls.ai, 1);
    assert.deepEqual(calls.inputs[0].images.map((image: { role: string }) => image.role), ['nutrition']);
  });
  it('barcode + ingredients photo: Gemini gets only that photo', async () => {
    const { service, calls } = setup({ off: offPartial() });
    await service.analyze([product(), png(2)], 'user', { barcode: BARCODE, roles: ['product', 'ingredients'] });
    assert.equal(calls.ai, 1);
    assert.deepEqual(calls.inputs[0].images.map((image: { role: string }) => image.role), ['ingredients']);
  });
  it('the only content photo with a role may go alone: no product photo is added', async () => {
    const { service, calls } = setup({ off: offPartial() });
    const line = await flow(() => service.analyze(product(), 'user', { barcode: BARCODE, roles: ['nutrition'] }));
    assert.equal(calls.ai, 1); assert.deepEqual([line.geminiCalled, line.geminiImages], [true, 1]);
  });
  it('no barcode: the usual Gemini flow, the product role changes nothing for the provider', async () => {
    const { service, calls } = setup({ off: offComplete() });
    await service.analyze(product(), 'user', { roles: ['product'] });
    assert.equal(calls.ai, 1);
    assert.equal(calls.inputs[0].images, undefined);
    assert.equal(calls.inputs[0].image.role, undefined);
  });
  it('Tavily fills the gaps: no Gemini', async () => {
    const { service, calls } = setup({ off: offPartial(), pages: { 'ozon.ru': html() } });
    const result = await service.analyze(product(), 'user', { barcode: BARCODE, roles: ['product'] });
    assert.equal(calls.ai, 0); assert.notEqual(result.score.value, null);
  });
  it('an old client without roles: the photo is still content', async () => {
    const { service, calls } = setup({ off: offPartial() });
    await service.analyze(product(), 'user', { barcode: BARCODE });
    assert.equal(calls.ai, 1);
  });
});

describe('Regressions', () => {
  it('12. Snickers: a score from the barcode alone, without reading sugars from a photo', async () => {
    const { service, calls } = setup({ pages: { 'snickers.ru': html(SNICKERS) } });
    const { product, score } = await service.analyze(FILE, 'user', { barcode: BARCODE });
    assert.equal(calls.ai, 0);
    assert.deepEqual([product.nutrition!.sugarsG.value, product.nutrition!.saturatedFatG.value, product.nutrition!.saltG.value], [48, 10, 0.37]);
    assert.equal(typeof score.value, 'number');
  });
  it('12. Snickers: the regular recipe is rejected once the label is read, and the label wins', async () => {
    const regular = { ...SNICKERS, kcal: 496, carbs: 58, fat: 25 };
    const { service, calls, verdicts } = setup({ pages: { 'ozon.ru': html(regular) }, label: await snickersLabel() });
    const { product } = await service.analyze(FILE, 'user', { barcode: BARCODE });
    assert.equal(calls.ai, 1); assert.equal(calls.search.length, 1, 'the pages found earlier are checked against the label, without a new search');
    assert.equal(product.nutrition!.fatG.value, 28.6); assert.equal(product.nutritionMetadata!.fields.sugarsG.quality, 'estimated');
    assert.equal(verdicts().at(-1).status, 'recipe_version_conflict');
  });
  it('12. Snickers: with the label read, a matching page with the barcode fills the gaps', async () => {
    const { service, calls } = setup({ pages: { 'ozon.ru': html(SNICKERS) }, label: await snickersLabel() });
    const { product, score } = await service.analyze(FILE, 'user', { barcode: BARCODE });
    assert.equal(calls.ai, 1);
    assert.equal(product.nutrition!.sugarsG.value, 48); assert.equal(product.nutrition!.fatG.value, 28.6);
    assert.notEqual(score.value, null);
  });
  it('13. Choco Pie: OFF with another recipe is dropped when the label is read, and web values checked against it go too', async () => {
    const wrongMacros = { ...offMacros, 'energy-kcal': OFF_NUTRIENTS['energy-kcal'], carbohydrates: { ...offMacros.carbohydrates, value: 70.5 }, fat: { ...offMacros.fat, value: 16.1 } };
    const off = mapOpenFoodFactsProduct(nutrients(wrongMacros), BARCODE)!;
    const page = html({ carbs: 70.5, fat: 16.1, saturated: 8 }).replace(/, соль [\d.,]+ г/, '');
    const { service, calls, verdicts } = setup({ off, pages: { 'ozon.ru': page } });
    const { product, score } = await service.analyze(FILE, 'user', { barcode: BARCODE });
    assert.equal(calls.ai, 1, 'salt is still missing, so the label is read');
    assert.deepEqual([product.nutrition!.carbsG.value, product.nutrition!.fatG.value], [63, 18]);
    assert.equal(product.nutritionMetadata!.fields.sugarsG.quality, 'estimated');
    assert.notEqual(score.value, null); assert.equal(typeof score.value, 'number');
    assert.equal(verdicts().at(-1).status, 'recipe_version_conflict');
  });
  it('the second pass reuses the search when the macros are the same', async () => {
    const { service, calls } = setup({ off: offPartial(), pages: { 'ozon.ru': html().replace(/, соль [\d.,]+ г/, '') } });
    await service.analyze(FILE, 'user', { barcode: BARCODE });
    assert.equal(calls.ai, 1); assert.equal(calls.search.length, 1);
  });
  it('with a label read at most two searches run per scan', async () => {
    const { service, calls } = setup({ pages: { 'ozon.ru': html(SNICKERS) }, label: await snickersLabel() });
    await service.analyze(FILE, 'user', { barcode: BARCODE });
    assert.ok(calls.search.length <= 2);
  });
});
