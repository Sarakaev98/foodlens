import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AIProviderError, type AIProviderErrorCode } from '../errors';
import { MetaProvider, type MetaProviderConfig } from '../providers/meta/meta-provider';
import { metaAnalysis } from './meta-fixtures';

const FIRST_IMAGE = { mimeType: 'image/jpeg', base64: Buffer.from('first').toString('base64') } as const;
const SECOND_IMAGE = { mimeType: 'image/jpeg', base64: Buffer.from('second').toString('base64') } as const;
const IMAGE = { kind: 'image', image: { mimeType: 'image/jpeg', base64: Buffer.from('fake-jpeg').toString('base64') } } as const;
const TEST_KEY = 'test-key-not-real';

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function completion(content: unknown, finishReason = 'stop'): Response {
  return jsonResponse(200, {
    id: 'chatcmpl-test',
    choices: [{ finish_reason: finishReason, message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }],
  });
}

function provider(responses: readonly (Response | Error)[], overrides: Partial<MetaProviderConfig> = {}) {
  const calls: Call[] = [];
  const sleeps: number[] = [];
  const logs: { message: string; fields: Readonly<Record<string, unknown>> }[] = [];
  let index = 0;
  const instance = new MetaProvider({
    apiKey: TEST_KEY,
    fetch: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      const next = responses[Math.min(index++, responses.length - 1)]!;
      if (next instanceof Error) throw next;
      return next;
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    logger: {
      log: (message, fields) => logs.push({ message, fields }),
      warn: (message, fields) => logs.push({ message, fields }),
    },
    createId: () => 'id',
    now: () => new Date('2026-10-27T12:00:00Z'),
    ...overrides,
  });
  return { instance, calls, sleeps, logs };
}

async function rejectsWith(promise: Promise<unknown>, code: AIProviderErrorCode): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof AIProviderError && error.code === code);
}

describe('MetaProvider.analyzeProduct', () => {
  it('отправляет изображение в Meta с strict JSON Schema и возвращает Product', async () => {
    const { instance, calls } = provider([completion(metaAnalysis())]);
    const product = await instance.analyzeProduct(IMAGE);

    assert.equal(product.name.value, 'Греческий йогурт 2%');
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, 'https://api.meta.ai/v1/chat/completions');
    assert.equal((calls[0]!.init.headers as Record<string, string>).Authorization, `Bearer ${TEST_KEY}`);
    const body = JSON.parse(String(calls[0]!.init.body));
    assert.equal(body.model, 'muse-spark-1.3');
    assert.equal(body.response_format.type, 'json_schema');
    assert.equal(body.response_format.json_schema.strict, true);
    assert.match(body.messages[1].content[1].image_url.url, /^data:image\/jpeg;base64,/);
  });

  it('14. без MODEL_API_KEY запрос не отправляется: not_configured', async () => {
    const { instance, calls } = provider([completion(metaAnalysis())], { apiKey: '' });
    await rejectsWith(instance.analyzeProduct(IMAGE), 'not_configured');
    assert.equal(calls.length, 0);
  });

  it('15. ошибки Meta: 401 → authentication_failed без повторов, 400 → bad_request', async () => {
    const auth = provider([jsonResponse(401, { error: { type: 'authentication_error', message: 'Invalid key' } })]);
    await rejectsWith(auth.instance.analyzeProduct(IMAGE), 'authentication_failed');
    assert.equal(auth.calls.length, 1);

    const bad = provider([jsonResponse(400, { error: { type: 'invalid_request_error' } })]);
    await rejectsWith(bad.instance.analyzeProduct(IMAGE), 'bad_request');
    assert.equal(bad.calls.length, 1);

    const quota = provider([jsonResponse(402, {})]);
    await rejectsWith(quota.instance.analyzeProduct(IMAGE), 'quota_exceeded');
  });

  it('15b. 429 и 5xx повторяются с backoff, Retry-After учитывается', async () => {
    const { instance, calls, sleeps } = provider([
      jsonResponse(429, {}, { 'retry-after': '2' }),
      jsonResponse(503, {}),
      completion(metaAnalysis()),
    ]);
    const product = await instance.analyzeProduct(IMAGE);
    assert.equal(product.brand.value, 'Epica');
    assert.equal(calls.length, 3);
    assert.equal(sleeps[0], 2000);
    assert.ok(sleeps[1]! >= 2000 && sleeps[1]! < 2500, 'вторая пауза: экспоненциальный backoff');
  });

  it('15c. после исчерпания попыток: rate_limited / unavailable', async () => {
    const limited = provider([jsonResponse(429, {})]);
    await rejectsWith(limited.instance.analyzeProduct(IMAGE), 'rate_limited');
    assert.equal(limited.calls.length, 3);

    const down = provider([new TypeError('fetch failed')]);
    await rejectsWith(down.instance.analyzeProduct(IMAGE), 'unavailable');
    assert.equal(down.calls.length, 3);
  });

  it('16. таймаут → timeout без повтора; 504 → timeout', async () => {
    const timeout = Object.assign(new Error('aborted'), { name: 'TimeoutError' });
    const slow = provider([timeout]);
    await rejectsWith(slow.instance.analyzeProduct(IMAGE), 'timeout');
    assert.equal(slow.calls.length, 1);

    const gateway = provider([jsonResponse(504, {})], { maxAttempts: 1 });
    await rejectsWith(gateway.instance.analyzeProduct(IMAGE), 'timeout');
  });

  it('16b. настоящий таймаут AbortSignal срабатывает', async () => {
    const hanging = new MetaProvider({
      apiKey: TEST_KEY,
      timeoutMs: 20,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))),
    });
    await rejectsWith(hanging.analyzeProduct(IMAGE), 'timeout');
  });

  it('10. некорректный ответ: не JSON, обрезан, не по схеме, отказ → invalid_response / refused', async () => {
    await rejectsWith(provider([completion('```json {}```')]).instance.analyzeProduct(IMAGE), 'invalid_response');
    await rejectsWith(provider([completion(metaAnalysis(), 'length')]).instance.analyzeProduct(IMAGE), 'invalid_response');
    await rejectsWith(provider([completion({ ...metaAnalysis(), extra: 1 })]).instance.analyzeProduct(IMAGE), 'invalid_response');
    await rejectsWith(provider([jsonResponse(200, { choices: [] })]).instance.analyzeProduct(IMAGE), 'invalid_response');
    const refusal = jsonResponse(200, { choices: [{ finish_reason: 'stop', message: { content: null, refusal: 'no' } }] });
    await rejectsWith(provider([refusal]).instance.analyzeProduct(IMAGE), 'refused');
  });

  it('не еда → product_not_recognized', async () => {
    const notFood = metaAnalysis({ image: { is_food_product: false } });
    await rejectsWith(provider([completion(notFood)]).instance.analyzeProduct(IMAGE), 'product_not_recognized');
  });

  it('штрихкод и текст не поддерживаются этим сценарием', async () => {
    const { instance } = provider([]);
    await rejectsWith(instance.analyzeProduct({ kind: 'text', text: 'milk' }), 'unsupported_input');
  });

  it('логи содержат длительность и статус, но не ключ и не изображение', async () => {
    const { instance, logs } = provider([jsonResponse(500, {}), completion(metaAnalysis())]);
    await instance.analyzeProduct({ ...IMAGE, requestId: 'req-1' });
    const text = JSON.stringify(logs);
    assert.ok(!text.includes(TEST_KEY));
    assert.ok(!text.includes(IMAGE.image.base64));
    assert.ok(!text.includes('Bearer'));
    const finished = logs.find((entry) => entry.message === 'product analysis finished')!;
    assert.equal(finished.fields.requestId, 'req-1');
    assert.equal(finished.fields.model, 'muse-spark-1.3');
    assert.equal(finished.fields.status, 'ok');
    assert.equal(typeof finished.fields.durationMs, 'number');
    assert.equal(finished.fields.attempts, 2);
  });
});

describe('MetaProvider with several images', () => {
  it('uses the first image only', async () => {
    let body = '';
    const provider = new MetaProvider({
      apiKey: 'unit-key',
      fetch: (async (_url: unknown, init?: RequestInit) => {
        body = String(init!.body);
        return new Response(JSON.stringify({ id: 'r', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(metaAnalysis()) } }] }));
      }) as typeof fetch,
    });
    await provider.analyzeProduct({ kind: 'image', images: [FIRST_IMAGE, SECOND_IMAGE] });
    assert.ok(body.includes(FIRST_IMAGE.base64));
    assert.ok(!body.includes(SECOND_IMAGE.base64));
  });
});
