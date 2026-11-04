import { randomUUID } from 'node:crypto';
import type { Product, GoalMatchAiInput, GoalMatchAiOutput, MealPlan } from '@foodlens/core';
import type { AIProvider } from '../../ai-provider';
import type { AnalyzeMealPhotoInput, AnalyzeProductInput, GenerateMealPlanInput, ProductImageInput } from '../../ai-provider.types';
import { SILENT_AI_LOGGER, type AILogger } from '../../ai-logger';
import { AIProviderError, AIMethodNotImplementedError, type AIProviderErrorCode } from '../../errors';
import { findSchemaViolation } from '../../json-schema/json-schema';
import { MAX_PRODUCT_IMAGES, productImages } from '../../product-images';
import { normalizeMetaProductAnalysis, ProductNotRecognizedError } from '../meta/meta-product-normalizer';
import type { MetaProductAnalysis } from '../meta/meta-product-analysis';
import { GoogleGoalMatchProvider, type GoogleGoalMatchProviderConfig } from './google-goal-match-provider';
import {
  GOOGLE_PRODUCT_ANALYSIS_SCHEMA,
  GOOGLE_PRODUCT_ANALYSIS_VERSION,
  googleNutritionStatus,
  prepareGoogleProductAnalysis,
  validGoogleProductQuantities,
  googleProductResponseSchema,
} from './google-product-analysis';
import {
  GOOGLE_PRODUCT_LABEL_PROMPT,
  GOOGLE_PRODUCT_MULTI_IMAGE_PROMPT,
  GOOGLE_PRODUCT_SYSTEM_PROMPT,
  GOOGLE_PRODUCT_USER_PROMPT,
} from './google-product-prompt';
import { GoogleMealPlanProvider } from './google-meal-plan-provider';
import { GoogleMealPhotoProvider } from './google-meal-photo-provider';
import type { MealPhotoAiOutput } from '../../meal-photo/meal-photo-output-schema';
import { logGeminiUsage } from './gemini-usage';

export const GOOGLE_PRODUCT_TIMEOUT_MS = 60000;
export interface GoogleProviderConfig extends GoogleGoalMatchProviderConfig {
  /** Product image extraction has its own deadline; timeoutMs still belongs to Goal Match. */
  readonly productTimeoutMs?: number;
  readonly logger?: AILogger;
  readonly now?: () => Date;
  readonly createId?: () => string;
}
const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const message = (code: AIProviderErrorCode) => 'Google product analysis: ' + code;

/** Real multimodal extraction; the second evaluator delegates to the existing text-only provider. */
export class GoogleProvider implements AIProvider {
  readonly name = 'google';
  readonly model: string;
  readonly #key: string;
  readonly #project: string;
  readonly #location: string;
  readonly #transport: typeof globalThis.fetch;
  readonly #timeoutMs: number;
  readonly #logger: AILogger;
  readonly #now: () => Date;
  readonly #id: () => string;
  readonly #evaluator: GoogleGoalMatchProvider;
  readonly #mealPlans: GoogleMealPlanProvider;
  readonly #mealPhotos: GoogleMealPhotoProvider;
  constructor(config: GoogleProviderConfig) {
    this.#evaluator = new GoogleGoalMatchProvider(config);
    this.model = this.#evaluator.model;
    this.#project = this.#evaluator.project;
    this.#location = this.#evaluator.location;
    this.#key = config.apiKey?.trim() ?? '';
    this.#transport = config.fetch ?? globalThis.fetch;
    this.#timeoutMs = config.productTimeoutMs ?? GOOGLE_PRODUCT_TIMEOUT_MS;
    this.#logger = config.logger ?? SILENT_AI_LOGGER;
    this.#now = config.now ?? (() => new Date());
    this.#id = config.createId ?? randomUUID;
    this.#mealPlans = new GoogleMealPlanProvider({
      apiKey: this.#key,
      project: this.#project,
      location: this.#location,
      model: this.model,
      fetch: this.#transport,
      logger: this.#logger,
      createId: this.#id,
    });
    this.#mealPhotos = new GoogleMealPhotoProvider({
      apiKey: this.#key,
      project: this.#project,
      location: this.#location,
      model: this.model,
      fetch: this.#transport,
      logger: this.#logger,
    });
  }
  async analyzeProduct(input: AnalyzeProductInput): Promise<Product> {
    const images = input.kind === 'image' ? productImages(input) : [];
    if (
      images.length < 1 ||
      images.length > MAX_PRODUCT_IMAGES ||
      images.some((x) => !['image/jpeg', 'image/png', 'image/webp'].includes(x.mimeType) || !x.base64)
    )
      throw new AIProviderError(this.name, 'unsupported_input', message('unsupported_input'));
    if (
      !this.#key ||
      !this.#project ||
      !/^[a-zA-Z0-9-]+$/u.test(this.#project) ||
      !/^[a-zA-Z0-9-]+$/u.test(this.#location) ||
      !/^[a-zA-Z0-9._-]+$/u.test(this.model) ||
      !Number.isFinite(this.#timeoutMs) ||
      this.#timeoutMs <= 0
    )
      throw new AIProviderError(this.name, 'not_configured', message('not_configured'));
    const started = Date.now(),
      controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new AIProviderError(this.name, 'timeout', message('timeout')));
      }, this.#timeoutMs);
    });
    try {
      const product = await Promise.race([this.requestProduct(images, input.requestId, controller.signal), deadline]);
      this.#logger.log('google request', {
        provider: this.name,
        model: this.model,
        requestType: 'product_analysis',
        success: true,
        latencyMs: Date.now() - started,
      });
      return product;
    } catch (error) {
      const code = error instanceof AIProviderError ? error.code : controller.signal.aborted ? 'timeout' : 'unavailable';
      const httpStatus = error instanceof AIProviderError ? error.httpStatus : undefined;
      this.#logger.warn('google request', {
        provider: this.name,
        model: this.model,
        requestType: 'product_analysis',
        success: false,
        latencyMs: Date.now() - started,
        code,
        httpStatus,
      });
      throw new AIProviderError(this.name, code, message(code), { httpStatus });
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
  /** All images share one generateContent call. One image keeps the request exactly as it was. */
  private async requestProduct(images: readonly ProductImageInput[], requestId: string | undefined, signal: AbortSignal): Promise<Product> {
    const many = images.length > 1,
      label = !many && images[0]?.role === 'nutrition';
    const imageParts = images.flatMap((image) => [
      ...(many && image.role ? [{ text: 'Role hint: ' + image.role }] : []),
      { inlineData: { mimeType: image.mimeType, data: image.base64 } },
    ]);
    const url =
      'https://aiplatform.googleapis.com/v1/projects/' +
      encodeURIComponent(this.#project) +
      '/locations/' +
      encodeURIComponent(this.#location) +
      '/publishers/google/models/' +
      encodeURIComponent(this.model) +
      ':generateContent';
    const response = await this.#transport(url, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.#key },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: GOOGLE_PRODUCT_SYSTEM_PROMPT + (many ? GOOGLE_PRODUCT_MULTI_IMAGE_PROMPT : label ? GOOGLE_PRODUCT_LABEL_PROMPT : '') }],
        },
        contents: [{ role: 'user', parts: [{ text: GOOGLE_PRODUCT_USER_PROMPT }, ...imageParts] }],
        generationConfig: {
          ...(this.model.startsWith('gemini-3.5-flash-lite')
            ? { thinkingConfig: { thinkingLevel: 'MINIMAL' } }
            : { temperature: 0, thinkingConfig: { thinkingBudget: 0 } }),
          responseMimeType: 'application/json',
          responseSchema: googleProductResponseSchema(),
          maxOutputTokens: 4096,
        },
      }),
    });
    if (signal.aborted) {
      void response.body?.cancel().catch(() => undefined);
      throw new AIProviderError(this.name, 'timeout', message('timeout'));
    }
    if (!response.ok) {
      const status = response.status,
        code: AIProviderErrorCode =
          status === 401 || status === 403 ? 'authentication_failed' : status === 429 ? 'rate_limited' : status >= 500 ? 'unavailable' : 'bad_request';
      void response.body?.cancel().catch(() => undefined);
      throw new AIProviderError(this.name, code, message(code), { httpStatus: status });
    }
    let envelope: unknown;
    try {
      envelope = await response.json();
    } catch {
      const code = signal.aborted ? 'timeout' : 'invalid_response';
      throw new AIProviderError(this.name, code, message(code));
    }
    if (signal.aborted) throw new AIProviderError(this.name, 'timeout', message('timeout'));
    logGeminiUsage(this.#logger, 'product_analysis', this.model, envelope, images.length);
    const candidate = record(envelope) && Array.isArray(envelope.candidates) ? envelope.candidates[0] : null;
    if (!record(candidate) || candidate.finishReason !== 'STOP') throw new AIProviderError(this.name, 'invalid_response', message('invalid_response'));
    const content = record(candidate.content) ? candidate.content : null,
      parts = content && Array.isArray(content.parts) ? content.parts : [];
    const text = parts
      .filter((p) => record(p) && typeof p.text === 'string' && p.thought !== true)
      .map((p) => (p as Record<string, unknown>).text)
      .join('');
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new AIProviderError(this.name, 'invalid_response', message('invalid_response'));
    }
    const prepared = prepareGoogleProductAnalysis(raw);
    if (findSchemaViolation(GOOGLE_PRODUCT_ANALYSIS_SCHEMA, prepared) !== null || !validGoogleProductQuantities(prepared as MetaProductAnalysis))
      throw new AIProviderError(this.name, 'invalid_response', message('invalid_response'));
    this.#logger.log('nutrition_status', { requestId, ...googleNutritionStatus(raw) });
    try {
      const analyzedAt = this.#now().toISOString();
      return normalizeMetaProductAnalysis(prepared as MetaProductAnalysis, {
        productId: 'scan_' + this.#id(),
        analyzedAt,
        source: { type: 'google_vision', provider: 'google', analyzedAt, analysisVersion: GOOGLE_PRODUCT_ANALYSIS_VERSION },
      });
    } catch (error) {
      const code = error instanceof ProductNotRecognizedError ? 'product_not_recognized' : 'normalization_failed';
      throw new AIProviderError(this.name, code, message(code));
    }
  }
  evaluateGoalMatch(input: GoalMatchAiInput): Promise<GoalMatchAiOutput> {
    return this.#evaluator.evaluateGoalMatch(input);
  }
  analyzeMealPhoto(input: AnalyzeMealPhotoInput): Promise<MealPhotoAiOutput> {
    return this.#mealPhotos.analyze(input);
  }
  async explainProduct(): Promise<never> {
    throw new AIMethodNotImplementedError(this.name, 'explainProduct');
  }
  generateMealPlan(input: GenerateMealPlanInput): Promise<MealPlan> {
    return this.#mealPlans.generate(input);
  }
  async replaceMeal(): Promise<never> {
    throw new AIMethodNotImplementedError(this.name, 'replaceMeal');
  }
}
