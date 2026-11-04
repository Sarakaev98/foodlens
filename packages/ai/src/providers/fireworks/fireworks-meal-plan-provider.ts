import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { sumMeals, type Meal, type MealId, type MealPlan, type MealPlanId } from '@foodlens/core';
import type { GenerateMealPlanInput } from '../../ai-provider.types';
import { SILENT_AI_LOGGER, type AILogger } from '../../ai-logger';
import { AIProviderError, type AIProviderErrorCode } from '../../errors';
import { findSchemaViolation } from '../../json-schema/json-schema';
import { MEAL_PLAN_OUTPUT_SCHEMA, type MealPlanOutput } from '../../meal-plan/meal-plan-output-schema';
import { MEAL_PLAN_SYSTEM_PROMPT, mealPlanUserPrompt } from '../../meal-plan/meal-plan-prompt';

export const FIREWORKS_MEAL_PLAN_MODEL = 'accounts/fireworks/models/muse-spark-open';
export const FIREWORKS_MEAL_PLAN_ENDPOINT = 'https://api.fireworks.ai/inference/v1/chat/completions';
export interface FireworksMealPlanProviderConfig {
  readonly apiKey: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
  readonly logger?: AILogger;
  readonly createId?: () => string;
}
const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const count = (x: unknown): number | null => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0 ? x : null;
const failure = (code: AIProviderErrorCode, httpStatus?: number) => new AIProviderError('fireworks', code, `Fireworks meal plan: ${code}`, { httpStatus });

/** One transport attempt. The existing MealPlanService alone owns nutritional correction. */
export class FireworksMealPlanProvider {
  readonly model = FIREWORKS_MEAL_PLAN_MODEL;
  private readonly logger: AILogger;
  private readonly createId: () => string;
  private readonly transport: typeof globalThis.fetch;
  constructor(private readonly config: FireworksMealPlanProviderConfig) {
    this.logger = config.logger ?? SILENT_AI_LOGGER;
    this.createId = config.createId ?? randomUUID;
    this.transport = config.fetch ?? globalThis.fetch;
  }
  async generate(input: GenerateMealPlanInput): Promise<MealPlan> {
    const timeoutMs = this.config.timeoutMs ?? 60000;
    if (!this.config.apiKey.trim() || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw failure('not_configured');
    const requestId = this.createId(), started = Date.now();
    const fields = { requestId, provider: 'fireworks', model: this.model, type: 'meal_plan', correction: !!input.correction, retries: 0 };
    const clockStarted = performance.now();
    let stage = 'waiting_headers';
    let httpStatus: number | null = null;
    let headersAt: number | null = null;
    let bodyStartedAt: number | null = null;
    let bodyCompletedAt: number | null = null;
    let parseStartedAt: number | null = null;
    let parseCompletedAt: number | null = null;
    let validationStartedAt: number | null = null;
    const timings = () => {
      const now = performance.now();
      return { stage, httpStatus, elapsedMs: Math.round(now - clockStarted),
        headersMs: headersAt === null ? null : Math.round(headersAt - clockStarted),
        bodyMs: bodyStartedAt === null ? null : Math.round((bodyCompletedAt ?? now) - bodyStartedAt),
        waitingHeadersMs: Math.round((headersAt ?? now) - clockStarted),
        jsonParseMs: parseStartedAt === null ? null : Math.round((parseCompletedAt ?? now) - parseStartedAt),
        responseValidationMs: validationStartedAt === null ? null : Math.round(now - validationStartedAt) };
    };
    const trace = (event: string, extra: { jsonValid?: boolean; bodyBytes?: number } = {}) =>
      this.logger.log('fireworks_http', { ...fields, event, ...timings(), ...extra });
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Race also bounds a body/transport that ignores cancellation.
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(failure('timeout')); }, timeoutMs);
    });
    const operation = async (): Promise<MealPlan> => {
      trace('request_started');
      const response = await this.transport(FIREWORKS_MEAL_PLAN_ENDPOINT, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { Authorization: `Bearer ${this.config.apiKey.trim()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, stream: false, max_tokens: 4096, reasoning_effort: 'low',
          messages: [{ role: 'system', content: MEAL_PLAN_SYSTEM_PROMPT }, { role: 'user', content: mealPlanUserPrompt(input) }],
          response_format: { type: 'json_schema', json_schema: { name: 'meal_plan', schema: MEAL_PLAN_OUTPUT_SCHEMA, strict: true } },
        }),
      });
      // A transport ignoring abort must not emit a late success after the deadline.
      if (controller.signal.aborted) {
        void response.body?.cancel().catch(() => undefined);
        throw failure('timeout');
      }
      headersAt = performance.now();
      httpStatus = response.status;
      stage = 'checking_status';
      trace('headers_received');
      if (!response.ok) {
        void response.body?.cancel().catch(() => undefined);
        const status = response.status;
        throw failure(status === 401 || status === 403 ? 'authentication_failed' : status === 429 ? 'rate_limited' : status >= 500 ? 'unavailable' : 'bad_request', status);
      }
      stage = 'reading_body';
      bodyStartedAt = performance.now();
      trace('body_read_started');
      const text = await response.text();
      if (controller.signal.aborted) throw failure('timeout');
      bodyCompletedAt = performance.now();
      trace('body_read_completed', { bodyBytes: Buffer.byteLength(text, 'utf8') });
      stage = 'parsing_json';
      parseStartedAt = performance.now();
      let envelope: unknown = null;
      try { envelope = JSON.parse(text); }
      catch { parseCompletedAt = performance.now(); trace('json_parsed', { jsonValid: false }); throw failure('invalid_response'); }
      parseCompletedAt = performance.now();
      trace('json_parsed', { jsonValid: true });
      stage = 'validating_response';
      validationStartedAt = performance.now();
      const u = record(envelope) && record(envelope.usage) ? envelope.usage : {};
      const prompt = count(u.prompt_tokens), output = count(u.completion_tokens), total = count(u.total_tokens);
      const cached = record(u.prompt_tokens_details) ? count(u.prompt_tokens_details.cached_tokens) : null;
      const validCached = cached !== null && prompt !== null && cached <= prompt ? cached : 0;
      // Standard serverless USD / million tokens, verified 2026-11-04 on the model card.
      const estimatedCostUsd = prompt !== null && output !== null ? ((prompt - validCached) * 1.25 + validCached * 0.15 + output * 4.25) / 1e6 : null;
      this.logger.log('fireworks_usage', { ...fields, prompt, output, total, cached, estimatedCostUsd, priceVersion: '2026-11-04', httpStatus: response.status });
      if (!record(envelope) || envelope.model !== this.model || !Array.isArray(envelope.choices) || envelope.choices.length !== 1) throw failure('invalid_response');
      const choice: unknown = envelope.choices[0];
      if (!record(choice) || !record(choice.message)) throw failure('invalid_response');
      if (choice.finish_reason === 'content_filter' || choice.message.refusal) throw failure('refused');
      const toolCalls = choice.message.tool_calls;
      const unexpectedToolCalls = toolCalls != null && (!Array.isArray(toolCalls) || toolCalls.length > 0);
      if (choice.finish_reason !== 'stop' || choice.message.role !== 'assistant' || typeof choice.message.content !== 'string' || unexpectedToolCalls) throw failure('invalid_response');
      let result: unknown;
      try { result = JSON.parse(choice.message.content); } catch { throw failure('invalid_response'); }
      if (findSchemaViolation(MEAL_PLAN_OUTPUT_SCHEMA, result)) throw failure('invalid_response');
      const data = result as MealPlanOutput;
      if (!data.meals.length || data.meals.some(m => !m.name.trim() || m.calories_kcal <= 0 || m.protein_g < 0 || m.carbs_g < 0 || m.fat_g < 0)) throw failure('invalid_response');
      const meals: Meal[] = data.meals.map(m => ({ id: `meal_${this.createId()}` as MealId, slot: m.slot, name: m.name, description: m.description,
        ingredients: m.ingredients, portion: m.portion, caloriesKcal: m.calories_kcal, proteinG: m.protein_g, carbsG: m.carbs_g, fatG: m.fat_g }));
      const plan: MealPlan = { id: `plan_${this.createId()}` as MealPlanId, days: [{ date: input.startDate, meals, totals: sumMeals(meals) }] };
      stage = 'completed';
      this.logger.log('meal_plan_provider', { ...fields, planId: plan.id, success: true, latencyMs: Date.now() - started, ...timings() });
      return plan;
    };
    try { return await Promise.race([operation(), deadline]); }
    catch (error) {
      const safe = error instanceof AIProviderError ? error : failure(controller.signal.aborted ? 'timeout' : 'unavailable');
      this.logger.warn('meal_plan_provider', { ...fields, success: false, code: safe.code, latencyMs: Date.now() - started, ...timings(), httpStatus: httpStatus ?? safe.httpStatus ?? null });
      throw safe;
    } finally { if (timer) clearTimeout(timer); }
  }
}
