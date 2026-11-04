import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { Product } from '@foodlens/core';
import type { AnalyzeProductInput } from '../../ai-provider.types';
import { SILENT_AI_LOGGER, type AILogger } from '../../ai-logger';
import { AIProviderError, type AIProviderErrorCode } from '../../errors';
import { findSchemaViolation, objectSchema, enumSchema } from '../../json-schema/json-schema';
import { MAX_PRODUCT_IMAGES, productImages } from '../../product-images';
import { normalizeMetaProductAnalysis, ProductNotRecognizedError } from '../meta/meta-product-normalizer';
import type { MetaProductAnalysis } from '../meta/meta-product-analysis';
import { GOOGLE_PRODUCT_ANALYSIS_SCHEMA, prepareGoogleProductAnalysis, validGoogleProductQuantities, googleNutritionStatus } from '../google/google-product-analysis';
import { GOOGLE_PRODUCT_SYSTEM_PROMPT, GOOGLE_PRODUCT_USER_PROMPT, GOOGLE_PRODUCT_LABEL_PROMPT, GOOGLE_PRODUCT_MULTI_IMAGE_PROMPT } from '../google/google-product-prompt';
import { FIREWORKS_MEAL_PLAN_ENDPOINT, FIREWORKS_MEAL_PLAN_MODEL } from './fireworks-meal-plan-provider';

export const FIREWORKS_PRODUCT_MODEL = FIREWORKS_MEAL_PLAN_MODEL;
export const FIREWORKS_PRODUCT_ANALYSIS_VERSION = 'fireworks-muse-spark-product-analysis-v1';
// Same extraction schema and diagnostic fields as Gemini, expressed as native JSON Schema.
const base = GOOGLE_PRODUCT_ANALYSIS_SCHEMA;
if (!('type' in base) || base.type !== 'object') throw new Error('Product schema must be an object');
export const FIREWORKS_PRODUCT_RESPONSE_SCHEMA = objectSchema({ ...base.properties,
  nutrition_status: objectSchema(Object.fromEntries(['sugars', 'saturated_fat', 'salt'].map(key => [key, enumSchema(['observed', 'not_listed', 'unreadable'])]))),
});
export interface FireworksProductProviderConfig {
  readonly apiKey: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
  readonly logger?: AILogger;
  readonly now?: () => Date;
  readonly createId?: () => string;
}
const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const count = (x: unknown): number | null => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0 ? x : null;
const failure = (code: AIProviderErrorCode, httpStatus?: number) => new AIProviderError('fireworks', code, `Fireworks product analysis: ${code}`, { httpStatus });

/** Product photographs only. No retries, alternate models, database lookups or score calculations. */
export class FireworksProductProvider {
  readonly name = 'fireworks';
  readonly model = FIREWORKS_PRODUCT_MODEL;
  private readonly logger: AILogger;
  private readonly transport: typeof globalThis.fetch;
  private readonly id: () => string;
  constructor(private readonly config: FireworksProductProviderConfig) {
    this.logger = config.logger ?? SILENT_AI_LOGGER;
    this.transport = config.fetch ?? globalThis.fetch;
    this.id = config.createId ?? randomUUID;
  }
  async analyzeProduct(input: AnalyzeProductInput): Promise<Product> {
    const images = input.kind === 'image' ? productImages(input) : [];
    if (!images.length || images.length > MAX_PRODUCT_IMAGES || images.some(i => !['image/jpeg','image/png','image/webp'].includes(i.mimeType) || !i.base64)) throw failure('unsupported_input');
    const timeoutMs = this.config.timeoutMs ?? 60000;
    if (!this.config.apiKey.trim() || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw failure('not_configured');
    const requestId = input.requestId ?? this.id(), started = performance.now();
    const fields = { requestId, provider: this.name, model: this.model, type: 'product_analysis', numberOfImages: images.length, retries: 0 };
    let stage = 'waiting_headers', httpStatus: number | null = null, headersAt: number | null = null, bodyAt: number | null = null, bodyEnd: number | null = null;
    const timing = () => ({ stage, httpStatus, latencyMs: Math.round(performance.now() - started),
      headersMs: headersAt === null ? null : Math.round(headersAt - started), bodyMs: bodyAt === null ? null : Math.round((bodyEnd ?? performance.now()) - bodyAt) });
    const trace = (event: string) => this.logger.log('fireworks_scan_http', { ...fields, event, ...timing() });
    let validationIssue: string | null = null;
    const invalid = (reason: string) => { validationIssue = reason; return failure('invalid_response'); };
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(failure('timeout')); }, timeoutMs); });
    const operation = async (): Promise<Product> => {
      const many = images.length > 1, label = !many && images[0]?.role === 'nutrition';
      const content = [{ type: 'text', text: GOOGLE_PRODUCT_USER_PROMPT }, ...images.flatMap(image => [
        ...(many && image.role ? [{ type: 'text', text: 'Role hint: ' + image.role }] : []),
        { type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.base64}` } },
      ])];
      trace('request_started');
      const response = await this.transport(FIREWORKS_MEAL_PLAN_ENDPOINT, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { Authorization: `Bearer ${this.config.apiKey.trim()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, max_tokens: 4096, reasoning_effort: 'low', stream: false,
          messages: [{ role: 'system', content: GOOGLE_PRODUCT_SYSTEM_PROMPT + (many ? GOOGLE_PRODUCT_MULTI_IMAGE_PROMPT : label ? GOOGLE_PRODUCT_LABEL_PROMPT : '') }, { role: 'user', content }],
          response_format: { type: 'json_schema', json_schema: { name: 'product_analysis', schema: FIREWORKS_PRODUCT_RESPONSE_SCHEMA, strict: true } },
        }),
      });
      if (controller.signal.aborted) { void response.body?.cancel().catch(() => undefined); throw failure('timeout'); }
      headersAt = performance.now(); httpStatus = response.status; stage = 'checking_status'; trace('headers_received');
      if (!response.ok) {
        void response.body?.cancel().catch(() => undefined);
        const status = response.status;
        throw failure(status === 401 || status === 403 ? 'authentication_failed' : status === 429 ? 'rate_limited' : status >= 500 ? 'unavailable' : 'bad_request', status);
      }
      stage = 'reading_body'; bodyAt = performance.now(); trace('body_read_started');
      const text = await response.text();
      if (controller.signal.aborted) throw failure('timeout');
      bodyEnd = performance.now(); trace('body_read_completed'); stage = 'parsing_json';
      let envelope: unknown;
      try { envelope = JSON.parse(text); } catch { throw failure('invalid_response'); }
      const usage = record(envelope) && record(envelope.usage) ? envelope.usage : {};
      const prompt = count(usage.prompt_tokens), output = count(usage.completion_tokens), total = count(usage.total_tokens);
      const cached = record(usage.prompt_tokens_details) ? count(usage.prompt_tokens_details.cached_tokens) : null;
      const cache = prompt !== null && cached !== null && cached <= prompt ? cached : 0;
      this.logger.log('fireworks_usage', { ...fields, prompt, output, total, cached, httpStatus,
        estimatedCostUsd: prompt !== null && output !== null ? ((prompt-cache)*1.25+cache*0.15+output*4.25)/1e6 : null, priceVersion: '2026-11-04' });
      stage = 'validating_response';
      if (!record(envelope)) throw invalid('envelope_shape');
      if (envelope.model !== this.model) throw invalid('model_mismatch');
      if (!Array.isArray(envelope.choices) || envelope.choices.length !== 1) throw invalid('choice_count');
      const choice: unknown = envelope.choices[0];
      if (!record(choice) || !record(choice.message)) throw invalid('choice_shape');
      if (choice.finish_reason === 'content_filter' || choice.message.refusal) throw failure('refused');
      // An empty optional array means no tool calls, not an invalid analysis.
      const toolCalls = choice.message.tool_calls;
      const unexpectedToolCalls = toolCalls != null && (!Array.isArray(toolCalls) || toolCalls.length > 0);
      if (choice.finish_reason !== 'stop') throw invalid(choice.finish_reason === 'length' ? 'truncated' : 'finish_reason');
      if (choice.message.role !== 'assistant') throw invalid('assistant_role');
      if (typeof choice.message.content !== 'string') throw invalid('content_type');
      if (unexpectedToolCalls) throw invalid('tool_calls');
      let raw: unknown;
      try { raw = JSON.parse(choice.message.content); } catch { throw invalid('content_json'); }
      const prepared = prepareGoogleProductAnalysis(raw);
      // Log only fixed diagnostic codes, never the violation text or untrusted field names.
      if (findSchemaViolation(GOOGLE_PRODUCT_ANALYSIS_SCHEMA, prepared) !== null) throw invalid('schema_violation');
      if (!validGoogleProductQuantities(prepared as MetaProductAnalysis)) throw invalid('quantity_bounds');
      this.logger.log('nutrition_status', { requestId, ...googleNutritionStatus(raw) });
      stage = 'normalizing';
      try {
        const analyzedAt = (this.config.now?.() ?? new Date()).toISOString();
        // Existing ProductSource describes the model family; transport is explicit in version/logs.
        return normalizeMetaProductAnalysis(prepared as MetaProductAnalysis, { productId: 'scan_' + this.id(), analyzedAt,
          source: { type: 'meta_vision', provider: 'meta', analyzedAt, analysisVersion: FIREWORKS_PRODUCT_ANALYSIS_VERSION } });
      } catch (error) { throw failure(error instanceof ProductNotRecognizedError ? 'product_not_recognized' : 'normalization_failed'); }
    };
    try {
      const product = await Promise.race([operation(), deadline]); stage = 'completed';
      this.logger.log('fireworks_scan', { ...fields, success: true, ...timing() });
      return product;
    } catch (error) {
      const safe = error instanceof AIProviderError ? error : failure(controller.signal.aborted ? 'timeout' : 'unavailable');
      this.logger.warn('fireworks_scan', { ...fields, success: false, code: safe.code, validationIssue, ...timing(), httpStatus: httpStatus ?? safe.httpStatus ?? null });
      throw safe;
    } finally { if (timer) clearTimeout(timer); controller.abort(); }
  }
}
