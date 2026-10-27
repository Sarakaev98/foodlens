import { randomUUID } from 'node:crypto';
import type { Product } from '@foodlens/core';
import type { AIProvider } from '../../ai-provider';
import type { AnalyzeProductInput } from '../../ai-provider.types';
import { SILENT_AI_LOGGER, type AILogger } from '../../ai-logger';
import { AIMethodNotImplementedError, AIProviderError } from '../../errors';
import { findSchemaViolation } from '../../json-schema/json-schema';
import { MetaChatClient } from './meta-chat-client';
import { META_PRODUCT_ANALYSIS_SCHEMA, type MetaProductAnalysis } from './meta-product-analysis';
import { normalizeMetaProductAnalysis, ProductNotRecognizedError } from './meta-product-normalizer';
import { META_PRODUCT_SYSTEM_PROMPT, META_PRODUCT_USER_PROMPT } from './meta-product-prompt';

export const META_DEFAULT_BASE_URL = 'https://api.meta.ai/v1';
export const META_DEFAULT_MODEL = 'muse-spark-1.3';

export interface MetaProviderConfig {
  /** Ключ Meta Model API. Пустой ключ не мешает запуску API, но анализ вернёт not_configured. */
  readonly apiKey: string;
  readonly model?: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly maxAttempts?: number;
  readonly retryBaseDelayMs?: number;
  readonly logger?: AILogger;
  /** Подменяются в unit tests. */
  readonly fetch?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => Date;
  readonly createId?: () => string;
}

/**
 * Провайдер Meta. Цепочка analyzeProduct:
 * изображение → Meta Chat Completions (strict JSON Schema) → проверка схемы → нормализатор → Product.
 * Название модели остаётся внутри провайдера и в Product не попадает.
 */
export class MetaProvider implements AIProvider {
  readonly name = 'meta';
  readonly model: string;

  private readonly logger: AILogger;
  private readonly client: MetaChatClient;
  private readonly now: () => Date;
  private readonly createId: () => string;

  constructor(private readonly config: MetaProviderConfig) {
    this.model = config.model ?? META_DEFAULT_MODEL;
    this.logger = config.logger ?? SILENT_AI_LOGGER;
    this.now = config.now ?? (() => new Date());
    this.createId = config.createId ?? randomUUID;
    this.client = new MetaChatClient({
      apiKey: config.apiKey,
      baseUrl: (config.baseUrl ?? META_DEFAULT_BASE_URL).replace(/\/+$/, ''),
      model: this.model,
      timeoutMs: config.timeoutMs ?? 60_000,
      maxAttempts: config.maxAttempts ?? 3,
      retryBaseDelayMs: config.retryBaseDelayMs ?? 1_000,
      fetch: config.fetch ?? fetch,
      sleep: config.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
      logger: this.logger,
    });
  }

  async analyzeProduct(input: AnalyzeProductInput): Promise<Product> {
    if (input.kind !== 'image') {
      throw new AIProviderError(this.name, 'unsupported_input', `Input kind "${input.kind}" is not supported`);
    }
    const requestId = input.requestId ?? this.createId();
    if (!this.config.apiKey) {
      throw new AIProviderError(this.name, 'not_configured', 'MODEL_API_KEY is not set');
    }

    const startedAt = Date.now();
    const fields = { requestId, provider: this.name, model: this.model };
    this.logger.log('product analysis started', { ...fields, imageBytes: Math.floor((input.image.base64.length * 3) / 4) });

    try {
      const response = await this.client.completeStructured({
        requestId,
        systemPrompt: META_PRODUCT_SYSTEM_PROMPT,
        userPrompt: META_PRODUCT_USER_PROMPT,
        image: input.image,
        schemaName: 'meta_product_analysis',
        schema: META_PRODUCT_ANALYSIS_SCHEMA,
        maxCompletionTokens: 4_096,
      });

      const violation = findSchemaViolation(META_PRODUCT_ANALYSIS_SCHEMA, response.content);
      if (violation) throw new AIProviderError(this.name, 'invalid_response', `Schema mismatch at ${violation}`);

      const product = this.normalize(response.content as MetaProductAnalysis);
      this.logger.log('product analysis finished', {
        ...fields,
        status: 'ok',
        durationMs: Date.now() - startedAt,
        attempts: response.attempts,
        metaResponseId: response.responseId,
        confidence: product.confidence.overall,
      });
      return product;
    } catch (error) {
      const failure = error instanceof AIProviderError ? error : new AIProviderError(this.name, 'unavailable', 'Unexpected error', { cause: error });
      this.logger.warn('product analysis failed', {
        ...fields,
        status: 'error',
        code: failure.code,
        httpStatus: failure.httpStatus,
        durationMs: Date.now() - startedAt,
      });
      throw failure;
    }
  }

  private normalize(analysis: MetaProductAnalysis): Product {
    try {
      return normalizeMetaProductAnalysis(analysis, {
        productId: `scan_${this.createId()}`,
        analyzedAt: this.now().toISOString(),
      });
    } catch (error) {
      if (error instanceof ProductNotRecognizedError) {
        throw new AIProviderError(this.name, 'product_not_recognized', error.message);
      }
      throw new AIProviderError(this.name, 'normalization_failed', 'Could not normalize provider response', { cause: error });
    }
  }

  async explainProduct(): Promise<never> {
    throw new AIMethodNotImplementedError(this.name, 'explainProduct');
  }

  async generateMealPlan(): Promise<never> {
    throw new AIMethodNotImplementedError(this.name, 'generateMealPlan');
  }

  async replaceMeal(): Promise<never> {
    throw new AIMethodNotImplementedError(this.name, 'replaceMeal');
  }
}
