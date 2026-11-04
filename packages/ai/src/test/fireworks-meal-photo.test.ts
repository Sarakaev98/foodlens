import assert from 'node:assert/strict';
import { it } from 'node:test';
import { AIProviderError } from '../errors';
import { FireworksMealPhotoProvider, FIREWORKS_MEAL_PHOTO_MODEL, FIREWORKS_MEAL_PHOTO_TIMEOUT_MS } from '../providers/fireworks/fireworks-meal-photo-provider';
import { FIREWORKS_MEAL_PLAN_ENDPOINT } from '../providers/fireworks/fireworks-meal-plan-provider';
import { GoogleMealPhotoProvider } from '../providers/google/google-meal-photo-provider';
import { MEAL_PHOTO_OUTPUT_SCHEMA } from '../meal-photo/meal-photo-output-schema';
import { MEAL_PHOTO_SYSTEM_PROMPT, MEAL_PHOTO_USER_PROMPT } from '../meal-photo/meal-photo-prompt';
import { MOCK_MEAL_PHOTO_OUTPUT as raw } from '../providers/mock/mock-meal-photo';
const image = { mimeType: 'image/jpeg' as const, base64: '/9j/AAA=' };
const usage = { prompt_tokens: 300, completion_tokens: 120, total_tokens: 420, prompt_tokens_details: { cached_tokens: 50 } };
const envelope = (output: unknown = raw) => ({ model: FIREWORKS_MEAL_PHOTO_MODEL,
  choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(output), tool_calls: [] } }], usage });
function setup(respond: () => Response | Promise<Response>, timeoutMs?: number, apiKey = 'private-test-key') {
  const calls: { url: string; init: RequestInit; body: any }[] = [];
  const logs: { message: string; fields: Readonly<Record<string, unknown>> }[] = [];
  const log = (message: string, fields: Readonly<Record<string, unknown>>) => { logs.push({ message, fields }); };
  const ai = new FireworksMealPhotoProvider({ apiKey, timeoutMs, logger: { log, warn: log }, fetch: (async (url, init) => {
    calls.push({ url: String(url), init: init!, body: JSON.parse(String(init?.body)) }); return respond();
  }) as typeof fetch });
  return { ai, calls, logs };
}
async function rejects(p: Promise<unknown>, code: string, status?: number) {
  await assert.rejects(p, (e: unknown) => e instanceof AIProviderError && e.provider === 'fireworks' && e.code === code && (status === undefined || e.httpStatus === status));
}
it('one image uses the same prompts, schema, token limit and raw output as Gemini', async () => {
  let googleBody: any;
  const google = new GoogleMealPhotoProvider({ apiKey: 'fake', project: 'fake', location: 'global', model: 'gemini-3.5-flash-lite',
    fetch: (async (_url, init) => { googleBody = JSON.parse(String(init?.body)); return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(raw) }] } }] }); }) as typeof fetch });
  const g = await google.analyze({ image });
  const { ai, calls, logs } = setup(() => Response.json(envelope()));
  assert.deepEqual(await ai.analyzeMealPhoto({ image, requestId: 'meal-test' }), g);
  assert.equal(calls.length, 1);
  const { url, body, init } = calls[0]!;
  assert.equal(url, FIREWORKS_MEAL_PLAN_ENDPOINT); assert.equal(body.model, FIREWORKS_MEAL_PHOTO_MODEL);
  assert.equal(body.messages[0].content, googleBody.systemInstruction.parts[0].text);
  assert.equal(body.messages[0].content, MEAL_PHOTO_SYSTEM_PROMPT);
  assert.equal(body.messages[1].content[0].text, googleBody.contents[0].parts[0].text);
  assert.equal(body.messages[1].content[0].text, MEAL_PHOTO_USER_PROMPT);
  assert.deepEqual(body.messages[1].content[1], { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,/9j/AAA=' } });
  assert.deepEqual(body.response_format, { type: 'json_schema', json_schema: { name: 'meal_photo', schema: MEAL_PHOTO_OUTPUT_SCHEMA, strict: true } });
  assert.equal(body.max_tokens, googleBody.generationConfig.maxOutputTokens); assert.equal(body.max_tokens, 1024);
  assert.equal(body.reasoning_effort, 'low'); assert.equal(body.stream, false); assert.equal(init.redirect, 'error');
  assert.equal(FIREWORKS_MEAL_PHOTO_TIMEOUT_MS, 45000);
  assert.equal(new Headers(init.headers).get('x-goog-api-key'), null);
  assert.deepEqual(logs.filter(l => l.message === 'fireworks_meal_photo_http').map(l => l.fields.event), ['request_started', 'headers_received', 'body_read_started', 'body_read_completed']);
  assert.ok(logs.every(l => l.fields.requestId === 'meal-test'));
  assert.doesNotMatch(JSON.stringify(logs), /private-test-key|Chicken with Rice|base64|systemInstruction/);
});
for (const mimeType of ['image/jpeg', 'image/png', 'image/webp'] as const) it(`Meal photo preserves ${mimeType} bytes`, async () => {
  const { ai, calls } = setup(() => Response.json(envelope()));
  await ai.analyzeMealPhoto({ image: { ...image, mimeType } });
  assert.equal(calls[0]!.body.messages[1].content[1].image_url.url, `data:${mimeType};base64,${image.base64}`);
});
it('usage/cost and missing usage are safe; usage remains recorded before content rejection', async () => {
  const { ai, logs } = setup(() => Response.json(envelope()));
  await ai.analyzeMealPhoto({ image });
  const u = logs.find(l => l.message === 'fireworks_usage')!.fields;
  assert.equal(u.prompt, 300); assert.equal(u.output, 120); assert.equal(u.total, 420); assert.equal(u.cached, 50);
  assert.equal(u.type, 'meal_photo'); assert.equal(u.httpStatus, 200);
  assert.equal(u.estimatedCostUsd, (250 * 1.25 + 50 * .15 + 120 * 4.25) / 1e6);
  const { usage: _usage, ...withoutUsage } = envelope();
  const missing = setup(() => Response.json(withoutUsage)); await missing.ai.analyzeMealPhoto({ image });
  assert.equal(missing.logs.find(l => l.message === 'fireworks_usage')!.fields.estimatedCostUsd, null);
  const invalid = setup(() => Response.json(envelope({}))); await rejects(invalid.ai.analyzeMealPhoto({ image }), 'invalid_response');
  assert.ok(invalid.logs.some(l => l.message === 'fireworks_usage'));
});
for (const [status, code] of [[401, 'authentication_failed'], [403, 'authentication_failed'], [429, 'rate_limited'], [500, 'unavailable'], [400, 'bad_request']] as const) it(`HTTP ${status} preserves typed error with no retry/fallback`, async () => {
  const { ai, calls, logs } = setup(() => new Response('private-test-key sensitive response', { status }));
  await rejects(ai.analyzeMealPhoto({ image }), code, status);
  assert.equal(calls.length, 1); assert.equal(logs.at(-1)!.fields.httpStatus, status);
  assert.doesNotMatch(JSON.stringify(logs), /private-test-key|sensitive response/);
});
it('model/content errors, incomplete fields and truncation are rejected without guessing values', async () => {
  const noConfidence: Record<string, unknown> = { ...raw }; delete noConfidence.confidence;
  const itemMissing = structuredClone(raw) as any; delete itemMissing.items[0].protein_g;
  const invalids = [ {}, { ...envelope(), model: 'wrong' }, { ...envelope(), choices: [] }, envelope(noConfidence), envelope(itemMissing),
    envelope({ ...raw, items: [{ ...raw.items[0], grams: '100' }] }),
    { ...envelope(), choices: [{ finish_reason: 'length', message: { role: 'assistant', content: JSON.stringify(raw) } }] },
    { ...envelope(), choices: [{ finish_reason: 'stop', message: { role: 'tool', content: JSON.stringify(raw) } }] },
    { ...envelope(), choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{broken', tool_calls: [] } }] },
    { ...envelope(), choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(raw), tool_calls: [{}] } }] },
  ];
  for (const data of invalids) {
    const { ai, calls } = setup(() => Response.json(data));
    await rejects(ai.analyzeMealPhoto({ image }), 'invalid_response'); assert.equal(calls.length, 1);
  }
  await rejects(setup(() => new Response('not JSON')).ai.analyzeMealPhoto({ image }), 'invalid_response');
  await rejects(setup(() => Response.json({ ...envelope(), choices: [{ finish_reason: 'content_filter', message: { role: 'assistant', refusal: 'sensitive' } }] })).ai.analyzeMealPhoto({ image }), 'refused');
});
it('no-food result and nullable ranges retain the original contract', async () => {
  const noFood = { is_food: false, meal_name: '', items: [], total_kcal: 0, kcal_min: null, kcal_max: null, confidence: 'low', assumptions: [] };
  assert.deepEqual(await setup(() => Response.json(envelope(noFood))).ai.analyzeMealPhoto({ image }), noFood);
});
it('timeout bounds headers/body and never reports late success, even if fetch ignores abort', async () => {
  for (const respond of [() => new Promise<Response>(() => undefined), () => Promise.resolve(new Response(new ReadableStream({ start() {} })))]) {
    const { ai, calls, logs } = setup(respond, 15);
    await rejects(ai.analyzeMealPhoto({ image }), 'timeout'); assert.equal(calls.length, 1);
    assert.equal(calls[0]!.init.signal!.aborted, true); assert.equal(logs.at(-1)!.fields.success, false);
  }
  let finish!: (r: Response) => void;
  const late = setup(() => new Promise<Response>(resolve => { finish = resolve; }), 15);
  await rejects(late.ai.analyzeMealPhoto({ image }), 'timeout'); finish(Response.json(envelope()));
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(late.logs.some(l => l.fields.success === true || l.message === 'fireworks_usage'), false);
});
it('invalid image/missing key do not send a request; network error messages never leak', async () => {
  const missing = setup(() => Response.json(envelope()), undefined, '');
  await rejects(missing.ai.analyzeMealPhoto({ image }), 'not_configured'); assert.equal(missing.calls.length, 0);
  const bad = setup(() => Response.json(envelope()));
  await rejects(bad.ai.analyzeMealPhoto({ image: { ...image, base64: '' } }), 'unsupported_input'); assert.equal(bad.calls.length, 0);
  const network = setup(() => { throw new Error('private-test-key private photo'); });
  await rejects(network.ai.analyzeMealPhoto({ image }), 'unavailable');
  assert.doesNotMatch(JSON.stringify(network.logs), /private-test-key|private photo/);
});
