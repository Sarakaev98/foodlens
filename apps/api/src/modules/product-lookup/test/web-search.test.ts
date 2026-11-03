import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dirname, join } from 'node:path';
import { Logger } from '@nestjs/common';
import { GoogleNutritionSearch, GoogleProvider, MockProvider, MOCK_GOAL_MATCH_RECORDINGS, type DiscoveredSource, type ExtractedPage, type ExtractionPage, type SourceDiscoveryInput } from '@foodlens/ai';
import { NOT_DETECTED, observed, type NutritionFacts, type Product } from '@foodlens/core';
import { scoreProduct } from '@foodlens/scoring';
import type { AppConfig } from '../../../config/app-config';
import { GoalMatchService } from '../../goal-match/goal-match.service';
import { eatHealthierPlan } from '../../goal-match/test/goal-match-v4.fixtures';
import type { NutritionTargetsService } from '../../nutrition-targets/nutrition-targets.service';
import { ScanService } from '../../scan/scan.service';
import { CachedProductLookupProvider } from '../cached-product-lookup.provider';
import { WebSearchProductLookupProvider, MAX_PAGES_PER_SCAN, WEB_SEARCH_MAX_PER_HOUR, WebSearchLimitError, type NutritionSearcher } from '../web-search-lookup.provider';
import { MultiSourceProductLookup } from '../multi-source-product-lookup';
import { mapOpenFoodFactsProduct } from '../open-food-facts.mapper';
import { createProductLookupSources } from '../product-lookup.module';
import type { ProductLookupProvider, ProductLookupResult } from '../product-lookup.provider';
import { BARCODE, offProduct, OFF_NUTRIENTS } from './open-food-facts.fixtures';

// Search, AI and pages are stubbed everywhere: no test here can reach Google or a website.
const { MOCK_META_PRODUCT_ANALYSIS } = require(join(dirname(require.resolve('@foodlens/ai')), 'providers/mock/mock-product-analysis.js'));
Logger.overrideLogger(false);

interface PageFacts { title?: string; barcode?: string | null; kcal?: number; protein?: number; carbs?: number; fat?: number; sugars?: number | null; saturated?: number | null; salt?: number | null }
function html({ title = 'Orion Choco Pie', barcode = null, kcal = 430, protein = 4.5, carbs = 63, fat = 18, sugars = 28, saturated = 9, salt = 0.4 }: PageFacts = {}): string {
  const row = (name: string, value: number | null, unit = 'г') => (value === null ? '' : `<tr><td>${name}</td><td>${String(value).replace('.', ',')} ${unit}</td></tr>`);
  return `<html><head><title>${title}</title></head><body><h1>${title}</h1>${barcode ? `<p>Штрихкод: ${barcode}</p>` : ''}<table><tr><th>Пищевая ценность на 100 г</th></tr>
    ${row('Энергетическая ценность', kcal, 'ккал')}${row('Белки', protein)}${row('Углеводы', carbs)}${row('в т.ч. сахара', sugars)}${row('Жиры', fat)}${row('в т.ч. насыщенные', saturated)}${row('Соль', salt)}</table></body></html>`;
}
const source = (domain: string, path = 'p'): DiscoveredSource => ({ url: `https://${domain}/${path}`, title: domain, domain });
type Pages = Readonly<Record<string, string>>;

/** URLs from "groundingMetadata" are the keys of pages: what is not there can not be read. */
function web(pages: Pages = { 'orion.ru': html({ barcode: BARCODE }) }, extracted: readonly ExtractedPage[] = []) {
  const discoveries: SourceDiscoveryInput[] = [];
  const extractions: (readonly ExtractionPage[])[] = [];
  const reads: string[] = [];
  const logs: { message: string; fields: any }[] = [];
  const searcher: NutritionSearcher = {
    discoverSources: async (input) => { discoveries.push(input); return { sources: Object.keys(pages).map((domain) => source(domain)), webSearchQueries: 2 }; },
    extractNutrition: async (items) => { extractions.push(items); return extracted; },
  };
  const reader = { fetchPage: async (url: string) => {
    reads.push(url);
    const domain = new URL(url).hostname;
    return { finalUrl: url, domain, contentType: 'text/html', body: pages[domain]! };
  } };
  const logger = { log: (message: string, fields: unknown) => logs.push({ message, fields }), warn: (message: string, fields: unknown) => logs.push({ message, fields }) };
  return { searcher, reader, logger, discoveries, extractions, reads, logs, verdict: () => logs.find((line) => line.message === 'web_lookup')?.fields };
}
type Web = ReturnType<typeof web>;

async function label(overrides: Partial<NutritionFacts> = {}, product: Partial<Product> = {}): Promise<Product> {
  const base = await new MockProvider().analyzeProduct({ kind: 'image', image: { mimeType: 'image/jpeg', base64: 'AA' } });
  return { ...base, brand: observed('Orion'), name: observed('Choco Pie'), ...product, nutrition: {
    basis: 'per_100g', servingSize: NOT_DETECTED, caloriesKcal: observed(430), proteinG: observed(4.5), carbsG: observed(63), fatG: observed(18),
    sugarsG: NOT_DETECTED, saturatedFatG: NOT_DETECTED, fiberG: observed(1.2), saltG: NOT_DETECTED, sodiumMg: NOT_DETECTED, ...overrides,
  } };
}
const snickers = () => label({ caloriesKcal: observed(514), proteinG: observed(7.5), carbsG: observed(56), fatG: observed(28.6) }, { brand: observed('Snickers'), name: observed('Snickers лесной орех') });
function offPartial(): ProductLookupResult {
  const { sugars: _s, 'saturated-fat': _f, salt: _a, sodium: _n, ...rest } = OFF_NUTRIENTS;
  return mapOpenFoodFactsProduct(offProduct({ nutrition: { aggregated_set: { nutrients: rest, per: '100g', preparation: 'as_sold' } } }), BARCODE)!;
}
const offFull = () => mapOpenFoodFactsProduct(offProduct(), BARCODE)!;

const provider = (stub: Web) => new WebSearchProductLookupProvider(stub.searcher, stub.reader, stub.logger);
function chain(off: ProductLookupResult | null, stub: Web, barcode: string | null = BARCODE, cached = true) {
  const offSource: ProductLookupProvider = { name: 'open_food_facts', lookup: async () => off };
  const lookup = provider(stub);
  return new MultiSourceProductLookup([offSource, cached ? new CachedProductLookupProvider(lookup) : lookup]).begin(barcode);
}
const webStep = (steps: readonly { provider: string }[]) => steps.find((step) => step.provider === 'web_search') as any;
const SNICKERS_PAGE = { title: 'Snickers лесной орех', kcal: 510, protein: 7.3, carbs: 55, fat: 28, sugars: 48, saturated: 10, salt: 0.37 };
const REGULAR_SNICKERS = { title: 'Snickers лесной орех', kcal: 496, protein: 7.5, carbs: 58, fat: 25, sugars: 50, saturated: 9, salt: 0.5 };

describe('Web search: when it runs', () => {
  it('complete nutrition: not triggered', async () => {
    const stub = web();
    const { steps } = await chain(null, stub).enrich(await label({ sugarsG: observed(38), saturatedFatG: observed(9), saltG: observed(0.4) }));
    assert.equal(stub.discoveries.length, 0); assert.equal(webStep(steps).status, 'not_needed');
  });
  it('OFF fills everything: not triggered', async () => {
    const stub = web();
    await chain(offFull(), stub).enrich(await label());
    assert.equal(stub.discoveries.length, 0);
  });
  it('19. only product identity reaches Search: no secrets, photo, profile or macros', async () => {
    const stub = web();
    await chain(offPartial(), stub).enrich(await label());
    assert.equal(stub.discoveries.length, 1);
    const input = stub.discoveries[0]!;
    assert.deepEqual(Object.keys(input).sort(), ['barcode', 'brand', 'name', 'serving']);
    assert.equal(input.barcode, BARCODE); assert.equal(input.brand, 'Orion');
    assert.ok(!JSON.stringify(input).includes('430'), 'label macros stay in the code');
  });
  it('without a barcode it runs only with brand and name, and OFF is skipped', async () => {
    const stub = web({ 'orion.ru': html() });
    await chain(null, stub, null).enrich(await label());
    assert.equal(stub.discoveries.length, 1); assert.equal(stub.discoveries[0]!.barcode, null);
    const unknown = web();
    await chain(null, unknown, null).enrich(await label({}, { brand: NOT_DETECTED }));
    assert.equal(unknown.discoveries.length, 0);
  });
  it('nothing to verify a page with and no barcode: the paid request is not spent', async () => {
    for (const product of [await label({ proteinG: NOT_DETECTED, carbsG: NOT_DETECTED }), await label({ basis: 'unknown' }), { ...await label(), nutrition: null }, await label({ basis: 'per_serving' })]) {
      const stub = web();
      await chain(null, stub, null).enrich(product);
      assert.equal(stub.discoveries.length, 0);
      const coded = web();
      await chain(null, coded).enrich(product);
      assert.equal(coded.discoveries.length, 1, 'with a barcode the page can be confirmed by it');
    }
  });
  it('18. max calls: one discovery, one extraction, the best pages chosen by code', async () => {
    const domains = ['a.example', 'b.example', 'ozon.ru', 'vprok.ru', 'orion.ru'];
    const stub = web(Object.fromEntries(domains.map((domain) => [domain, '<title>Orion Choco Pie</title><p>Пищевая ценность: белок — 4,5</p>'])));
    await chain(offPartial(), stub).enrich(await label());
    assert.equal(stub.discoveries.length, 1);
    assert.equal(stub.reads.length, domains.length);
    assert.deepEqual(stub.reads.map((url) => new URL(url).hostname).slice(0, 3), ['orion.ru', 'ozon.ru', 'vprok.ru']);
    assert.equal(stub.extractions.length, 2);
    assert.equal(stub.extractions[0]!.length, 1, 'one extraction reads one page');
  });
  it('pages with a table or markup need no AI at all', async () => {
    const stub = web();
    await chain(null, stub).enrich(await label());
    assert.equal(stub.extractions.length, 0);
  });
});

describe('Web search: acceptance is decided by code', () => {
  it('1. exact barcode with matching macros: accepted', async () => {
    const stub = web({ 'ozon.ru': html({ barcode: BARCODE }) });
    const { product } = await chain(null, stub).enrich(await label());
    assert.equal(product.nutrition!.sugarsG.value, 28); assert.equal(product.nutrition!.saturatedFatG.value, 9); assert.equal(product.nutrition!.saltG.value, 0.4);
    assert.equal(stub.verdict().status, 'accepted');
    assert.equal(stub.verdict().pages[0].identityMatch, 'exact_barcode');
  });
  it('2. exact barcode, conflicting macros: rejected', async () => {
    const stub = web({ 'ozon.ru': html({ barcode: BARCODE, kcal: 300, carbs: 40 }) });
    const { product } = await chain(null, stub).enrich(await label());
    assert.equal(product.nutrition!.sugarsG.value, null);
  });
  it('16. the same case is reported as recipe_version_conflict, with the numbers', async () => {
    const stub = web({ 'ozon.ru': html({ barcode: BARCODE, carbs: 70.5, fat: 16.1 }) });
    const { steps } = await chain(null, stub).enrich(await label());
    assert.equal(webStep(steps).status, 'miss');
    assert.equal(stub.verdict().status, 'recipe_version_conflict');
    assert.deepEqual(stub.verdict().pages[0].conflicts.map((conflict: any) => conflict.field), ['carbs', 'fat']);
  });
  it('3. manufacturer page, exact variant, matching macros: accepted without a barcode', async () => {
    const stub = web({ 'snickers.ru': html(SNICKERS_PAGE) });
    const { product } = await chain(null, stub, null).enrich(await snickers());
    assert.equal(product.nutrition!.sugarsG.value, 48);
    assert.equal(product.fieldEvidence![0]!.identityMatch, 'official_variant');
  });
  it('4. same brand, wrong variant, even with close macros: rejected', async () => {
    const stub = web({ 'snickers.ru': html({ ...SNICKERS_PAGE, title: 'Snickers Super' }) });
    const { product } = await chain(null, stub, null).enrich(await snickers());
    assert.equal(product.nutrition!.sugarsG.value, null);
    assert.equal(stub.verdict().status, 'insufficient_identity');
    assert.equal(stub.verdict().pages[0].reason, 'variant_mismatch');
  });
  it('brand only: not enough on a retailer page; no brand: rejected', async () => {
    const stub = web({ 'ozon.ru': html({ ...SNICKERS_PAGE, title: 'Snickers' }) });
    const { product } = await chain(null, stub, null).enrich(await snickers());
    assert.equal(product.nutrition!.sugarsG.value, null, 'one retailer page needs a second source');
    const other = web({ 'ozon.ru': html({ ...SNICKERS_PAGE, title: 'Батончик лесной орех' }) });
    await chain(null, other, null).enrich(await snickers());
    assert.equal(other.verdict().pages[0].reason, 'brand_mismatch');
  });
  it('5. retailer: the matching variant is accepted with the barcode, or with a second independent source; alone it stays unknown', async () => {
    const withBarcode = await chain(null, web({ 'ozon.ru': html({ ...SNICKERS_PAGE, barcode: BARCODE }) })).enrich(await snickers());
    assert.equal(withBarcode.product.nutrition!.sugarsG.value, 48);
    const alone = await chain(null, web({ 'ozon.ru': html(SNICKERS_PAGE) }), null).enrich(await snickers());
    assert.equal(alone.product.nutrition!.sugarsG.value, null);
    assert.ok(!alone.product.fieldEvidence?.some((item) => item.field === 'sugarsG'));
    const pair = await chain(null, web({ 'calorizator.ru': html(SNICKERS_PAGE), 'fatsecret.ru': html(SNICKERS_PAGE) }), null).enrich(await snickers());
    assert.equal(pair.product.nutrition!.sugarsG.value, 48);
  });
  it('6. no grounding URL: rejected before anything is read', async () => {
    const stub = web({});
    const { product, steps } = await chain(null, stub).enrich(await label());
    assert.equal(product.nutrition!.sugarsG.value, null); assert.equal(webStep(steps).status, 'miss');
    assert.equal(stub.verdict().status, 'no_grounded_source'); assert.equal(stub.reads.length, 0);
  });
  it('7. only URLs from grounding are read: the searcher contract has no way to pass model text', async () => {
    const stub = web({ 'orion.ru': html({ barcode: BARCODE }) });
    await chain(null, stub).enrich(await label());
    assert.deepEqual(stub.reads, ['https://orion.ru/p']);
  });
  it('an SEO domain with the barcode and the same recipe stays unknown', async () => {
    const stub = web({ 'kalorii-orion.ru': html({ barcode: BARCODE }) });
    const { product } = await chain(null, stub).enrich(await label());
    assert.equal(product.nutrition!.sugarsG.value, null);
    assert.equal(stub.verdict().pages[0].reason, 'exact_barcode_single_source');
  });
  it('a page with too few macros alone gives nothing', async () => {
    const stub = web({ 'ozon.ru': `<title>Orion Choco Pie</title><p>${BARCODE} На 100 г: белки 4,5 г, сахара 28 г</p>` });
    const { product } = await chain(null, stub).enrich(await label());
    assert.equal(product.nutrition!.sugarsG.value, null);
    assert.equal(stub.verdict().pages[0].reason, 'needs_second_source', 'a partial table can only support another source');
  });
  it('a page per 100 ml does not verify a label per 100 g', async () => {
    const stub = web({ 'ozon.ru': html({ barcode: BARCODE }).replace('на 100 г', 'на 100 мл') });
    const { product } = await chain(null, stub).enrich(await label());
    assert.equal(product.nutrition!.sugarsG.value, null);
    assert.equal(stub.verdict().pages[0].reason, 'basis_mismatch');
  });
  it('a label per serving is compared per 100 g and filled per serving', async () => {
    const serving = await label({ basis: 'per_serving', servingSize: observed({ amount: 30, unit: 'g' }), caloriesKcal: observed(129), proteinG: observed(1.35), carbsG: observed(18.9), fatG: observed(5.4) });
    const { product } = await chain(null, web({ 'ozon.ru': html({ barcode: BARCODE }) })).enrich(serving);
    assert.equal(product.nutrition!.sugarsG.value, 8.4);
  });
  it('10. page text goes through AI: the numbers must be printed there', async () => {
    const text = `<title>Orion Choco Pie</title><p>Штрихкод ${BARCODE}. Пищевая ценность на 100 г: калорийность — 430; белок — 4,5; углеводы — 63; из них сахара — 28; жир — 18; из них насыщенные — 9; соль — 0,4.</p>`;
    const stub = web({ 'ozon.ru': text }, [{ id: 0, kcal: 430, protein: 4.5, carbs: 63, fat: 18, sugars: 28, saturatedFat: 9, salt: 0.4, sodiumMg: null, fiber: 77 }]);
    const { product } = await chain(null, stub).enrich(await label({ fiberG: NOT_DETECTED }));
    assert.equal(stub.extractions.length, 1);
    assert.ok(stub.extractions[0]![0]!.text.includes('сахара'));
    assert.equal(product.nutrition!.sugarsG.value, 28);
    assert.equal(product.nutrition!.fiberG.value, null, 'a value that is not on the page is dropped');
  });
  it('AI that invents macros does not get a page verified', async () => {
    const text = `<title>Orion Choco Pie</title><p>Штрихкод ${BARCODE}. Пищевая ценность на 100 г: белок — 4,5, сахара — 28</p>`;
    const stub = web({ 'ozon.ru': text }, [{ id: 0, kcal: 430, protein: 4.5, carbs: 63, fat: 18, sugars: 28, saturatedFat: null, salt: null, sodiumMg: null, fiber: null }]);
    const { product } = await chain(null, stub).enrich(await label());
    assert.equal(product.nutrition!.sugarsG.value, null);
  });
  it('failed AI extraction or an unreadable page does not break the scan', async () => {
    const stub = web({ 'ozon.ru': '<title>Orion Choco Pie</title><p>Пищевая ценность: белок — 4,5</p>' });
    stub.searcher.extractNutrition = async () => { throw new Error('Google nutrition search: timeout'); };
    const failed = await chain(offPartial(), stub).enrich(await label());
    assert.equal(webStep(failed.steps).status, 'miss');
    const broken = web({ 'ozon.ru': html({ barcode: BARCODE }), 'vprok.ru': html({ barcode: BARCODE }) });
    const read = broken.reader.fetchPage;
    broken.reader.fetchPage = async (url) => { if (url.includes('ozon')) throw new Error('Page fetch: http_error'); return read(url); };
    const { product } = await chain(null, broken).enrich(await label());
    assert.equal(product.nutrition!.sugarsG.value, 28);
    assert.equal(broken.logs.find((line) => line.message === 'web_page_failed')!.fields.domain, 'ozon.ru');
  });
  it('11. two independent sources agree: 48 and 48.2 are the same value', async () => {
    const stub = web({ 'calorizator.ru': html(SNICKERS_PAGE), 'fatsecret.ru': html({ ...SNICKERS_PAGE, sugars: 48.2 }) });
    const { product } = await chain(null, stub, null).enrich(await snickers());
    assert.equal(product.nutrition!.sugarsG.value, 48);
    assert.equal(product.fieldEvidence![0]!.identityMatch, 'two_sources');
    assert.equal(product.fieldEvidence![0]!.confidence, 'medium');
  });
  it('real Snickers case: the label form «лесного» matches vkusvill and calorizator, and both values agree', async () => {
    const named = { ...await snickers(), brand: observed('SNICKERS'), name: observed('Шоколадный батончик С лесного орехом') };
    const stub = web({ 'vkusvill.ru': html({ title: 'Шоколадный батончик Snickers Лесной Орех 81 г', kcal: 511, protein: 7.9, carbs: 56.4, fat: 27.8, sugars: 48, saturated: 10, salt: 0.37 }),
      'calorizator.ru': html({ title: 'Шоколад Snickers с лесным орехом', kcal: 514, protein: 7.5, carbs: 56, fat: 28.5, sugars: 48, saturated: 10, salt: 0.37 }) });
    const { product } = await chain(null, stub, null).enrich(named);
    assert.equal(product.nutrition!.sugarsG.value, 48);
    assert.equal(product.fieldEvidence!.find((item) => item.field === 'sugarsG')!.consensusCount, 2);
  });
  it('real Snickers case: a field on only one page stays unknown until a second site confirms it', async () => {
    const stub = web({ 'vkusvill.ru': html({ ...SNICKERS_PAGE, sugars: null, saturated: null, salt: null }), 'calorizator.ru': html(SNICKERS_PAGE) });
    const { product } = await chain(null, stub, null).enrich(await snickers());
    assert.equal(product.nutrition!.sugarsG.value, null);
  });
  it('the grammar fix does not let a wrong recipe or variant through', async () => {
    const regular = await chain(null, web({ 'snickers.ru': html(REGULAR_SNICKERS) }), null).enrich(await snickers());
    assert.equal(regular.product.nutrition!.sugarsG.value, null);
    const crisper = web({ 'snickers.ru': html({ ...SNICKERS_PAGE, title: 'Snickers Crisper' }) });
    await chain(null, crisper, null).enrich(await snickers());
    assert.equal(crisper.verdict().pages[0].reason, 'variant_mismatch');
  });
  it('sections of one site are not independent sources', async () => {
    const stub = web({ 'calorizator.ru': html(SNICKERS_PAGE), 'm.calorizator.ru': html(SNICKERS_PAGE) });
    const { product } = await chain(null, stub, null).enrich(await snickers());
    assert.equal(product.nutrition!.sugarsG.value, null);
  });
  it('12. two sources conflict: 48 and 32 stay unresolved, never averaged; other fields are used', async () => {
    const stub = web({ 'ozon.ru': html({ ...SNICKERS_PAGE, barcode: BARCODE }), 'vprok.ru': html({ ...SNICKERS_PAGE, barcode: BARCODE, sugars: 32 }) });
    const { product } = await chain(null, stub).enrich(await snickers());
    assert.equal(product.nutrition!.sugarsG.value, null);
    assert.equal(product.nutrition!.saturatedFatG.value, 10);
    assert.deepEqual(stub.verdict().unresolved, ['sugars']);
    const only = web({ 'ozon.ru': html({ ...SNICKERS_PAGE, barcode: BARCODE, saturated: null, salt: null }), 'vprok.ru': html({ ...SNICKERS_PAGE, barcode: BARCODE, sugars: 32, saturated: null, salt: null }) });
    await chain(null, only).enrich(await snickers());
    assert.equal(only.verdict().status, 'unresolved_conflict');
  });
  it('13. a label value is never overwritten and not even requested', async () => {
    const stub = web({ 'orion.ru': html({ barcode: BARCODE, sugars: 20 }) });
    const { product } = await chain(null, stub).enrich(await label({ sugarsG: observed(25) }));
    assert.deepEqual([product.nutrition!.sugarsG.value, product.nutrition!.sugarsG.provenance], [25, 'observed']);
    assert.equal(product.nutrition!.saturatedFatG.value, 9);
  });
  it('14. an OFF value stays; the web fills only what OFF lacks', async () => {
    const off = mapOpenFoodFactsProduct(offProduct(), BARCODE)!;
    const partial = { ...off, nutrition: { ...off.nutrition!, values: { ...off.nutrition!.values, saltG: null } } };
    const stub = web({ 'orion.ru': html({ barcode: BARCODE, sugars: 20 }) });
    const { product } = await chain(partial, stub).enrich(await label());
    assert.deepEqual([product.nutrition!.sugarsG.value, product.nutrition!.sugarsG.provenance], [38, 'open_food_facts']);
    assert.deepEqual([product.nutrition!.saltG.value, product.nutrition!.saltG.provenance], [0.4, 'web_search']);
  });
  it('15. the web fills only null: macros and other label values stay as printed', async () => {
    const stub = web({ 'orion.ru': html({ barcode: BARCODE, protein: 4.6, carbs: 62 }) });
    const { product } = await chain(null, stub).enrich(await label({ fiberG: observed(1) }));
    assert.deepEqual([product.nutrition!.proteinG.value, product.nutrition!.proteinG.provenance], [4.5, 'observed']);
    assert.equal(product.nutrition!.carbsG.value, 63); assert.equal(product.nutrition!.fiberG.value, 1);
    assert.equal(product.nutrition!.sugarsG.provenance, 'web_search');
  });
  it('sodium on a page is converted to salt', async () => {
    const stub = web({ 'orion.ru': html({ barcode: BARCODE, salt: null }).replace('</table>', '<tr><td>Натрий</td><td>160 мг</td></tr></table>') });
    const { product } = await chain(null, stub).enrich(await label());
    assert.equal(product.nutrition!.sodiumMg.value, 160);
    assert.equal(product.nutrition!.saltG.value, 0.4); assert.equal(product.nutrition!.saltG.provenance, 'web_search');
  });
  it('null stays null, never 0', async () => {
    const { product } = await chain(null, web({ 'orion.ru': html({ barcode: BARCODE, sugars: null }) })).enrich(await label());
    assert.equal(product.nutrition!.sugarsG.value, null); assert.equal(product.nutrition!.sugarsG.provenance, 'not_detected');
  });
  it('provenance per field: source, URL, domain, tier, confidence, identity, time', async () => {
    const { product } = await chain(null, web({ 'orion.ru': html({ barcode: BARCODE }) })).enrich(await label());
    assert.equal(product.nutrition!.sugarsG.provenance, 'web_search');
    const { retrievedAt, ...evidence } = product.fieldEvidence!.find((item) => item.field === 'sugarsG')!;
    assert.deepEqual(evidence, { field: 'sugarsG', source: 'web_search', url: 'https://orion.ru/p', domain: 'orion.ru', tier: 1, confidence: 'medium', identityMatch: 'exact_barcode', trust: 'official_manufacturer', dataQuality: 'verified', basis: 'per_100g', consensusCount: 1, sources: ['https://orion.ru/p'] });
    assert.ok(!Number.isNaN(Date.parse(retrievedAt)));
    assert.notEqual(product.confidence.nutrition, 'high', 'web values never give high confidence');
  });
});

describe('Regressions from real scans', () => {
  it('22. Snickers лесной орех: the regular Snickers page is rejected', async () => {
    const stub = web({ 'snickers.ru': html(REGULAR_SNICKERS) });
    const { product } = await chain(null, stub, null).enrich(await snickers());
    assert.equal(product.nutrition!.sugarsG.value, null); assert.equal(product.nutrition!.saltG.value, null);
    assert.equal(stub.verdict().status, 'different_product_or_recipe');
  });
  it('22. Snickers лесной орех: a hazelnut page with close macros is allowed, also in English', async () => {
    const stub = web({ 'snickers.ru': html(SNICKERS_PAGE) });
    const { product } = await chain(null, stub, null).enrich(await snickers());
    assert.equal(product.nutrition!.sugarsG.value, 48); assert.equal(product.nutrition!.saturatedFatG.value, 10); assert.equal(product.nutrition!.saltG.value, 0.37);
    const english = await chain(null, web({ 'snickers.ru': html({ ...SNICKERS_PAGE, title: 'Snickers Hazelnut' }) }), null).enrich(await snickers());
    assert.equal(english.product.nutrition!.sugarsG.value, 48);
  });
  it('23. Choco Pie: a page with carbs 70.5 and fat 16.1 is rejected, with or without the barcode', async () => {
    const page = { carbs: 70.5, fat: 16.1, kcal: 443 };
    const plain = web({ 'orion.ru': html(page) });
    const without = await chain(null, plain).enrich(await label());
    assert.equal(without.product.nutrition!.sugarsG.value, null);
    assert.equal(plain.verdict().status, 'different_product_or_recipe');
    const coded = web({ 'orion.ru': html({ ...page, barcode: BARCODE }) });
    await chain(null, coded).enrich(await label());
    assert.equal(coded.verdict().status, 'recipe_version_conflict');
  });
});

describe('Web search: cache and failures', () => {
  it('17. cached by barcode + missing fields: the same case costs one search, other pending fields reuse the found pages', async () => {
    const stub = web();
    const lookup = new CachedProductLookupProvider(provider(stub));
    const offSource: ProductLookupProvider = { name: 'open_food_facts', lookup: async () => null };
    const lookups = new MultiSourceProductLookup([offSource, lookup]);
    let first: Product | null = null;
    for (let i = 0; i < 3; i++) {
      const { product } = await lookups.begin(BARCODE).enrich(await label());
      assert.equal(product.nutrition!.sugarsG.value, 28, 'trusted values come from the cache');
      first ??= product;
    }
    assert.equal(stub.discoveries.length, 1);
    await lookups.begin(BARCODE).enrich(await label({ sugarsG: observed(38) }));
    assert.equal(stub.discoveries.length, 1);
  });
  it('without a barcode the key is brand, name, variant, package and missing fields', () => {
    const lookup = provider(web());
    const context = { brand: 'Snickers', name: 'Snickers лесной орех', serving: '81 g', basis: 'per_100g', kcal: 1, protein: 2, carbs: 3, fat: 4, missingFields: ['salt', 'sugars'] };
    assert.notEqual(lookup.cacheKey(null, context), lookup.cacheKey(null, { ...context, name: 'Snickers' }));
    assert.notEqual(lookup.cacheKey(null, context), lookup.cacheKey(null, { ...context, serving: '50 g' }));
    assert.equal(lookup.cacheKey(null, context), lookup.cacheKey(null, { ...context, name: 'SNICKERS  лесной-орех', missingFields: ['sugars', 'salt'] }));
    assert.equal(lookup.cacheKey('123', context), '123|salt,sugars|1/2/3/4');
    assert.notEqual(lookup.cacheKey('123', context), lookup.cacheKey('123', { ...context, kcal: 5 }), 'new macros mean a new check');
  });
  it('timeout, rate limit and bad responses: the scan keeps OFF data and shows no error', async () => {
    for (const failure of ['timeout', 'rate_limited', 'invalid_response']) {
      const stub = web();
      stub.searcher.discoverSources = async () => { throw new Error(`Google nutrition search: ${failure}`); };
      const { product, steps } = await chain(offPartial(), stub).enrich(await label());
      assert.equal(product.nutrition!.sugarsG.value, null); assert.equal(product.name.value, 'Choco Pie');
      assert.equal(webStep(steps).status, 'error');
    }
  });
  it('failures are not cached', async () => {
    let calls = 0;
    const stub = web();
    stub.searcher.discoverSources = async () => { calls++; throw new Error('down'); };
    const lookup = new CachedProductLookupProvider(provider(stub));
    const context = { brand: 'B', name: 'N', serving: null, basis: 'per_100g', kcal: 1, protein: 2, carbs: 3, fat: 4, missingFields: ['salt'] };
    await assert.rejects(lookup.lookup(BARCODE, context));
    await assert.rejects(lookup.lookup(BARCODE, context));
    assert.equal(calls, 2);
  });
  it('an hourly guard stops a runaway loop', async () => {
    const stub = web();
    const lookup = new WebSearchProductLookupProvider(stub.searcher, stub.reader, stub.logger, () => 0);
    const context = { brand: 'B', name: 'N', serving: null, basis: 'per_100g', kcal: 1, protein: 2, carbs: 3, fat: 4, missingFields: ['salt'] };
    for (let i = 0; i < WEB_SEARCH_MAX_PER_HOUR; i++) await lookup.lookup(`${4600000000000 + i}`, context);
    await assert.rejects(lookup.lookup(BARCODE, context), WebSearchLimitError);
  });
  it('logs say why each page was taken or dropped, with domains and no URLs or page text', async () => {
    const stub = web({ 'snickers.ru': html(REGULAR_SNICKERS) });
    await chain(null, stub, null).enrich(await snickers());
    const page = stub.verdict().pages[0];
    assert.deepEqual([page.domain, page.tier, page.method, page.status], ['snickers.ru', 1, 'html', 'different_product_or_recipe']);
    const text = JSON.stringify(stub.logs.filter((line) => line.message !== 'web_candidate'));
    for (const hidden of ['https://', 'Пищевая ценность']) assert.ok(!text.includes(hidden), hidden);
  });
});

describe('Source wiring', () => {
  const config = (webSearch: string, apiKey = 'unit-tavily') => ({ goalMatchAi: { google: { apiKey: 'k', project: 'p', location: 'global', model: 'gemini-3.5-flash-lite' } },
    productLookup: { provider: 'open_food_facts', contact: 'unit', webSearch, tavily: { apiKey, monthlyCreditLimit: 900 }, webSearchLimits: { maxQueries: undefined, maxPages: undefined }, fatSecret: { clientId: '', clientSecret: '', region: undefined, language: undefined } } }) as unknown as AppConfig;
  it('off by default; when enabled it comes after OFF, and FatSecret stays out without keys', () => {
    assert.deepEqual(createProductLookupSources(config('off')).map((s) => s.name), ['open_food_facts']);
    for (const name of ['gemini', 'tavily']) assert.deepEqual(createProductLookupSources(config(name)).map((s) => s.name), ['open_food_facts', 'web_search']);
  });
  it('tavily without a key stays out', () => {
    assert.deepEqual(createProductLookupSources(config('tavily', '')).map((s) => s.name), ['open_food_facts']);
  });
  it('the search source does not need a barcode, also through the cache', () => {
    assert.equal(createProductLookupSources(config('tavily'))[1]!.needsBarcode, false);
  });
});

describe('Full scan with Search (Gemini and Search stubbed)', () => {
  const GOOGLE_KEY = 'unit-google-key-for-search';
  const REDIRECT = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc';
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
  const FILE = { mimetype: 'image/jpeg', buffer: JPEG, size: JPEG.length };
  const goal = MOCK_GOAL_MATCH_RECORDINGS.find((r) => r.id === 'greek_yogurt')!.responses[0];
  const plans = { findPlanForUser: async () => eatHealthierPlan() } as unknown as NutritionTargetsService;
  const reply = (value: unknown, metadata: unknown = {}) => new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', groundingMetadata: metadata, content: { parts: [{ text: JSON.stringify(value) }] } }] }));
  const analysis = { ...MOCK_META_PRODUCT_ANALYSIS,
    identity: { ...MOCK_META_PRODUCT_ANALYSIS.identity, name: { value: 'Choco Pie', evidence: 'visible_text' }, brand: { value: 'Orion', evidence: 'visible_text' } },
    nutrition_table: { ...MOCK_META_PRODUCT_ANALYSIS.nutrition_table, energy_kcal: 430, protein_g: 4.5, carbohydrates_g: 63, fat_g: 18,
      sugars_g: null, saturated_fat_g: null, fiber_g: null, salt_g: null, sodium: { amount: null, unit: null }, serving_size: { amount: null, unit: null } } };

  async function scan(off: ProductLookupResult) {
    const requests: Record<string, any>[] = [];
    const transport = (async (_: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init!.body));
      requests.push(body);
      if (body.tools) return reply('Pages found.', { webSearchQueries: ['q1', 'q2'], groundingChunks: [{ web: { uri: REDIRECT, title: 'orion.ru', domain: 'orion.ru' } }] });
      return reply(body.contents[0].parts.some((p: any) => p.inlineData) ? analysis : goal);
    }) as typeof fetch;
    const provider = new GoogleProvider({ apiKey: GOOGLE_KEY, project: 'foodlens-513112', fetch: transport });
    const search = new GoogleNutritionSearch({ apiKey: GOOGLE_KEY, project: 'foodlens-513112', fetch: transport });
    const reader = { fetchPage: async (url: string) => {
      assert.equal(url, REDIRECT);
      return { finalUrl: 'https://orion.ru/choco-pie', domain: 'orion.ru', contentType: 'text/html', body: html({ barcode: BARCODE }) };
    } };
    const lookups = new MultiSourceProductLookup([{ name: 'open_food_facts', lookup: async () => off }, new CachedProductLookupProvider(new WebSearchProductLookupProvider(search, reader))]);
    const lines: string[] = [];
    const capture = (message: unknown) => { lines.push(String(message)); };
    Logger.overrideLogger({ log: capture, warn: capture, error: capture, debug: capture, verbose: capture });
    try {
      return { result: await new ScanService(provider, plans, new GoalMatchService(provider), lookups).analyze(FILE, 'unit-user', { barcode: BARCODE }), requests, lines };
    } finally {
      Logger.overrideLogger(false);
    }
  }
  const isSearch = (body: Record<string, any>) => Array.isArray(body.tools);
  const isProduct = (body: Record<string, any>) => body.contents[0].parts.some((p: any) => p.inlineData);

  it('20. Product Score becomes available after the web fill', async () => {
    const { result } = await scan(offPartial());
    assert.equal(result.product.nutrition!.sugarsG.provenance, 'web_search');
    assert.notEqual(result.score.value, null);
    assert.deepEqual(result.score, scoreProduct(result.product));
  });
  it('21. Goal Match runs on the full product, on the 100 g estimate without a printed serving', async () => {
    const { result, requests } = await scan(offPartial());
    assert.equal(typeof result.goalMatch.value, 'number');
    assert.equal(result.goalMatch.portion!.basis, 'per_100');
    assert.equal(requests.filter(isProduct).length, 0, 'the barcode was enough'); assert.equal(requests.filter(isSearch).length, 1);
  });
  it('photo, profile and scores never reach the search request', async () => {
    const { requests } = await scan(offPartial());
    const sent = JSON.stringify(requests.find(isSearch));
    for (const secret of [JPEG.toString('base64'), 'inlineData', 'eat_healthier', 'caloriesKcal"', '"score"']) assert.ok(!sent.includes(secret), secret);
  });
  it('logs: trigger, missing fields, match, domains and field names, without secrets, prompt or photo', async () => {
    const { lines } = await scan(offPartial());
    const line = lines.find((item) => item.startsWith('product_lookup ') && item.includes('"web_search"'))!;
    const parsed = JSON.parse(line.slice('product_lookup '.length));
    assert.equal(parsed.triggered, true); assert.equal(parsed.barcodePresent, true);
    assert.deepEqual(parsed.missingFields, ['sugars', 'saturatedFat', 'salt']);
    assert.equal(parsed.match, 'verified_identity');
    assert.deepEqual(parsed.search, { webSearchQueries: 2, domains: ['orion.ru'] });
    assert.ok(parsed.filled.includes('sugarsG'));
    const text = lines.join('\n');
    for (const secret of [GOOGLE_KEY, JPEG.toString('base64'), 'You only find', 'grounding-api-redirect']) assert.ok(!text.includes(secret), secret);
  });
});

describe('Ingredient provenance barcode and recipe claims', () => {
  for (const exact of [false, true]) it(`ingredients exact_barcode requires the requested code (exact=${exact})`, async () => {
    const body = html({barcode: exact ? BARCODE : '1234567890128'}) + '<p>Ingredients: flour, sugar, cocoa.</p>';
    const stub = web({'orion.ru': body});
    const result = await provider(stub).lookup(BARCODE, {name:'Choco Pie',brand:'Orion',serving:null,basis:'unknown',kcal:null,protein:null,carbs:null,fat:null,missingFields:['sugars'],needsIngredients:true});
    assert.ok(result?.ingredients?.length);
    assert.equal(result.evidence?.ingredients?.identityMatch, exact ? 'exact_barcode' : 'exact_name');
  });
  it('No Sugar Added ingredients never merge into the ordinary product', async () => {
    const stub = web({'orion.ru':html({title:'Orion Choco Pie No Sugar Added'}) + '<p>Ingredients: stevia, cocoa.</p>'});
    const result = await provider(stub).lookup(BARCODE, {name:'Choco Pie',brand:'Orion',serving:null,basis:'unknown',kcal:null,protein:null,carbs:null,fat:null,missingFields:['sugars'],needsIngredients:true});
    assert.equal(result?.ingredients ?? null, null);
  });
});

