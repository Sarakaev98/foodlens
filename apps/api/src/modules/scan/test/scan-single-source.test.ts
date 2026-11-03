import { sourceEvidenceView } from './source-evidence-view';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { Logger } from '@nestjs/common';
import type { AIProvider, DiscoveredSource } from '@foodlens/ai';
import { eatHealthierPlan } from '../../goal-match/test/goal-match-v4.fixtures';
import type { NutritionTargetsService } from '../../nutrition-targets/nutrition-targets.service';
import { CachedProductLookupProvider } from '../../product-lookup/cached-product-lookup.provider';
import { WebSearchProductLookupProvider, WEB_SEARCH_MAX_PER_HOUR, type NutritionSearcher } from '../../product-lookup/web-search-lookup.provider';
import { MultiSourceProductLookup } from '../../product-lookup/multi-source-product-lookup';
import { mapOpenFoodFactsProduct } from '../../product-lookup/open-food-facts.mapper';
import { sourceTier } from '../../product-lookup/web/source-tier';
import { ScanService } from '../scan.service';

// Tavily, Gemini, Open Food Facts и страницы подставные: тест не выходит в сеть.
Logger.overrideLogger(false);
const plans = { findPlanForUser: async () => eatHealthierPlan() } as unknown as NutritionTargetsService;

type Macros = readonly [kcal: number | null, protein: number, carbs: number, fat: number];
const item = (value: number, unit = 'g') => ({ source: 'manufacturer', source_index: 0, source_per: '100g', unit, value });
function off(barcode: string, name: string, brand: string, [kcal, protein, carbs, fat]: Macros, extra: Record<string, unknown> = {}) {
  const nutrients = { ...(kcal === null ? {} : { 'energy-kcal': item(kcal, 'kcal') }), proteins: item(protein), carbohydrates: item(carbs), fat: item(fat) };
  return mapOpenFoodFactsProduct({ product_name: name, brands: brand, ingredients_text: 'мука, сахар', nutrition: { aggregated_set: { nutrients, per: '100g', preparation: 'as_sold' } }, ...extra }, barcode)!;
}
interface Table { kcal: number; protein: number; carbs: number; fat: number; sugars?: number; saturated?: number; salt?: number; per?: string }
function page(title: string, barcode: string | null, { kcal, protein, carbs, fat, sugars, saturated, salt, per = '100 г' }: Table): string {
  const row = (label: string, value?: number) => (value === undefined ? '' : `${label} ${value} г, `);
  return `<title>${title}</title><p>${barcode ? `Штрихкод: ${barcode}.` : ''} Пищевая ценность на ${per}: ${kcal} ккал, белки ${protein} г, углеводы ${carbs} г, ${row('в т.ч. сахара', sugars)}жиры ${fat} г, ${row('в т.ч. насыщенные', saturated)}${row('соль', salt)}</p>`;
}
const found = (domain: string, title: string, snippet = ''): DiscoveredSource => ({ url: `https://${domain}/p`, title, domain, snippet });

function setup(lookupOff: ReturnType<typeof off> | null, pages: Readonly<Record<string, string>>, sources: readonly DiscoveredSource[]) {
  const calls = { reads: [] as string[], queries: 0 };
  const searcher: NutritionSearcher = {
    discoverSources: async () => assert.fail('the staged search does not use discoverSources'),
    searchQuery: async () => ({ sources: calls.queries++ === 0 ? [...sources] : [], webSearchQueries: 1 }),
    extractNutrition: async () => [],
  };
  const reader = { fetchPage: async (url: string) => {
    const domain = new URL(url).hostname;
    calls.reads.push(domain);
    return { finalUrl: url, domain, contentType: 'text/html', body: pages[domain] ?? '<title>x</title>' };
  } };
  const web = new CachedProductLookupProvider(new WebSearchProductLookupProvider(searcher, reader));
  const lookups = new MultiSourceProductLookup([{ name: 'open_food_facts', lookup: async () => lookupOff }, web]);
  const ai = { name: 'stub', analyzeProduct: async () => assert.fail('no AI in a barcode scan') } as unknown as AIProvider;
  return { service: new ScanService(ai, plans, undefined, lookups), calls };
}
type Scanned = Awaited<ReturnType<ScanService['analyze']>>;
const evidence = ({ product }: Scanned, field: string) => product.fieldEvidence?.find((entry) => entry.field === field);
const quality = (scanned: Scanned, field: string) => [evidence(scanned, field)?.dataQuality, evidence(scanned, field)?.confidence];

// Данные последнего реального скана: одна запись Open Food Facts, значения страниц без изменений.
const CHOCO = '4607084351385';
const chocoOff = () => off(CHOCO, 'Choco Pie', 'Orion', [507, 4.5, 63, 18], { serving_size: '30 g' });
const forkin = page('Choco Pie Orion', CHOCO, { kcal: 432.6, protein: 4.5, carbs: 63, fat: 18, sugars: 37.1, saturated: 11, salt: 0.2 });
const posylka = page('Choco Pie Orion', CHOCO, { kcal: 443, protein: 4, carbs: 70.5, fat: 16.1, sugars: 37, saturated: 10, salt: 0.69 });
const barista = page('Choco Pie Orion', CHOCO, { kcal: 450, protein: 4.8, carbs: 67, fat: 18 });
const hit = (domain: string) => found(domain, 'Choco Pie Orion', `Штрихкод ${CHOCO}`);

describe('Uncorroborated values remain unknown', () => {
  it('real Choco Pie scan: uncorroborated fields stay unknown, conflicting recipes stay out', async () => {
    const partial = await setup(chocoOff(), { 'barista-ltd.ru': barista }, [hit('barista-ltd.ru')]).service.analyze(undefined, 'user', { barcode: CHOCO }).then(sourceEvidenceView);
    const domains = ['forkin.io', 'posylka.de', 'barista-ltd.ru'];
    const scanned = await setup(chocoOff(), { 'forkin.io': forkin, 'posylka.de': posylka, 'barista-ltd.ru': barista }, domains.map(hit)).service.analyze(undefined, 'user', { barcode: CHOCO }).then(sourceEvidenceView);
    const n = scanned.product.nutrition!;
    assert.deepEqual([n.sugarsG.value, n.saturatedFatG.value, n.saltG.value], [null, null, null]);
    for (const field of ['sugarsG', 'saturatedFatG', 'saltG']) assert.deepEqual(quality(scanned, field), [undefined, undefined], field);
    assert.deepEqual([n.caloriesKcal.value, evidence(scanned, 'caloriesKcal')!.dataQuality], [433, 'confirmed'], 'two sites replace the suspicious 507');
    assert.equal(scanned.score.confidence, 'low');
    assert.equal(typeof scanned.score.value, 'number');
    assert.notEqual(scanned.score.value, null);
    assert.equal(typeof partial.score.value, 'number');
    assert.equal(scanned.goalMatch.goal, 'eat_healthier');
    assert.ok(scanned.goalMatch.value! <= scanned.score.value!, `${scanned.goalMatch.value} above ${scanned.score.value}`);
  });
  it('exact barcode + recipe conflict: posylka.de alone gives nothing', async () => {
    const { product } = await setup(chocoOff(), { 'posylka.de': posylka }, [hit('posylka.de')]).service.analyze(undefined, 'user', { barcode: CHOCO }).then(sourceEvidenceView);
    assert.deepEqual([product.nutrition!.sugarsG.value, product.nutrition!.saturatedFatG.value, product.nutrition!.saltG.value], [null, null, null]);
  });
  it('a lone page never replaces a value that is not suspicious, and kcal must fit the macros', async () => {
    const trusted = off(CHOCO, 'Choco Pie', 'Orion', [430, 4.5, 63, 18], { nutrition: { aggregated_set: { nutrients: { 'energy-kcal': item(430, 'kcal'), proteins: item(4.5), carbohydrates: item(63), fat: item(18), sugars: item(38) }, per: '100g', preparation: 'as_sold' } } });
    const scanned = await setup(trusted, { 'forkin.io': forkin }, [hit('forkin.io')]).service.analyze(undefined, 'user', { barcode: CHOCO }).then(sourceEvidenceView);
    assert.deepEqual([scanned.product.nutrition!.sugarsG.value, scanned.product.nutrition!.caloriesKcal.value], [38, 430]);
    assert.deepEqual(quality(scanned, 'sugarsG'), ['database', 'medium']);
    const wrongKcal = page('Choco Pie Orion', CHOCO, { kcal: 600, protein: 4.5, carbs: 63, fat: 18, sugars: 37.1 });
    const missing = await setup(off(CHOCO, 'Choco Pie', 'Orion', [null, 4.5, 63, 18]), { 'forkin.io': wrongKcal }, [hit('forkin.io')]).service.analyze(undefined, 'user', { barcode: CHOCO }).then(sourceEvidenceView);
    assert.deepEqual([missing.product.nutrition!.caloriesKcal.provenance === 'inferred' || missing.product.nutrition!.caloriesKcal.value === null, missing.product.nutrition!.sugarsG.value], [true, null]);
  });
  it('exact name + matching recipe without the barcode: unknown; a generic page: nothing', async () => {
    const exact = page('Orion Choco Pie', null, { kcal: 432, protein: 4.5, carbs: 63, fat: 18, sugars: 37 });
    const named = await setup(chocoOff(), { 'sweets.example': exact }, [found('sweets.example', 'Orion Choco Pie')]).service.analyze(undefined, 'user', { barcode: CHOCO }).then(sourceEvidenceView);
    assert.equal(named.product.nutrition!.sugarsG.value, null); assert.deepEqual(quality(named, 'sugarsG'), [undefined, undefined]);
    const generic = page('Печенье', null, { kcal: 432, protein: 4.5, carbs: 63, fat: 18, sugars: 37 });
    const weak = await setup(chocoOff(), { 'sweets.example': generic }, [found('sweets.example', 'Orion Choco Pie')]).service.analyze(undefined, 'user', { barcode: CHOCO }).then(sourceEvidenceView);
    assert.equal(weak.product.nutrition!.sugarsG.value, null);
  });
  it('a list page with the barcode gives no estimate', async () => {
    const list = `${page('Choco Pie Orion', null, { kcal: 432, protein: 4.5, carbs: 63, fat: 18, sugars: 37 })}<p>${CHOCO} 4607084351392 4607084351408 4607084351415</p>`;
    const { product } = await setup(chocoOff(), { 'codes.example': list.replace('Choco Pie Orion', 'Каталог') }, [found('codes.example', 'Каталог', `Штрихкод ${CHOCO}`)]).service.analyze(undefined, 'user', { barcode: CHOCO }).then(sourceEvidenceView);
    assert.equal(product.nutrition!.sugarsG.value, null);
  });
  it('a manufacturer page stays verified, two unknown sites are confirmed', async () => {
    const strong = await setup(chocoOff(), { 'orionworld.ru': forkin }, [hit('orionworld.ru')]).service.analyze(undefined, 'user', { barcode: CHOCO }).then(sourceEvidenceView);
    assert.deepEqual(quality(strong, 'sugarsG'), ['verified', 'medium']);
    const pair = await setup(chocoOff(), { 'forkin.io': forkin, 'sweets.example': forkin }, [hit('forkin.io'), hit('sweets.example')]).service.analyze(undefined, 'user', { barcode: CHOCO }).then(sourceEvidenceView);
    assert.deepEqual(quality(pair, 'sugarsG'), ['confirmed', 'medium']);
  });
});

describe('Reading before checking', () => {
  it('a manufacturer page without the brand in the title is still read', async () => {
    const run = setup(chocoOff(), { 'en.orionworld.ru': forkin }, [found('en.orionworld.ru', 'Choco Pie')]);
    await run.service.analyze(undefined, 'user', { barcode: CHOCO }).then(sourceEvidenceView);
    assert.deepEqual(run.calls.reads, ['en.orionworld.ru']);
  });
  it('the brand in the snippet is enough on an unknown site; without it the page is not read; another variant never is', async () => {
    const shop = (snippet: string, title = 'Печенье Choco-Pie Original 12*30гр') => setup(chocoOff(), {}, [found('semeiniy.kz', title, snippet)]);
    const withBrand = shop('Orion, упаковка 12 штук');
    await withBrand.service.analyze(undefined, 'user', { barcode: CHOCO }).then(sourceEvidenceView);
    assert.deepEqual(withBrand.calls.reads, ['semeiniy.kz']);
    const without = shop('упаковка 12 штук');
    await without.service.analyze(undefined, 'user', { barcode: CHOCO }).then(sourceEvidenceView);
    assert.deepEqual(without.calls.reads, []);
    const other = shop('Orion, упаковка', 'Choco Pie Banana');
    await other.service.analyze(undefined, 'user', { barcode: CHOCO }).then(sourceEvidenceView);
    assert.deepEqual(other.calls.reads, []);
  });
  it('Tavily pages are not candidates, the new domains are classified, the hourly limit is 60', async () => {
    const { service, calls } = setup(chocoOff(), {}, [found('tavily.com', 'Choco Pie Orion', `Штрихкод ${CHOCO}`)]);
    await service.analyze(undefined, 'user', { barcode: CHOCO }).then(sourceEvidenceView);
    assert.deepEqual(calls.reads, []);
    assert.deepEqual(['orionworld.ru', 'en.orionworld.ru', 'metro-cc.ru', 'dixy.ru', 'igooods.ru'].map((domain) => sourceTier(domain, null)), [1, 1, 2, 2, 2]);
    assert.equal(WEB_SEARCH_MAX_PER_HOUR, 60);
  });
  it('a new process starts without the old miss', async () => {
    const empty = setup(chocoOff(), {}, []);
    await empty.service.analyze(undefined, 'user', { barcode: CHOCO }).then(sourceEvidenceView);
    const restarted = setup(chocoOff(), { 'forkin.io': forkin }, [hit('forkin.io')]);
    assert.equal((await restarted.service.analyze(undefined, 'user', { barcode: CHOCO }).then(sourceEvidenceView)).product.nutrition!.sugarsG.value, null);
  });
});

describe('The rule is the same for any product', () => {
  const PRODUCTS = [
    { name: 'Choco Pie', brand: 'Orion', code: CHOCO, macros: [430, 4.5, 63, 18], table: { sugars: 37.1, saturated: 11, salt: 0.2 }, other: { carbs: 75, fat: 12 } },
    { name: 'Картофельное пюре с курицей', brand: 'Роллтон', code: '4605496000815', macros: [350, 6, 65, 7.5], table: { sugars: 5, saturated: 2, salt: 3 }, other: { carbs: 50, fat: 15 } },
    { name: 'Coca-Cola Classic', brand: 'Coca-Cola', code: '5449000000996', macros: [42, 0.5, 10.6, 0.5], table: { sugars: 10.6, saturated: 0.1, salt: 0.01 }, other: { carbs: 5, fat: 3 } },
    { name: 'Snickers Hazelnut', brand: 'Snickers', code: '5000159461122', macros: [510, 7.3, 55, 28], table: { sugars: 48, saturated: 10, salt: 0.37 }, other: { carbs: 40, fat: 20 } },
    { name: 'Натуральный йогурт', brand: 'Простоквашино', code: '4600605012345', macros: [68, 5, 6, 2.5], table: { sugars: 4.7, saturated: 1.6, salt: 0.1 }, other: { carbs: 12, fat: 6 } },
    { name: 'Lays Paprika Chips', brand: 'Lays', code: '4690388112233', macros: [530, 6.5, 52, 33], table: { sugars: 2.5, saturated: 3.2, salt: 1.5 }, other: { carbs: 65, fat: 20 } },
    { name: 'Хлеб зерновой', brand: 'Хлебпром', code: '4607012345675', macros: [245, 9, 44, 3.5], table: { sugars: 3, saturated: 0.6, salt: 1.1 }, other: { carbs: 30, fat: 9 } },
  ] as const;
  const tableOf = ({ macros: [kcal, protein, carbs, fat] }: (typeof PRODUCTS)[number]) => ({ kcal, protein, carbs, fat });
  for (const product of PRODUCTS) {
    it(`${product.name}: corroborated pages fill the gaps, another recipe does not`, async () => {
      const source = found('small-shop.example', `${product.brand} ${product.name}`, `Штрихкод ${product.code}`);
      const base = () => off(product.code, product.name, product.brand, product.macros);
      const same = page(`${product.brand} ${product.name}`, product.code, { ...tableOf(product), ...product.table });
      const scanned = await setup(base(), { 'small-shop.example': same, 'second-shop.example': same }, [source, found('second-shop.example', `${product.brand} ${product.name}`, `Штрихкод ${product.code}`)]).service.analyze(undefined, 'user', { barcode: product.code }).then(sourceEvidenceView);
      const n = scanned.product.nutrition!;
      assert.deepEqual([n.sugarsG.value, n.saturatedFatG.value, n.saltG.value], [product.table.sugars, product.table.saturated, product.table.salt]);
      assert.deepEqual(quality(scanned, 'sugarsG'), ['confirmed', 'medium']);
      assert.ok(!scanned.score.missingFactors.includes('sugars')); assert.equal(scanned.score.confidence, 'low');
      const differ = page(`${product.brand} ${product.name}`, product.code, { ...tableOf(product), ...product.other, ...product.table });
      const rejected = await setup(base(), { 'small-shop.example': differ }, [source]).service.analyze(undefined, 'user', { barcode: product.code }).then(sourceEvidenceView);
      assert.equal(rejected.product.nutrition!.sugarsG.value, null);
    });
  }
  it('no production branch names a concrete barcode or product', () => {
    const lookup = join(__dirname, '..', '..', 'product-lookup');
    const code = ['web-search-lookup.provider.js', 'web/product-identity.js', 'multi-source-product-lookup.js'].map((file) => readFileSync(join(lookup, file), 'utf8')).join('');
    for (const product of PRODUCTS) assert.ok(!code.includes(product.code), product.code);
    assert.ok(!/forkin|posylka|barista/i.test(code));
  });
});
