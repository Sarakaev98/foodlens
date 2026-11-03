import { sourceEvidenceView } from './source-evidence-view';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Logger } from '@nestjs/common';
import { MockProvider, type AIProvider, type DiscoveredSource, type ExtractedPage } from '@foodlens/ai';
import { fromOpenFoodFacts as fromOff, NOT_DETECTED, observed, type NutritionFacts, type Product } from '@foodlens/core';
import { eatHealthierPlan } from '../../goal-match/test/goal-match-v4.fixtures';
import type { NutritionTargetsService } from '../../nutrition-targets/nutrition-targets.service';
import { CachedProductLookupProvider } from '../../product-lookup/cached-product-lookup.provider';
import { GeminiSearchProductLookupProvider, MAX_AI_EXTRACTIONS_PER_PRODUCT, MAX_EXTRACTS_PER_PRODUCT, MAX_PAGE_ATTEMPTS, MAX_PAGES_PER_SCAN, MAX_SEARCHES_PER_PRODUCT, type NutritionSearcher, type WebSearchLimits } from '../../product-lookup/gemini-search-lookup.provider';
import { MultiSourceProductLookup } from '../../product-lookup/multi-source-product-lookup';
import { mapOpenFoodFactsProduct } from '../../product-lookup/open-food-facts.mapper';
import type { ProductLookupResult } from '../../product-lookup/product-lookup.provider';
import { BARCODE, offProduct, OFF_NUTRIENTS } from '../../product-lookup/test/open-food-facts.fixtures';
import { parsePage } from '../../product-lookup/web/page-nutrition';
import { mergeProductLookup } from '../../product-lookup/product-merge';
import { searchName } from '../../product-lookup/web/search-identity';
import { searchStrategy } from '../../product-lookup/web/search-strategy';
import { ScanService } from '../scan.service';

// Tavily, AI, Open Food Facts и страницы подставные: тест не выходит в сеть.
Logger.overrideLogger(false);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const FILE = { mimetype: 'image/jpeg', buffer: JPEG, size: JPEG.length };
const plans = { findPlanForUser: async () => eatHealthierPlan() } as unknown as NutritionTargetsService;
const ORANGE_BARCODE = '5449000022431';

const { sugars: _s, 'saturated-fat': _f, salt: _a, sodium: _n, ...offMacros } = OFF_NUTRIENTS;
const nutrients = (values: Record<string, unknown>, extra: Record<string, unknown> = {}) => offProduct({ nutrition: { aggregated_set: { nutrients: values, per: '100g', preparation: 'as_sold' } }, ...extra });
const offComplete = () => mapOpenFoodFactsProduct(offProduct(), BARCODE)!;
const offPartial = () => mapOpenFoodFactsProduct(nutrients(offMacros), BARCODE)!;
const energy = (kcal: number, protein: number, carbs: number, fat: number) => {
  const item = (value: number, unit = 'g') => ({ source: 'manufacturer', source_index: 0, source_per: '100g', unit, value });
  return { 'energy-kcal': item(kcal, 'kcal'), proteins: item(protein), carbohydrates: item(carbs), fat: item(fat) };
};
const offSnickers = () => mapOpenFoodFactsProduct(nutrients(energy(514, 7.5, 56, 28.6), { product_name: 'Snickers лесной орех', brands: 'Snickers' }), BARCODE)!;

interface Facts { title?: string; barcode?: string | null; per?: string; kcal?: number; protein?: number; carbs?: number; fat?: number; sugars?: number | null; saturated?: number; salt?: number }
function html({ title = 'Чокопай Lotte', barcode = BARCODE, per = '100 г', kcal = 430, protein = 4.5, carbs = 63, fat = 18, sugars = 38, saturated = 9, salt = 0.4 }: Facts = {}): string {
  return `<title>${title}</title><p>${barcode ? `Штрихкод: ${barcode}.` : ''} Состав: сахар, арахис, какао-масло, эмульгатор лецитин. Пищевая ценность на ${per}: ${kcal} ккал, белки ${protein} г, углеводы ${carbs} г, ${sugars === null ? '' : `в т.ч. сахара ${sugars} г,`} жиры ${fat} г, в т.ч. насыщенные ${saturated} г, соль ${salt} г</p>`;
}
const jsonLd = (barcode: string) => `<title>Чокопай Lotte</title><script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: 'Чокопай', brand: 'Lotte', gtin13: barcode,
  nutrition: { '@type': 'NutritionInformation', servingSize: '100 g', calories: '430 kcal', proteinContent: '4,5 g', carbohydrateContent: '63 g', sugarContent: '38 g', fatContent: '18 g', saturatedFatContent: '9 g', sodiumContent: '160 mg' } })}</script>`;

async function labelProduct(overrides: Partial<NutritionFacts> = {}, identity: Partial<Product> = {}): Promise<Product> {
  const base = await new MockProvider().analyzeProduct({ kind: 'image', image: { mimeType: 'image/jpeg', base64: 'AA' } });
  return { ...base, brand: observed('Lotte'), name: observed('Чокопай'), ...identity, nutrition: {
    basis: 'per_100g', servingSize: NOT_DETECTED, caloriesKcal: observed(430), proteinG: observed(4.5), carbsG: observed(63), fatG: observed(18),
    sugarsG: NOT_DETECTED, saturatedFatG: NOT_DETECTED, fiberG: NOT_DETECTED, saltG: NOT_DETECTED, sodiumMg: NOT_DETECTED, ...overrides,
  } };
}

interface Setup {
  off?: ProductLookupResult | null;
  pages?: Readonly<Record<string, string>>;
  /** Что вернёт поиск на запрос с таким номером. Без неё находятся все страницы сразу. */
  sources?: readonly (readonly DiscoveredSource[])[];
  debug?: boolean;
  aiIngredients?: string | null;
  results?: readonly (readonly string[])[];
  closed?: readonly string[];
  extractable?: Readonly<Record<string, string>>;
  available?: () => boolean;
  label?: Product;
  limits?: WebSearchLimits;
  aiPages?: readonly ExtractedPage[];
}
function setup({ off = null, pages = {}, results, closed = [], extractable = {}, available, label, limits, aiPages, sources, debug = false, aiIngredients }: Setup) {
  const calls = { ai: 0, off: 0, queries: [] as string[], reads: [] as string[], extracts: [] as (readonly string[])[], aiText: 0, aiPages: [] as (readonly string[])[], aiIngredients: [] as string[] };
  const logs: { message: string; fields: any }[] = [];
  const logger = { log: (message: string, fields: unknown) => logs.push({ message, fields }), warn: (message: string, fields: unknown) => logs.push({ message, fields }) };
  const ai = { name: 'stub', analyzeProduct: async () => { calls.ai++; return label ?? await labelProduct(); } } as unknown as AIProvider;
  const found = (domains: readonly string[]) => ({ sources: domains.map((domain): DiscoveredSource => ({ url: `https://${domain}/p`, title: `${domain} Чокопай Lotte Snickers Coca-Cola`, domain })), webSearchQueries: 1 });
  const searcher: NutritionSearcher = {
    discoverSources: async () => assert.fail('the staged search does not use discoverSources'),
    searchQuery: async (query) => {
      calls.queries.push(query);
      if (sources) return { sources: sources[calls.queries.length - 1] ?? [], webSearchQueries: 1 };
      return found(results ? results[calls.queries.length - 1] ?? [] : Object.keys(pages));
    },
    ...(aiIngredients === undefined ? {} : { extractIngredients: async (text: string) => { calls.aiIngredients.push(text); return aiIngredients; } }),
    extractNutrition: async (items) => { calls.aiText++; calls.aiPages.push(items.map((item) => item.text)); return aiPages ?? []; },
    readPages: async (urls) => { calls.extracts.push(urls); return urls.flatMap((url) => { const content = extractable[new URL(url).hostname]; return content ? [{ url, content }] : []; }); },
    ...(available ? { isAvailable: available } : {}),
  };
  const reader = { fetchPage: async (url: string) => {
    const domain = new URL(url).hostname;
    calls.reads.push(domain);
    if (closed.includes(domain)) throw new Error('page_timeout');
    return { finalUrl: url, domain, contentType: 'text/html', body: pages[domain] ?? '<title>x</title>' };
  } };
  const provider = new GeminiSearchProductLookupProvider(searcher, reader, logger, Date.now, debug, limits);
  const web = new CachedProductLookupProvider(provider);
  const lookups = new MultiSourceProductLookup([{ name: 'open_food_facts', lookup: async () => (calls.off++, off) }, web]);
  const service = new ScanService(ai, plans, undefined, lookups);
  return { service, calls, logs, verdicts: () => logs.filter((line) => line.message === 'web_lookup').map((line) => line.fields) };
}
const scan = (service: ScanService, barcode = BARCODE) => service.analyze(undefined, 'user', { barcode }).then(sourceEvidenceView);

describe('Web fallback: query order', () => {
  it('1. OFF complete: Tavily 0, Gemini 0', async () => {
    const { service, calls } = setup({ off: offComplete(), pages: { 'ozon.ru': html() } });
    const result = await scan(service);
    assert.deepEqual([calls.queries.length, calls.ai, calls.aiText], [0, 0, 0]); assert.notEqual(result.score.value, null);
  });
  it('2. OFF partial: the first query is the barcode alone, without macros', async () => {
    const { service, calls } = setup({ off: offPartial(), pages: {}, results: [[], [], [], []] });
    await scan(service);
    assert.equal(calls.queries[0], `"${BARCODE}"`);
    assert.ok(calls.queries.every((query) => !/\b(430|4\.5|63|18)\b/.test(query)), 'macros stay in the code');
  });
  it('3. the barcode search finds the page: one query is enough', async () => {
    const { service, calls } = setup({ off: offPartial(), pages: { 'ozon.ru': html() } });
    const result = await scan(service);
    assert.equal(calls.queries.length, 1); assert.equal(result.product.nutrition!.sugarsG.value, 38); assert.notEqual(result.score.value, null);
    assert.equal('needsPhoto' in result, false);
  });
  it('4. barcode search miss: the identity query follows', async () => {
    const { service, calls } = setup({ off: offPartial(), pages: { 'ozon.ru': html() }, results: [[], ['ozon.ru']] });
    await scan(service);
    assert.deepEqual(calls.queries, [`"${BARCODE}"`, `"${BARCODE}" "Lotte" "Чокопай"`]);
  });
  it('5. identity query miss: the query for the first missing field follows', async () => {
    const { service, calls } = setup({ off: offPartial(), pages: { 'ozon.ru': html() }, results: [[], [], ['ozon.ru']] });
    await scan(service);
    assert.equal(calls.queries.length, 3); assert.equal(calls.queries[2], `${BARCODE} сахара`);
  });
  it('query 4 asks for the missing fields and runs whenever Q1–Q3 gave no accepted page', async () => {
    const page = html({ title: 'Lotte Чокопай', barcode: null, sugars: null });
    const { service, calls } = setup({ off: offPartial(), pages: { 'lotte.ru': page }, results: [['lotte.ru']] });
    await scan(service);
    assert.ok(calls.queries.some((query) => /Lotte Чокопай сахара/.test(query)));
    const empty = setup({ off: offPartial(), results: [] });
    await scan(empty.service);
    assert.match(empty.calls.queries.at(-1)!, /Lotte Чокопай сахара/, 'nothing was found, and the last query still runs');
  });
  it('the strategy never repeats the brand and uses the label name as it is', () => {
    const context = { brand: 'Snickers', name: 'Snickers лесной орех', serving: null, basis: 'per_100g', kcal: 1, protein: 1, carbs: 1, fat: 1, missingFields: ['sugars'] } as any;
    assert.deepEqual(searchStrategy(BARCODE, context).map((step) => step.query).slice(1, 3), [`"${BARCODE}" "Snickers лесной орех"`, `${BARCODE} сахара`]);
    assert.deepEqual(searchStrategy(null, context).map((step) => step.kind), ['exact_product', 'missing_nutrients']);
    assert.deepEqual(searchStrategy(BARCODE, { ...context, brand: null, name: null }).map((step) => step.kind), ['barcode']);
  });
  it('allergens and additives alone do not start the search', async () => {
    const { service, calls } = setup({ off: mapOpenFoodFactsProduct(offProduct({ allergens_tags: undefined, additives_tags: undefined }), BARCODE)!, pages: { 'ozon.ru': html() } });
    await scan(service);
    assert.equal(calls.queries.length, 0);
  });
  it('missing ingredients alone start the search, and it asks for ingredients', async () => {
    const { service, calls } = setup({ off: mapOpenFoodFactsProduct(offProduct({ ingredients_text: undefined }), BARCODE)!, results: [] });
    await scan(service);
    assert.deepEqual(calls.queries, [`"${BARCODE}"`, `"${BARCODE}" "Lotte" "Чокопай"`, `${BARCODE} состав`, '"Lotte" "Чокопай" ingredients', '"Lotte" "Чокопай" состав']);
  });
  it('both missing: one query for ingredients in the local word and one for nutrition', async () => {
    const { service, calls } = setup({ off: mapOpenFoodFactsProduct(nutrients(offMacros, { ingredients_text: undefined }), BARCODE)!, results: [] });
    await scan(service);
    assert.deepEqual(calls.queries.slice(-2), ['"Lotte" "Чокопай" пищевая ценность состав', 'Lotte Чокопай сахара насыщенные жиры соль состав']);
  });
  it('other languages take the word from the small dictionary, without a model', () => {
    const context = { brand: null, name: 'შოკოლადი რძიანი', serving: null, basis: 'unknown', kcal: null, protein: null, carbs: null, fat: null, missingFields: [], needsIngredients: true } as any;
    assert.equal(searchStrategy(null, context).at(-1)!.query, '"შოკოლადი რძიანი" შემადგენლობა');
  });
});

describe('Web fallback: which pages are trusted', () => {
  it('6. manufacturer page without a barcode is accepted by name and macros', async () => {
    const { service, verdicts } = setup({ off: offPartial(), pages: { 'lotte.ru': html({ title: 'Lotte Чокопай', barcode: null }) } });
    const result = await scan(service);
    assert.equal(result.product.nutrition!.sugarsG.value, 38); assert.equal(verdicts()[0].pages.at(-1).tier, 1);
  });
  it('7. retailer page with the barcode is accepted', async () => {
    const { service, verdicts } = setup({ off: offPartial(), pages: { 'perekrestok.ru': html() } });
    const result = await scan(service);
    assert.equal(result.product.nutrition!.saturatedFatG.value, 9); assert.equal(verdicts()[0].pages.at(-1).tier, 2);
  });
  it('8. wrong variant is rejected', async () => {
    const page = html({ title: 'Snickers миндаль', barcode: null, kcal: 514, protein: 7.5, carbs: 56, fat: 28.6, sugars: 48 });
    const { service, verdicts } = setup({ off: offSnickers(), pages: { 'snickers.ru': page }, results: [['snickers.ru']] });
    const result = await scan(service);
    assert.equal(result.product.nutrition!.sugarsG.value, null); assert.equal(verdicts()[0].pages.at(-1).reason, 'variant_mismatch');
  });
  it('9. macro conflict is rejected, and nothing is averaged', async () => {
    const page = html({ title: 'Snickers лесной орех', barcode: null, kcal: 496, protein: 7.5, carbs: 58, fat: 25, sugars: 50 });
    const { service, verdicts } = setup({ off: offSnickers(), pages: { 'ozon.ru': page }, results: [['ozon.ru']] });
    const result = await scan(service);
    assert.equal(result.product.nutrition!.sugarsG.value, null); assert.equal(result.product.nutrition!.caloriesKcal.value, 514);
    assert.equal(verdicts()[0].status, 'different_product_or_recipe');
  });
  it('10. JSON-LD NutritionInformation is read first', async () => {
    const { service, verdicts } = setup({ off: offPartial(), pages: { 'ozon.ru': jsonLd(BARCODE) } });
    const result = await scan(service);
    assert.equal(verdicts()[0].pages.at(-1).method, 'json_ld'); assert.equal(result.product.nutrition!.sugarsG.value, 38);
  });
  it('embedded product JSON is read when there is no JSON-LD', async () => {
    const data = { props: { product: { gtin13: BARCODE, name: 'Чокопай', nutrition: { per: 'на 100 г', calories: 430, proteins: 4.5, carbohydrates: 63, sugars: 38, fat: 18, saturated_fat: 9, salt: 0.4 } } } };
    const page = `<title>Чокопай Lotte</title><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script>`;
    const { service, verdicts } = setup({ off: offPartial(), pages: { 'ozon.ru': page } });
    const result = await scan(service);
    assert.equal(verdicts()[0].pages.at(-1).method, 'embedded_json'); assert.equal(result.product.nutrition!.saltG.value, 0.4);
  });
  it('embedded JSON of several products is not used: it may describe neighbours', async () => {
    const item = (sugars: number) => ({ gtin13: BARCODE, nutrition: { per: 'на 100 г', calories: 430, proteins: 4.5, carbohydrates: 63, sugars, fat: 18 } });
    const page = `<title>Чокопай Lotte</title><script type="application/json">${JSON.stringify([item(38), item(12)])}</script>`;
    const { service, verdicts } = setup({ off: offPartial(), pages: { 'ozon.ru': page }, results: [['ozon.ru']] });
    await scan(service);
    assert.equal(verdicts()[0].pages.at(-1).method, null);
  });
  it('11. a plain HTML table is read', async () => {
    const { service, verdicts } = setup({ off: offPartial(), pages: { 'ozon.ru': html() } });
    await scan(service);
    assert.equal(verdicts()[0].pages.at(-1).method, 'html');
  });
  it('12. a page that did not open is read through Tavily extract', async () => {
    const { service, calls, verdicts } = setup({ off: offPartial(), pages: {}, results: [['kuper.ru']], closed: ['kuper.ru'], extractable: { 'kuper.ru': html() } });
    const result = await scan(service);
    assert.equal(calls.extracts.length, 1); assert.equal(calls.queries.length, 1);
    assert.equal(verdicts()[0].pages.at(-1).reader, 'search_extract'); assert.equal(result.product.nutrition!.sugarsG.value, 38);
  });
  it('13. two independent sources with the same values are enough', async () => {
    const page = html({ title: 'Lotte Чокопай', barcode: null });
    const { service, verdicts } = setup({ off: offPartial(), pages: { 'calorizator.ru': page, 'fatsecret.ru': page }, results: [['calorizator.ru', 'fatsecret.ru']] });
    const result = await scan(service);
    assert.equal(result.product.nutrition!.sugarsG.value, 38); assert.equal(verdicts()[0].status, 'accepted');
  });
  it('14. two sources in conflict leave the field unknown', async () => {
    const { service, verdicts } = setup({ off: offPartial(), pages: { 'calorizator.ru': html({ title: 'Lotte Чокопай', barcode: null }), 'fatsecret.ru': html({ title: 'Lotte Чокопай', barcode: null, sugars: 20 }) }, results: [['calorizator.ru', 'fatsecret.ru']] });
    const result = await scan(service);
    assert.equal(result.product.nutrition!.sugarsG.value, null); assert.ok(verdicts()[0].unresolved.includes('sugars'));
  });
});

describe('Web fallback: identity before and after reading', () => {
  const titled = (title: string, domain: string, snippet = ''): DiscoveredSource => ({ url: `https://${domain}/${encodeURIComponent(title).slice(0, 20)}`, title, domain, snippet });
  const orange = () => mapOpenFoodFactsProduct({ product_name: 'coca cola orange' }, ORANGE_BARCODE);
  const real = [titled('Simply® Orange - All Varieties & Nutrition Facts | Coca-Cola US', 'coca-cola.com'), titled('Simply Orange® - Varieties & Nutrition Facts | Coca-Cola CA', 'coca-cola.com'),
    titled('‘We All Scream for Orange Cream’: Coca-Cola Drops Retro-Inspired Flavor Innovation', 'coca-colacompany.com'), titled('Coca-Cola - The Original Taste | Coca-Cola GB', 'coca-cola.com')];
  it('the pages of the real Coca Cola Orange scan are not read, the text AI is not called, and query 4 runs', async () => {
    const { service, calls } = setup({ off: orange(), sources: [real, [], [], []] });
    const result = await scan(service, ORANGE_BARCODE);
    assert.deepEqual(calls.reads, []); assert.equal(calls.aiText, 0); assert.equal(calls.queries.length, MAX_SEARCHES_PER_PRODUCT);
    assert.match(calls.queries.at(-1)!, /^coca cola orange sugars saturated fat salt .*ingredients$/); assert.equal(result.status, undefined);
  });
  it('an exact barcode in the title, snippet or URL gets the page read without the product name', async () => {
    for (const source of [titled(`Товар ${BARCODE}`, 'ozon.ru'), titled('Товар', 'ozon.ru', `Штрихкод ${BARCODE}`), { url: `https://ozon.ru/${BARCODE}`, title: 'Товар', domain: 'ozon.ru' }]) {
      const { service } = setup({ off: offPartial(), pages: { 'ozon.ru': html({ title: 'Товар' }) }, sources: [[source]] });
      assert.equal((await scan(service)).product.nutrition!.sugarsG.value, 38);
    }
  });
  it('an exact barcode found after reading is enough without the full name in the title', async () => {
    const { service } = setup({ off: offPartial(), pages: { 'ozon.ru': html({ title: 'Lotte сладости' }) }, sources: [[titled('Lotte сладости', 'ozon.ru')]] });
    assert.equal((await scan(service)).product.nutrition!.sugarsG.value, 38);
  });
  it('an explicitly different variant is rejected: Orange Cream, Vanilla, Zero against Original', async () => {
    const page = (title: string, barcode: string | null = null) => html({ title, barcode, per: '100 мл', kcal: 42, protein: 0, carbs: 10.6, fat: 0, sugars: 10.6, saturated: 0, salt: 0.01 });
    for (const [name, title] of [['Coca-Cola Orange', 'Coca-Cola Orange Cream'], ['Coca-Cola Orange', 'Coca-Cola Vanilla'], ['Coca-Cola Original', 'Coca-Cola Zero']] as const) {
      const off = mapOpenFoodFactsProduct({ product_name: name, brands: 'Coca-Cola' }, ORANGE_BARCODE);
      const notRead = setup({ off, sources: [[titled(title, 'coca-cola.com')]], pages: { 'coca-cola.com': page(title) } });
      await scan(notRead.service, ORANGE_BARCODE);
      assert.deepEqual(notRead.calls.reads, [], title);
      const read = setup({ off, sources: [[{ url: `https://coca-cola.com/${ORANGE_BARCODE}`, title: 'Товар', domain: 'coca-cola.com' }]], pages: { 'coca-cola.com': page(title, ORANGE_BARCODE) } });
      const result = await scan(read.service, ORANGE_BARCODE);
      assert.equal(result.product.nutrition?.sugarsG.value ?? null, null, title);
      assert.equal(read.verdicts()[0].pages.at(-1).reason, 'variant_mismatch', title);
    }
  });
  it('Original on the page is not another variant of a product with no variant', async () => {
    const { service } = setup({ off: mapOpenFoodFactsProduct(nutrients(offMacros, { product_name: 'Чокопай' }), BARCODE)!, pages: { 'lotte.ru': html({ title: 'Lotte Чокопай Original', barcode: null }) }, sources: [[titled('Lotte Чокопай Original', 'lotte.ru')]] });
    assert.equal((await scan(service)).product.nutrition!.sugarsG.value, 38);
  });
  it('a page that names no variant is not rejected for that: brand and macros decide', async () => {
    const page = html({ title: 'Snickers', barcode: null, kcal: 510, protein: 7.3, carbs: 55, fat: 28, sugars: 48, saturated: 10, salt: 0.37 });
    const { service, verdicts } = setup({ off: offSnickers(), pages: { 'snickers.ru': page }, sources: [[titled('Snickers', 'snickers.ru')]] });
    const result = await scan(service);
    assert.equal(result.product.nutrition!.sugarsG.value, 48); assert.equal(verdicts()[0].status, 'accepted');
  });
  it('a word on the page that is not this product still counts as a mismatch', async () => {
    const page = html({ title: 'Snickers Super', barcode: null, kcal: 510, protein: 7.3, carbs: 55, fat: 28, sugars: 48 });
    const { service, verdicts } = setup({ off: offSnickers(), pages: { 'snickers.ru': page }, sources: [[titled('Snickers Super', 'snickers.ru')]] });
    await scan(service);
    assert.equal(verdicts()[0].pages.at(-1).reason, 'variant_mismatch');
  });
  it('the brand comes from a known name only for the check: the product keeps no brand', async () => {
    const { service, calls } = setup({ off: orange(), sources: [[]] });
    const result = await scan(service, ORANGE_BARCODE);
    assert.equal(result.product.brand.value, null);
    assert.equal(calls.queries[1], `"${ORANGE_BARCODE}" "coca cola orange"`, 'the brand is not repeated');
  });
  it('one read always stays for the last query', async () => {
    const domains = ['ozon.ru', 'vprok.ru', 'lenta.com', 'auchan.ru'];
    const pages = Object.fromEntries(domains.map((domain) => [domain, html({ title: 'Lotte Чокопай', barcode: null, sugars: null })]));
    const { service, calls } = setup({ off: offPartial(), pages, results: [domains.slice(0, 3), [], [], domains.slice(3)] });
    await scan(service);
    assert.ok(calls.queries.length >= 4); assert.equal(calls.reads.length, 4); assert.equal(calls.reads[3], 'auchan.ru', 'the last query still gets a read');
  });
  it('the log says why a page was not read', async () => {
    const domains = [titled('Coca-Cola Orange - Wikipedia', 'en.wikipedia.org'), titled('Coca Cola Orange', 'unknown-shop.ru'), titled('Simply Orange | Coca-Cola US', 'coca-cola.com')];
    const { service, logs } = setup({ off: mapOpenFoodFactsProduct({ product_name: 'coca cola orange', ingredients_text: 'вода, сахар' }, ORANGE_BARCODE), sources: [domains], debug: true });
    await scan(service, ORANGE_BARCODE);
    const reasons = Object.fromEntries(logs.filter((line) => line.message === 'web_candidate').map((line) => [line.fields.domain, line.fields.reason]));
    assert.deepEqual(reasons, { 'en.wikipedia.org': 'not_product_site', 'unknown-shop.ru': 'no_per_100_nutrition', 'coca-cola.com': 'not_relevant' });
  });
});

describe('Web fallback: name confirmed by the exact barcode', () => {
  const off = () => mapOpenFoodFactsProduct({ product_name: 'Coca Cola Orange' }, ORANGE_BARCODE);
  const result = (title: string, domain: string, snippet = `EAN ${ORANGE_BARCODE}`): DiscoveredSource => ({ url: `https://${domain}/${encodeURIComponent(title).slice(0, 24)}`, title, domain, snippet });
  const q1 = [result('Coca Cola Zero Orange 1.5L', 'shop-one.rs'), result('Coca-Cola Zero Sugar Orange 1.5L', 'shop-two.ba')];
  const OFFICIAL = 'Coca-Cola® Zero Sugar Orange | Coca-Cola';
  const facts = { title: OFFICIAL, barcode: null, per: '100 мл', kcal: 1, protein: 0, carbs: 0, fat: 0, sugars: 0, saturated: 0, salt: 0.02 };
  const official = (page = html(facts), title = OFFICIAL) => ({ pages: { 'coca-cola.com': page }, sources: [q1, [], [result(title, 'coca-cola.com', '')]] });

  it('1–5. Q1 confirms Zero Orange, the next queries use it, and the official page without a barcode is accepted', async () => {
    const { service, calls, logs, verdicts } = setup({ off: off(), ...official(), debug: true });
    const scanned = await scan(service, ORANGE_BARCODE);
    assert.equal(calls.queries[0], `"${ORANGE_BARCODE}"`);
    assert.match(calls.queries[1]!, /"Coca-Cola zero orange"/);
    assert.equal(logs.find((line) => line.message === 'identity_enrichment')!.fields.reason, 'independent_sources');
    assert.equal(verdicts()[0].alias, 'Coca-Cola zero orange');
    assert.equal(calls.reads.at(-1), 'coca-cola.com'); assert.equal(verdicts()[0].pages.at(-1).reason, 'official_page_barcode_confirmed_name');
    assert.equal(scanned.product.nutrition!.sugarsG.value, 0); assert.notEqual(scanned.score.value, null); assert.equal(calls.ai, 0);
  });
  it('the Product keeps the name from OFF: the confirmed name is for search and verification', async () => {
    const { service } = setup({ off: off(), ...official() });
    const scanned = await scan(service, ORANGE_BARCODE);
    assert.equal(scanned.product.name.value, 'Coca Cola Orange');
  });
  it('one strong source with the barcode is enough', async () => {
    const { service, calls } = setup({ off: off(), sources: [[result('Coca-Cola Zero Orange 1,5 л', 'ozon.ru')]] });
    await scan(service, ORANGE_BARCODE);
    assert.match(calls.queries[1]!, /zero/);
  });
  it('one weak result with the exact barcode gives the alias, and nothing else', async () => {
    const weak = result('Coca-Cola Zero Orange 1.5L', 'shop-one.rs', `EAN ${ORANGE_BARCODE}. Состав: вода. Пищевая ценность на 100 мл: 1 ккал, белки 0 г, углеводы 0 г, сахара 0 г, жиры 0 г, насыщенные 0 г, соль 0,02 г`);
    const { service, calls, logs, verdicts } = setup({ off: off(), pages: { 'shop-one.rs': html(facts) }, sources: [[weak]] });
    const scanned = await scan(service, ORANGE_BARCODE);
    const enrichment = logs.find((line) => line.message === 'identity_enrichment')!.fields;
    assert.equal(enrichment.reason, 'single_barcode_result'); assert.equal(enrichment.provisional, true);
    assert.equal(verdicts()[0].alias, 'Coca-Cola zero orange');
    assert.match(calls.queries[1]!, /Coca-Cola zero orange/); assert.ok(calls.queries.filter((query) => /Coca-Cola zero orange/.test(query)).length >= 2);
    assert.equal(scanned.product.nutrition?.sugarsG.value ?? null, null); assert.equal(scanned.product.ingredients.value, null);
    assert.equal(typeof scanned.score.value, 'number'); assert.equal(scanned.status, undefined); assert.equal(verdicts()[0].accepted.length, 0);
    assert.equal(scanned.product.name.value, 'Coca Cola Orange');
  });
  it('after a weak alias a retailer page without the barcode is not enough', async () => {
    const weak = result('Coca-Cola Zero Orange 1.5L', 'shop-one.rs');
    const retailer = setup({ off: off(), pages: { 'ozon.ru': html({ ...facts, title: 'Coca-Cola Zero Orange' }) }, sources: [[weak], [], [result('Coca-Cola Zero Orange', 'ozon.ru', '')]] });
    const scanned = await scan(retailer.service, ORANGE_BARCODE);
    assert.equal(scanned.product.nutrition?.sugarsG.value ?? null, null, 'a retailer page without the barcode is not enough');
    assert.equal(retailer.verdicts()[0].pages.at(-1).reason, 'no_reference_without_barcode');
  });
  it('after a weak alias a site with only part of the brand in its domain is not the manufacturer', async () => {
    const weak = result('Coca-Cola Zero Orange 1.5L', 'shop-one.rs');
    const { service, verdicts } = setup({ off: off(), pages: { 'cola.com': html(facts) }, sources: [[weak], [], [result(OFFICIAL, 'cola.com', '')]] });
    const scanned = await scan(service, ORANGE_BARCODE);
    assert.equal(scanned.product.nutrition?.sugarsG.value ?? null, null); assert.equal(verdicts()[0].pages.at(-1).reason, 'no_reference_without_barcode');
  });
  it('after a weak alias the manufacturer page must name the full variant', async () => {
    const weak = result('Coca-Cola Zero Orange 1.5L', 'shop-one.rs');
    const { service, verdicts } = setup({ off: off(), pages: { 'coca-cola.com': html({ ...facts, title: 'Coca-Cola Zero' }) }, sources: [[weak], [], [result('Coca-Cola Zero', 'coca-cola.com', '')]] });
    const scanned = await scan(service, ORANGE_BARCODE);
    assert.equal(scanned.product.nutrition?.sugarsG.value ?? null, null); assert.equal(verdicts()[0].pages.at(-1).reason, 'no_reference_without_barcode');
  });
  it('one exact barcode with a foreign brand or family gives no alias', async () => {
    for (const title of ['Fanta Zero Orange 1.5L', 'Pepsi Zero Orange 1.5L', 'Whitmor Drawer Dividers Zero']) {
      const { service, calls, verdicts } = setup({ off: off(), sources: [[result(title, 'shop-one.rs')]] });
      await scan(service, ORANGE_BARCODE);
      assert.equal(verdicts()[0].alias, null, title); assert.ok(calls.queries.every((query) => !/zero/i.test(query)), title);
    }
  });
  it('a barcode that only partly matches gives no alias', async () => {
    for (const code of ['15449000022431', '54490000224315', '544900002243']) {
      const { service, verdicts } = setup({ off: off(), sources: [[result(`Coca-Cola Zero Orange ${code}`, 'shop-one.rs', '')]] });
      await scan(service, ORANGE_BARCODE);
      assert.equal(verdicts()[0].alias, null, code);
    }
  });
  it('without the exact barcode in the result nothing changes', async () => {
    const { service, calls } = setup({ off: off(), sources: [[result('Coca Cola Zero Orange', 'ozon.ru', ''), result('Coca Cola Zero Orange 1.5', 'vprok.ru', '')]] });
    await scan(service, ORANGE_BARCODE);
    assert.ok(calls.queries.every((query) => !/zero/i.test(query)));
  });
  it('sources that disagree give no enrichment', async () => {
    const { service, calls } = setup({ off: off(), sources: [[result('Coca-Cola Zero Orange', 'ozon.ru'), result('Coca-Cola Orange Vanilla', 'vprok.ru')]] });
    await scan(service, ORANGE_BARCODE);
    assert.ok(calls.queries.every((query) => !/zero|vanilla/i.test(query)));
  });
  it('a result listing several variants is not a product name', async () => {
    const { service, calls } = setup({ off: off(), sources: [[result('Coca-Cola Orange Zero Vanilla', 'ozon.ru')]] });
    await scan(service, ORANGE_BARCODE);
    assert.ok(calls.queries.every((query) => !/zero|vanilla/i.test(query)));
  });
  it('7. after the enrichment another real variant is still rejected', async () => {
    for (const title of ['Coca-Cola Zero Sugar Vanilla', 'Coca-Cola Zero Orange Cream', 'Coca-Cola Original']) {
      const { service, calls } = setup({ off: off(), ...official(html({ ...facts, title }), `${title} | Coca-Cola`) });
      const scanned = await scan(service, ORANGE_BARCODE);
      assert.ok(!calls.reads.includes('coca-cola.com'), title); assert.equal(scanned.status, undefined, title);
      const barcoded = setup({ off: off(), pages: { 'coca-cola.com': html({ ...facts, title, barcode: ORANGE_BARCODE }) }, sources: [q1, [], [{ url: `https://coca-cola.com/${ORANGE_BARCODE}`, title: 'Товар', domain: 'coca-cola.com' }]] });
      await scan(barcoded.service, ORANGE_BARCODE);
      assert.equal(barcoded.verdicts()[0].pages.at(-1).reason, 'variant_mismatch', title);
    }
  });
  it('8. nutrition in a search snippet is never accepted', async () => {
    const snippet = result('Coca-Cola Zero Orange 1.5L', 'ozon.ru', `${ORANGE_BARCODE} Пищевая ценность на 100 мл: 1 ккал, белки 0 г, углеводы 0 г, сахара 0 г, жиры 0 г, насыщенные 0 г, соль 0,02 г`);
    const { service, verdicts } = setup({ off: off(), sources: [[snippet]], closed: ['ozon.ru'] });
    const scanned = await scan(service, ORANGE_BARCODE);
    assert.equal(scanned.product.nutrition?.sugarsG.value ?? null, null); assert.equal(scanned.status, undefined);
    assert.equal(verdicts()[0].accepted.length, 0);
  });
  describe('6. broken nutrition on the page', () => {
    const page = html(facts);
    const cases: readonly (readonly [string, string, RegExp])[] = [
      ['negative value', page.replace('сахара 0 г', 'сахара -5 г'), /malformed_nutrition/],
      ['unfilled template', page.replace('сахара 0 г', 'сахара {{sugars}} г'), /malformed_nutrition/],
      ['NaN', page.replace('сахара 0 г', 'сахара NaN г'), /malformed_nutrition/],
      ['impossible value', page.replace('сахара 0 г', 'сахара 12000 г'), /malformed_nutrition/],
      ['impossible kcal', page.replace('1 ккал', '4200 ккал'), /malformed_nutrition/],
      ['sugars over carbs', page.replace('сахара 0 г', 'сахара 30 г'), /sugars_over_carbs/],
      ['saturated fat over fat', page.replace('насыщенные 0 г', 'насыщенные 9 г'), /saturated_fat_over_fat/],
      ['kcal far from macros', page.replace('1 ккал', '400 ккал'), /kcal_differs_from_macros/],
      ['mass over 100', page.replace('белки 0 г', 'белки 60 г').replace('углеводы 0 г', 'углеводы 60 г'), /mass_over_100/],
    ];
    for (const [name, broken, reason] of cases) {
      it(`${name}: the page is rejected and nothing reaches the score`, async () => {
        const { service, verdicts, calls } = setup({ off: off(), ...official(broken) });
        const scanned = await scan(service, ORANGE_BARCODE);
        assert.match(verdicts()[0].pages.at(-1).reason, reason);
        assert.equal(typeof scanned.score.value, 'number'); assert.equal(scanned.status, undefined); assert.equal(calls.aiText, 0);
      });
    }
    it('broken JSON-LD and embedded JSON are rejected the same way', async () => {
      const ld = `<title>${OFFICIAL}</title><script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: 'Coca-Cola Zero Orange', nutrition: { servingSize: '100 ml', calories: '1 kcal', proteinContent: '0 g', carbohydrateContent: '0 g', fatContent: '0 g', sugarContent: '-2 g' } })}</script>`;
      const json = `<title>${OFFICIAL}</title><script type="application/json">${JSON.stringify({ product: { nutrition: { per: 'на 100 мл', calories: 1, proteins: 0, carbohydrates: 0, fat: 0, sugars: '{{value}}' } } })}</script>`;
      for (const broken of [ld, json]) {
        const { service, verdicts } = setup({ off: off(), ...official(broken) });
        await scan(service, ORANGE_BARCODE);
        assert.equal(verdicts()[0].pages.at(-1).reason, 'malformed_nutrition');
      }
    });
    it('a dash after a label is not a minus', async () => {
      const { service } = setup({ off: off(), ...official(page.replace('соль 0.02 г', 'соль - 0.02 г')) });
      assert.notEqual((await scan(service, ORANGE_BARCODE)).score.value, null);
    });
    it('AI values go through the same checks', async () => {
      const text = `<title>${OFFICIAL}</title><p>Пищевая ценность: белки 0, жиры 0, углеводы 0, сахара 30, насыщенные 0, калорийность 1 на 100 мл</p>`;
      const { service, verdicts } = setup({ off: off(), ...official(text), aiPages: [{ id: 2, kcal: 1, protein: 0, carbs: 0, fat: 0, sugars: 30, saturatedFat: 0, salt: null, sodiumMg: null, fiber: null }] });
      const scanned = await scan(service, ORANGE_BARCODE);
      assert.equal(typeof scanned.score.value, 'number'); assert.match(verdicts()[0].pages.at(-1).reason, /sugars_over_carbs/);
    });
  });
});

describe('Web fallback: identity read outside the allowlist', () => {
  const off = () => mapOpenFoodFactsProduct({ product_name: 'Coca Cola Orange' }, ORANGE_BARCODE);
  const hit = (domain: string, title = 'Proizvodi', snippet = ''): DiscoveredSource => ({ url: `https://${domain}/${ORANGE_BARCODE}`, title, domain, snippet });
  const facts = { barcode: ORANGE_BARCODE, per: '100 мл', kcal: 1, protein: 0, carbs: 0, fat: 0, sugars: 0, saturated: 0, salt: 0.02 };
  const shopPage = html({ ...facts, title: 'Coca-Cola Zero Orange 1.5L' });
  const reason = (logs: { message: string; fields: any }[], domain: string) => logs.find((line) => line.message === 'web_candidate' && line.fields.domain === domain)?.fields.reason;

  it('exact barcode outside the allowlist: the page gives the name and display-only ingredients, and its numbers go nowhere', async () => {
    const { service, calls, logs, verdicts } = setup({ off: off(), pages: { 'plitvicemarketi.rs': shopPage }, sources: [[hit('plitvicemarketi.rs')]], debug: true });
    const scanned = await scan(service, ORANGE_BARCODE);
    assert.deepEqual(calls.reads, ['plitvicemarketi.rs']); assert.equal(verdicts()[0].identityReads, 1);
    assert.equal(verdicts()[0].alias, 'Coca-Cola zero orange');
    assert.equal(logs.find((line) => line.message === 'identity_enrichment')!.fields.provisional, true);
    for (const query of calls.queries.slice(1).filter((item) => !/^\d/.test(item))) assert.match(query, /Coca-Cola zero orange/);
    assert.equal(scanned.product.nutrition?.sugarsG.value ?? null, null, 'nutrition is ignored');
    assert.equal(scanned.product.fieldEvidence!.find((item) => item.field === 'ingredients')!.ingredientsOnly, undefined, 'the exact barcode on the page confirms the ingredients');
    assert.equal(typeof scanned.score.value, 'number'); assert.equal(scanned.status, undefined);
    assert.deepEqual(verdicts()[0].pages, [], 'the page never reaches verification'); assert.equal(calls.aiText, 0); assert.equal(calls.ai, 0);
    assert.equal(reason(logs, 'plitvicemarketi.rs'), 'identity_read_only');
  });
  const official = { url: 'https://coca-cola.com/zero-orange', title: 'Coca-Cola Zero Sugar Orange | Coca-Cola', domain: 'coca-cola.com' };
  const name = 'Coca-Cola Zero Orange 1.5L';
  const fromList = (extra: Partial<Setup> & { readonly second?: readonly DiscoveredSource[]; readonly third?: readonly DiscoveredSource[] } = {}) => {
    const { second = [], third = [official], ...rest } = extra;
    return setup({ off: off(), pages: { 'plitvicemarketi.rs': shopPage, 'coca-cola.com': html({ ...facts, title: official.title, barcode: null }) }, sources: [[hit('plitvicemarketi.rs')], second, third], ...rest });
  };
  it('1–3. a weak list page gives the alias, the official page is read, and without a second confirmation nothing is accepted', async () => {
    const { service, calls, verdicts } = fromList();
    const scanned = await scan(service, ORANGE_BARCODE);
    assert.equal(verdicts()[0].alias, 'Coca-Cola zero orange'); assert.equal(verdicts()[0].aliasState, 'provisional'); assert.equal(verdicts()[0].aliasStrength, 'weak');
    assert.deepEqual(calls.reads, ['plitvicemarketi.rs', 'coca-cola.com']);
    assert.equal(verdicts()[0].pages.at(-1).reason, 'no_reference_without_barcode');
    assert.equal(scanned.product.nutrition?.sugarsG.value ?? null, null);
    assert.equal(scanned.product.fieldEvidence!.find((item) => item.field === 'ingredients')!.domain, 'plitvicemarketi.rs', 'not from the unconfirmed official page');
    assert.equal(typeof scanned.score.value, 'number'); assert.equal(scanned.status, undefined); assert.equal(calls.ai, 0);
  });
  it('4. a second independent result with the same brand and variant allows the official nutrition', async () => {
    const { service, verdicts } = fromList({ second: [{ url: 'https://shop-two.ba/p', title: name, domain: 'shop-two.ba' }] });
    const scanned = await scan(service, ORANGE_BARCODE);
    assert.equal(verdicts()[0].aliasState, 'confirmed'); assert.equal(verdicts()[0].aliasConfirmedBy, 'shop-two.ba');
    assert.equal(scanned.product.nutrition!.saltG.value, 0.02); assert.notEqual(scanned.score.value, null);
  });
  it('another strong source with the barcode allows it too', async () => {
    const { service } = fromList({ second: [{ url: `https://ozon.ru/${ORANGE_BARCODE}`, title: name, domain: 'ozon.ru' }], third: [official], pages: { 'plitvicemarketi.rs': shopPage, 'ozon.ru': '<title>x</title>', 'coca-cola.com': html({ ...facts, title: official.title, barcode: null }) } });
    assert.notEqual((await scan(service, ORANGE_BARCODE)).score.value, null);
  });
  it('the exact barcode on the official page itself allows it', async () => {
    const { service, verdicts } = fromList({ pages: { 'plitvicemarketi.rs': shopPage, 'coca-cola.com': html({ ...facts, title: official.title }) } });
    const scanned = await scan(service, ORANGE_BARCODE);
    assert.equal(verdicts()[0].aliasState, 'provisional'); assert.notEqual(scanned.score.value, null);
  });
  it('results of a search by name, and the official page itself, confirm nothing', async () => {
    const { service, verdicts } = fromList({ third: [official, { url: 'https://shop-two.ba/p', title: name, domain: 'shop-two.ba' }] });
    const scanned = await scan(service, ORANGE_BARCODE);
    assert.equal(verdicts()[0].aliasState, 'provisional'); assert.equal(typeof scanned.score.value, 'number');
    const self = fromList({ second: [official] });
    assert.equal(typeof (await scan(self.service, ORANGE_BARCODE)).score.value, 'number', 'source confirmation and final estimation are separate');
  });
  it('a search or tag page of a big retailer is a weak source', async () => {
    const list = { url: `https://ozon.ru/search?text=${ORANGE_BARCODE}`, title: name, domain: 'ozon.ru' };
    const { service, verdicts } = setup({ off: off(), pages: { 'coca-cola.com': html({ ...facts, title: official.title, barcode: null }) }, sources: [[list], [], [official]] });
    const scanned = await scan(service, ORANGE_BARCODE);
    assert.equal(verdicts()[0].aliasStrength, 'weak'); assert.equal(typeof scanned.score.value, 'number');
  });
  it('the same site does not confirm itself', async () => {
    const { service } = fromList({ second: [{ url: 'https://plitvicemarketi.rs/other', title: name, domain: 'plitvicemarketi.rs' }] });
    assert.equal(typeof (await scan(service, ORANGE_BARCODE)).score.value, 'number');
  });
  it('5. a conflicting second result with the barcode rejects, and the alias stays for the search', async () => {
    const conflict = { url: 'https://shop-two.ba/p', title: `Coca-Cola Orange Vanilla ${ORANGE_BARCODE}`, domain: 'shop-two.ba' };
    const confirm = { url: 'https://shop-three.ba/p', title: name, domain: 'shop-three.ba' };
    const { service, calls, verdicts } = fromList({ second: [conflict, confirm] });
    const scanned = await scan(service, ORANGE_BARCODE);
    assert.equal(verdicts()[0].aliasState, 'conflict'); assert.equal(typeof scanned.score.value, 'number'); assert.equal(scanned.status, undefined);
    assert.match(calls.queries[1]!, /zero orange/);
  });
  it('an Orange Cream result without the barcode is not a conflict', async () => {
    const { service, verdicts } = fromList({ second: [{ url: 'https://shop-two.ba/p', title: name, domain: 'shop-two.ba' }, { url: 'https://pops.example/p', title: 'Coca-Cola Orange Cream', domain: 'pops.example' }] });
    await scan(service, ORANGE_BARCODE);
    assert.equal(verdicts()[0].aliasState, 'confirmed');
  });
  it('6. the Tavily extract fallback stays within its limit, whatever failed', async () => {
    const { service, calls } = fromList({ closed: ['plitvicemarketi.rs', 'coca-cola.com'], extractable: { 'plitvicemarketi.rs': shopPage, 'coca-cola.com': html({ ...facts, title: official.title, barcode: null }) } });
    await scan(service, ORANGE_BARCODE); await scan(service, ORANGE_BARCODE);
    assert.ok(calls.extracts.length <= MAX_EXTRACTS_PER_PRODUCT);
  });
  it('the text AI is not spent on a page that could not be accepted', async () => {
    const text = `<title>${official.title}</title><p>Пищевая ценность: белки 0, жиры 0, углеводы 0</p>`;
    const { service, calls } = fromList({ pages: { 'plitvicemarketi.rs': shopPage, 'coca-cola.com': text } });
    await scan(service, ORANGE_BARCODE);
    assert.equal(calls.aiText, 0);
  });
  it('a listing page: only the text near the barcode names the product', async () => {
    const page = `<title>Proizvodi</title><p>${'Fanta Lemon 1L Sprite 2L '.repeat(20)}</p><p>Coca Cola Zero Orange 1.5L šifra ${ORANGE_BARCODE}</p><p>${'Pepsi Max Vanilla '.repeat(20)}</p>`;
    const { service, verdicts } = setup({ off: off(), pages: { 'plitvicemarketi.rs': page }, sources: [[hit('plitvicemarketi.rs')]] });
    await scan(service, ORANGE_BARCODE);
    assert.equal(verdicts()[0].alias, 'Coca-Cola zero orange');
  });
  it('a listing in a search snippet: the same, by the text near the barcode', async () => {
    const snippet = `${'Fanta Lemon 1L Pepsi Vanilla '.repeat(30)} Coca Cola Zero Orange 1.5L ${ORANGE_BARCODE} ${'Sprite Lime 2L '.repeat(30)}`;
    const { service, calls, verdicts } = setup({ off: off(), sources: [[hit('plitvicemarketi.rs', 'Proizvodi', snippet)]] });
    await scan(service, ORANGE_BARCODE);
    assert.equal(verdicts()[0].alias, 'Coca-Cola zero orange'); assert.equal(calls.reads.length, 1, 'read for ingredients: the name came from the snippet');
  });
  it('a foreign brand on the page gives no alias', async () => {
    for (const title of ['Fanta Zero Orange 1.5L', 'Pepsi Zero Orange 1.5L']) {
      const { service, calls, verdicts } = setup({ off: off(), pages: { 'plitvicemarketi.rs': html({ ...facts, title }) }, sources: [[hit('plitvicemarketi.rs')]] });
      await scan(service, ORANGE_BARCODE);
      assert.equal(calls.reads.length, 1); assert.equal(verdicts()[0].alias, null, title);
      assert.ok(calls.queries.every((query) => !/zero/i.test(query)), title);
    }
  });
  it('a page that does not carry the barcode gives no alias, when only the snippet had it', async () => {
    const source = { url: 'https://plitvicemarketi.rs/p', title: 'Proizvodi', domain: 'plitvicemarketi.rs', snippet: `EAN ${ORANGE_BARCODE}` };
    const { service, verdicts } = setup({ off: off(), pages: { 'plitvicemarketi.rs': html({ ...facts, barcode: null, title: 'Coca-Cola Zero Orange' }) }, sources: [[source]] });
    await scan(service, ORANGE_BARCODE);
    assert.equal(verdicts()[0].alias, null);
  });
  it('a partial barcode: the page is not read', async () => {
    for (const code of ['15449000022431', '54490000224315', '544900002243']) {
      const source = { url: `https://plitvicemarketi.rs/${code}`, title: `Proizvod ${code}`, domain: 'plitvicemarketi.rs' };
      const { service, calls } = setup({ off: off(), pages: { 'plitvicemarketi.rs': shopPage }, sources: [[source]] });
      await scan(service, ORANGE_BARCODE);
      assert.deepEqual(calls.reads, [], code);
    }
  });
  it('one identity read per product, within the limit of 3 reads, also on a repeated scan', async () => {
    const { service, calls, verdicts } = setup({ off: off(), sources: [[hit('one.rs'), hit('two.rs')], [hit('three.rs')], [], []] });
    await scan(service, ORANGE_BARCODE); await scan(service, ORANGE_BARCODE);
    assert.equal(calls.reads[0], 'one.rs'); assert.equal(verdicts()[0].identityReads, 1); assert.ok(calls.reads.length <= MAX_PAGES_PER_SCAN);
  });
  it('it counts towards the reads', async () => {
    const domains = ['ozon.ru', 'vprok.ru', 'lenta.com', 'auchan.ru'];
    const pages = Object.fromEntries(domains.map((domain) => [domain, html({ title: 'Coca Cola Orange', barcode: null, sugars: null })]));
    const { service, calls } = setup({ off: off(), pages, sources: [[hit('one.rs')], domains.map((domain) => ({ url: `https://${domain}/p`, title: 'Coca Cola Orange', domain })), [], []] });
    await scan(service, ORANGE_BARCODE);
    assert.equal(calls.reads.length, 5); assert.ok(calls.reads.length <= MAX_PAGES_PER_SCAN); assert.equal(calls.reads[0], 'one.rs');
  });
  it('a closed page is not retried: one Tavily extract within the limit, and its data is ignored too', async () => {
    const { service, calls, verdicts } = setup({ off: off(), sources: [[hit('plitvicemarketi.rs')]], closed: ['plitvicemarketi.rs'], extractable: { 'plitvicemarketi.rs': shopPage } });
    const scanned = await scan(service, ORANGE_BARCODE);
    assert.deepEqual(calls.reads, ['plitvicemarketi.rs']); assert.equal(calls.extracts.length, 1);
    assert.equal(verdicts()[0].alias, 'Coca-Cola zero orange'); assert.equal(verdicts()[0].credits, calls.queries.length + 1);
    assert.equal(scanned.product.nutrition?.sugarsG.value ?? null, null);
  });
  it('the log has the text around the barcode and the brand, far from the start, and not the whole text', async () => {
    const snippet = `${'x'.repeat(3000)} Coca Cola Zero Orange 1.5L šifra ${ORANGE_BARCODE} ${'y'.repeat(3000)}`;
    const { service, logs } = setup({ off: off(), sources: [[hit('plitvicemarketi.rs', 'Proizvodi', snippet)]], debug: true });
    await scan(service, ORANGE_BARCODE);
    const contexts: string[] = logs.find((line) => line.message === 'identity_context')!.fields.contexts;
    assert.ok(contexts.some((text) => text.includes(ORANGE_BARCODE) && text.includes('Zero Orange')));
    assert.ok(contexts.every((text) => text.length < 200)); assert.ok(!contexts.join('').includes('x'.repeat(100)));
    assert.equal(logs.find((line) => line.message === 'identity_enrichment')!.fields.alias, 'Coca-Cola zero orange');
  });
});

describe('Web fallback: ingredients apart from nutrition', () => {
  const CODE = '4605496000815';
  const NAME = 'Пюре картофельное Роллтон с куриным вкусом 40 г';
  const offRollton = (ingredients?: string) => mapOpenFoodFactsProduct(nutrients(energy(350, 6, 65, 7.5), { product_name: 'Картофельное Пюре С Куриным Вкусом', brands: 'Роллтон', ingredients_text: ingredients, allergens_tags: undefined, traces_tags: undefined, additives_tags: undefined }), CODE)!;
  const result = (domain: string, title = NAME, snippet = `Штрихкод ${CODE}`): DiscoveredSource => ({ url: `https://${domain}/p`, title, domain, snippet });
  const page = (title = NAME, code: string | null = CODE, section = 'Ингредиенты') => `<title>${title}</title><p>${code ? `Штрихкод: ${code}` : ''}</p><h2>${section}</h2><p>хлопья картофельные, ароматизатор курица, соль поваренная</p><p>Пищевая ценность на 100 г: 350 ккал, белки 6 г, углеводы 65 г, сахара 5 г, жиры 7,5 г, насыщенные 2 г, соль 3 г</p>`;
  async function flow(run: () => Promise<unknown>) {
    const lines: string[] = [];
    const capture = (message: unknown) => { lines.push(String(message)); };
    Logger.overrideLogger({ log: capture, warn: capture, error: capture, debug: capture, verbose: capture });
    try { await run(); } finally { Logger.overrideLogger(false); }
    return JSON.parse(lines.find((line) => line.startsWith('scan_flow '))!.slice('scan_flow '.length));
  }

  it('outside the allowlist + exact barcode + the right product: ingredients are accepted, nutrition remains unknown', async () => {
    const { service, calls, verdicts } = setup({ off: offRollton(), pages: { 'alania-market.ru': page() }, sources: [[result('alania-market.ru')]] });
    const scanned = await scan(service, CODE);
    assert.deepEqual(calls.reads, ['alania-market.ru']);
    assert.deepEqual(scanned.product.ingredients.value!.map((item) => item.name), ['хлопья картофельные', 'ароматизатор курица', 'соль поваренная']);
    const evidence = scanned.product.fieldEvidence!.find((item) => item.field === 'ingredients')!;
    assert.deepEqual([evidence.domain, evidence.tier, evidence.confidence, evidence.identityMatch, evidence.ingredientsOnly], ['alania-market.ru', 4, 'medium', 'exact_barcode', undefined]);
    assert.equal(scanned.product.confidence.ingredients, 'medium');
    const n = scanned.product.nutrition!;
    assert.deepEqual([n.caloriesKcal.value, n.proteinG.value, n.sugarsG.value, n.saturatedFatG.value, n.saltG.value], [350, 6, null, null, null], 'one weak page does not supply reliable nutrients');
    assert.deepEqual(scanned.product.fieldEvidence!.filter((item) => item.dataQuality === 'estimated').map((item) => item.field), []);
    assert.equal(scanned.product.allergens.value, null); assert.deepEqual(scanned.product.additives.value, [{ code: null, name: 'ароматизатор курица' }], 'parsed from the confirmed ingredients');
    assert.notEqual(scanned.score.value, null); assert.equal(scanned.score.confidence, 'low'); assert.ok(!verdicts()[0].accepted.includes('sugarsG'));
  });
  it('the sections Состав продукта and Состав: work too, a placeholder does not', async () => {
    for (const section of ['Состав продукта', 'Состав продукта:', 'Состав:']) {
      const { service } = setup({ off: offRollton(), pages: { 'alania-market.ru': page(NAME, CODE, section) }, sources: [[result('alania-market.ru')]] });
      assert.equal((await scan(service, CODE)).product.ingredients.value?.length, 3, section);
    }
    const stub = `<title>${NAME}</title><p>${CODE}</p><h2>Ингредиенты</h2><p>нет данных об этом продукте</p>`;
    const { service } = setup({ off: offRollton(), pages: { 'alania-market.ru': stub }, sources: [[result('alania-market.ru')]] });
    assert.equal((await scan(service, CODE)).product.ingredients.value, null);
  });
  it('wrong brand, wrong variant, other name or no barcode on the page: rejected, with the reason in scan_flow', async () => {
    const cases: readonly (readonly [string, string, string])[] = [
      ['brand_mismatch', page('Пюре картофельное Доширак с куриным вкусом 40 г'), NAME],
      ['variant_conflict', page('Пюре картофельное Роллтон с куриным вкусом и кремом 40 г'), NAME],
      ['name_mismatch', page('Лапша Роллтон с курицей 40 г'), NAME],
      ['name_mismatch', page('Роллтон картофельное пюре', null), NAME],
    ];
    for (const [reason, body, title] of cases) {
      const { service } = setup({ off: offRollton(), pages: { 'alania-market.ru': body }, sources: [[result('alania-market.ru', title)]] });
      const line = await flow(async () => assert.equal((await scan(service, CODE)).product.ingredients.value, null, reason));
      assert.deepEqual([line.ingredients_found, line.ingredients_accepted, line.ingredients_rejected, line.reject_reason], [true, false, true, reason]);
    }
  });
  it('scan_flow names the source of accepted ingredients', async () => {
    const { service } = setup({ off: offRollton(), pages: { 'alania-market.ru': page() }, sources: [[result('alania-market.ru')]] });
    const line = await flow(() => scan(service, CODE));
    assert.deepEqual([line.ingredients_found, line.ingredients_source, line.ingredients_accepted, line.ingredients_rejected, line.reject_reason], [true, 'alania-market.ru', true, false, null]);
  });
  it('a page with the barcode and another recipe gives neither nutrition nor ingredients', async () => {
    const other = page().replace('350 ккал, белки 6 г, углеводы 65 г', '145 ккал, белки 3 г, углеводы 20 г').replace('жиры 7,5 г', 'жиры 4 г');
    const { service, verdicts } = setup({ off: offRollton(), pages: { 'perekrestok.ru': other }, sources: [[result('perekrestok.ru')], [], [], []] });
    const scanned = await scan(service, CODE);
    assert.equal(verdicts()[0].pages.at(-1).status, 'recipe_version_conflict', 'another recipe, the 145 kcal stay rejected');
    assert.equal(scanned.product.nutrition!.sugarsG.value, null); assert.equal(scanned.product.ingredients.value, null);
  });
  it('an accepted page gives ingredients without new nutrition', async () => {
    const body = `<title>${NAME}</title><p>Штрихкод: ${CODE}. Ингредиенты: хлопья картофельные, соль поваренная. Пищевая ценность на 100 г: 350 ккал, белки 6 г, углеводы 65 г, жиры 7,5 г</p>`;
    const { service, verdicts } = setup({ off: offRollton(), pages: { 'perekrestok.ru': body }, sources: [[result('perekrestok.ru')]] });
    const scanned = await scan(service, CODE);
    assert.equal(verdicts()[0].pages.at(-1).status, 'accepted'); assert.equal(scanned.product.ingredients.value?.length, 2);
    assert.equal(scanned.product.fieldEvidence!.find((item) => item.field === 'ingredients')!.ingredientsOnly, undefined);
  });
  it('full OFF identity and ingredients: one shop page is read for nutrition, alone it leaves nutrients unknown', async () => {
    const { service, calls, verdicts } = setup({ off: offRollton('мука, соль поваренная'), pages: { 'alania-market.ru': page() }, sources: [[result('alania-market.ru')]] });
    const scanned = await scan(service, CODE);
    assert.deepEqual(calls.reads, ['alania-market.ru']); assert.equal(verdicts()[0].identityReads, 0);
    assert.equal(scanned.product.nutrition!.sugarsG.value, null);
    assert.equal(scanned.product.ingredients.value?.[0]?.name, 'мука', 'OFF stays');
  });
  it('a page that did not open is read through the one Tavily extract', async () => {
    const { service, calls } = setup({ off: offRollton(), sources: [[result('selvis.com')]], closed: ['selvis.com'], extractable: { 'selvis.com': page() } });
    const scanned = await scan(service, CODE);
    assert.equal(calls.extracts.length, 1); assert.equal(scanned.product.ingredients.value?.length, 3);
  });
  it('the page that names the product is read first', async () => {
    const { service, calls } = setup({ off: offRollton(), pages: { 'alania-market.ru': page() }, sources: [[result('selvis.com', 'Пюре картофельное Роллтон куриное'), result('alania-market.ru')]] });
    await scan(service, CODE);
    assert.equal(calls.reads[0], 'alania-market.ru');
  });
  it('ingredients from a page without the barcode change neither Product Score nor Goal Match', async () => {
    const trusted = html({ title: NAME, barcode: CODE, kcal: 350, protein: 6, carbs: 65, fat: 7.5, sugars: 2, saturated: 2, salt: 3 }).replace(/Состав:[^.]*\./, '');
    const closed = setup({ off: offRollton(), pages: { 'ozon.ru': trusted }, sources: [[result('alania-market.ru')], [result('ozon.ru')]], closed: ['alania-market.ru'] });
    const open = setup({ off: offRollton(), pages: { 'ozon.ru': trusted, 'alania-market.ru': page().replaceAll(CODE, '') }, sources: [[result('alania-market.ru')], [result('ozon.ru')]] });
    const without = await scan(closed.service, CODE);
    const withIngredients = await scan(open.service, CODE);
    assert.equal(without.product.fieldEvidence!.some((item) => item.field === 'ingredients'), false);
    assert.notEqual(withIngredients.score.value, null);
    assert.deepEqual(withIngredients.score, without.score); assert.deepEqual(withIngredients.goalMatch, without.goalMatch);
    assert.deepEqual(withIngredients.product.semantics, without.product.semantics);
  });
  it('weak ingredients do not stop a real ingredients photo from reaching Gemini', async () => {
    const trusted = html({ title: NAME, barcode: CODE, kcal: 350, protein: 6, carbs: 65, fat: 7.5, sugars: 2, saturated: 2, salt: 3 }).replace(/Состав:[^.]*\./, '');
    const { service, calls } = setup({ off: offRollton(), pages: { 'ozon.ru': trusted, 'alania-market.ru': page().replaceAll(CODE, '') }, sources: [[result('alania-market.ru')], [result('ozon.ru')]] });
    await service.analyze({ ...FILE }, 'user', { barcode: CODE, roles: ['ingredients'] }).then(sourceEvidenceView);
    assert.equal(calls.ai, 1);
  });
});

describe('Web fallback: per-field enrichment', () => {
  const CODE = '4605496000815';
  const NAME = 'Пюре картофельное Роллтон с куриным вкусом 40 г';
  const LIST = 'картофельные хлопья, соль поваренная, ароматизатор курица';
  const off = (extra: Record<string, unknown> = {}) => mapOpenFoodFactsProduct(nutrients(energy(350, 6, 65, 7.5), { product_name: 'Картофельное Пюре С Куриным Вкусом', brands: 'Роллтон', ingredients_text: undefined, allergens_tags: undefined, traces_tags: undefined, additives_tags: undefined, ...extra }), CODE)!;
  const result = (domain: string, title = NAME, snippet = ''): DiscoveredSource => ({ url: `https://${domain}/product`, title, domain, snippet });
  const card = (title = NAME, section = `Состав: ${LIST}`, code: string | null = CODE) => `<title>${title}</title><p>${code ? `Штрихкод: ${code}` : ''}</p><p>${section}</p>`;
  const source = (scanned: Awaited<ReturnType<typeof scan>>) => scanned.product.fieldEvidence?.find((item) => item.field === 'ingredients');

  it('barcode → identity → ingredients from a retailer', async () => {
    const { service } = setup({ off: off(), pages: { 'perekrestok.ru': card() }, sources: [[result('perekrestok.ru', NAME, CODE)]] });
    const scanned = await scan(service, CODE);
    assert.equal(scanned.product.ingredients.value?.length, 3); assert.equal(source(scanned)!.domain, 'perekrestok.ru');
  });
  it('ingredients from the manufacturer', async () => {
    const { service } = setup({ off: off(), pages: { 'rollton.ru': card() }, sources: [[result('rollton.ru', NAME, CODE)]] });
    const scanned = await scan(service, CODE);
    assert.equal(source(scanned)!.tier, 1); assert.equal(scanned.product.ingredients.value?.length, 3);
  });
  it('ingredients from a database', async () => {
    const { service } = setup({ off: off(), pages: { 'fatsecret.ru': card() }, sources: [[result('fatsecret.ru', NAME, CODE)]] });
    assert.equal(source(await scan(service, CODE))!.tier, 3);
  });
  it('a retailer outside the allowlist, without the barcode on the page: exact name is enough, confidence stays medium', async () => {
    const { service } = setup({ off: off(), pages: { 'unlisted-market.ru': card(NAME, `Ингредиенты: ${LIST}`, null) }, sources: [[], [], [result('unlisted-market.ru')]] });
    const scanned = await scan(service, CODE);
    assert.equal(scanned.product.ingredients.value?.length, 3); assert.deepEqual([source(scanned)!.tier, source(scanned)!.confidence, source(scanned)!.identityMatch], [4, 'medium', 'exact_name']);
  });
  it('wrong brand or wrong variant are rejected without a barcode too', async () => {
    for (const [title, reason] of [['Пюре картофельное Доширак с куриным вкусом 40 г', 'brand_mismatch'], ['Пюре картофельное Роллтон с куриным вкусом и кремом 40 г', 'variant_conflict']] as const) {
      const { service } = setup({ off: off(), pages: { 'perekrestok.ru': card(title, undefined, null) }, sources: [[result('perekrestok.ru')]] });
      assert.equal((await scan(service, CODE)).product.ingredients.value, null, reason);
    }
  });
  it('a page that only matches a weak alias is not accepted without the barcode', async () => {
    const ORANGE = mapOpenFoodFactsProduct({ product_name: 'Coca Cola Orange' }, ORANGE_BARCODE);
    const weak = { url: `https://shop.rs/${ORANGE_BARCODE}`, title: 'Coca-Cola Zero Orange 1.5L', domain: 'shop.rs' };
    const { service } = setup({ off: ORANGE, pages: { 'shop.rs': '<title>x</title>', 'ozon.ru': card('Coca-Cola Zero Orange 1.5L', undefined, null) }, sources: [[weak], [], [{ url: 'https://ozon.ru/p', title: 'Coca-Cola Zero Orange 1.5L', domain: 'ozon.ru' }]] });
    assert.equal((await scan(service, ORANGE_BARCODE)).product.ingredients.value, null);
  });
  it('a weak name match without the barcode is not accepted', async () => {
    const { service } = setup({ off: off(), pages: { 'perekrestok.ru': card('Роллтон пюре 40 г', undefined, null) }, sources: [[result('perekrestok.ru', 'Роллтон пюре 40 г')]] });
    assert.equal((await scan(service, CODE)).product.ingredients.value, null);
  });
  it('a search, category or tag page is rejected and not read', async () => {
    for (const url of ['https://shop.example/search?q=4605496000815', 'https://shop.example/catalog/pure', 'https://barcode-list.ru/barcode/RU/%D0%9F%D0%BE%D0%B8%D1%81%D0%BA.htm', 'https://shop.example/tag/rollton']) {
      const { service, calls } = setup({ off: off(), pages: { 'shop.example': card(), 'barcode-list.ru': card() }, sources: [[{ url, title: NAME, domain: new URL(url).hostname, snippet: CODE }]] });
      const scanned = await scan(service, CODE);
      assert.equal(scanned.product.ingredients.value, null, url); assert.deepEqual(calls.reads, [], url);
    }
  });
  it('a page with many barcodes is a list, even at an ordinary address', async () => {
    const many = ['4605496000815', '4605496000816', '4605496000817', '4605496000818'].join(' ');
    const { service } = setup({ off: off(), pages: { 'perekrestok.ru': card(NAME, `Коды ${many}. Состав: ${LIST}`) }, sources: [[result('perekrestok.ru', NAME, CODE)]] });
    assert.equal((await scan(service, CODE)).product.ingredients.value, null);
  });
  it('Wikipedia, YouTube and forums are not read for ingredients', async () => {
    const domains = ['ru.wikipedia.org', 'youtube.com', 'forum.food.ru'];
    const { service, calls } = setup({ off: off(), pages: Object.fromEntries(domains.map((domain) => [domain, card()])), sources: [domains.map((domain) => result(domain, NAME, CODE))] });
    await scan(service, CODE);
    assert.deepEqual(calls.reads, []);
  });
  it('ingredients accepted while nutrition of the same page is rejected for another reason', async () => {
    const page = `${card()}<p>Пищевая ценность на 100 г: 350 ккал, белки 6 г, сахара 5 г, насыщенные 2 г, соль 3 г</p>`;
    const { service, verdicts } = setup({ off: off(), pages: { 'unknown-market.ru': page }, sources: [[result('unknown-market.ru', NAME, CODE)]] });
    const scanned = await scan(service, CODE);
    assert.equal(verdicts()[0].pages.at(-1).reason, 'needs_second_source');
    assert.equal(scanned.product.nutrition!.sugarsG.value, null); assert.equal(scanned.product.ingredients.value?.length, 3);
    assert.equal(source(scanned)!.ingredientsOnly, undefined);
  });
  it('nutrition accepted while the page has no ingredients; nutrition and ingredients come from different sources', async () => {
    const facts = html({ title: NAME, barcode: CODE, kcal: 350, protein: 6, carbs: 65, fat: 7.5, sugars: 2, saturated: 2, salt: 3 }).replace(/Состав:[^.]*\./, '');
    const { service } = setup({ off: off(), pages: { 'ozon.ru': facts, 'dixy.ru': card() }, sources: [[result('dixy.ru', NAME, CODE), result('ozon.ru', NAME, CODE)]] });
    const scanned = await scan(service, CODE);
    const evidence = scanned.product.fieldEvidence!;
    assert.equal(evidence.find((item) => item.field === 'sugarsG')!.domain, 'ozon.ru'); assert.equal(source(scanned)!.domain, 'dixy.ru');
    assert.equal(source(scanned)!.url, 'https://dixy.ru/product'); assert.equal(source(scanned)!.confidence, 'medium');
    assert.equal(scanned.product.ingredients.provenance, 'web_search'); assert.notEqual(scanned.score.value, null);
  });
  it('structured data and embedded product JSON are read first', async () => {
    const ld = `<title>${NAME}</title><script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: NAME, gtin13: CODE, ingredients: LIST })}</script>`;
    const json = `<title>${NAME}</title><p>${CODE}</p><script type="application/json">${JSON.stringify({ product: { composition: LIST } })}</script>`;
    for (const body of [ld, json]) {
      const { service } = setup({ off: off(), pages: { 'perekrestok.ru': body }, sources: [[result('perekrestok.ru', NAME, CODE)]] });
      assert.equal((await scan(service, CODE)).product.ingredients.value?.length, 3);
    }
  });
  it('the headings Ingredient list, Ingredients list and Composition are understood', async () => {
    for (const heading of ['Ingredient list:', 'Ingredients list', 'Composition:', 'Ingredients']) {
      const { service } = setup({ off: off(), pages: { 'perekrestok.ru': `<title>${NAME}</title><p>${CODE}</p><h2>${heading}</h2><p>potato flakes, salt, chicken flavouring</p>` }, sources: [[result('perekrestok.ru', NAME, CODE)]] });
      assert.equal((await scan(service, CODE)).product.ingredients.value?.length, 3, heading);
    }
  });
  describe('text Gemini for ingredients', () => {
    const hard = card(NAME, `Состав и пищевая информация Состав продукта это ${LIST}`.replace(/, /g, ' и '));
    it('only on a verified page, once, and printed words pass', async () => {
      const printed = 'картофельные хлопья и соль поваренная и ароматизатор курица';
      const { service, calls } = setup({ off: off(), pages: { 'perekrestok.ru': hard }, sources: [[result('perekrestok.ru', NAME, CODE)]], aiIngredients: 'картофельные хлопья, соль поваренная, ароматизатор курица' });
      const scanned = await scan(service, CODE); await scan(service, CODE);
      assert.equal(printed.length > 0, true); assert.equal(calls.aiIngredients.length, 1); assert.equal(calls.ai, 0);
      assert.ok(calls.aiIngredients[0]!.includes('Состав')); assert.equal(scanned.product.ingredients.value?.length, 3);
    });
    it('not on a page about another product', async () => {
      const { service, calls } = setup({ off: off(), pages: { 'perekrestok.ru': card('Роллтон лапша 40 г', 'Состав смотрите на упаковке') }, sources: [[result('perekrestok.ru', NAME, CODE)]], aiIngredients: 'мука, соль' });
      await scan(service, CODE);
      assert.equal(calls.aiIngredients.length, 0);
    });
    it('an ingredient absent from the page cancels the answer', async () => {
      const { service, calls } = setup({ off: off(), pages: { 'perekrestok.ru': hard }, sources: [[result('perekrestok.ru', NAME, CODE)]], aiIngredients: 'картофельные хлопья, соль поваренная, глутамат натрия' });
      const scanned = await scan(service, CODE);
      assert.equal(calls.aiIngredients.length, 1); assert.equal(scanned.product.ingredients.value, null);
    });
    it('null stays null', async () => {
      const { service } = setup({ off: off(), pages: { 'perekrestok.ru': hard }, sources: [[result('perekrestok.ru', NAME, CODE)]], aiIngredients: null });
      assert.equal((await scan(service, CODE)).product.ingredients.value, null);
    });
  });
  describe('strong context for ingredients', () => {
    const parsed = (body: string) => parsePage(`<title>x</title>${body}`);
    it('1. a JSON-LD field is accepted', () => {
      const page = parsed(`<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: 'x', ingredients: LIST })}</script>`);
      assert.equal(page.ingredients, LIST);
    });
    it('2–3. HTML Состав: and Ingredients: are accepted', () => {
      assert.equal(parsed(`<p>Состав: ${LIST}.</p>`).ingredients, LIST);
      assert.equal(parsed('<p>Ingredients: potato flakes, salt, chicken flavouring</p>').ingredients, 'potato flakes, salt, chicken flavouring');
      assert.equal(parsed(`<dt>Состав</dt><dd>${LIST}</dd>`).ingredients, LIST);
      assert.equal(parsed(`<div class="t"><span>Ингредиенты:</span></div><div>${LIST}</div>`).ingredients, LIST);
      assert.equal(parsePage(`## Состав\n\n${LIST}\n\n## Отзывы`).ingredients, LIST);
      assert.equal(parsePage(`| Состав | ${LIST} |`).ingredients, LIST);
    });
    it('4–5. category and food group text is rejected', () => {
      for (const body of ['<p>Категория: фрукты, овощи и бобовые</p>', '<div class="category">fruits, vegetables and legumes</div>', '<nav><a>Молоко, сыр, яйца</a></nav>', '<p>NOVA 4: сахар, соль, жиры</p>', '<h3>Похожие товары</h3><p>Пюре, лапша, супы</p>']) {
        assert.equal(parsed(body).ingredients, null, body);
      }
    });
    it('6. the tail of the word составе is not a heading', () => {
      for (const body of ['<p>В составе (фрукты, овощи и бобовые). Другое</p>', '<p>Доля в составе: фрукты, овощи и бобовые</p>', '<p>Входит в состав: фрукты, овощи и бобовые</p>']) {
        const page = parsed(body);
        assert.equal(page.ingredients, null, body); assert.equal(page.ingredientsIssue, null, body);
      }
      assert.equal(parsed('<p>Состав: е (фрукты, овощи и бобовые)</p>').ingredients, null);
      assert.equal(parsed('<p>Состав: е (фрукты, овощи и бобовые)</p>').ingredientsIssue, 'not_ingredients_content');
    });
    it('7. taxonomy and the real section on one page: the real one is chosen', () => {
      const page = parsed(`<p>Высокая доля в составе (фрукты, овощи и бобовые). Категории: снеки, супы, пюре</p><p>Состав: ${LIST}.</p>`);
      assert.equal(page.ingredients, LIST);
    });
    it('8. a menu link and list-like text without a heading are rejected', () => {
      assert.equal(parsed(`<a href="#s">Состав</a><p>${LIST}</p>`).ingredients, null);
      assert.equal(parsed(`<p>${LIST}</p>`).ingredients, null);
      assert.equal(parsed(`<p>Состав напитка зависит от партии, рецепта, страны</p>`).ingredients, null);
    });
    it('9. truncated fragments are rejected as not_ingredients_content', () => {
      for (const body of ['<p>Состав: картофельные хлопья, кусочки курицы (</p>', '<p>Состав: а, б</p>', '<p>Состав: )хлопья, соль</p>', '<p>Состав: информация об ингредиентах, упаковка</p>']) {
        const page = parsed(body);
        assert.equal(page.ingredients, null, body); assert.equal(page.ingredientsIssue, 'not_ingredients_content', body);
      }
    });
    it('10. text Gemini is not asked without an explicit heading, and an answer from elsewhere is dropped', async () => {
      const noHeading = setup({ off: off(), pages: { 'perekrestok.ru': card(NAME, 'Высокая доля в составе (фрукты, овощи и бобовые)') }, sources: [[result('perekrestok.ru', NAME, CODE)]], aiIngredients: 'фрукты, овощи и бобовые' });
      assert.equal((await scan(noHeading.service, CODE)).product.ingredients.value, null);
      assert.equal(noHeading.calls.aiIngredients.length, 0);
      const before = setup({ off: off(), pages: { 'perekrestok.ru': card(NAME, 'Категории: фрукты, овощи. Состав указан на упаковке') }, sources: [[result('perekrestok.ru', NAME, CODE)]], aiIngredients: 'фрукты, овощи' });
      assert.equal((await scan(before.service, CODE)).product.ingredients.value, null);
      assert.equal(before.calls.aiIngredients.length, 1);
    });
  });
  describe('a Состав: mark in the search snippet only changes the reading order', () => {
    const good = (domain: string, snippet: string) => result(domain, NAME, `${CODE} ${snippet}`);
    it('1. of two suitable results the marked one is read first', async () => {
      const { service, calls, logs } = setup({ off: off(), pages: { 'shop-one.ru': card(), 'shop-two.ru': card() }, sources: [[good('shop-one.ru', 'Описание'), good('shop-two.ru', 'Штрихкод. Состав: мука, соль')]], debug: true });
      await scan(service, CODE);
      assert.equal(calls.reads[0], 'shop-two.ru');
      const boost = (domain: string) => logs.find((line) => line.message === 'web_candidate' && line.fields.domain === domain)!.fields.readBoost;
      assert.equal(boost('shop-two.ru'), 'ingredients_mark_in_snippet'); assert.equal(boost('shop-one.ru'), undefined);
    });
    it('Ингредиенты: and Ingredients: count, and a mark outranks a tier and a title', async () => {
      for (const mark of ['Ингредиенты: мука', 'Ingredients: flour']) {
        const { service, calls } = setup({ off: off(), pages: { 'ozon.ru': card(), 'possy.ru': card() }, sources: [[good('ozon.ru', 'Описание'), result('possy.ru', `${CODE} - Тип: EAN-13`, `${CODE} ${mark}`)]] });
        await scan(service, CODE);
        assert.equal(calls.reads[0], 'possy.ru', mark);
      }
    });
    it('2. the snippet is not a source: without a real section on the page ingredients stay null', async () => {
      const { service, calls } = setup({ off: off(), pages: { 'shop-two.ru': card(NAME, 'Описание товара') }, sources: [[good('shop-two.ru', `Состав: ${LIST}`)]] });
      const scanned = await scan(service, CODE);
      assert.equal(calls.reads[0], 'shop-two.ru'); assert.equal(scanned.product.ingredients.value, null);
    });
    it('3. в составе or a heading without a colon gives no priority', async () => {
      for (const words of ['в составе: мука', 'Входит в состав: мука', 'Состав мука, соль', 'составе: мука']) {
        const { service, calls } = setup({ off: off(), pages: { 'shop-one.ru': card(), 'shop-two.ru': card() }, sources: [[good('shop-one.ru', 'Описание'), good('shop-two.ru', words)]] });
        await scan(service, CODE);
        assert.equal(calls.reads[0], 'shop-one.ru', words);
      }
    });
    it('4. another product with Состав: is not read for that, and its section is rejected by identity', async () => {
      const other = setup({ off: off(), pages: { 'shop-two.ru': card('Лапша Доширак 90 г') }, sources: [[result('shop-two.ru', 'Лапша Доширак 90 г', 'Состав: мука, соль')]] });
      await scan(other.service, CODE);
      assert.deepEqual(other.calls.reads, []);
      const variant = setup({ off: off(), pages: { 'shop-two.ru': card(`${NAME} и кремом`) }, sources: [[result('shop-two.ru', NAME, `Состав: ${LIST}`)]] });
      assert.equal((await scan(variant.service, CODE)).product.ingredients.value, null);
    });
    it('5. the limits do not change', async () => {
      const domains = ['one.ru', 'two.ru', 'three.ru', 'four.ru', 'five.ru'];
      const { service, calls, verdicts } = setup({ off: off(), pages: Object.fromEntries(domains.map((domain) => [domain, card(NAME, 'Описание')])), sources: [domains.map((domain) => good(domain, 'Состав: мука, соль'))] });
      await scan(service, CODE); await scan(service, CODE);
      assert.equal(calls.reads.length, domains.length); assert.ok(calls.reads.length <= MAX_PAGES_PER_SCAN); assert.ok(calls.queries.length <= MAX_SEARCHES_PER_PRODUCT); assert.ok(verdicts()[0].credits <= MAX_SEARCHES_PER_PRODUCT + MAX_EXTRACTS_PER_PRODUCT);
    });
    it('once ingredients are known the mark gives nothing', async () => {
      const { service, calls } = setup({ off: off({ ingredients_text: 'мука, соль' }), pages: { 'ozon.ru': html({ title: NAME, barcode: CODE, kcal: 350, protein: 6, carbs: 65, fat: 7.5, sugars: 2, saturated: 2, salt: 3 }), 'possy.ru': card() }, sources: [[good('possy.ru', 'Состав: мука'), good('ozon.ru', 'Описание')]] });
      await scan(service, CODE);
      assert.equal(calls.reads[0], 'ozon.ru');
    });
  });
  it('Rollton after the real scan: the taxonomy of the OFF page is ignored and the search goes on to the real section', async () => {
    const offPage = `<title>Картофельное Пюре С Куриным Вкусом – Роллтон</title><p>Штрих-код: ${CODE}</p><p>Высокая доля в составе (фрукты, овощи и бобовые). Пищевая ценность на 100 г: 350 ккал, белки 6 г, углеводы 65 г, жиры 7,5 г</p>`;
    const possy = `<title>${CODE} - Тип: EAN-13 | Штрихкод валидный</title><p>Картофельное пюре Роллтон с куриным вкусом, 40 г, в стакане</p><p>Состав: картофельные хлопья, кусочки курицы (сублимированные), соль.</p><p>Другие штрихкоды: 2409331030133 4605496001966 4605496001967 4605496001968</p>`;
    const offResult = { url: `https://ru.openfoodfacts.org/продукт/${CODE}/x`, title: 'Картофельное Пюре С Куриным Вкусом – Роллтон', domain: 'ru.openfoodfacts.org' };
    const possyResult = { url: `https://possy.ru/barcode/${CODE}`, title: `${CODE} - Тип: EAN-13 | Штрихкод валидный`, domain: 'possy.ru' };
    const { service, calls } = setup({ off: off(), pages: { 'ru.openfoodfacts.org': offPage, 'possy.ru': possy }, sources: [[offResult, possyResult]] });
    const scanned = await scan(service, CODE);
    assert.equal(calls.reads.includes('ru.openfoodfacts.org'), false, 'the same record was already read through the OFF API');
    assert.ok(calls.reads.includes('possy.ru'));
    assert.deepEqual(scanned.product.ingredients.value!.map((item) => item.name), ['картофельные хлопья', 'кусочки курицы (сублимированные)', 'соль']);
    assert.equal(source(scanned)!.domain, 'possy.ru'); assert.equal(source(scanned)!.ingredientsOnly, undefined);
    assert.notEqual(scanned.score.value, null); assert.equal(typeof scanned.score.value, 'number'); assert.equal(scanned.product.nutrition!.sugarsG.value, null);
    const empty = setup({ off: off(), pages: { 'ru.openfoodfacts.org': offPage }, sources: [[offResult]] });
    assert.equal((await scan(empty.service, CODE)).product.ingredients.value, null, 'without a real section the answer is null');
  });
  it('Rollton end to end: ingredients appear, sugars stay unknown, the score is partial', async () => {
    const pages = { 'alania-market.ru': `<title>${NAME}</title><p>Бренд Роллтон. Штрихкод ${CODE}</p><h2>Состав</h2><p>${LIST}</p>` };
    const { service, calls, verdicts } = setup({ off: off({ serving_quantity: 40, serving_quantity_unit: 'g' }), pages, sources: [[result('selvis.com', 'Пюре картофельное Роллтон куриное (стакан) 40г', `Штрихкод ${CODE}`), result('alania-market.ru', NAME, `Штрихкод ${CODE}`)]], closed: ['selvis.com'] });
    const scanned = await scan(service, CODE);
    assert.equal(calls.queries[0], `"${CODE}"`); assert.equal(calls.reads[0], 'alania-market.ru');
    assert.deepEqual(scanned.product.ingredients.value!.map((item) => item.name), LIST.split(', '));
    const n = scanned.product.nutrition!;
    assert.deepEqual([n.caloriesKcal.value, n.proteinG.value, n.carbsG.value, n.fatG.value], [350, 6, 65, 7.5]);
    assert.deepEqual([n.sugarsG.value, n.saturatedFatG.value, n.saltG.value], [null, null, null]);
    assert.notEqual(scanned.score.value, null); assert.equal(typeof scanned.score.value, 'number'); assert.equal(scanned.status, undefined); assert.equal(calls.ai, 0);
    assert.equal(source(scanned)!.ingredientsOnly, undefined); assert.ok(calls.queries.length <= MAX_SEARCHES_PER_PRODUCT); assert.ok(verdicts()[0].credits <= MAX_SEARCHES_PER_PRODUCT + MAX_EXTRACTS_PER_PRODUCT);
  });
  it('Coca-Cola: the name is refined by the barcode, nutrition still needs strict verification', async () => {
    const ORANGE = mapOpenFoodFactsProduct({ product_name: 'Coca Cola Orange' }, ORANGE_BARCODE);
    const shop = { url: `https://shop.rs/${ORANGE_BARCODE}`, title: 'Coca-Cola Zero Orange 1.5L', domain: 'shop.rs', snippet: 'Sastojci' };
    const page = html({ title: 'Coca-Cola Zero Orange', barcode: ORANGE_BARCODE, per: '100 мл', kcal: 1, protein: 0, carbs: 0, fat: 0, sugars: 0, saturated: 0, salt: 0.02 });
    const { service, verdicts, calls } = setup({ off: ORANGE, pages: { 'shop.rs': page }, sources: [[shop]] });
    const scanned = await scan(service, ORANGE_BARCODE);
    assert.equal(verdicts()[0].alias, 'Coca-Cola zero orange'); assert.match(calls.queries[1]!, /zero orange/);
    assert.equal(scanned.product.nutrition?.sugarsG.value ?? null, null, 'a shop outside the list gives no nutrition'); assert.equal(typeof scanned.score.value, 'number');
    assert.equal(scanned.product.ingredients.value?.length, 4, 'but its ingredients are shown');
  });
});

describe('Web fallback: merge', () => {
  it('15. web fills only the missing fields', async () => {
    const { service } = setup({ off: offPartial(), pages: { 'ozon.ru': html({ protein: 4.6 }) } });
    const result = await scan(service);
    assert.equal(result.product.nutrition!.proteinG.value, 4.5); assert.equal(result.product.nutrition!.sugarsG.value, 38);
  });
  it('16. the label beats the web', async () => {
    const label = await labelProduct({ sugarsG: observed(30) });
    const { service, calls } = setup({ pages: { 'lotte.ru': html({ title: 'Lotte Чокопай', barcode: null }) }, label });
    const result = await service.analyze(FILE, 'user').then(sourceEvidenceView);
    assert.equal(calls.ai, 1); assert.equal(result.product.nutrition!.sugarsG.value, 30); assert.equal(result.product.nutrition!.saturatedFatG.value, 9);
  });
  it('17. a trusted OFF value is not overwritten', async () => {
    const { sugars: _sugars, ...withoutSugars } = OFF_NUTRIENTS;
    const off = mapOpenFoodFactsProduct(nutrients(withoutSugars), BARCODE)!;
    const { service, calls } = setup({ off, pages: { 'ozon.ru': html({ saturated: 9.3, salt: 0.42 }) } });
    const result = await scan(service);
    assert.equal(calls.queries.length, 1);
    assert.equal(result.product.nutrition!.saturatedFatG.value, 9); assert.equal(result.product.nutrition!.saltG.value, 0.4); assert.equal(result.product.nutrition!.sugarsG.value, 38);
  });
});

describe('Web fallback: limits and cache', () => {
  it('18. a repeated scan comes from the cache and costs no Tavily credits', async () => {
    const { service, calls } = setup({ off: offPartial(), pages: { 'ozon.ru': html() } });
    const first = await scan(service);
    const second = await scan(service);
    assert.deepEqual([calls.queries.length, calls.reads.length], [1, 1]);
    assert.equal(second.product.nutrition!.sugarsG.value, first.product.nutrition!.sugarsG.value);
    const missed = setup({ off: offPartial(), results: [] });
    await scan(missed.service); await scan(missed.service);
    assert.ok(missed.calls.queries.length <= MAX_SEARCHES_PER_PRODUCT, 'a miss is remembered too');
  });
  it('19. Tavily exhausted: no queries, Gemini 0, the answer asks for a nutrition photo', async () => {
    const { service, calls, verdicts } = setup({ off: offPartial(), pages: { 'ozon.ru': html() }, available: () => false });
    const result = await scan(service);
    assert.deepEqual([calls.queries.length, calls.ai], [0, 0]); assert.equal(verdicts()[0].status, 'budget_exhausted');
    assert.equal(result.needsPhoto, undefined); assert.equal(result.status, undefined);
  });
  it('credits run out in the middle: the next queries are not sent', async () => {
    let left = 2;
    const { service, calls } = setup({ off: offPartial(), results: [], available: () => left-- > 0 });
    await scan(service);
    assert.equal(calls.queries.length, 1);
  });
  it('23. the query, page and Tavily extract limits hold for the product', async () => {
    const domains = ['ozon.ru', 'wildberries.ru', 'vprok.ru', 'lenta.com', 'auchan.ru', 'magnit.ru', 'metro-cc.ru', 'utkonos.ru'];
    const pages = Object.fromEntries(domains.map((domain) => [domain, html({ title: 'Lotte Чокопай', barcode: null, sugars: null })]));
    const results = [domains.slice(0, 2), domains.slice(2, 4), domains.slice(4, 6), domains.slice(6)];
    const { service, calls, verdicts } = setup({ off: offPartial(), pages, results, closed: domains });
    await scan(service); await scan(service);
    assert.ok(calls.queries.length <= MAX_SEARCHES_PER_PRODUCT); assert.ok(calls.reads.length <= MAX_PAGE_ATTEMPTS, 'closed pages are replaced, but not forever'); assert.equal(calls.extracts.length, MAX_EXTRACTS_PER_PRODUCT);
    assert.equal(verdicts()[0].credits, calls.queries.length + calls.extracts.length);
    const strict = setup({ off: offPartial(), pages, results: [[], [], []], limits: { maxQueries: 2, maxPages: 1 } });
    await scan(strict.service);
    assert.equal(strict.calls.queries.length, 2);
  });
  it('a single unknown site with the product name is read, and alone it leaves nutrients unknown', async () => {
    const { service, calls } = setup({ off: offPartial(), pages: { 'unknown-shop.ru': html() }, results: [['unknown-shop.ru']] });
    const { product } = await scan(service);
    assert.deepEqual(calls.reads, ['unknown-shop.ru']);
    assert.equal(product.nutrition!.sugarsG.value, null);
    assert.ok(!product.fieldEvidence?.some((item) => item.field === 'sugarsG'));
  });
  const noTable = (title: string, barcode = '') => `<title>${title}</title><p>${barcode} Пищевая ценность и калорийность: белки 4,5, жиры 18, углеводы 63, сахара 38.</p>`;
  it('text AI: one page per request, within the limit, never repeated', async () => {
    const { service, calls, verdicts } = setup({ off: offPartial(), pages: { 'ozon.ru': noTable('Lotte Чокопай'), 'lenta.com': noTable('Lotte Чокопай', BARCODE) }, results: [['ozon.ru', 'lenta.com']] });
    await scan(service); await scan(service);
    assert.equal(calls.aiText, MAX_AI_EXTRACTIONS_PER_PRODUCT); assert.equal(calls.ai, 0); assert.equal(verdicts()[0].aiExtractions, MAX_AI_EXTRACTIONS_PER_PRODUCT);
    assert.equal(calls.aiPages[0]!.length, 1); assert.ok(calls.aiPages[0]![0]!.includes(BARCODE), 'the page with the barcode goes first');
  });
  it('text AI: a page about another product is not sent', async () => {
    const { service, calls } = setup({ off: offPartial(), pages: { 'ozon.ru': noTable('Lotte Чокопай банан') }, results: [['ozon.ru']] });
    const other = setup({ off: offPartial(), pages: { 'ozon.ru': noTable('Orion Чокопай') }, results: [['ozon.ru']] });
    await scan(service); await scan(other.service);
    assert.equal(other.calls.aiText, 0);
    assert.equal(calls.aiText, 0, 'another flavour on the page');
  });
  it('text AI: not sent when the code read the table or the critical fields are found', async () => {
    const { service, calls } = setup({ off: offPartial(), pages: { 'ozon.ru': html({ sugars: null }) }, results: [['ozon.ru']] });
    await scan(service);
    assert.equal(calls.aiText, 0);
  });
  it('text AI: unknown values stay null, and numbers not printed on the page are dropped', async () => {
    const invented = { id: 0, kcal: 430, protein: 4.5, carbs: 63, fat: 18, sugars: 38, saturatedFat: 99, salt: null, sodiumMg: null, fiber: null };
    const page = `<title>Lotte Чокопай</title><p>${BARCODE} Пищевая ценность на 100 г (код не разбирает): ккал 430 белки 4,5 жиры 18 углеводы 63 сахара 38</p>`;
    const { service, calls } = setup({ off: offPartial(), pages: { 'ozon.ru': page }, results: [['ozon.ru']], aiPages: [invented] });
    const result = await scan(service);
    assert.equal(calls.aiText, 1); assert.equal(result.product.nutrition!.sugarsG.value, 38);
    assert.equal(result.product.nutrition!.saturatedFatG.value, null); assert.equal(result.product.nutrition!.saltG.value, null);
  });
});

describe('Web fallback: when Gemini reads a photo', () => {
  const product = () => ({ ...FILE });
  it('20. barcode only: Gemini 0 calls, the photo is requested only after the search', async () => {
    const { service, calls } = setup({ off: offPartial(), results: [] });
    const result = await scan(service);
    assert.equal(calls.ai, 0); assert.ok(calls.queries.length >= 4);
    assert.equal(result.status, undefined); assert.equal(result.needsPhoto, undefined);
  });
  it('product photo with a barcode: the same', async () => {
    const { service, calls } = setup({ off: offPartial(), results: [] });
    const result = await service.analyze(product(), 'user', { barcode: BARCODE, roles: ['product'] }).then(sourceEvidenceView);
    assert.equal(calls.ai, 0); assert.equal(result.needsPhoto, undefined);
  });
  it('21. nutrition photo: Gemini exactly once, and the found pages are not searched again', async () => {
    const { service, calls } = setup({ off: offPartial(), results: [] });
    await scan(service);
    const before = calls.queries.length;
    const result = await service.analyze(product(), 'user', { barcode: BARCODE, roles: ['nutrition'] }).then(sourceEvidenceView);
    assert.equal(calls.ai, 1); assert.equal(calls.queries.length, before); assert.equal('needsPhoto' in result, false);
  });
  it('22. no barcode: the old AI-first flow, and the search goes by name', async () => {
    const { service, calls } = setup({ pages: { 'lotte.ru': html({ title: 'Lotte Чокопай', barcode: null }) } });
    await service.analyze(FILE, 'user').then(sourceEvidenceView);
    assert.equal(calls.ai, 1); assert.equal(calls.off, 0);
    assert.match(calls.queries[0]!, /^Lotte Чокопай/);
  });
});

describe('Web fallback: regressions', () => {
  const orangeOff = () => mapOpenFoodFactsProduct({ product_name: 'Coca-Cola Orange' }, ORANGE_BARCODE);
  it('24. Coca Cola Orange: OFF has only a name, the search reaches a trusted page, Gemini is not called', async () => {
    const page = html({ title: 'Coca-Cola Orange', barcode: ORANGE_BARCODE, per: '100 мл', kcal: 42, protein: 0, carbs: 10.6, fat: 0, sugars: 10.6, saturated: 0, salt: 0.01 });
    const noise = ['wikipedia.org', 'kiddle.co', 'love80s.ru'];
    const { service, calls } = setup({ off: orangeOff(), pages: { 'coca-cola.com': page }, results: [noise, [], ['coca-cola.com']] });
    const result = await scan(service, ORANGE_BARCODE);
    assert.equal(calls.queries.length, 6); assert.deepEqual(calls.queries.slice(0, 2), [`"${ORANGE_BARCODE}"`, `"${ORANGE_BARCODE}" "Coca-Cola Orange"`]);
    assert.ok(!calls.reads.includes('wikipedia.org')); assert.ok(!calls.reads.includes('love80s.ru'));
    assert.equal(calls.ai, 0); assert.equal(result.product.nutrition!.sugarsG.value, 10.6); assert.notEqual(result.score.value, null);
  });
  it('24. Coca Cola Orange: nothing trusted is found: needs_nutrition_photo, Gemini is not called', async () => {
    const noise = html({ title: 'Coca-Cola Orange вкус', barcode: null, per: '100 мл', kcal: 42, protein: 0, carbs: 10.6, fat: 0, sugars: 10.6, saturated: 0, salt: 0.01 });
    const { service, calls } = setup({ off: orangeOff(), pages: { 'love80s.ru': noise }, results: [['love80s.ru']] });
    const result = await scan(service, ORANGE_BARCODE);
    assert.equal(calls.ai, 0); assert.equal(result.status, undefined); assert.equal(result.product.nutrition?.sugarsG.value ?? null, null);
  });
  it('25. Snickers: the regular recipe is rejected, the matching page fills the fields', async () => {
    const regular = html({ title: 'Snickers лесной орех', barcode: null, kcal: 496, protein: 7.5, carbs: 58, fat: 25, sugars: 50 });
    const hazelnut = html({ title: 'Snickers лесной орех', barcode: null, kcal: 510, protein: 7.3, carbs: 55, fat: 28, sugars: 48, saturated: 10, salt: 0.37 });
    const { service, calls, verdicts } = setup({ off: offSnickers(), pages: { 'ozon.ru': regular, 'snickers.ru': hazelnut }, results: [['ozon.ru'], ['snickers.ru']] });
    const result = await scan(service);
    assert.equal(calls.ai, 0); assert.equal(result.product.nutrition!.sugarsG.value, 48); assert.equal(result.product.nutrition!.caloriesKcal.value, 514);
    assert.deepEqual(verdicts()[0].pages.map((page: { status: string }) => page.status), ['different_product_or_recipe', 'accepted']);
  });
  it('26. Choco Pie: an exact barcode does not cancel the recipe check', async () => {
    const page = html({ title: 'Чокопай Lotte', kcal: 520, protein: 4.5, carbs: 50, fat: 28, sugars: 30 });
    const { service, calls, verdicts } = setup({ off: offPartial(), pages: { 'ozon.ru': page }, results: [['ozon.ru']] });
    const result = await scan(service);
    assert.equal(calls.ai, 0); assert.equal(verdicts()[0].pages.at(-1).status, 'recipe_version_conflict');
    assert.equal(result.product.nutrition!.sugarsG.value, null); assert.equal(result.status, undefined);
  });
});

describe('OFF + internet enrichment: the universal rule', () => {
  const offNoIngredients = () => mapOpenFoodFactsProduct(nutrients(offMacros, { ingredients_text: undefined, allergens_tags: undefined, traces_tags: undefined, additives_tags: undefined }), BARCODE)!;
  const titled = (domain: string) => ({ url: `https://${domain}/p`, title: 'Чокопай Lotte', domain });
  const perServing = (size: string) => html({ per: size, kcal: 172, protein: 1.8, carbs: 25.2, fat: 7.2, sugars: 15.2, saturated: 3.6, salt: 0.16 });

  it('1. OFF complete: no Tavily at all', async () => {
    const { service, calls } = setup({ off: offComplete(), pages: { 'ozon.ru': html() } });
    await scan(service);
    assert.deepEqual([calls.queries.length, calls.reads.length, calls.aiText], [0, 0, 0]);
  });
  it('2. OFF partial: the web starts, also for a missing macro alone', async () => {
    const partial = setup({ off: offPartial(), pages: { 'ozon.ru': html() } });
    await scan(partial.service);
    assert.ok(partial.calls.queries.length > 0);
    const { proteins: _p, ...noProtein } = OFF_NUTRIENTS;
    const macro = setup({ off: mapOpenFoodFactsProduct(nutrients(noProtein), BARCODE)!, pages: { 'ozon.ru': html() } });
    await scan(macro.service);
    assert.ok(macro.calls.queries.length > 0);
  });
  it('3. only the missing fields are searched', () => {
    const context = { brand: 'Lotte', name: 'Чокопай', serving: null, basis: 'per_100g', kcal: 1, protein: 1, carbs: 1, fat: 1, missingFields: ['salt'], needsIngredients: true };
    const steps = searchStrategy(BARCODE, context);
    assert.deepEqual(steps.map((step) => step.query), [`"${BARCODE}"`, `"${BARCODE}" "Lotte" "Чокопай"`, `${BARCODE} соль`, `${BARCODE} состав`, '"Lotte" "Чокопай" пищевая ценность состав', 'Lotte Чокопай соль состав']);
    assert.deepEqual(searchStrategy(BARCODE, { ...context, needsIngredients: false }).at(-1)!.query, 'Lotte Чокопай соль');
  });
  it('4. the OFF web page takes no read', async () => {
    const { service, calls } = setup({ off: offPartial(), pages: { 'ozon.ru': html() }, sources: [[titled('ru.openfoodfacts.org'), titled('ozon.ru')]] });
    await scan(service);
    assert.deepEqual(calls.reads, ['ozon.ru']);
  });
  it('5. a failed fetch frees the slot for the next candidate', async () => {
    const { service, calls } = setup({ off: offPartial(), pages: { 'lenta.com': html() }, sources: [[titled('ozon.ru'), titled('vprok.ru'), titled('lenta.com')]], closed: ['ozon.ru', 'vprok.ru'] });
    const result = await scan(service);
    assert.ok(calls.reads.includes('lenta.com'));
    assert.equal(result.product.nutrition!.sugarsG.value, 38);
  });
  it('6. an exact barcode page is accepted and ranked first', async () => {
    const { service, calls, verdicts } = setup({ off: offPartial(), pages: { 'ozon.ru': html({ barcode: null }), 'unknown-market.ru': html(), 'vprok.ru': html() }, sources: [[titled('ozon.ru'), { ...titled('vprok.ru'), snippet: `Штрихкод ${BARCODE}` }]] });
    await scan(service);
    assert.equal(calls.reads[0], 'vprok.ru');
    assert.equal(verdicts()[0].pages[0].reason, 'exact_barcode_and_macros');
  });
  it('7. another variant is rejected', async () => {
    const { service } = setup({ off: offPartial(), pages: { 'ozon.ru': html({ title: 'Чокопай Lotte клубника', barcode: null }) }, sources: [[titled('ozon.ru')]] });
    assert.equal((await scan(service)).product.nutrition!.sugarsG.value, null);
  });
  it('8. per serving without its size is rejected', async () => {
    const { service, verdicts } = setup({ off: offPartial(), pages: { 'ozon.ru': perServing('порцию') }, sources: [[titled('ozon.ru')]] });
    assert.equal((await scan(service)).product.nutrition!.sugarsG.value, null);
    assert.equal(verdicts()[0].pages[0].reason, 'no_per_100_nutrition');
  });
  it('9. per serving with its size is converted to 100 g', async () => {
    const { service } = setup({ off: offPartial(), pages: { 'ozon.ru': perServing('порцию (40 г)') }, sources: [[titled('ozon.ru')]] });
    const { nutrition } = (await scan(service)).product;
    assert.deepEqual([nutrition!.sugarsG.value, nutrition!.saturatedFatG.value, nutrition!.saltG.value], [38, 9, 0.4]);
  });
  it('10–11. exact barcode: ingredients give additives, allergens and processing, nutrition needs corroboration', async () => {
    const { service, verdicts } = setup({ off: offNoIngredients(), pages: { 'unknown-market.ru': html() }, sources: [[{ ...titled('unknown-market.ru'), snippet: `Штрихкод ${BARCODE}` }]] });
    const { product, score } = await scan(service);
    assert.equal(verdicts()[0].pages[0].reason, 'exact_barcode_single_source');
    assert.equal(product.nutrition!.sugarsG.value, null);
    assert.ok(product.ingredients.value!.some((item) => item.name === 'сахар'));
    assert.ok(product.additives.value!.some((item) => item.name === 'эмульгатор лецитин'));
    assert.deepEqual(product.allergens.value!.map((item) => [item.code, item.presence]), [['peanuts', 'contains']]);
    assert.equal(product.semantics!.processing.value, 'ultra_processed');
    assert.equal(score.factors.find((item) => item.kind === 'processing')!.level, 'many');
    assert.ok(!score.missingFactors.includes('additives'));
  });
  it('exact barcode, no nutrition on the page to compare: ingredients are accepted', async () => {
    const page = `<title>Чокопай Lotte</title><p>Штрихкод: ${BARCODE}. Состав: сахар, арахис, какао-масло.</p>`;
    const { service } = setup({ off: offNoIngredients(), pages: { 'ozon.ru': page }, sources: [[titled('ozon.ru')]] });
    assert.ok((await scan(service)).product.ingredients.value!.some((item) => item.name === 'арахис'));
  });
  it('exact barcode, macros agree: ingredients are accepted', async () => {
    const { service } = setup({ off: offNoIngredients(), pages: { 'ozon.ru': html() }, sources: [[titled('ozon.ru')]] });
    assert.ok((await scan(service)).product.ingredients.value!.some((item) => item.name === 'арахис'));
  });
  it('exact barcode, macros conflict: possible_recipe_mismatch rejects nutrition, ingredients, allergens and additives', async () => {
    const { service, calls, verdicts } = setup({ off: offNoIngredients(), pages: { 'ozon.ru': html({ kcal: 520, fat: 28 }) }, sources: [[titled('ozon.ru')], [], [], []], aiIngredients: 'сахар, арахис' });
    const scanned = await scan(service);
    assert.equal(verdicts()[0].pages[0].status, 'recipe_version_conflict');
    assert.equal(scanned.product.nutrition!.sugarsG.value, null);
    assert.equal(scanned.product.ingredients.value, null);
    assert.deepEqual([scanned.product.allergens.value, scanned.product.additives.value], [null, null]);
    assert.equal(calls.aiIngredients.length, 0, 'text from the conflicting page is not sent to the AI either');
  });
  it('12. the same product does not call Tavily or Gemini again, whether found or not', async () => {
    for (const pages of [{ 'ozon.ru': html() }, {}] as Readonly<Record<string, string>>[]) {
      const { service, calls } = setup({ off: offPartial(), pages, sources: [[titled('ozon.ru')], [], [], []] });
      await scan(service);
      const spent = [calls.queries.length, calls.reads.length, calls.extracts.length, calls.aiText];
      await scan(service);
      assert.deepEqual([calls.queries.length, calls.reads.length, calls.extracts.length, calls.aiText], spent);
    }
  });
  it('13. the web fills the missing nutrition: the Score uses the full profile', async () => {
    const { service } = setup({ off: offPartial(), pages: { 'ozon.ru': html() }, sources: [[titled('ozon.ru')]] });
    const { score } = await scan(service);
    assert.notEqual(score.confidence, 'low');
    for (const kind of ['sugars', 'saturatedFat', 'salt'] as const) assert.ok(!score.missingFactors.includes(kind), kind);
  });
  it('14–15. a web miss: partial Score, low confidence and no invented values', async () => {
    const { service, calls, logs } = setup({ off: offNoIngredients(), sources: [[], [], [], []] });
    const { product, score } = await scan(service);
    assert.equal(calls.queries.length, MAX_SEARCHES_PER_PRODUCT);
    assert.equal(typeof score.value, 'number');
    assert.equal(score.confidence, 'low');
    assert.ok(!score.missingFactors.some(kind => ['sugars', 'saturatedFat', 'salt'].includes(kind)));
    assert.deepEqual([product.nutrition!.sugarsG.value, product.nutrition!.saturatedFatG.value, product.nutrition!.saltG.value, product.ingredients.value], [null, null, null, null]);
    assert.equal(logs.some((line) => line.message === 'web_lookup'), true);
  });
});

describe('Multi-source field aggregation', () => {
  const site = (domain: string, title = 'Чокопай Lotte') => ({ url: `https://${domain}/p`, title, domain, snippet: `Штрихкод ${BARCODE}` });
  const noMacros = () => mapOpenFoodFactsProduct(nutrients({}, { product_name: 'Чокопай', brands: 'Lotte', ingredients_text: undefined, allergens_tags: undefined, traces_tags: undefined, additives_tags: undefined }), BARCODE)!;
  const OTHER = { kcal: 440, protein: 4, carbs: 70.5, fat: 16.1, sugars: 50, saturated: 7, salt: 0.8 };
  const evidence = (product: Product, field: string) => product.fieldEvidence!.find((item) => item.field === field)!;
  const SHOPS = ['shop-one.ru', 'shop-two.ru', 'shop-three.ru'];

  it('1. three sources agree on sugars: accepted with high confidence and full provenance', async () => {
    const [a, b, c] = [36.8, 37, 37.2].map((sugars) => html({ sugars }));
    const { service } = setup({ off: offPartial(), pages: { 'shop-one.ru': a!, 'shop-two.ru': b!, 'shop-three.ru': c! }, sources: [SHOPS.map((domain) => site(domain))] });
    const { product } = await scan(service);
    assert.equal(product.nutrition!.sugarsG.value, 37);
    const sugars = evidence(product, 'sugarsG');
    assert.deepEqual([sugars.confidence, sugars.consensusCount, sugars.sources!.length, sugars.basis], ['medium', 3, 3, 'per_100g']);
    assert.ok(sugars.retrievedAt);
  });
  it('2. two sources agree and one conflicts: the majority wins', async () => {
    const { service } = setup({ off: offPartial(), pages: { 'shop-one.ru': html(), 'shop-two.ru': html(), 'shop-three.ru': html({ sugars: 20 }) }, sources: [SHOPS.map((domain) => site(domain))] });
    const { product } = await scan(service);
    assert.equal(product.nutrition!.sugarsG.value, 38);
    assert.equal(evidence(product, 'sugarsG').consensusCount, 2);
  });
  it('3. two recipe clusters: fields are not mixed', async () => {
    const { service, verdicts } = setup({ off: noMacros(), pages: { 'shop-one.ru': html(), 'shop-two.ru': html(), 'shop-three.ru': html(OTHER) }, sources: [SHOPS.map((domain) => site(domain))] });
    const { product } = await scan(service);
    assert.deepEqual([product.nutrition!.caloriesKcal.value, product.nutrition!.sugarsG.value, product.nutrition!.saltG.value], [430, 38, 0.4]);
    assert.equal(verdicts()[0].pages.at(-1).reason, 'other_recipe_cluster');
  });
  it('4. OFF macros choose the cluster even against the majority', async () => {
    const { service } = setup({ off: offPartial(), pages: { 'ozon.ru': html(), 'shop-one.ru': html(OTHER), 'shop-two.ru': html(OTHER) }, sources: [[site('shop-one.ru'), site('shop-two.ru'), site('ozon.ru')]] });
    assert.equal((await scan(service)).product.nutrition!.sugarsG.value, 38);
  });
  it('5. label macros choose the cluster', async () => {
    const { service, calls } = setup({ pages: { 'orion.ru': html({ title: 'Lotte Чокопай', barcode: null }), 'lotte.ru': html({ title: 'Lotte Чокопай', barcode: null }), 'vprok.ru': html({ ...OTHER, title: 'Lotte Чокопай', barcode: null }) }, sources: [[site('vprok.ru', 'Lotte Чокопай'), site('lotte.ru', 'Lotte Чокопай'), site('orion.ru', 'Lotte Чокопай')].map(({ snippet: _snippet, ...source }) => source)] });
    const { product } = await service.analyze({ ...FILE }, 'user', { roles: ['nutrition'] }).then(sourceEvidenceView);
    assert.equal(calls.ai, 1);
    assert.equal(product.nutrition!.sugarsG.value, 38);
  });
  it('6. sodium from one source and salt from another are the same value', async () => {
    const sodium = html().replace(/соль[^<]*?г/i, 'натрий 160 мг');
    const { service } = setup({ off: offPartial(), pages: { 'shop-one.ru': html(), 'shop-two.ru': sodium }, sources: [SHOPS.slice(0, 2).map((domain) => site(domain))] });
    const { product } = await scan(service);
    assert.equal(product.nutrition!.saltG.value, 0.4);
    assert.equal(evidence(product, 'saltG').consensusCount, 2);
  });
  it('9. a single weak source is rejected', async () => {
    const { service } = setup({ off: offPartial(), pages: { 'shop-one.ru': html({ title: 'Печенье', barcode: null }) }, sources: [[site('shop-one.ru')]] });
    assert.equal((await scan(service)).product.nutrition!.sugarsG.value, null);
  });
  it('10. a single manufacturer page is accepted with medium confidence', async () => {
    const { service } = setup({ off: offPartial(), pages: { 'lotte.ru': html() }, sources: [[site('lotte.ru')]] });
    const { product } = await scan(service);
    assert.equal(product.nutrition!.sugarsG.value, 38);
    assert.deepEqual([evidence(product, 'sugarsG').confidence, evidence(product, 'sugarsG').consensusCount], ['medium', 1]);
  });
  it('11. a major retailer without the barcode alone leaves nutrients unknown; with a second source the field is medium', async () => {
    const retailer = (domain: string) => ({ url: `https://${domain}/p`, title: 'Чокопай Lotte', domain });
    const single = setup({ off: offPartial(), pages: { 'ozon.ru': html({ barcode: null }) }, sources: [[retailer('ozon.ru')]] });
    const alone = (await scan(single.service)).product;
    assert.equal(alone.nutrition!.sugarsG.value, null);
    const pair = setup({ off: offPartial(), pages: { 'ozon.ru': html({ barcode: null }), 'vprok.ru': html({ barcode: null }) }, sources: [[retailer('ozon.ru'), retailer('vprok.ru')]] });
    const { product } = await scan(pair.service);
    assert.equal(product.nutrition!.sugarsG.value, 38);
    assert.deepEqual([evidence(product, 'sugarsG').confidence, evidence(product, 'sugarsG').consensusCount], ['medium', 2]);
  });
  it('12–13. ingredients come only from the selected cluster', async () => {
    const other = html(OTHER).replace(/Состав:[^.]*\./, 'Состав: крахмал, вода, краситель.');
    const selected = html().replace(/Состав:[^.]*\./, '');
    const rejected = setup({ off: noMacros(), pages: { 'shop-one.ru': selected, 'shop-two.ru': selected, 'shop-three.ru': other }, sources: [SHOPS.map((domain) => site(domain)), [], [], []] });
    assert.equal((await scan(rejected.service)).product.ingredients.value, null);
    const accepted = setup({ off: noMacros(), pages: { 'shop-one.ru': html(), 'shop-two.ru': selected, 'shop-three.ru': other }, sources: [SHOPS.map((domain) => site(domain)), [], [], []] });
    assert.ok((await scan(accepted.service)).product.ingredients.value!.some((item) => item.name === 'сахар'));
  });
  it('14. the cache prevents repeated Tavily and Gemini calls', async () => {
    const { service, calls } = setup({ off: offPartial(), pages: { 'shop-one.ru': html(), 'shop-two.ru': html() }, sources: [SHOPS.slice(0, 2).map((domain) => site(domain))] });
    await scan(service);
    const spent = [calls.queries.length, calls.reads.length, calls.aiText];
    await scan(service);
    assert.deepEqual([calls.queries.length, calls.reads.length, calls.aiText], spent);
  });
  it('15. sugars, saturated fat and salt from several sources give the usual Score', async () => {
    const onlySugars = html().replace(/насыщенн[^<]*?\d+\s*г/i, '');
    const { service } = setup({ off: offPartial(), pages: { 'shop-one.ru': html(), 'shop-two.ru': html(), 'shop-three.ru': onlySugars }, sources: [SHOPS.map((domain) => site(domain))] });
    const { product, score } = await scan(service);
    assert.deepEqual([product.nutrition!.sugarsG.value, product.nutrition!.saturatedFatG.value, product.nutrition!.saltG.value], [38, 9, 0.4]);
    for (const kind of ['sugars', 'saturatedFat', 'salt'] as const) assert.ok(!score.missingFactors.includes(kind));
  });
});

describe('Field-level enrichment: Choco Pie regression and the general rule', () => {
  const CHOCO = '4607084351385';
  const A = { kcal: 430, protein: 4.5, carbs: 63, fat: 18, sugars: 38, saturated: 9, salt: 0.4 };
  const B = { kcal: 440, protein: 4, carbs: 70.5, fat: 16.1, sugars: 50, saturated: 7, salt: 0.8 };
  const off = (values = energy(430, 4.5, 63, 18)) => mapOpenFoodFactsProduct(nutrients(values, { product_name: 'Чокопай', brands: 'Lotte' }), CHOCO)!;
  const site = (domain: string) => ({ url: `https://${domain}/p`, title: 'Чокопай Lotte', domain, snippet: `Штрихкод ${CHOCO}` });
  const page = (facts: Facts) => html({ barcode: CHOCO, ...facts });
  const missing = (product: Product) => [product.nutrition!.sugarsG.value, product.nutrition!.saturatedFatG.value, product.nutrition!.saltG.value];
  const only = (facts: Facts, ...rows: readonly RegExp[]) => rows.reduce((text, row) => text.replace(row, ''), page(facts));
  const SATURATED = /насыщенн[^<.]*?\d+\s*г/i;
  const SUGARS = /сахар[а-я]*[^<.]*?\d+(?:,\d+)?\s*г/i;
  const SALT = /соль[^<.]*?\d+(?:,\d+)?\s*г/i;

  it('Choco Pie: group B is never carried into group A', async () => {
    const { service } = setup({ off: off(), pages: { 'shop-one.ru': page(B), 'shop-two.ru': page(B), 'ozon.ru': page(B) }, sources: [['shop-one.ru', 'shop-two.ru', 'ozon.ru'].map(site)] });
    assert.deepEqual(missing((await scan(service, CHOCO)).product), [null, null, null]);
  });
  it('Choco Pie: two agreeing sources of group A fill the fields, group B is ignored', async () => {
    const { service } = setup({ off: off(), pages: { 'shop-one.ru': page(A), 'shop-two.ru': page(A), 'shop-three.ru': page(B) }, sources: [['shop-one.ru', 'shop-two.ru', 'shop-three.ru'].map(site)] });
    assert.deepEqual(missing((await scan(service, CHOCO)).product), [38, 9, 0.4]);
  });
  it('1. one field from a strong source', async () => {
    const { service } = setup({ off: off(), pages: { 'lotte.ru': page(A) }, sources: [[site('lotte.ru')]] });
    assert.equal((await scan(service, CHOCO)).product.nutrition!.sugarsG.value, 38);
  });
  it('2. one field by the consensus of two sources', async () => {
    const { service } = setup({ off: off(), pages: { 'shop-one.ru': page(A), 'shop-two.ru': page({ ...A, sugars: 38.2 }) }, sources: [['shop-one.ru', 'shop-two.ru'].map(site)] });
    const { product } = await scan(service, CHOCO);
    assert.equal(product.nutrition!.sugarsG.value, 38);
    assert.equal(product.fieldEvidence!.find((item) => item.field === 'sugarsG')!.confidence, 'medium');
  });
  it('3. conflicting sources: the field stays null', async () => {
    const { service } = setup({ off: off(), pages: { 'shop-one.ru': page({ ...A, sugars: 38 }), 'shop-two.ru': page({ ...A, sugars: 20 }) }, sources: [['shop-one.ru', 'shop-two.ru'].map(site)] });
    assert.equal((await scan(service, CHOCO)).product.nutrition!.sugarsG.value, null);
  });
  it('5. several missing fields are collected from different pages', async () => {
    const pages = {
      'lotte.ru': only(A, SATURATED, SALT),
      'orion.ru': only(A, SUGARS, SALT),
      'shop-one.ru': only(A, SUGARS, SATURATED), 'shop-two.ru': only(A, SUGARS, SATURATED),
    };
    const { service } = setup({ off: off(), pages, sources: [Object.keys(pages).map(site)] });
    assert.deepEqual(missing((await scan(service, CHOCO)).product), [38, 9, 0.4]);
  });
  it('6. the search continues while fiber is missing', async () => {
    const { service, calls } = setup({ off: off(), pages: { 'lotte.ru': page(A) }, sources: [[site('lotte.ru')], [site('shop-one.ru')]] });
    await scan(service, CHOCO);
    assert.equal(calls.queries.length, 5);
  });
  it('only the fields still missing reach the later queries', async () => {
    const { service, calls } = setup({ off: off(), pages: { 'lotte.ru': only(A, SATURATED, SALT) }, sources: [[site('lotte.ru')], [], [], [], [], []] });
    await scan(service, CHOCO);
    assert.ok(calls.queries.length > 2);
    for (const query of calls.queries.slice(2)) assert.doesNotMatch(query, /сахар/);
  });
  it('7. the cache avoids a repeated search', async () => {
    const { service, calls } = setup({ off: off(), pages: { 'lotte.ru': page(A) }, sources: [[site('lotte.ru')]] });
    await scan(service, CHOCO); await scan(service, CHOCO);
    assert.deepEqual([calls.queries.length, calls.reads.length], [5, 1]);
  });
  it('8. a web calorie candidate that does not fit the macros fills nothing', async () => {
    const { 'energy-kcal': _kcal, ...macros } = energy(430, 4.5, 63, 18);
    const { service } = setup({ off: off(macros as ReturnType<typeof energy>), pages: { 'lotte.ru': page({ ...A, kcal: 507 }) }, sources: [[site('lotte.ru')]] });
    const { nutrition } = (await scan(service, CHOCO)).product;
    assert.equal(nutrition!.caloriesKcal.value, null);
    assert.deepEqual([nutrition!.proteinG.value, nutrition!.carbsG.value, nutrition!.fatG.value], [4.5, 63, 18]);
  });
  const macrosOf = (product: Product) => [product.nutrition!.caloriesKcal.value, product.nutrition!.proteinG.value, product.nutrition!.carbsG.value, product.nutrition!.fatG.value];
  it('fixture: a 507 kcal line is ignored, 430 stays, and the same page still gives its other fields', async () => {
    const { service } = setup({ off: off(), pages: { 'lotte.ru': page({ ...A, kcal: 507 }) }, sources: [[site('lotte.ru')]] });
    const { product } = await scan(service, CHOCO);
    assert.deepEqual(macrosOf(product), [430, 4.5, 63, 18]);
    assert.deepEqual(missing(product), [38, 9, 0.4]);
  });
  it('fixture: candidate B of another recipe moves nothing and the existing values stay', async () => {
    const { service } = setup({ off: off(), pages: { 'shop-one.ru': page(B), 'shop-two.ru': page(B) }, sources: [['shop-one.ru', 'shop-two.ru'].map(site)] });
    const { product } = await scan(service, CHOCO);
    assert.deepEqual(macrosOf(product), [430, 4.5, 63, 18]);
    assert.deepEqual(missing(product), [null, null, null]);
  });
  it('a base value is never erased, even if it disagrees with the macros: 507 from the base stays', async () => {
    const { service } = setup({ off: off(energy(507, 4.5, 63, 18)), sources: [[], [], [], [], [], []] });
    assert.deepEqual(macrosOf((await scan(service, CHOCO)).product), [507, 4.5, 63, 18]);
  });
  it('every existing field survives a conflicting web candidate', async () => {
    const { service } = setup({ off: mapOpenFoodFactsProduct(offProduct({ ingredients_text: undefined }), BARCODE)!, pages: { 'shop-one.ru': html({ kcal: 900, protein: 30, carbs: 5, fat: 60, sugars: 1, saturated: 30, salt: 5, barcode: BARCODE }), 'shop-two.ru': html({ kcal: 900, protein: 30, carbs: 5, fat: 60, sugars: 1, saturated: 30, salt: 5, barcode: BARCODE }) }, sources: [['shop-one.ru', 'shop-two.ru'].map((domain) => ({ url: `https://${domain}/p`, title: 'Чокопай Lotte', domain, snippet: `Штрихкод ${BARCODE}` }))] });
    const before = (await new CachedProductLookupProvider({ name: 'off', lookup: async () => offComplete() }).lookup(BARCODE))!.nutrition!.values;
    const { nutrition } = (await scan(service)).product;
    for (const key of ['caloriesKcal', 'proteinG', 'carbsG', 'fatG', 'sugarsG', 'saturatedFatG', 'saltG'] as const) assert.equal(nutrition![key].value, before[key], key);
  });
  it('9. the final Score is calculated after enrichment', async () => {
    const { service } = setup({ off: off(), pages: { 'lotte.ru': page(A) }, sources: [[site('lotte.ru')]] });
    const { score } = await scan(service, CHOCO);
    assert.equal(score.factors.find((item) => item.kind === 'sugars')!.level, 'high');
    assert.ok(!score.missingFactors.includes('sugars'));
  });
  it('10. no fake values: a placeholder zero is not accepted', async () => {
    const { service, verdicts } = setup({ off: off(), pages: { 'lotte.ru': page({ ...A, saturated: 0 }) }, sources: [[site('lotte.ru')]] });
    const { product } = await scan(service, CHOCO);
    assert.equal(product.nutrition!.saturatedFatG.value, null);
    assert.equal(verdicts()[0].pages[0].reason, 'implausible_nutrition:zero_saturated_fat');
  });
});

describe('Universal enrichment model', () => {
  const CODE = '4600000000017';
  const RIGHT = { kcal: 500, protein: 6, carbs: 60, fat: 26, sugars: 30, saturated: 12, salt: 0.5 };
  const OTHER = { kcal: 420, protein: 10, carbs: 75, fat: 9, sugars: 45, saturated: 4, salt: 1.2 };
  const baseValues = (kcal = 500, protein = 6, carbs = 60, fat = 26) => energy(kcal, protein, carbs, fat);
  const product = (values: Record<string, unknown>, extra: Record<string, unknown> = {}) => mapOpenFoodFactsProduct(nutrients(values, { product_name: 'Батончик Ореховый', brands: 'Lotte', ...extra }), CODE)!;
  const withNutrient = (name: string, value: number) => ({ [name]: { source: 'manufacturer', source_index: 0, source_per: '100g', unit: 'g', value } });
  const site = (domain: string) => ({ url: `https://${domain}/p`, title: 'Батончик Ореховый Lotte', domain, snippet: `Штрихкод ${CODE}` });
  const page = (facts: Facts, title = 'Батончик Ореховый Lotte') => html({ title, barcode: CODE, ...facts });
  const run = (off: ProductLookupResult, pages: Record<string, string>) => {
    const made = setup({ off, pages, sources: [Object.keys(pages).map(site), [], [], [], [], []] });
    return { ...made, scanned: scan(made.service, CODE) };
  };
  const macros = (item: Product) => [item.nutrition!.caloriesKcal.value, item.nutrition!.proteinG.value, item.nutrition!.carbsG.value, item.nutrition!.fatG.value];
  const trio = (item: Product) => [item.nutrition!.sugarsG.value, item.nutrition!.saturatedFatG.value, item.nutrition!.saltG.value];
  const evidence = (item: Product, field: string) => item.fieldEvidence!.find((entry) => entry.field === field)!;

  it('1. a correct, complete OFF record needs no web', async () => {
    const off = product({ ...baseValues(), ...withNutrient('sugars', 30), ...withNutrient('saturated-fat', 12), ...withNutrient('salt', 0.5), ...withNutrient('fiber', 1.2) }, { ingredients_text: 'сахар, орехи, какао' });
    const { calls, scanned } = run(off, { 'lotte.ru': page(RIGHT) });
    await scanned;
    assert.equal(calls.queries.length, 0);
  });
  it('2. a partial OFF record is filled from the web, and every field keeps its source', async () => {
    const { scanned } = run(product(baseValues()), { 'lotte.ru': page(RIGHT) });
    const { product: filled } = await scanned;
    assert.deepEqual(trio(filled), [30, 12, 0.5]);
    assert.deepEqual([evidence(filled, 'proteinG').trust, evidence(filled, 'proteinG').confidence], ['open_food_facts', 'medium']);
  });
  it('3–4. a wrong OFF field is fixed by the manufacturer with corroboration', async () => {
    const { scanned } = run(product({ ...baseValues(), ...withNutrient('sugars', 5) }), { 'lotte.ru': page(RIGHT), 'shop-one.ru': page(RIGHT) });
    const { product: fixed } = await scanned;
    assert.equal(fixed.nutrition!.sugarsG.value, 30);
    assert.equal(fixed.nutrition!.sugarsG.provenance, 'web_search');
    assert.deepEqual([evidence(fixed, 'sugarsG').corrected, evidence(fixed, 'sugarsG').trust, evidence(fixed, 'sugarsG').consensusCount], [true, 'official_manufacturer', 2]);
  });
  it('OFF calories that break the recipe are fixed together by stronger sources', async () => {
    const { scanned } = run(product(baseValues(620)), { 'lotte.ru': page(RIGHT), 'shop-one.ru': page(RIGHT) });
    const { product: fixed } = await scanned;
    assert.deepEqual(macros(fixed), [500, 6, 60, 26]);
    assert.equal(evidence(fixed, 'caloriesKcal').corrected, true);
  });
  it('two independent weak sites outrank the base on one field', async () => {
    const { scanned } = run(product({ ...baseValues(), ...withNutrient('sugars', 5) }), { 'shop-one.ru': page(RIGHT), 'shop-two.ru': page(RIGHT) });
    const { product: fixed } = await scanned;
    assert.equal(fixed.nutrition!.sugarsG.value, 30);
    assert.equal(evidence(fixed, 'sugarsG').dataQuality, 'confirmed');
  });
  it('one weak or one strong conflicting site leaves OFF alone', async () => {
    const weak = run(product({ ...baseValues(), ...withNutrient('sugars', 5) }), { 'shop-one.ru': page(RIGHT) });
    assert.equal((await weak.scanned).product.nutrition!.sugarsG.value, 5);
    const strong = run(product({ ...baseValues(), ...withNutrient('sugars', 5) }), { 'lotte.ru': page(RIGHT) });
    assert.equal((await strong.scanned).product.nutrition!.sugarsG.value, 5);
  });
  it('a label value is never corrected', async () => {
    const label = await labelProduct({ sugarsG: observed(5), saturatedFatG: observed(1), saltG: observed(0.1) });
    const made = setup({ label, pages: { 'lotte.ru': html({ title: 'Lotte Чокопай', barcode: null }), 'orion.ru': html({ title: 'Lotte Чокопай', barcode: null }) } });
    const { product: read } = await made.service.analyze({ ...FILE }, 'user', { roles: ['nutrition'] }).then(sourceEvidenceView);
    assert.equal(read.nutrition!.sugarsG.value, 5);
  });
  it('5. two exact-barcode sources confirm a field; two of them can also correct OFF', async () => {
    const { scanned } = run(product({ ...baseValues(), ...withNutrient('sugars', 5) }), { 'ozon.ru': page(RIGHT), 'vprok.ru': page(RIGHT) });
    const { product: fixed } = await scanned;
    assert.equal(fixed.nutrition!.sugarsG.value, 30);
    assert.deepEqual([evidence(fixed, 'sugarsG').confidence, evidence(fixed, 'sugarsG').trust], ['high', 'exact_barcode_source']);
  });
  it('6. two conflicting sources leave the field null', async () => {
    const { scanned } = run(product(baseValues()), { 'shop-one.ru': page(RIGHT), 'shop-two.ru': page({ ...RIGHT, sugars: 10 }) });
    assert.equal((await scanned).product.nutrition!.sugarsG.value, null);
  });
  it('7–8. two recipe groups: a field found only in the other recipe is not moved', async () => {
    const { scanned } = run(product(baseValues()), { 'shop-one.ru': page(OTHER), 'shop-two.ru': page(OTHER), 'ozon.ru': page(OTHER) });
    const { product: kept } = await scanned;
    assert.deepEqual(macros(kept), [500, 6, 60, 26]);
    assert.deepEqual(trio(kept), [null, null, null]);
  });
  it('another recipe with stronger proof replaces the macros as a whole, never field by field', async () => {
    const { scanned } = run(product(baseValues()), { 'lotte.ru': page(OTHER), 'ozon.ru': page(OTHER), 'vprok.ru': page(OTHER) });
    const { product: replaced } = await scanned;
    assert.deepEqual(macros(replaced), [420, 10, 75, 9]);
    assert.deepEqual(trio(replaced), [45, 4, 1.2]);
  });
  it('9. sugars from one strong source', async () => {
    const { scanned } = run(product(baseValues()), { 'lotte.ru': page(RIGHT) });
    assert.equal(evidence((await scanned).product, 'sugarsG').trust, 'official_manufacturer');
  });
  it('10. sugars by consensus of weak sources', async () => {
    const { scanned } = run(product(baseValues()), { 'shop-one.ru': page(RIGHT), 'shop-two.ru': page({ ...RIGHT, sugars: 30.2 }) });
    const { product: filled } = await scanned;
    assert.equal(filled.nutrition!.sugarsG.value, 30);
    assert.deepEqual([evidence(filled, 'sugarsG').confidence, evidence(filled, 'sugarsG').trust], ['medium', 'weak_web_source']);
  });
  it('11. salt from sodium', async () => {
    const sodium = page(RIGHT).replace(/соль[^<]*?г/i, 'натрий 200 мг');
    const { scanned } = run(product(baseValues()), { 'lotte.ru': sodium });
    assert.equal((await scanned).product.nutrition!.saltG.value, 0.5);
  });
  it('12. per-serving values are converted before comparing', async () => {
    const serving = page({ kcal: 200, protein: 2.4, carbs: 24, fat: 10.4, sugars: 12, saturated: 4.8, salt: 0.2, per: 'порцию (40 г)' });
    const { scanned } = run(product(baseValues()), { 'lotte.ru': serving });
    assert.deepEqual(trio((await scanned).product), [30, 12, 0.5]);
  });
  it('13. ingredients stand apart from nutrition', async () => {
    const onlyIngredients = `<title>Батончик Ореховый Lotte</title><p>Штрихкод: ${CODE}. Состав: сахар, арахис, какао-масло.</p>`;
    const { scanned } = run(product(baseValues(), { ingredients_text: undefined, allergens_tags: undefined, traces_tags: undefined, additives_tags: undefined }), { 'lotte.ru': onlyIngredients });
    assert.ok((await scanned).product.ingredients.value!.some((item) => item.name === 'арахис'));
  });
  it('14. a repeated scan pays nothing, including a miss', async () => {
    const made = run(product(baseValues()), { 'lotte.ru': page(RIGHT) });
    await made.scanned;
    const spent = made.calls.queries.length + made.calls.reads.length;
    await scan(made.service, CODE);
    assert.equal(made.calls.queries.length + made.calls.reads.length, spent);
  });
  it('15. a web miss gives a partial Score', async () => {
    const { scanned } = run(product(baseValues()), {});
    const { score, product: partial } = await scanned;
    assert.deepEqual([typeof score.value, score.confidence], ['number', 'low']);
    assert.deepEqual(trio(partial), [null, null, null]);
  });
  it('the reading order follows source trust', async () => {
    const pages = { 'shop-one.ru': page(RIGHT), 'ozon.ru': page(RIGHT, 'Батончик Ореховый Lotte'), 'lotte.ru': page(RIGHT) };
    const plain = { url: 'https://ozon.ru/p', title: 'Батончик Ореховый Lotte', domain: 'ozon.ru' };
    const { service, calls } = setup({ off: product(baseValues()), pages, sources: [[plain, site('shop-one.ru'), site('lotte.ru')]] });
    await scan(service, CODE);
    assert.deepEqual(calls.reads.slice(0, 3), ['lotte.ru', 'shop-one.ru', 'ozon.ru']);
  });
});

describe('Anomalies, search identity and recipe replacement', () => {
  const CODE = '4600000000024';
  const FULL = { sugars: 30, 'saturated-fat': 12, salt: 0.5, fiber: 1.2 };
  const nutrient = (name: string, value: number) => ({ [name]: { source: 'manufacturer', source_index: 0, source_per: '100g', unit: 'g', value } });
  const product = (kcal: number, extra: Record<string, number> = FULL, identity: Record<string, unknown> = {}) => mapOpenFoodFactsProduct(nutrients({ ...energy(kcal, 6, 60, 26), ...Object.assign({}, ...Object.entries(extra).map(([name, value]) => nutrient(name, value))) }, { product_name: 'Батончик Ореховый', brands: 'Lotte', ingredients_text: 'сахар, орехи, какао', ...identity }), CODE)!;
  const site = (domain: string) => ({ url: `https://${domain}/p`, title: 'Батончик Ореховый Lotte', domain, snippet: `Штрихкод ${CODE}` });
  const RIGHT = { title: 'Батончик Ореховый Lotte', barcode: CODE, kcal: 500, protein: 6, carbs: 60, fat: 26, sugars: 30, saturated: 12, salt: 0.5 };
  const OTHER = { ...RIGHT, kcal: 420, protein: 10, carbs: 75, fat: 9, sugars: 45, saturated: 4, salt: 1.2 };
  const run = (off: ProductLookupResult, pages: Record<string, string>) => {
    const made = setup({ off, pages, sources: [Object.keys(pages).map(site), [], [], [], [], []] });
    return { ...made, scanned: scan(made.service, CODE) };
  };

  it('1. complete and consistent OFF: no web requests', async () => {
    const { calls, scanned } = run(product(500), { 'lotte.ru': html(RIGHT) });
    await scanned;
    assert.deepEqual([calls.queries.length, calls.reads.length], [0, 0]);
  });
  it('2. complete OFF with calories against the macros: the web checks exactly that field', async () => {
    const { calls, scanned } = run(product(640), { 'lotte.ru': html(RIGHT) });
    const { product: fixed } = await scanned;
    assert.ok(calls.queries.length > 0);
    assert.equal(fixed.nutrition!.caloriesKcal.value, 500);
    assert.equal(fixed.fieldEvidence!.find((item) => item.field === 'caloriesKcal')!.corrected, true);
    assert.equal(fixed.nutrition!.sugarsG.value, 30, 'the other fields stay');
  });
  it('an anomaly nobody confirms keeps the base value', async () => {
    const { calls, scanned } = run(product(640), {});
    assert.equal((await scanned).product.nutrition!.caloriesKcal.value, 640);
    assert.ok(calls.queries.length > 0);
  });
  it('3. sugars above carbs is an anomaly', async () => {
    const { calls, scanned } = run(product(500, { ...FULL, sugars: 80 }), { 'lotte.ru': html(RIGHT) });
    assert.equal((await scanned).product.nutrition!.sugarsG.value, 30);
    assert.ok(calls.queries.length > 0);
  });
  it('4. saturated fat above fat is an anomaly', async () => {
    const { calls, scanned } = run(product(500, { ...FULL, 'saturated-fat': 40 }), { 'lotte.ru': html(RIGHT) });
    assert.equal((await scanned).product.nutrition!.saturatedFatG.value, 12);
    assert.ok(calls.queries.length > 0);
  });
  it('salt that disagrees with sodium is an anomaly', async () => {
    const off = product(500, { ...FULL, salt: 3 });
    const withSodium = { ...off, nutrition: { ...off.nutrition!, values: { ...off.nutrition!.values, sodiumMg: 200 } } };
    const { calls, scanned } = run(withSodium, { 'lotte.ru': html(RIGHT) });
    await scanned;
    assert.ok(calls.queries.length > 0);
  });
  it('5. a long legal name becomes a short search identity', () => {
    assert.equal(searchName('Choco Pie - Мучное кондитерское изделие в глазури«Choco Pie» («Чоко Пай»)'), 'Choco Pie');
    assert.equal(searchName('Продукт пищевой Батончик Ореховый масса нетто 40 г'), 'Батончик Ореховый');
    assert.equal(searchName('Картофельное Пюре С Куриным Вкусом'), 'Картофельное Пюре С Куриным Вкусом');
    assert.equal(searchName('Пюре (с курицей)'), 'Пюре (с курицей)', 'a variant in brackets stays');
    assert.equal(searchName('Кондитерское изделие'), 'Кондитерское изделие', 'nothing left: the source name stays');
  });
  it('5–6. queries use the short name, pages are matched by it, and the shown name does not change', async () => {
    const LONG = 'Choco Pie - Мучное кондитерское изделие в глазури«Choco Pie» («Чоко Пай»)';
    const off = mapOpenFoodFactsProduct(nutrients(energy(430, 4.5, 63, 18), { product_name: LONG, brands: 'Orion' }), CODE)!;
    const page = html({ title: 'Orion Choco Pie', barcode: null });
    const pages = { 'ozon.ru': page, 'vprok.ru': page };
    const { service, calls } = setup({ off, pages, sources: [[], Object.keys(pages).map((domain) => ({ url: `https://${domain}/p`, title: 'Orion Choco Pie', domain }))] });
    const { product: scanned } = await scan(service, CODE);
    assert.equal(calls.queries[1], `"${CODE}" "Orion" "Choco Pie"`);
    assert.deepEqual([...calls.reads].sort(), ['ozon.ru', 'vprok.ru']);
    assert.equal(scanned.nutrition!.sugarsG.value, 38);
    assert.equal(scanned.name.value, LONG);
  });
  it('7–8. a new recipe clears old fiber, sugars and salt it did not confirm', async () => {
    const partial = html(OTHER).replace(/сахар[а-я]*[^<.]*?\d+\s*г/i, '').replace(/соль[^<]*?г/i, '');
    const off = product(500, { sugars: 30, salt: 0.5, fiber: 5 });
    const { scanned } = run(off, { 'lotte.ru': partial, 'ozon.ru': partial, 'vprok.ru': partial });
    const { nutrition, ingredients } = (await scanned).product;
    assert.deepEqual([nutrition!.caloriesKcal.value, nutrition!.proteinG.value, nutrition!.carbsG.value, nutrition!.fatG.value], [420, 10, 75, 9]);
    assert.deepEqual([nutrition!.fiberG.value, nutrition!.sugarsG.value, nutrition!.saltG.value, nutrition!.sodiumMg.value], [null, null, null, null]);
    assert.ok(ingredients.value === null || !ingredients.value.some((item) => item.name === 'какао'), 'old ingredients are not kept');
  });
  it('9. a label field survives the recipe reconciliation', async () => {
    const label = await labelProduct({ sugarsG: observed(5), caloriesKcal: fromOff(500), proteinG: fromOff(6), carbsG: fromOff(60), fatG: fromOff(26), fiberG: fromOff(4) });
    const lookup = { ...product(420), replacesRecipe: true, corrections: ['caloriesKcal' as const], nutrition: { basis: 'per_100g' as const, derived: [], values: { caloriesKcal: 420, proteinG: null, carbsG: null, sugarsG: 45, fatG: null, saturatedFatG: null, fiberG: null, saltG: null, sodiumMg: null } } };
    const { nutrition } = mergeProductLookup(label, lookup).product;
    assert.deepEqual([nutrition!.sugarsG.value, nutrition!.sugarsG.provenance], [5, 'observed']);
    assert.equal(nutrition!.caloriesKcal.value, 420);
    assert.equal(nutrition!.fiberG.value, null);
  });
});

describe('Final barcode enrichment', () => {
  const CODE = '4607000000018';
  const off = () => mapOpenFoodFactsProduct(nutrients(energy(430, 4.5, 63, 18), { product_name: 'Чокопай', brands: 'Lotte', ingredients_text: undefined, allergens_tags: undefined, traces_tags: undefined, additives_tags: undefined }), CODE)!;
  const site = (domain: string, extra = {}) => ({ url: `https://${domain}/p`, title: 'Чокопай Lotte', domain, snippet: `Штрихкод ${CODE}`, ...extra });

  it('each missing field gets its own barcode query, in priority order', async () => {
    const { service, calls } = setup({ off: off(), sources: [[], [], [], [], [], [], [], []] });
    await scan(service, CODE);
    assert.deepEqual(calls.queries.slice(0, 6), [`"${CODE}"`, `"${CODE}" "Lotte" "Чокопай"`, `${CODE} сахара`, `${CODE} насыщенные жиры`, `${CODE} соль`, `${CODE} клетчатка`]);
    assert.equal(calls.queries.length, MAX_SEARCHES_PER_PRODUCT);
  });
  it('a field already found leaves the later queries, and a full profile stops the search', async () => {
    const full = html({ barcode: CODE });
    const { service, calls } = setup({ off: off(), pages: { 'lotte.ru': full }, sources: [[site('lotte.ru')]] });
    await scan(service, CODE);
    assert.equal(calls.queries.length, 5);
  });
  it('Gemini parses found pages up to its limit, and only printed numbers survive', async () => {
    const text = (domain: string) => `<title>Чокопай Lotte ${domain}</title><p>Штрихкод ${CODE}. Пищевая ценность и калорийность: сахара тридцать восемь, белки 4,5, углеводы 63, жиры 18</p>`;
    const pages = { 'shop-one.ru': text('a'), 'shop-two.ru': text('b'), 'shop-three.ru': text('c') };
    const { service, calls } = setup({ off: off(), pages, sources: [Object.keys(pages).map((domain) => site(domain))], aiPages: [{ id: 0, kcal: 430, protein: 4.5, carbs: 63, fat: 18, sugars: 99, saturatedFat: null, salt: null, sodiumMg: null, fiber: null }] });
    const { product } = await scan(service, CODE);
    assert.ok(calls.aiPages.length >= 1 && calls.aiPages.length <= MAX_AI_EXTRACTIONS_PER_PRODUCT);
    assert.equal(product.nutrition!.sugarsG.value, null, 'a number that is not on the page is dropped');
  });
  it('the fullest ingredients block is chosen among equally confirmed pages', async () => {
    const short = html({ barcode: CODE });
    const long = short.replace(/Состав:[^.]*\./, 'Состав: сахар, арахис, какао-масло, эмульгатор лецитин, мука пшеничная, соль.');
    const { service } = setup({ off: off(), pages: { 'shop-one.ru': short, 'shop-two.ru': long }, sources: [['shop-one.ru', 'shop-two.ru'].map((domain) => site(domain))] });
    const { product } = await scan(service, CODE);
    assert.ok(product.ingredients.value!.some((item) => item.name === 'мука пшеничная'));
    assert.ok(product.allergens.value!.some((item) => item.code === 'gluten'));
  });
});

describe('Data quality tiers and estimates', () => {
  const CODE = '4607000000025';
  const estimateItem = (value: number) => ({ source: 'estimate', source_index: 0, source_per: '100g', unit: 'g', value });
  const off = (extra: Record<string, unknown> = {}, identity: Record<string, unknown> = {}) => mapOpenFoodFactsProduct(nutrients({ ...energy(430, 4.5, 63, 18), ...extra }, { product_name: 'Чокопай', brands: 'Lotte', ...identity }), CODE)!;
  const site = (domain: string) => ({ url: `https://${domain}/p`, title: 'Чокопай Lotte', domain, snippet: `Штрихкод ${CODE}` });
  const evidence = (product: Product, field: string) => product.fieldEvidence!.find((item) => item.field === field)!;
  const sources = (domains: readonly string[]) => [domains.map(site), [], [], [], [], [], [], []];

  it('a strong source is verified, two weak agreeing sites are confirmed', async () => {
    const strong = setup({ off: off(), pages: { 'lotte.ru': html({ barcode: CODE }) }, sources: sources(['lotte.ru']) });
    assert.equal(evidence((await scan(strong.service, CODE)).product, 'sugarsG').dataQuality, 'verified');
    const pair = setup({ off: off(), pages: { 'shop-one.ru': html({ barcode: CODE }), 'shop-two.ru': html({ barcode: CODE }) }, sources: sources(['shop-one.ru', 'shop-two.ru']) });
    assert.equal(evidence((await scan(pair.service, CODE)).product, 'sugarsG').dataQuality, 'confirmed');
  });
  it('a narrow spread between two sites between disagreeing sources remains unknown', async () => {
    const { service } = setup({ off: off(), pages: { 'shop-one.ru': html({ barcode: CODE, sugars: 36 }), 'shop-two.ru': html({ barcode: CODE, sugars: 40 }) }, sources: sources(['shop-one.ru', 'shop-two.ru']) });
    const { product, score } = await scan(service, CODE);
    assert.equal(product.nutrition!.sugarsG.value, null);
    assert.ok(!product.fieldEvidence?.some((item) => item.field === 'sugarsG'));
    assert.equal(typeof score.value, 'number');
  });
  it('a wide spread stays null', async () => {
    const { service } = setup({ off: off(), pages: { 'shop-one.ru': html({ barcode: CODE, sugars: 20 }), 'shop-two.ru': html({ barcode: CODE, sugars: 40 }) }, sources: sources(['shop-one.ru', 'shop-two.ru']) });
    assert.equal((await scan(service, CODE)).product.nutrition!.sugarsG.value, null);
  });
  it('an OFF estimate remains unknown after unsuccessful enrichment', async () => {
    const { service } = setup({ off: off({ sugars: estimateItem(37) }), sources: sources([]) });
    const { product, score } = await scan(service, CODE);
    assert.equal(product.nutrition!.sugarsG.value, null);
    assert.ok(!product.fieldEvidence?.some((item) => item.field === 'sugarsG'));
    assert.equal(score.confidence, 'low');
    assert.equal(product.nutrition!.saturatedFatG.value, null, 'without evidence the field stays null');
  });
  it('a found value beats the base estimate', async () => {
    const { service } = setup({ off: off({ sugars: estimateItem(20) }), pages: { 'lotte.ru': html({ barcode: CODE }) }, sources: sources(['lotte.ru']) });
    const { product } = await scan(service, CODE);
    assert.equal(product.nutrition!.sugarsG.value, 38);
    assert.equal(evidence(product, 'sugarsG').dataQuality, 'verified');
  });
  it('category and NOVA come from the base; processing does not come from a name', async () => {
    const { service } = setup({ off: off({}, { categories_tags: ['en:snacks', 'en:sugary-snacks', 'en:chocolates'], nova_group: 4 }), sources: sources([]) });
    const { product } = await scan(service, CODE);
    assert.equal(product.category.value, 'chocolate');
    assert.equal(product.semantics!.processing.value, 'ultra_processed');
    const plain = setup({ off: off({}, { ingredients_text: undefined }), sources: sources([]) });
    assert.equal((await scan(plain.service, CODE)).product.semantics!.processing.value, 'unknown');
  });
  it('fixtures: a drink, a healthy product and a snack go through the same flow', async () => {
    for (const [name, values, page] of [
      ['Лимонад', energy(40, 0, 10, 0), html({ title: 'Чокопай Lotte', barcode: CODE, per: '100 мл', kcal: 40, protein: 0, carbs: 10, fat: 0, sugars: 9.5, saturated: 0, salt: 0.01 })],
      ['Творог', energy(120, 17, 2, 5), html({ title: 'Чокопай Lotte', barcode: CODE, kcal: 120, protein: 17, carbs: 2, fat: 5, sugars: 1.8, saturated: 3, salt: 0.1 })],
      ['Чипсы', energy(536, 6.5, 53, 34), html({ title: 'Чокопай Lotte', barcode: CODE, kcal: 536, protein: 6.5, carbs: 53, fat: 34, sugars: 0.6, saturated: 3.1, salt: 1.4 })],
    ] as const) {
      const base = mapOpenFoodFactsProduct(nutrients(values, { product_name: 'Чокопай', brands: 'Lotte', ...(name === 'Лимонад' ? { categories_tags: ['en:beverages'] } : {}) }), CODE)!;
      const { service } = setup({ off: base, pages: { 'lotte.ru': page }, sources: sources(['lotte.ru']) });
      const { product, score } = await scan(service, CODE);
      assert.notEqual(product.nutrition!.sugarsG.value, null, name);
      assert.notEqual(score.value, null, name);
    }
  });
});
