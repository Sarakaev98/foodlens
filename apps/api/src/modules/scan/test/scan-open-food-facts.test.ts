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
import { OpenFoodFactsProductLookupProvider } from '../../product-lookup/open-food-facts.provider';
import { BARCODE, offFound, offNotFound, offProduct, OFF_NUTRIENTS } from '../../product-lookup/test/open-food-facts.fixtures';
import { ScanService } from '../scan.service';

// Google and Open Food Facts are both stubbed: nothing here leaves the machine.
const { MOCK_META_PRODUCT_ANALYSIS } = require(join(dirname(require.resolve('@foodlens/ai')), 'providers/mock/mock-product-analysis.js'));
Logger.overrideLogger(false);

const KEY = 'unit-test-off-scan-key';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const FILE = { mimetype: 'image/jpeg', buffer: JPEG, size: JPEG.length };
const goal = MOCK_GOAL_MATCH_RECORDINGS.find((r) => r.id === 'greek_yogurt')!.responses[0];
const plans = { findPlanForUser: async () => eatHealthierPlan() } as unknown as NutritionTargetsService;
const reply = (value: unknown) => new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }] }));

/** Этикетка как у Choco Pie: четыре значения, порции нет, Gemini предлагает свою порцию. */
const label = {
  ...MOCK_META_PRODUCT_ANALYSIS,
  nutrition_table: { ...MOCK_META_PRODUCT_ANALYSIS.nutrition_table, energy_kcal: 430, protein_g: 4.5, carbohydrates_g: 63, fat_g: 18,
    sugars_g: null, saturated_fat_g: null, fiber_g: null, salt_g: null, sodium: { amount: null, unit: null }, serving_size: { amount: null, unit: null } },
  semantics: { ...MOCK_META_PRODUCT_ANALYSIS.semantics, typicalServing: { amount: 999, unit: 'g', confidence: 'high', evidence: ['package'] } },
};

async function scan(off: () => Promise<Response>, options: { barcode?: string | null } = { barcode: BARCODE }, analysis: unknown = label) {
  const gemini: Record<string, any>[] = [];
  const offCalls: string[] = [];
  const provider = new GoogleProvider({ apiKey: KEY, project: 'foodlens-513112', fetch: (async (_: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init!.body));
    gemini.push(body);
    return reply(body.contents[0].parts.some((p: any) => p.inlineData) ? analysis : goal);
  }) as typeof fetch });
  const lookup = new CachedProductLookupProvider(new OpenFoodFactsProductLookupProvider({ contact: 'unit', fetch: (async (url: unknown) => {
    offCalls.push(String(url));
    return off();
  }) as typeof fetch }));
  const service = new ScanService(provider, plans, new GoalMatchService(provider), lookup);
  const lines: string[] = [];
  const capture = (message: unknown) => { lines.push(String(message)); };
  Logger.overrideLogger({ log: capture, warn: capture, error: capture, debug: capture, verbose: capture });
  try {
    const result = await service.analyze(FILE, 'unit-user', { barcode: options.barcode }).then(sourceEvidenceView);
    return { result, gemini, offCalls, lines, service };
  } finally {
    Logger.overrideLogger(false);
  }
}
const partial = () => {
  const { sugars: _sugars, 'saturated-fat': _fat, salt: _salt, sodium: _sodium, ...nutrients } = OFF_NUTRIENTS;
  return offProduct({ nutrition: { aggregated_set: { nutrients, per: '100g', preparation: 'as_sold' } } });
};
const productCalls = (gemini: Record<string, any>[]) => gemini.filter((body) => body.contents[0].parts.some((p: any) => p.inlineData));
const lookupLine = (lines: string[]) => JSON.parse(lines.find((line) => line.startsWith('product_lookup '))!.slice('product_lookup '.length));

describe('Scan with barcode and Open Food Facts (stubbed HTTP)', () => {
  it('found and complete: Product Score and Goal Match come from it, the photo is not analyzed', async () => {
    const { result } = await scan(async () => offFound());
    const n = result.product.nutrition!;
    assert.deepEqual([n.sugarsG.value, n.saturatedFatG.value, n.saltG.value], [38, 9, 0.4]);
    assert.deepEqual([n.proteinG.provenance, n.sugarsG.provenance], ['open_food_facts', 'open_food_facts']);
    assert.notEqual(result.score.value, null);
    assert.deepEqual(result.score, scoreProduct(result.product));
    assert.equal(result.barcode, BARCODE);
    assert.equal(result.goalMatch.version, 'goal-match-v4');
    assert.equal(typeof result.goalMatch.value, 'number', 'photo alone gives missing_nutrients; merged data gives a value');
  });
  it('without the database the same label gives no scores: the fill is what changes them', async () => {
    const { result } = await scan(async () => offNotFound());
    assert.notEqual(result.score.value, null); assert.equal(typeof result.score.value, 'number'); assert.equal(typeof result.goalMatch.value, 'number');
  });
  it('not found, 429, 503 and network errors: the normal photo result, no error for the user', async () => {
    const plain = (await scan(async () => offFound(), { barcode: null })).result;
    for (const off of [async () => offNotFound(), async () => new Response('', { status: 429 }), async () => new Response('', { status: 503 }), async () => { throw new Error('offline'); }]) {
      const { result, lines } = await scan(off);
      assert.equal(result.product.nutrition!.sugarsG.value, null);
      assert.deepEqual(result.score, plain.score);
      assert.ok(lines.some((line) => line.startsWith('scan finished')));
    }
  });
  it('no AI call means no gemini_usage line at all', async () => {
    const logs: string[] = [];
    const logger = { log: (message: string) => logs.push(message), warn: (message: string) => logs.push(message) };
    let requests = 0;
    const provider = new GoogleProvider({ apiKey: KEY, project: 'foodlens-513112', logger, fetch: (async () => { requests++; return reply(label); }) as typeof fetch });
    const lookup = new CachedProductLookupProvider(new OpenFoodFactsProductLookupProvider({ contact: 'unit', fetch: (async () => offFound()) as typeof fetch }));
    const result = await new ScanService(provider, plans, new GoalMatchService(provider), lookup).analyze(FILE, 'unit-user', { barcode: BARCODE, roles: ['product'] }).then(sourceEvidenceView);
    assert.notEqual(result.score.value, null);
    assert.equal(requests, 0); assert.ok(!logs.includes('gemini_usage'));
  });
  it('no barcode: the database is not called', async () => {
    const { result, offCalls } = await scan(async () => offFound(), { barcode: null });
    assert.equal(offCalls.length, 0); assert.equal(result.product.nutrition!.sugarsG.value, null);
    assert.equal('barcode' in result, false);
  });
  it('an explicit serving from the database is used; AI typicalServing is not', async () => {
    const { result } = await scan(async () => offFound(offProduct({ serving_quantity: 28 })));
    const n = result.product.nutrition!;
    assert.deepEqual([n.servingSize.value, n.servingSize.provenance], [{ amount: 28, unit: 'g' }, 'open_food_facts']);
    assert.equal(result.goalMatch.portion!.basis, 'serving'); assert.equal(result.goalMatch.portion!.amount, 28);
  });
  it('no serving anywhere: the existing 100 g estimate stays, without AI and without any Gemini call', async () => {
    const { result, gemini } = await scan(async () => offFound());
    assert.equal(result.goalMatch.portion!.basis, 'per_100'); assert.equal(result.goalMatch.portion!.amount, 100);
    assert.equal(result.goalMatch.version === 'goal-match-v4' && result.goalMatch.source, 'deterministic');
    assert.equal(result.goalMatch.confidence, 'low'); assert.equal(gemini.length, 0);
  });
  it('at most one analyzeProduct per scan; the lookup never sends data to it', async () => {
    const { gemini, offCalls } = await scan(async () => offFound(partial()));
    assert.equal(productCalls(gemini).length, 1); assert.equal(offCalls.length, 1);
    const sent = JSON.stringify(productCalls(gemini)[0]);
    for (const secret of ['Чокопай', 'мука пшеничная', BARCODE]) assert.ok(!sent.includes(secret), secret);
  });
  it('lookup and analysis run in parallel: the database is asked before Gemini answers', async () => {
    const order: string[] = [];
    const provider = new GoogleProvider({ apiKey: KEY, project: 'foodlens-513112', fetch: (async () => {
      await new Promise((resolve) => setImmediate(resolve));
      order.push('gemini');
      return reply(label);
    }) as typeof fetch });
    const lookup = { name: 'stub', lookup: async () => { order.push('lookup'); return null; } };
    await new ScanService(provider, plans, undefined, lookup).analyze(FILE, 'unit-user', { barcode: BARCODE }).then(sourceEvidenceView);
    assert.deepEqual(order, ['lookup', 'gemini']);
  });
  it('conflicts are logged by field, and the label value stays', async () => {
    const analysis = { ...label, nutrition_table: { ...label.nutrition_table, sugars_g: 20 } };
    const { salt: _salt, sodium: _sodium, ...nutrients } = OFF_NUTRIENTS;
    const noSalt = offProduct({ nutrition: { aggregated_set: { nutrients, per: '100g', preparation: 'as_sold' } } });
    const { result, lines } = await scan(async () => offFound(noSalt), { barcode: BARCODE }, analysis);
    assert.equal(result.product.nutrition!.sugarsG.value, 20);
    const merged = lines.filter((line) => line.startsWith('product_lookup ')).map((line) => JSON.parse(line.slice('product_lookup '.length))).at(-1);
    assert.deepEqual(merged.conflicts, [{ field: 'sugarsG', label: 20, lookup: 38 }]);
  });
  it('logs: barcode, status, boolean fields and latency, without images, keys, prompts or product text', async () => {
    const { lines } = await scan(async () => offFound());
    const line = lookupLine(lines);
    assert.equal(line.barcode, BARCODE); assert.equal(line.status, 'hit'); assert.equal(line.provider, 'open_food_facts');
    assert.equal(typeof line.latencyMs, 'number');
    assert.deepEqual([line.fields.sugars, line.fields.saturatedFat, line.fields.salt, line.fields.sodium], [true, true, true, false]);
    const text = lines.join('\n');
    for (const secret of [KEY, JPEG.toString('base64'), 'inlineData', 'systemInstruction', 'Чокопай', 'мука пшеничная']) assert.ok(!text.includes(secret), secret);
  });
  it('a lookup error is logged without the transport text', async () => {
    const { lines } = await scan(async () => { throw new Error('secret transport detail'); });
    assert.equal(lookupLine(lines).status, 'error');
    assert.ok(!lines.join('\n').includes('secret transport detail'));
  });
});
