import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AIProviderError } from '../errors';
import type { MealPhotoAiOutput } from '../meal-photo/meal-photo-output-schema';
import { MockProvider } from '../providers/mock/mock-provider';
import { MOCK_MEAL_PHOTO_OUTPUT } from '../providers/mock/mock-meal-photo';
import { GoogleMealPhotoProvider } from '../providers/google/google-meal-photo-provider';
import { GoogleProvider } from '../providers/google/google-provider';

const IMAGE = { mimeType: 'image/jpeg' as const, base64: '/9j/AAA=' };
const USAGE = { promptTokenCount: 300, candidatesTokenCount: 120, totalTokenCount: 420, promptTokensDetails: [{ modality: 'IMAGE', tokenCount: 258 }, { modality: 'TEXT', tokenCount: 42 }] };
const envelope = (output: unknown, finishReason = 'STOP') => ({
  candidates: [{ finishReason, content: { parts: [{ text: typeof output === 'string' ? output : JSON.stringify(output) }] } }],
  usageMetadata: USAGE,
});

function recorder() {
  const lines: { message: string; fields: Record<string, unknown> }[] = [];
  return { lines, logger: { log: (message: string, fields: Readonly<Record<string, unknown>>) => void lines.push({ message, fields: { ...fields } }), warn: () => undefined } };
}

function provider(respond: () => Response | Promise<Response>, requests: { url: string; body: Record<string, unknown> }[] = [], logger = recorder().logger) {
  return new GoogleMealPhotoProvider({
    apiKey: 'test', project: 'test-project', location: 'global', model: 'gemini-3.5-flash-lite', logger,
    fetch: (async (url: string, init: RequestInit) => {
      requests.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
      return respond();
    }) as typeof fetch,
  });
}

async function rejectsWith(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof AIProviderError && error.code === code);
}

describe('GoogleMealPhotoProvider', () => {
  it('valid meal photo response: несколько компонентов разбираются по схеме', async () => {
    const output = await provider(() => Response.json(envelope(MOCK_MEAL_PHOTO_OUTPUT))).analyze({ image: IMAGE });
    assert.equal(output.meal_name, 'Chicken with Rice and Vegetables');
    assert.equal(output.items.length, 4);
    assert.deepEqual(output, MOCK_MEAL_PHOTO_OUTPUT);
  });

  it('один запрос: одно фото, короткий prompt, JSON-схема и маленький лимит ответа', async () => {
    const requests: { url: string; body: Record<string, unknown> }[] = [];
    await provider(() => Response.json(envelope(MOCK_MEAL_PHOTO_OUTPUT)), requests).analyze({ image: IMAGE });
    assert.equal(requests.length, 1);
    assert.match(requests[0]!.url, /models\/gemini-3\.5-flash-lite:generateContent$/);
    const body = requests[0]!.body as { contents: { parts: { inlineData?: unknown }[] }[]; generationConfig: Record<string, unknown>; systemInstruction: { parts: { text: string }[] } };
    assert.equal(body.contents[0]!.parts.filter((part) => part.inlineData).length, 1);
    assert.ok(body.systemInstruction.parts[0]!.text.length < 800, 'prompt stays short');
    assert.match(body.systemInstruction.parts[0]!.text, /in English/);
    assert.doesNotMatch(body.systemInstruction.parts[0]!.text, /in Russian/);
    assert.equal(body.generationConfig.responseMimeType, 'application/json');
    assert.equal(body.generationConfig.maxOutputTokens, 1024);
    assert.ok(body.generationConfig.responseSchema);
  });

  it('usageMetadata сохраняется в лог gemini_usage с типом meal_photo', async () => {
    const { lines, logger } = recorder();
    await provider(() => Response.json(envelope(MOCK_MEAL_PHOTO_OUTPUT)), [], logger).analyze({ image: IMAGE, requestId: 'r1' });
    const usage = lines.find((line) => line.message === 'gemini_usage');
    assert.deepEqual(usage?.fields, {
      type: 'meal_photo', model: 'gemini-3.5-flash-lite', prompt: 300, output: 120, thoughts: null, cached: null, total: 420, image: 258, text: 42, numberOfImages: 1, retries: 0,
    });
  });

  it('usageMetadata пишется и для ответа, который потом отклонён', async () => {
    const { lines, logger } = recorder();
    await rejectsWith(provider(() => Response.json(envelope('{not json')), [], logger).analyze({ image: IMAGE }), 'invalid_response');
    assert.ok(lines.some((line) => line.message === 'gemini_usage' && line.fields.total === 420));
  });

  it('AI malformed JSON и нарушение схемы → invalid_response', async () => {
    await rejectsWith(provider(() => Response.json(envelope('{"is_food": tru'))).analyze({ image: IMAGE }), 'invalid_response');
    const { confidence: _confidence, ...withoutConfidence } = MOCK_MEAL_PHOTO_OUTPUT;
    await rejectsWith(provider(() => Response.json(envelope(withoutConfidence))).analyze({ image: IMAGE }), 'invalid_response');
    await rejectsWith(provider(() => Response.json(envelope({ ...MOCK_MEAL_PHOTO_OUTPUT, items: [{ name: 'x', grams: '100' }] }))).analyze({ image: IMAGE }), 'invalid_response');
    await rejectsWith(provider(() => Response.json(envelope(MOCK_MEAL_PHOTO_OUTPUT, 'MAX_TOKENS'))).analyze({ image: IMAGE }), 'invalid_response');
  });

  it('ответ «не еда» проходит схему: решение принимает нормализация', async () => {
    const noFood: MealPhotoAiOutput = { is_food: false, meal_name: '', items: [], total_kcal: 0, kcal_min: null, kcal_max: null, confidence: 'low', assumptions: [] };
    assert.deepEqual(await provider(() => Response.json(envelope(noFood))).analyze({ image: IMAGE }), noFood);
  });

  it('ошибки Gemini переводятся в коды провайдера', async () => {
    await rejectsWith(provider(() => new Response('', { status: 429 })).analyze({ image: IMAGE }), 'rate_limited');
    await rejectsWith(provider(() => new Response('', { status: 403 })).analyze({ image: IMAGE }), 'authentication_failed');
    await rejectsWith(provider(() => new Response('', { status: 503 })).analyze({ image: IMAGE }), 'unavailable');
    await rejectsWith(provider(() => { throw new TypeError('fetch failed: secret'); }).analyze({ image: IMAGE }), 'unavailable');
  });

  it('timeout → timeout', async () => {
    const hanging = new GoogleMealPhotoProvider({
      apiKey: 'test', project: 'p', location: 'global', model: 'gemini-3.5-flash-lite', timeoutMs: 20,
      fetch: ((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))))) as typeof fetch,
    });
    // AbortSignal.timeout не держит event loop: без этого таймера node:test завершится раньше.
    const keepAlive = setTimeout(() => undefined, 1000);
    try {
      await rejectsWith(hanging.analyze({ image: IMAGE }), 'timeout');
    } finally {
      clearTimeout(keepAlive);
    }
  });

  it('без ключа запроса нет: not_configured', async () => {
    let called = false;
    const unconfigured = new GoogleMealPhotoProvider({ apiKey: '', project: 'p', location: 'global', model: 'm', fetch: (async () => { called = true; return Response.json({}); }) as typeof fetch });
    await rejectsWith(unconfigured.analyze({ image: IMAGE }), 'not_configured');
    assert.equal(called, false);
  });

  it('GoogleProvider и MockProvider отдают метод analyzeMealPhoto', async () => {
    const google = new GoogleProvider({ apiKey: 'k', project: 'foodlens-test', fetch: (async () => Response.json(envelope(MOCK_MEAL_PHOTO_OUTPUT))) as typeof fetch });
    assert.equal((await google.analyzeMealPhoto({ image: IMAGE })).items.length, 4);
    assert.deepEqual(await new MockProvider().analyzeMealPhoto({ image: IMAGE }), MOCK_MEAL_PHOTO_OUTPUT);
  });
});
