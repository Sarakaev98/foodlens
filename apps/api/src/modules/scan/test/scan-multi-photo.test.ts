import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { dirname, join } from 'node:path';
import { Logger, Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { GoogleProvider, MockProvider, MOCK_GOAL_MATCH_RECORDINGS, productImages, type AnalyzeProductInput, type AIProvider } from '@foodlens/ai';
import { GoalMatchService } from '../../goal-match/goal-match.service';
import { MultiSourceProductLookup } from '../../product-lookup/multi-source-product-lookup';
import type { ProductLookupResult } from '../../product-lookup/product-lookup.provider';
import { eatHealthierPlan } from '../../goal-match/test/goal-match-v4.fixtures';
import type { NutritionTargetsService } from '../../nutrition-targets/nutrition-targets.service';
import { ScanError } from '../scan-error';
import {
  collectScanUploads, parseScanRoles, SCAN_MAX_IMAGE_BYTES, SCAN_MAX_TOTAL_IMAGE_BYTES, validateScanImages, type UploadedImage,
} from '../scan-image.validation';
import { ScanController } from '../scan.controller';
import { ScanService } from '../scan.service';

// Multipart goes through a real local Nest app; every AI call is a stub. Nothing leaves this machine.
const { MOCK_META_PRODUCT_ANALYSIS } = require(join(dirname(require.resolve('@foodlens/ai')), 'providers/mock/mock-product-analysis.js'));
Logger.overrideLogger(false);

const KEY = 'unit-test-multi-photo-key';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const jpeg = (n: number): UploadedImage => {
  const buffer = Buffer.concat([JPEG, Buffer.from([n])]);
  return { mimetype: 'image/jpeg', buffer, size: buffer.length };
};
const plans = (plan = eatHealthierPlan()) => ({ findPlanForUser: async () => plan }) as unknown as NutritionTargetsService;
const reply = (value: unknown) => new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }] }));
const goal = { ...MOCK_GOAL_MATCH_RECORDINGS.find((r) => r.id === 'greek_yogurt')!.responses[0], warnings: [] };

describe('multi-photo validation', () => {
  it('accepts 1–3 images, keeps order and roles, rejects more than 3', () => {
    const images = validateScanImages([jpeg(1), jpeg(2), jpeg(3)], ['product', undefined, 'nutrition']);
    assert.deepEqual(images.map((image) => image.role), ['product', undefined, 'nutrition']);
    assert.deepEqual(images.map((image) => Buffer.from(image.base64, 'base64').at(-1)), [1, 2, 3]);
    assert.throws(() => validateScanImages([jpeg(1), jpeg(2), jpeg(3), jpeg(4)]), (e: unknown) => e instanceof ScanError && e.code === 'TOO_MANY_IMAGES' && e.status === 400);
  });
  it('no images is the same error as a missing photo', () => {
    assert.throws(() => validateScanImages([]), (e: unknown) => e instanceof ScanError && e.code === 'IMAGE_MISSING' && e.status === 400);
  });
  it('one bad file rejects the whole set: MIME and signature', () => {
    const gif = { ...jpeg(2), mimetype: 'image/gif' };
    const fake = { mimetype: 'image/jpeg', buffer: Buffer.from('not an image'), size: 12 };
    assert.throws(() => validateScanImages([jpeg(1), gif]), (e: unknown) => e instanceof ScanError && e.code === 'IMAGE_UNSUPPORTED_TYPE');
    assert.throws(() => validateScanImages([jpeg(1), fake]), (e: unknown) => e instanceof ScanError && e.code === 'IMAGE_INVALID');
  });
  it('total cap: each file allowed alone, together over the limit is rejected', () => {
    const big = { ...jpeg(1), size: SCAN_MAX_TOTAL_IMAGE_BYTES / 2 + 1 };
    assert.ok(big.size <= SCAN_MAX_IMAGE_BYTES);
    assert.equal(validateScanImages([big]).length, 1);
    assert.throws(() => validateScanImages([big, big]), (e: unknown) => e instanceof ScanError && e.code === 'IMAGE_TOO_LARGE' && e.status === 413);
  });
  it('the total cap fits the 20 MB inline request limit in base64', () => {
    assert.ok((SCAN_MAX_TOTAL_IMAGE_BYTES * 4) / 3 + 50_000 < 20_000_000);
  });
  it('roles: JSON or one value per photo; duplicates kept; invalid and missing become undefined', () => {
    assert.deepEqual(parseScanRoles('["nutrition","nutrition"]', 2), ['nutrition', 'nutrition']);
    assert.deepEqual(parseScanRoles(['product', 'bad', 'ingredients'], 3), ['product', undefined, 'ingredients']);
    assert.deepEqual(parseScanRoles('product', 2), ['product', undefined]);
    for (const raw of [undefined, null, 7, '{}', '[broken', 'bad', [1, {}]]) assert.deepEqual(parseScanRoles(raw, 2), [undefined, undefined]);
  });
  it('a single image field takes the roles when there is no images field', () => {
    const named = (fieldname: string, n: number) => ({ ...jpeg(n), fieldname });
    assert.deepEqual(collectScanUploads([named('image', 1)], '["product"]').roles, ['product']);
    assert.deepEqual(collectScanUploads([named('image', 1)], undefined).roles, [undefined]);
  });
  it('collects both fields, image first, and aligns roles with images only', () => {
    const named = (fieldname: string, n: number) => ({ ...jpeg(n), fieldname });
    const { files, roles } = collectScanUploads([named('images', 2), named('other', 9), named('image', 1)], '["nutrition"]');
    assert.deepEqual(files.map((file) => file.fieldname), ['image', 'images']);
    assert.deepEqual(roles, [undefined, 'nutrition']);
  });
});

describe('POST /scan/analyze multipart (local Nest app, stub provider)', () => {
  let app: INestApplication;
  let url = '';
  const inputs: AnalyzeProductInput[] = [];
  const mock = new MockProvider();
  const provider = {
    name: 'stub', analyzeProduct: async (input: AnalyzeProductInput) => (inputs.push(input), mock.analyzeProduct({ kind: 'image', image: { mimeType: 'image/jpeg', base64: 'AA' } })),
  } as unknown as AIProvider;

  before(async () => {
    @Module({ controllers: [ScanController], providers: [{ provide: ScanService, useValue: new ScanService(provider, plans()) }] })
    class TestScanModule {}
    app = await NestFactory.create(TestScanModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    url = (await app.getUrl()).replace('[::1]', '127.0.0.1') + '/scan/analyze';
  });
  after(() => app.close());

  const blob = (bytes: Buffer, type = 'image/jpeg') => new Blob([new Uint8Array(bytes)], { type });
  const form = (fields: readonly (readonly [string, string | Blob])[]) => {
    const body = new FormData();
    for (const [name, value] of fields) typeof value === 'string' ? body.append(name, value) : body.append(name, value, 'scan.jpg');
    return body;
  };
  const post = async (fields: readonly (readonly [string, string | Blob])[]) => {
    inputs.length = 0;
    const response = await fetch(url, { method: 'POST', body: form(fields) });
    return { status: response.status, body: (await response.json()) as Record<string, any> };
  };
  const images = () => productImages(inputs[0] as Extract<AnalyzeProductInput, { kind: 'image' }>);
  const file = (n: number) => blob(Buffer.concat([JPEG, Buffer.from([n])]));

  it('legacy single "image" field works as before', async () => {
    const { status, body } = await post([['image', file(1)]]);
    assert.equal(status, 200); assert.ok(body.product && body.score && body.goalMatch);
    assert.equal(inputs.length, 1); assert.equal(images().length, 1); assert.equal(images()[0]!.role, undefined);
  });
  it('"images" with 1, 2 and 3 files reaches one provider call with all files in order', async () => {
    for (const count of [1, 2, 3]) {
      const { status } = await post(Array.from({ length: count }, (_, i) => ['images', file(i + 1)] as const));
      assert.equal(status, 200); assert.equal(inputs.length, 1); assert.equal(images().length, count);
      assert.deepEqual(images().map((image) => Buffer.from(image.base64, 'base64').at(-1)), Array.from({ length: count }, (_, i) => i + 1));
    }
  });
  it('roles as JSON, repeated fields, duplicates and invalid values', async () => {
    await post([['roles', '["nutrition","nutrition"]'], ['images', file(1)], ['images', file(2)]]);
    assert.deepEqual(images().map((image) => image.role), ['nutrition', 'nutrition']);
    await post([['images', file(1)], ['images', file(2)], ['roles', 'ingredients'], ['roles', 'bad']]);
    assert.deepEqual(images().map((image) => image.role), ['ingredients', undefined]);
    const { status } = await post([['images', file(1)], ['roles', 'not json [']]);
    assert.equal(status, 200); assert.equal(images()[0]!.role, undefined);
  });
  it('more than 3 images → TOO_MANY_IMAGES, and the provider is not called', async () => {
    const { status, body } = await post(Array.from({ length: 4 }, (_, i) => ['images', file(i)] as const));
    assert.equal(status, 400); assert.equal(body.code, 'TOO_MANY_IMAGES'); assert.equal(inputs.length, 0);
    const mixed = await post([['image', file(1)], ['images', file(2)], ['images', file(3)], ['images', file(4)]]);
    assert.equal(mixed.body.code, 'TOO_MANY_IMAGES');
  });
  it('invalid MIME or signature in any file → the existing errors, no provider call', async () => {
    const mime = await post([['images', file(1)], ['images', blob(PNG, 'application/pdf')]]);
    assert.equal(mime.status, 415); assert.equal(mime.body.code, 'IMAGE_UNSUPPORTED_TYPE');
    const signature = await post([['images', file(1)], ['images', blob(Buffer.from('not an image'))]]);
    assert.equal(signature.status, 400); assert.equal(signature.body.code, 'IMAGE_INVALID');
    assert.equal(inputs.length, 0);
  });
  it('size limits: one file over 10 MB and several over the total', async () => {
    const huge = Buffer.concat([JPEG, Buffer.alloc(SCAN_MAX_IMAGE_BYTES)]);
    const single = await post([['images', blob(huge)]]);
    assert.equal(single.status, 413); assert.equal(single.body.code, 'IMAGE_TOO_LARGE');
    const part = Buffer.concat([JPEG, Buffer.alloc(SCAN_MAX_TOTAL_IMAGE_BYTES / 2)]);
    const total = await post([['images', blob(part)], ['images', blob(part)]]);
    assert.equal(total.status, 413); assert.equal(total.body.code, 'IMAGE_TOO_LARGE'); assert.equal(inputs.length, 0);
  });
  it('no photo or an unknown field → IMAGE_MISSING, as before', async () => {
    for (const fields of [[['barcode', 'bad']], [['photo', file(1)]]] as const) {
      const { status, body } = await post(fields);
      assert.equal(status, 400); assert.equal(body.code, 'IMAGE_MISSING');
    }
  });
  it('a barcode alone is a valid request: no AI call, the answer asks for a photo', async () => {
    const before = inputs.length;
    const { status, body } = await post([['barcode', '4607001771234']]);
    assert.equal(status, 200); assert.equal(body.barcode, '4607001771234'); assert.equal(body.needsPhoto, true);
    assert.equal(inputs.length, before);
  });
  it('barcode still arrives next to the images and an old client sees the same response shape', async () => {
    const { status, body } = await post([['barcode', '4607001771234'], ['images', file(1)], ['images', file(2)]]);
    assert.equal(status, 200); assert.equal(body.barcode, '4607001771234');
    assert.deepEqual(Object.keys(body).sort(), ['barcode', 'goalMatch', 'product', 'score']);
  });
});

describe('POST /scan/analyze with a real barcode image (local Nest app, multipart, zxing)', () => {
  const BARCODE = '5449000022431';
  const bwip = require('bwip-js') as { toBuffer(options: Record<string, unknown>): Promise<Buffer> };
  let app: INestApplication;
  let url = '';
  let code: Blob;
  const inputs: AnalyzeProductInput[] = [];
  const mock = new MockProvider();
  const provider = {
    name: 'stub', analyzeProduct: async (input: AnalyzeProductInput) => (inputs.push(input), mock.analyzeProduct({ kind: 'image', image: { mimeType: 'image/jpeg', base64: 'AA' } })),
  } as unknown as AIProvider;
  // Только имя, как у настоящей записи: данных мало, и всё решает роль фото.
  const off = { provider: 'open_food_facts', match: 'exact_barcode', barcode: BARCODE, name: 'coca cola orange', brand: null, servingSize: null, ingredients: null, allergens: null, additives: null, nutrition: null };
  const lookups: { barcode: string | null }[] = [];

  before(async () => {
    const source = { name: 'open_food_facts', lookup: async (barcode: string | null) => (lookups.push({ barcode }), off as unknown as ProductLookupResult) };
    @Module({ controllers: [ScanController], providers: [{ provide: ScanService, useValue: new ScanService(provider, plans(), undefined, new MultiSourceProductLookup([source])) }] })
    class TestScanModule {}
    app = await NestFactory.create(TestScanModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    url = (await app.getUrl()).replace('[::1]', '127.0.0.1') + '/scan/analyze';
    const png = await bwip.toBuffer({ bcid: 'ean13', text: BARCODE, scale: 3, height: 20, includetext: false, backgroundcolor: 'FFFFFF', paddingwidth: 20, paddingheight: 20 });
    code = new Blob([new Uint8Array(png)], { type: 'image/png' });
  });
  after(() => app.close());

  const post = async (fields: readonly (readonly [string, string | Blob])[]) => {
    inputs.length = 0; lookups.length = 0;
    const body = new FormData();
    for (const [name, value] of fields) typeof value === 'string' ? body.append(name, value) : body.append(name, value, 'scan.png');
    const response = await fetch(url, { method: 'POST', body });
    return { status: response.status, body: (await response.json()) as Record<string, any> };
  };
  const sent = () => productImages(inputs[0] as Extract<AnalyzeProductInput, { kind: 'image' }>);

  it('single "image" + role product + barcode read from the photo: 0 Gemini image calls, the answer asks for the nutrition photo', async () => {
    const { status, body } = await post([['roles', '["product"]'], ['image', code]]);
    assert.equal(status, 200); assert.equal(inputs.length, 0);
    assert.equal(lookups[0]!.barcode, BARCODE); assert.equal(body.barcode, BARCODE);
    assert.equal(body.needsPhoto, undefined); assert.equal(body.status, undefined);
  });
  it('the same order of fields does not matter: the file before the roles', async () => {
    const { status } = await post([['image', code], ['roles', '["product"]']]);
    assert.equal(status, 200); assert.equal(inputs.length, 0);
  });
  it('single "image" + role product + barcode sent by the camera: 0 Gemini image calls', async () => {
    const { status, body } = await post([['barcode', BARCODE], ['roles', '["product"]'], ['image', code]]);
    assert.equal(status, 200); assert.equal(inputs.length, 0); assert.equal(body.barcode, BARCODE); assert.equal(body.needsPhoto, undefined);
  });
  it('single "image" + role nutrition: exactly 1 Gemini call with that photo', async () => {
    const { status, body } = await post([['barcode', BARCODE], ['roles', '["nutrition"]'], ['image', code]]);
    assert.equal(status, 200); assert.equal(inputs.length, 1);
    assert.deepEqual(sent().map((image) => image.role), ['nutrition']); assert.equal(body.needsPhoto, undefined);
  });
  it('multi-image flow is unchanged: only the content photos reach Gemini, in one call', async () => {
    const { status } = await post([['barcode', BARCODE], ['roles', '["product","nutrition","ingredients"]'], ['images', code], ['images', code], ['images', code]]);
    assert.equal(status, 200); assert.equal(inputs.length, 1);
    assert.deepEqual(sent().map((image) => image.role), ['nutrition', 'ingredients']);
  });
  it('mixed "image" and "images": the roles still belong to "images" only', async () => {
    const { status } = await post([['barcode', BARCODE], ['roles', '["product"]'], ['image', code], ['images', code]]);
    assert.equal(status, 200); assert.equal(inputs.length, 1);
    assert.deepEqual(sent().map((image) => image.role), [undefined]);
  });
  it('an old client without roles is unchanged: the photo counts as content', async () => {
    const { status } = await post([['image', code]]);
    assert.equal(status, 200); assert.equal(inputs.length, 1); assert.equal(sent()[0]!.role, undefined);
  });
  it('a photo with no barcode goes the old AI-first way, whatever its role', async () => {
    const plain = new Blob([new Uint8Array(Buffer.concat([JPEG, Buffer.from([1])]))], { type: 'image/jpeg' });
    const { status } = await post([['roles', '["product"]'], ['image', plain]]);
    assert.equal(status, 200); assert.equal(inputs.length, 1); assert.equal(lookups.length, 0);
  });
  it('an unknown role does not break the scan', async () => {
    const { status } = await post([['roles', '["bad"]'], ['image', code]]);
    assert.equal(status, 200); assert.equal(inputs.length, 1);
  });
});

describe('multi-photo Scan through GoogleProvider (stubbed HTTP)', () => {
  const files = [jpeg(1), jpeg(2), jpeg(3)];
  const scan = async (analysis: unknown) => {
    const requests: Record<string, any>[] = [];
    const provider = new GoogleProvider({ apiKey: KEY, project: 'foodlens-513112', fetch: (async (_: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init!.body));
      requests.push(body);
      return reply(body.contents[0].parts.some((p: any) => p.inlineData) ? analysis : goal);
    }) as typeof fetch });
    const lines: string[] = [];
    const capture = (message: unknown) => { lines.push(String(message)); };
    Logger.overrideLogger({ log: capture, warn: capture, error: capture, debug: capture, verbose: capture });
    try {
      const result = await new ScanService(provider, plans(), new GoalMatchService(provider)).analyze(files, 'unit-user', { roles: ['product', 'nutrition', 'ingredients'] });
      return { result, requests, lines };
    } finally {
      Logger.overrideLogger(false);
    }
  };
  const isProduct = (body: Record<string, any>) => body.contents[0].parts.some((p: any) => p.inlineData);

  it('success: exactly one analyzeProduct request with 3 images, then Goal Match', async () => {
    const { result, requests, lines } = await scan(MOCK_META_PRODUCT_ANALYSIS);
    assert.equal(requests.filter(isProduct).length, 1);
    assert.equal(requests[0]!.contents[0].parts.filter((p: any) => p.inlineData).length, 3);
    assert.equal(requests.filter((body) => !isProduct(body)).length, 1, 'Goal Match runs once, text only');
    assert.ok(!JSON.stringify(requests[1]).includes('inlineData'));
    assert.equal(result.goalMatch.version, 'goal-match-v4');
    assert.ok(lines.some((line) => line.startsWith('scan finished') && line.includes('"images":3')));
  });
  it('estimated critical fields reach Goal Match after the image analysis', async () => {
    const table = { ...MOCK_META_PRODUCT_ANALYSIS.nutrition_table, sugars_g: null, saturated_fat_g: null, salt_g: null, sodium: { amount: null, unit: null } };
    const { result, requests } = await scan({ ...MOCK_META_PRODUCT_ANALYSIS, nutrition_table: table });
    assert.equal(requests.length, 2);
    assert.notEqual(result.score.value, null); assert.equal(typeof result.score.value, 'number'); assert.equal(typeof result.goalMatch.value, 'number');
  });
  it('logs carry no image, base64, key or prompt', async () => {
    const { lines } = await scan(MOCK_META_PRODUCT_ANALYSIS);
    const text = lines.join('\n');
    for (const file of files) assert.ok(!text.includes(file.buffer.toString('base64')));
    for (const secret of [KEY, 'inlineData', 'Several images', 'Role hint']) assert.ok(!text.includes(secret), secret);
  });
});

describe('per-100 Goal Match without a printed serving (stubbed HTTP)', () => {
  const typicalServing = { amount: 28, unit: 'g', confidence: 'high', evidence: ['one piece'] };
  const analysis = {
    ...MOCK_META_PRODUCT_ANALYSIS,
    nutrition_table: { ...MOCK_META_PRODUCT_ANALYSIS.nutrition_table, serving_size: { amount: null, unit: null } },
    semantics: { ...MOCK_META_PRODUCT_ANALYSIS.semantics, typicalServing },
  };
  it('returns the Product Score and a deterministic estimate with one Gemini call, ignoring AI typicalServing', async () => {
    const requests: Record<string, any>[] = [];
    const provider = new GoogleProvider({ apiKey: KEY, project: 'foodlens-513112', fetch: (async (_: unknown, init?: RequestInit) => {
      requests.push(JSON.parse(String(init!.body)));
      return reply(analysis);
    }) as typeof fetch });
    const result = await new ScanService(provider, plans(), new GoalMatchService(provider)).analyze([jpeg(1), jpeg(2)], 'unit-user');
    assert.equal(requests.length, 1, 'no Goal Match AI call');
    assert.notEqual(result.score.value, null);
    assert.equal(result.goalMatch.version, 'goal-match-v4');
    if (result.goalMatch.version !== 'goal-match-v4') return;
    assert.equal(result.goalMatch.source, 'deterministic');
    assert.equal(result.goalMatch.confidence, 'low');
    assert.equal(typeof result.goalMatch.value, 'number');
    assert.deepEqual([result.goalMatch.portion!.basis, result.goalMatch.portion!.amount], ['per_100', 100]);
  });
});
