import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { NutritionTargets } from '@foodlens/core';
import type { GenerateMealPlanInput } from '../ai-provider.types';
import { AIProviderError } from '../errors';
import { FireworksMealPlanProvider, FIREWORKS_MEAL_PLAN_MODEL, FIREWORKS_MEAL_PLAN_ENDPOINT } from '../providers/fireworks/fireworks-meal-plan-provider';
import { MEAL_PLAN_SYSTEM_PROMPT, mealPlanUserPrompt } from '../meal-plan/meal-plan-prompt';
import { MEAL_PLAN_OUTPUT_SCHEMA } from '../meal-plan/meal-plan-output-schema';
const targets: NutritionTargets = {
  caloriesKcal: 2000, proteinG: 150, fatG: 67, carbsG: 200,
  calculation: { version: 'nutrition-v1', bmrKcal: 1500, tdeeKcal: 2350, goalAdjustmentPercent: -15, macroSplit: { proteinPercent: 30, fatPercent: 30, carbsPercent: 40 } },
};
const input: GenerateMealPlanInput = {
  goal: 'lose_weight', targets, startDate: '2026-11-02', days: 1, locale: 'en',
  preferences: { dietaryPreferences: ['vegan'], allergens: ['soy'], avoidedIngredients: ['кинза'] },
};
const meal = { slot: 'breakfast', name: 'Каша', description: 'Завтрак', ingredients: ['рис, 80 г'], portion: '1 тарелка', calories_kcal: 500, protein_g: 20.4, carbs_g: 80.2, fat_g: 10 };

const envelope = (content: unknown = { meals: [meal] }, reason = 'stop') => ({ model: FIREWORKS_MEAL_PLAN_MODEL,
  choices: [{ finish_reason: reason, message: { role: 'assistant', content: JSON.stringify(content) } }],
  usage: { prompt_tokens: 149, completion_tokens: 52, total_tokens: 201, prompt_tokens_details: { cached_tokens: 0 } } });
function setup(respond: () => Response | Promise<Response> = () => Response.json(envelope()), timeoutMs = 1000) {
  const calls: { url: unknown; init: RequestInit }[] = [], logs: { message: string; fields: unknown }[] = [];
  const provider = new FireworksMealPlanProvider({ apiKey: 'private-test-key', timeoutMs, createId: () => 'id',
    logger: { log: (message, fields) => logs.push({ message, fields }), warn: (message, fields) => logs.push({ message, fields }) },
    fetch: (async (url, init) => { calls.push({ url, init: init! }); return respond(); }) as typeof fetch });
  return { provider, calls, logs };
}
const code = (expected: string) => (e: unknown) => e instanceof AIProviderError && e.provider === 'fireworks' && e.code === expected;
describe('Fireworks Meal Plan (offline only)', () => {
  it('preserves prompts/schema/restrictions, maps meals and calculates totals locally', async () => {
    const { provider, calls, logs } = setup(() => Response.json(envelope({ meals: [meal, { ...meal, slot: 'lunch' }] })));
    const request = { ...input, mealsPerDay: 3 as const, correction: ['No soy'], recentMealNames: ['Rice'], variation: { style: 'Mediterranean', emphasis: 'legumes' } };
    const plan = await provider.generate(request);
    assert.equal(calls.length, 1); assert.equal(calls[0]!.url, FIREWORKS_MEAL_PLAN_ENDPOINT);
    const init = calls[0]!.init, body = JSON.parse(String(init.body));
    assert.equal(init.redirect, 'error'); assert.equal((init.headers as Record<string,string>).Authorization, 'Bearer private-test-key');
    assert.equal(body.model, FIREWORKS_MEAL_PLAN_MODEL); assert.equal(body.max_tokens, 4096);
    assert.equal(body.reasoning_effort, 'low');
    assert.deepEqual(body.messages, [{ role: 'system', content: MEAL_PLAN_SYSTEM_PROMPT }, { role: 'user', content: mealPlanUserPrompt(request) }]);
    assert.deepEqual(body.response_format.json_schema.schema, MEAL_PLAN_OUTPUT_SCHEMA);
    assert.equal(body.response_format.type, 'json_schema');
    assert.deepEqual(plan.days[0]!.totals, { caloriesKcal: 1000, proteinG: 41, carbsG: 160, fatG: 20 });
    assert.equal(plan.days[0]!.date, input.startDate);
    const usage = logs.find(l => l.message === 'fireworks_usage')!.fields as Record<string,unknown>;
    assert.equal(usage.estimatedCostUsd, 0.00040725);
    assert.ok(logs.some(l => l.message === 'meal_plan_provider' && (l.fields as Record<string,unknown>).planId === plan.id));
    assert.doesNotMatch(JSON.stringify(logs), /private-test-key|No soy|Каша/);
  });
  for (const [status, expected] of [[401,'authentication_failed'],[403,'authentication_failed'],[429,'rate_limited'],[500,'unavailable'],[400,'bad_request']] as const) {
    it(`HTTP ${status}: safe error, one attempt, no fallback`, async () => {
      const { provider, calls, logs } = setup(() => new Response('private-test-key upstream secret', { status }));
      await assert.rejects(provider.generate(input), code(expected)); assert.equal(calls.length, 1);
      assert.doesNotMatch(JSON.stringify(logs), /private-test-key|upstream secret/);
    });
  }
  it('missing key makes no transport call', async () => {
    const p = new FireworksMealPlanProvider({ apiKey: ' ', fetch: (async () => { throw new Error('must not call'); }) as typeof fetch });
    await assert.rejects(p.generate(input), code('not_configured'));
  });
  it('bounds stalled transport and body, without retries', async () => {
    const hanging = setup(() => new Promise<Response>(() => {}), 10);
    await assert.rejects(hanging.provider.generate(input), code('timeout')); assert.equal(hanging.calls.length, 1);
    const body = setup(() => new Response(new ReadableStream({ start() {} })), 10);
    await assert.rejects(body.provider.generate(input), code('timeout')); assert.equal(body.calls.length, 1);
  });
  it('network errors never leak raw messages', async () => {
    const { provider, calls, logs } = setup(() => { throw new Error('private-test-key'); });
    await assert.rejects(provider.generate(input), e => code('unavailable')(e) && !(e as Error).message.includes('private-test-key'));
    assert.equal(calls.length, 1); assert.doesNotMatch(JSON.stringify(logs), /private-test-key/);
  });
  const invalid = [null, { meals: [] }, { meals: [{ ...meal, slot: 'brunch' }] }, { meals: [{ ...meal, calories_kcal: 0 }] },
    { meals: [{ ...meal, protein_g: -1 }] }, { meals: [{ ...meal, name: ' ' }] }, { meals: [{ ...meal, extra: true }] }];
  for (const [index, output] of invalid.entries()) it(`rejects invalid JSON contract ${index}`, async () => {
    const { provider } = setup(() => Response.json(envelope(output)));
    await assert.rejects(provider.generate(input), code('invalid_response'));
  });
  it('rejects malformed envelope, truncation, refusal, wrong model and markdown', async () => {
    const bad = [envelope({ meals: [meal] }, 'length'), { ...envelope(), model: 'different-model' }, {},
      { ...envelope(), choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '```json {} ```' } }] }];
    for (const response of bad) await assert.rejects(setup(() => Response.json(response)).provider.generate(input), code('invalid_response'));
    await assert.rejects(setup(() => Response.json(envelope({}, 'content_filter'))).provider.generate(input), code('refused'));
    await assert.rejects(setup(() => new Response('not json')).provider.generate(input), code('invalid_response'));
  });
  it('missing usage is logged as unknown; cached usage adjusts cost', async () => {
    const response = envelope();
    const noUsage = { ...response, usage: undefined };
    const first = setup(() => Response.json(noUsage)); await first.provider.generate(input);
    assert.equal((first.logs.find(l => l.message === 'fireworks_usage')!.fields as Record<string,unknown>).estimatedCostUsd, null);
    response.usage.prompt_tokens_details.cached_tokens = 100;
    const second = setup(() => Response.json(response)); await second.provider.generate(input);
    assert.equal((second.logs.find(l => l.message === 'fireworks_usage')!.fields as Record<string,unknown>).estimatedCostUsd, (49 * 1.25 + 100 * 0.15 + 52 * 4.25)/1e6);
  });
});


describe('Fireworks HTTP stage diagnostics (no network)', () => {
  const summaries = (logs: { message: string; fields: unknown }[]) => logs.filter(l => l.message === 'meal_plan_provider').map(l => l.fields as Record<string,unknown>);
  const traces = (logs: { message: string; fields: unknown }[]) => logs.filter(l => l.message === 'fireworks_http').map(l => l.fields as Record<string,unknown>);
  it('records ordered stages/status/durations; request parameters remain unchanged', async () => {
    const { provider, calls, logs } = setup(); await provider.generate(input);
    const stages = traces(logs);
    assert.deepEqual(stages.map(l => l.event), ['request_started','headers_received','body_read_started','body_read_completed','json_parsed']);
    assert.equal(stages[0]!.httpStatus, null); assert.equal(stages[1]!.httpStatus, 200);
    assert.equal(stages[4]!.jsonValid, true); assert.ok(Number(stages[3]!.bodyBytes) > 0);
    const summary = summaries(logs)[0]!;
    assert.equal(summary.stage, 'completed'); assert.equal(summary.httpStatus, 200);
    for (const key of ['elapsedMs','headersMs','bodyMs','waitingHeadersMs','jsonParseMs','responseValidationMs']) assert.ok(typeof summary[key] === 'number' && Number(summary[key]) >= 0);
    const body = JSON.parse(String(calls[0]!.init.body));
    assert.deepEqual(Object.keys(body).sort(), ['model','stream','max_tokens','reasoning_effort','messages','response_format'].sort());
    assert.equal(body.max_tokens, 4096); assert.equal(body.stream, false);
    assert.equal(body.temperature, undefined); assert.equal(body.reasoning_effort, 'low'); assert.equal(body.thinking, undefined);
    assert.doesNotMatch(JSON.stringify(logs), /private-test-key|кинза|caloriesKcal|Завтрак/);
  });
  it('timeout before headers differs from timeout reading a body with HTTP 200', async () => {
    const first = setup(() => new Promise<Response>(() => {}), 15);
    await assert.rejects(first.provider.generate(input), code('timeout'));
    const noHeaders = summaries(first.logs)[0]!;
    assert.equal(noHeaders.stage, 'waiting_headers'); assert.equal(noHeaders.httpStatus, null);
    assert.equal(noHeaders.headersMs, null); assert.equal(noHeaders.bodyMs, null);
    assert.ok(Number(noHeaders.waitingHeadersMs) >= 0);
    const second = setup(() => new Response(new ReadableStream({start() {}})), 15);
    await assert.rejects(second.provider.generate(input), code('timeout'));
    const stalledBody = summaries(second.logs)[0]!;
    assert.equal(stalledBody.stage, 'reading_body'); assert.equal(stalledBody.httpStatus, 200);
    assert.ok(Number(stalledBody.bodyMs) >= 0); assert.equal(second.calls.length, 1);
  });
  it('HTTP failures preserve status without reading or logging the error body/headers', async () => {
    const t = setup(() => new Response('private-test-key upstream body', {status:429,headers:{'x-secret':'private-test-key'}}));
    await assert.rejects(t.provider.generate(input), code('rate_limited'));
    assert.deepEqual(traces(t.logs).map(l => l.event), ['request_started','headers_received']);
    assert.equal(summaries(t.logs)[0]!.httpStatus, 429); assert.equal(summaries(t.logs)[0]!.stage, 'checking_status');
    assert.doesNotMatch(JSON.stringify(t.logs), /private-test-key|upstream body|x-secret/);
  });
  it('separates malformed envelope JSON from JSON-contract rejection', async () => {
    const malformed = setup(() => new Response('private-test-key not json'));
    await assert.rejects(malformed.provider.generate(input), code('invalid_response'));
    assert.equal(summaries(malformed.logs)[0]!.stage, 'parsing_json');
    assert.equal(traces(malformed.logs).at(-1)!.jsonValid, false);
    assert.doesNotMatch(JSON.stringify(malformed.logs), /private-test-key|not json/);
    const invalid = setup(() => Response.json(envelope({meals:[]})));
    await assert.rejects(invalid.provider.generate(input), code('invalid_response'));
    assert.equal(summaries(invalid.logs)[0]!.stage, 'validating_response');
    assert.equal(traces(invalid.logs).at(-1)!.jsonValid, true);
  });
  it('late response after timeout produces no misleading success/usage events', async () => {
    let complete!: (r: Response) => void;
    const t = setup(() => new Promise<Response>(resolve => { complete = resolve; }), 15);
    await assert.rejects(t.provider.generate(input), code('timeout'));
    const length = t.logs.length;
    complete(Response.json(envelope()));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(t.logs.length, length); assert.equal(t.calls.length, 1);
  });
});


describe('Meal Plan optional tool_calls regression (offline)', () => {
  it('omitted/null/empty tool calls preserve an identical validated plan', async () => {
    let expected: unknown;
    for (const toolCalls of [undefined, null, []]) {
      const t = setup(() => Response.json({ ...envelope(), choices: [{ finish_reason: 'stop', message: {
        role: 'assistant', content: JSON.stringify({ meals: [meal] }), ...(toolCalls === undefined ? {} : { tool_calls: toolCalls }),
      } }] }));
      const plan = await t.provider.generate(input);
      if (expected === undefined) expected = plan; else assert.deepEqual(plan, expected);
      assert.equal(t.calls.length, 1);
    }
  });
  it('real/malformed tool calls and invalid meal JSON remain rejected', async () => {
    for (const toolCalls of [[{ id: 'tool', type: 'function', function: { name: 'unexpected', arguments: '{}' } }], {}, 'bad', false, 0]) {
      await assert.rejects(setup(() => Response.json({ ...envelope(), choices: [{ finish_reason: 'stop', message: {
        role: 'assistant', content: JSON.stringify({ meals: [meal] }), tool_calls: toolCalls,
      } }] })).provider.generate(input), code('invalid_response'));
    }
    await assert.rejects(setup(() => Response.json({ ...envelope(), choices: [{ finish_reason: 'stop', message: {
      role: 'assistant', content: '{}', tool_calls: [],
    } }] })).provider.generate(input), code('invalid_response'));
  });
});
