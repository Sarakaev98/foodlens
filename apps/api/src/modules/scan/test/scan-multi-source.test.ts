import { sourceEvidenceView } from './source-evidence-view';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dirname, join } from 'node:path';
import { Logger } from '@nestjs/common';
import { GoogleProvider, MOCK_GOAL_MATCH_RECORDINGS } from '@foodlens/ai';
import { scoreProduct } from '@foodlens/scoring';
import { GoalMatchService } from '../../goal-match/goal-match.service';
import { eatHealthierPlan } from '../../goal-match/test/goal-match-v4.fixtures';
import type { NutritionTargetsService } from '../../nutrition-targets/nutrition-targets.service';
import { CachedProductLookupProvider } from '../../product-lookup/cached-product-lookup.provider';
import { FatSecretProductLookupProvider } from '../../product-lookup/fatsecret.provider';
import { MultiSourceProductLookup } from '../../product-lookup/multi-source-product-lookup';
import { OpenFoodFactsProductLookupProvider } from '../../product-lookup/open-food-facts.provider';
import { BARCODE, offFound, offProduct, OFF_NUTRIENTS } from '../../product-lookup/test/open-food-facts.fixtures';
import { ScanService } from '../scan.service';

// Gemini, Open Food Facts and FatSecret are all stubbed: nothing here leaves the machine.
const { MOCK_META_PRODUCT_ANALYSIS } = require(join(dirname(require.resolve('@foodlens/ai')), 'providers/mock/mock-product-analysis.js'));
Logger.overrideLogger(false);

const GOOGLE_KEY = 'unit-google-key';
const CLIENT_ID = 'unit-fatsecret-id';
const CLIENT_SECRET = 'unit-fatsecret-secret';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const FILE = { mimetype: 'image/jpeg', buffer: JPEG, size: JPEG.length };
const goal = MOCK_GOAL_MATCH_RECORDINGS.find((r) => r.id === 'greek_yogurt')!.responses[0];
const plans = { findPlanForUser: async () => eatHealthierPlan() } as unknown as NutritionTargetsService;
const reply = (value: unknown) => new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }] }));

const label = {
  ...MOCK_META_PRODUCT_ANALYSIS,
  nutrition_table: { ...MOCK_META_PRODUCT_ANALYSIS.nutrition_table, energy_kcal: 430, protein_g: 4.5, carbohydrates_g: 63, fat_g: 18,
    sugars_g: null, saturated_fat_g: null, fiber_g: null, salt_g: null, sodium: { amount: null, unit: null }, serving_size: { amount: null, unit: null } },
};
const { sugars: _s, 'saturated-fat': _f, salt: _a, sodium: _n, ...offRest } = OFF_NUTRIENTS;
/** Как у реального Choco Pie: OFF знает продукт и порцию, но не знает сахара, насыщенные жиры и соль. */
const offChocoPie = () => offFound(offProduct({ serving_quantity: 30, nutrition: { aggregated_set: { nutrients: offRest, per: '100g', preparation: 'as_sold' } } }));
const fatFood = { food: { food_id: '1', food_name: 'Choco Pie', brand_name: 'Orion', food_type: 'Brand', servings: { serving: {
  metric_serving_amount: '30', metric_serving_unit: 'g', measurement_description: 'piece', calories: '129', carbohydrate: '18.9', protein: '1.35', fat: '5.4',
  saturated_fat: '2.7', sugar: '8.4', sodium: '48' } } } };

async function scan(answer: () => Response = () => new Response(JSON.stringify(fatFood))) {
  const gemini: Record<string, any>[] = [];
  const fatRequests: { url: string; init: RequestInit }[] = [];
  const provider = new GoogleProvider({ apiKey: GOOGLE_KEY, project: 'foodlens-513112', fetch: (async (_: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init!.body));
    gemini.push(body);
    return reply(body.contents[0].parts.some((p: any) => p.inlineData) ? label : goal);
  }) as typeof fetch });
  const off = new OpenFoodFactsProductLookupProvider({ contact: 'unit', fetch: (async () => offChocoPie()) as typeof fetch });
  const fat = new FatSecretProductLookupProvider({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, fetch: (async (url: unknown, init: RequestInit) => {
    fatRequests.push({ url: String(url), init });
    return String(url).includes('oauth') ? new Response(JSON.stringify({ access_token: 'unit-fatsecret-token', expires_in: 86400 })) : answer();
  }) as typeof fetch });
  const lookups = new MultiSourceProductLookup([new CachedProductLookupProvider(off), new CachedProductLookupProvider(fat)]);
  const service = new ScanService(provider, plans, new GoalMatchService(provider), lookups);
  const lines: string[] = [];
  const capture = (message: unknown) => { lines.push(String(message)); };
  Logger.overrideLogger({ log: capture, warn: capture, error: capture, debug: capture, verbose: capture });
  try {
    const result = await service.analyze(FILE, 'unit-user', { barcode: BARCODE }).then(sourceEvidenceView);
    return { result, gemini, fatRequests, lines };
  } finally {
    Logger.overrideLogger(false);
  }
}
const lookupLines = (lines: string[]) => lines.filter((line) => line.startsWith('product_lookup ')).map((line) => JSON.parse(line.slice('product_lookup '.length)));

describe('Choco Pie case: label + OFF + second source (all stubbed)', () => {
  it('18. Product Score is computed from the merged nutrition', async () => {
    const { result } = await scan();
    const n = result.product.nutrition!;
    assert.deepEqual([n.sugarsG.value, n.sugarsG.provenance], [28, 'fatsecret']);
    assert.deepEqual([n.saturatedFatG.value, n.saturatedFatG.provenance], [9, 'fatsecret']);
    assert.deepEqual([n.sodiumMg.value, n.sodiumMg.provenance], [160, 'fatsecret']);
    assert.deepEqual([n.saltG.value, n.saltG.provenance], [0.4, 'inferred']);
    assert.deepEqual([n.proteinG.provenance, n.fiberG.provenance], ['open_food_facts', 'open_food_facts']);
    assert.notEqual(result.score.value, null);
    assert.deepEqual(result.score, scoreProduct(result.product));
  });
  it('19. Goal Match uses the merged product and the OFF serving, with its AI step', async () => {
    const { result, gemini } = await scan();
    assert.equal(result.goalMatch.version, 'goal-match-v4');
    assert.equal(typeof result.goalMatch.value, 'number');
    assert.equal(result.goalMatch.portion!.basis, 'serving'); assert.equal(result.goalMatch.portion!.amount, 30);
    assert.equal(gemini.filter((body) => body.contents[0].parts.some((p: any) => p.inlineData)).length, 0, 'the barcode sources were enough');
  });
  it('second source not found or failing: same result as OFF alone, no error', async () => {
    for (const answer of [() => new Response(JSON.stringify({ error: { code: 211 } })), () => new Response('', { status: 503 }), () => { throw new Error('timeout'); }]) {
      const { result } = await scan(answer);
      assert.equal(result.product.nutrition!.sugarsG.value, null);
      assert.notEqual(result.score.value, null); assert.equal(typeof result.score.value, 'number');
      assert.equal(result.product.nutrition!.servingSize.value!.amount, 30);
    }
  });
  it('only the barcode goes out: no image, no product data, no Gemini text', async () => {
    const { fatRequests } = await scan();
    const sent = JSON.stringify(fatRequests.map(({ url, init }) => ({ url, body: init.body })));
    assert.ok(!sent.includes(JPEG.toString('base64'))); assert.ok(!sent.includes('Чокопай'));
    const search = new URL(fatRequests.find((r) => r.url.includes('barcode'))!.url);
    assert.deepEqual([...search.searchParams.keys()].sort(), ['barcode', 'flag_default_serving', 'format']);
  });
  it('16. the log shows each source, what it filled and its match level', async () => {
    const { lines } = await scan();
    const [off, fat] = lookupLines(lines);
    assert.equal(off.provider, 'open_food_facts'); assert.equal(off.status, 'hit'); assert.equal(off.match, 'exact_barcode');
    assert.equal(fat.provider, 'fatsecret'); assert.equal(fat.status, 'hit');
    assert.ok(fat.filled.includes('sugarsG') && fat.filled.includes('saturatedFatG') && fat.filled.includes('sodiumMg'));
    assert.equal(off.barcode, BARCODE);
  });
  it('17. logs carry no keys, tokens, images or prompts', async () => {
    const { lines } = await scan();
    const text = lines.join('\n');
    for (const secret of [GOOGLE_KEY, CLIENT_ID, CLIENT_SECRET, 'unit-fatsecret-token', Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64'),
      JPEG.toString('base64'), 'systemInstruction', 'Чокопай']) assert.ok(!text.includes(secret), secret);
  });
});
