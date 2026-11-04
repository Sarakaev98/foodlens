import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { AnalyzeMealPhotoInput } from '../../ai-provider.types';
import { SILENT_AI_LOGGER, type AILogger } from '../../ai-logger';
import { AIProviderError, type AIProviderErrorCode } from '../../errors';
import { findSchemaViolation } from '../../json-schema/json-schema';
import { MEAL_PHOTO_OUTPUT_SCHEMA, type MealPhotoAiOutput } from '../../meal-photo/meal-photo-output-schema';
import { MEAL_PHOTO_SYSTEM_PROMPT, MEAL_PHOTO_USER_PROMPT } from '../../meal-photo/meal-photo-prompt';
import { FIREWORKS_MEAL_PLAN_ENDPOINT, FIREWORKS_MEAL_PLAN_MODEL } from './fireworks-meal-plan-provider';

export const FIREWORKS_MEAL_PHOTO_MODEL = FIREWORKS_MEAL_PLAN_MODEL;
export const FIREWORKS_MEAL_PHOTO_TIMEOUT_MS = 45000;
export interface FireworksMealPhotoProviderConfig {
  readonly apiKey: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
  readonly logger?: AILogger;
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
const failure = (code: AIProviderErrorCode, httpStatus?: number) => new AIProviderError('fireworks', code, `Fireworks meal photo: ${code}`, { httpStatus });

/** One photo, one request. Reuses the established meal prompts/schema and shared Fireworks endpoint/model. */
export class FireworksMealPhotoProvider {
  readonly name = 'fireworks';
  readonly model = FIREWORKS_MEAL_PHOTO_MODEL;
  private readonly logger: AILogger;
  private readonly transport: typeof globalThis.fetch;

  constructor(private readonly config: FireworksMealPhotoProviderConfig) {
    this.logger = config.logger ?? SILENT_AI_LOGGER;
    this.transport = config.fetch ?? globalThis.fetch;
  }

  async analyzeMealPhoto({ image, requestId = randomUUID() }: AnalyzeMealPhotoInput): Promise<MealPhotoAiOutput> {
    if (!image.base64 || !['image/jpeg', 'image/png', 'image/webp'].includes(image.mimeType)) throw failure('unsupported_input');
    const timeoutMs = this.config.timeoutMs ?? FIREWORKS_MEAL_PHOTO_TIMEOUT_MS;
    if (!this.config.apiKey.trim() || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw failure('not_configured');
    const started = performance.now();
    const fields = { requestId, provider: this.name, model: this.model, type: 'meal_photo', numberOfImages: 1, retries: 0 };
    let stage = 'waiting_headers', httpStatus: number | null = null;
    let headersAt: number | null = null, bodyAt: number | null = null, bodyEnd: number | null = null;
    let validationIssue: string | null = null;
    const timing = () => ({ stage, httpStatus, latencyMs: Math.round(performance.now() - started),
      headersMs: headersAt === null ? null : Math.round(headersAt - started),
      bodyMs: bodyAt === null ? null : Math.round((bodyEnd ?? performance.now()) - bodyAt) });
    const trace = (event: string) => this.logger.log('fireworks_meal_photo_http', { ...fields, event, ...timing() });
    const invalid = (reason: string) => { validationIssue = reason; return failure('invalid_response'); };
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(failure('timeout')); }, timeoutMs);
    });
    const operation = async (): Promise<MealPhotoAiOutput> => {
      trace('request_started');
      const response = await this.transport(FIREWORKS_MEAL_PLAN_ENDPOINT, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { Authorization: `Bearer ${this.config.apiKey.trim()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model, max_tokens: 1024, reasoning_effort: 'low', stream: false,
          messages: [
            { role: 'system', content: MEAL_PHOTO_SYSTEM_PROMPT },
            { role: 'user', content: [
              { type: 'text', text: MEAL_PHOTO_USER_PROMPT },
              { type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.base64}` } },
            ] },
          ],
          response_format: { type: 'json_schema', json_schema: { name: 'meal_photo', schema: MEAL_PHOTO_OUTPUT_SCHEMA, strict: true } },
        }),
      });
      if (controller.signal.aborted) { void response.body?.cancel().catch(() => undefined); throw failure('timeout'); }
      headersAt = performance.now(); httpStatus = response.status; stage = 'checking_status'; trace('headers_received');
      if (!response.ok) {
        void response.body?.cancel().catch(() => undefined);
        throw failure(httpStatus === 401 || httpStatus === 403 ? 'authentication_failed' : httpStatus === 429 ? 'rate_limited' : httpStatus >= 500 ? 'unavailable' : 'bad_request', httpStatus);
      }
      stage = 'reading_body'; bodyAt = performance.now(); trace('body_read_started');
      const text = await response.text();
      if (controller.signal.aborted) throw failure('timeout');
      bodyEnd = performance.now(); trace('body_read_completed'); stage = 'parsing_json';
      let envelope: unknown;
      try { envelope = JSON.parse(text); } catch { throw invalid('envelope_json'); }
      const usage = record(envelope) && record(envelope.usage) ? envelope.usage : {};
      const prompt = count(usage.prompt_tokens), output = count(usage.completion_tokens), total = count(usage.total_tokens);
      const cached = record(usage.prompt_tokens_details) ? count(usage.prompt_tokens_details.cached_tokens) : null;
      const cache = prompt !== null && cached !== null && cached <= prompt ? cached : 0;
      this.logger.log('fireworks_usage', { ...fields, httpStatus, prompt, output, total, cached,
        estimatedCostUsd: prompt !== null && output !== null ? ((prompt - cache) * 1.25 + cache * 0.15 + output * 4.25) / 1e6 : null,
        priceVersion: '2026-11-04' });
      stage = 'validating_response';
      if (!record(envelope)) throw invalid('envelope_shape');
      if (envelope.model !== this.model) throw invalid('model_mismatch');
      if (!Array.isArray(envelope.choices) || envelope.choices.length !== 1) throw invalid('choice_count');
      const choice: unknown = envelope.choices[0];
      if (!record(choice) || !record(choice.message)) throw invalid('choice_shape');
      const message = choice.message;
      if (choice.finish_reason === 'content_filter' || message.refusal) throw failure('refused');
      if (choice.finish_reason !== 'stop') throw invalid(choice.finish_reason === 'length' ? 'truncated' : 'finish_reason');
      if (message.role !== 'assistant' || typeof message.content !== 'string') throw invalid('assistant_content');
      if (message.tool_calls != null && (!Array.isArray(message.tool_calls) || message.tool_calls.length > 0)) throw invalid('tool_calls');
      let raw: unknown;
      try { raw = JSON.parse(message.content); } catch { throw invalid('content_json'); }
      if (findSchemaViolation(MEAL_PHOTO_OUTPUT_SCHEMA, raw) !== null) throw invalid('schema_violation');
      // Existing normalizeMealPhotoEstimate remains responsible for quantities and calculated totals.
      return raw as MealPhotoAiOutput;
    };
    try {
      const output = await Promise.race([operation(), deadline]);
      stage = 'completed';
      this.logger.log('fireworks_meal_photo', { ...fields, success: true, ...timing() });
      return output;
    } catch (error) {
      const safe = error instanceof AIProviderError ? error : failure(controller.signal.aborted ? 'timeout' : 'unavailable');
      this.logger.warn('fireworks_meal_photo', { ...fields, success: false, code: safe.code, validationIssue, ...timing() });
      throw safe;
    } finally {
      clearTimeout(timer); controller.abort();
    }
  }
}
