import 'reflect-metadata';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { Logger, Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MockProvider, type AIProvider, type AnalyzeProductInput } from '@foodlens/ai';
import type { NutritionTargetsService } from '../../nutrition-targets/nutrition-targets.service';
import type { ProductLookupProvider } from '../../product-lookup/product-lookup.provider';
import { parseScanBarcode } from '../scan-barcode';
import { ScanController } from '../scan.controller';
import { ScanService } from '../scan.service';

Logger.overrideLogger(false);

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
/** Mock выдаёт новые id и время анализа на каждый скан; сравниваем всё остальное. */
const stable = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (key, v: unknown) => (key === 'id' || key === 'analyzedAt' ? undefined : v)));
const NO_PROFILE = { findPlanForUser: async () => null } as unknown as NutritionTargetsService;

/** Запоминает, с чем вызывались AI и поиск по штрихкоду. */
const calls = { ai: [] as AnalyzeProductInput[], lookup: [] as string[] };
const mock = new MockProvider();
const recordingAI = {
  name: 'recording',
  analyzeProduct: (input: AnalyzeProductInput) => (calls.ai.push(input), mock.analyzeProduct(input)),
} as unknown as AIProvider;
const recordingLookup: ProductLookupProvider = {
  name: 'recording',
  lookup: async (barcode) => (calls.lookup.push(barcode!), null),
};

describe('parseScanBarcode', () => {
  it('accepts 8–14 digits (trimmed) and ignores everything else', () => {
    assert.equal(parseScanBarcode('4607001771234'), '4607001771234');
    assert.equal(parseScanBarcode(' 12345670 '), '12345670');
    assert.equal(parseScanBarcode('12345678901234'), '12345678901234');
    for (const invalid of [undefined, null, 4607001771234, '', '1234567', '123456789012345', '46070017712ab', 'https://qr.example', ['4607001771234']]) {
      assert.equal(parseScanBarcode(invalid), null, String(invalid));
    }
  });
});

describe('ScanService: optional barcode', () => {
  it('without a barcode the result and AI input are exactly as before; lookup is not called', async () => {
    calls.ai.length = 0;
    calls.lookup.length = 0;
    const result = await new ScanService(recordingAI, NO_PROFILE, undefined, recordingLookup).analyze(
      { mimetype: 'image/jpeg', buffer: JPEG, size: JPEG.length },
      'user',
    );
    assert.deepEqual(Object.keys(result).sort(), ['goalMatch', 'product', 'score']);
    assert.deepEqual(Object.keys(calls.ai[0]!).sort(), ['image', 'kind', 'requestId']);
    assert.deepEqual(calls.lookup, []);
  });

  it('a lookup failure or an empty database record never changes the photo result', async () => {
    const image = { mimetype: 'image/jpeg', buffer: JPEG, size: JPEG.length };
    const plain = await new ScanService(new MockProvider(), NO_PROFILE).analyze(image, 'user');
    const failing: ProductLookupProvider = { name: 'failing', lookup: async () => { throw new Error('db down'); } };
    const empty: ProductLookupProvider = { name: 'empty', lookup: async (barcode) => ({
      provider: 'open_food_facts', match: 'exact_barcode', barcode: barcode!, name: null, brand: null, nutrition: null, servingSize: null, ingredients: null, allergens: null, additives: null,
    }) };
    for (const lookup of [failing, empty]) {
      const result = await new ScanService(new MockProvider(), NO_PROFILE, undefined, lookup).analyze(image, 'user', { barcode: '4607001771234' });
      assert.equal(result.barcode, '4607001771234');
      assert.deepEqual(stable(result.product), stable(plain.product));
      assert.deepEqual(result.score, plain.score);
    }
  });
});

@Module({
  controllers: [ScanController],
  providers: [{ provide: ScanService, useFactory: () => new ScanService(recordingAI, NO_PROFILE, undefined, recordingLookup) }],
})
class BarcodeTestModule {}

describe('POST /scan/analyze multipart barcode field', () => {
  let app: INestApplication;
  let url: string;

  before(async () => {
    app = await NestFactory.create(BarcodeTestModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/scan/analyze`;
  });
  after(async () => app.close());

  async function post(barcode?: string): Promise<{ status: number; body: Record<string, unknown> }> {
    calls.ai.length = 0;
    calls.lookup.length = 0;
    const form = new FormData();
    form.append('image', new Blob([JPEG], { type: 'image/jpeg' }), 'scan.jpg');
    if (barcode !== undefined) form.append('barcode', barcode);
    const response = await fetch(url, { method: 'POST', body: form });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  it('without barcode: 200, same keys as before, lookup not called', async () => {
    const { status, body } = await post();
    assert.equal(status, 200);
    assert.deepEqual(Object.keys(body).sort(), ['goalMatch', 'product', 'score']);
    assert.deepEqual(calls.lookup, []);
  });

  it('dev log shows the exact field received and what was parsed from it', async () => {
    const lines: string[] = [];
    const capture = (message: unknown) => { lines.push(String(message)); };
    Logger.overrideLogger({ log: capture, warn: capture, error: capture, debug: capture, verbose: capture });
    try {
      await post('4607001771234');
      await post('not-a-code');
      await post();
    } finally {
      Logger.overrideLogger(false);
    }
    const received = lines.filter((line) => line.startsWith('api_barcode_received ')).map((line) => JSON.parse(line.slice('api_barcode_received '.length)));
    assert.deepEqual(received.map(({ received: raw, receivedType, barcode }) => ({ raw, receivedType, barcode })), [
      { raw: '4607001771234', receivedType: 'string', barcode: '4607001771234' },
      { raw: 'not-a-code', receivedType: 'string', barcode: null },
      { raw: null, receivedType: 'undefined', barcode: null },
    ]);
  });

  it('with a valid barcode: 200, barcode returned as metadata, passed to lookup, AI input unchanged', async () => {
    const without = await post();
    const { status, body } = await post('4607001771234');
    assert.equal(status, 200);
    assert.equal(body.barcode, '4607001771234');
    assert.deepEqual(calls.lookup, ['4607001771234']);
    assert.deepEqual(Object.keys(calls.ai[0]!).sort(), ['image', 'kind', 'requestId']);
    assert.deepEqual(stable(body.product), stable(without.body.product));
    assert.deepEqual(body.score, without.body.score);
  });

  it('an invalid barcode is ignored and the scan still succeeds', async () => {
    for (const invalid of ['abc', '123', 'https://example.com/qr', '1234567890123456']) {
      const { status, body } = await post(invalid);
      assert.equal(status, 200, invalid);
      assert.equal('barcode' in body, false, invalid);
      assert.deepEqual(calls.lookup, [], invalid);
    }
  });
});
