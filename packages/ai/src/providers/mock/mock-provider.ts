import { randomUUID } from 'node:crypto';
import type { GoalMatchAiInput, GoalMatchAiOutput, MealPlan, Product } from '@foodlens/core';
import type { AIProvider } from '../../ai-provider';
import type { AnalyzeProductInput, GenerateMealPlanInput } from '../../ai-provider.types';
import { SILENT_AI_LOGGER, type AILogger } from '../../ai-logger';
import { AIMethodNotImplementedError, AIProviderError, AIUnavailableError } from '../../errors';
import { findSchemaViolation } from '../../json-schema/json-schema';
import { META_PRODUCT_ANALYSIS_SCHEMA, type MetaProductAnalysis } from '../meta/meta-product-analysis';
import { normalizeMetaProductAnalysis, ProductNotRecognizedError } from '../meta/meta-product-normalizer';
import { mockMealPlan } from './mock-meal-plan';
import { MOCK_META_PRODUCT_ANALYSIS } from './mock-product-analysis';
import { prepareMetaProductAnalysis } from '../meta/meta-product-semantics';
import { findMockGoalMatchRecording, MOCK_GOAL_MATCH_MODEL, MOCK_GOAL_MATCH_RECORDINGS, type MockGoalMatchRecording } from './mock-goal-match';

export interface MockProviderConfig {
  /** Ответ «модели» в формате Meta. По умолчанию фикстура йогурта из mock-product-analysis. */
  readonly analysis?: MetaProductAnalysis;
  /** Записанные ответы Goal Match AI. По умолчанию MOCK_GOAL_MATCH_RECORDINGS; в тестах подменяются сценариями. */
  readonly goalMatchRecordings?: readonly MockGoalMatchRecording[];
  readonly logger?: AILogger;
  /** Подменяются в unit tests. */
  readonly now?: () => Date;
  readonly createId?: () => string;
}

/**
 * Провайдер для локальной разработки без MODEL_API_KEY. Включается только явно: AI_PROVIDER=mock.
 * Фото не анализируется: всегда берётся один и тот же ответ в формате Meta, который проходит
 * ту же проверку схемы и тот же нормализатор, что и настоящий ответ, и превращается в core Product.
 */
export class MockProvider implements AIProvider {
  readonly name = 'mock';
  /** Для ключа кэша Goal Match AI. */
  readonly model = MOCK_GOAL_MATCH_MODEL;

  private readonly analysis: MetaProductAnalysis;
  private readonly goalMatchRecordings: readonly MockGoalMatchRecording[];
  private readonly goalMatchCalls = new Map<string, number>();
  private readonly logger: AILogger;
  private readonly now: () => Date;
  private readonly createId: () => string;

  constructor(config: MockProviderConfig = {}) {
    this.analysis = config.analysis ?? MOCK_META_PRODUCT_ANALYSIS;
    this.goalMatchRecordings = config.goalMatchRecordings ?? MOCK_GOAL_MATCH_RECORDINGS;
    this.logger = config.logger ?? SILENT_AI_LOGGER;
    this.now = config.now ?? (() => new Date());
    this.createId = config.createId ?? randomUUID;
  }

  async analyzeProduct(input: AnalyzeProductInput): Promise<Product> {
    if (input.kind !== 'image') {
      throw new AIProviderError(this.name, 'unsupported_input', `Input kind "${input.kind}" is not supported`);
    }
    const requestId = input.requestId ?? this.createId();

    const analysis = prepareMetaProductAnalysis(this.analysis);
    const violation = findSchemaViolation(META_PRODUCT_ANALYSIS_SCHEMA, analysis);
    if (violation) throw new AIProviderError(this.name, 'invalid_response', `Schema mismatch at ${violation}`);

    try {
      const product = normalizeMetaProductAnalysis(analysis as MetaProductAnalysis, {
        productId: `scan_${this.createId()}`,
        analyzedAt: this.now().toISOString(),
      });
      this.logger.log('mock product analysis finished', { requestId, provider: this.name, status: 'ok' });
      return product;
    } catch (error) {
      if (error instanceof ProductNotRecognizedError) {
        throw new AIProviderError(this.name, 'product_not_recognized', error.message);
      }
      throw new AIProviderError(this.name, 'normalization_failed', 'Could not normalize mock response', { cause: error });
    }
  }

  /**
   * Детерминированный mock: возвращает записанный ответ для узнанного демо-продукта. v3 не вычисляется.
   * Неизвестный продукт: AIUnavailableError (без случайной оценки), Goal Match переходит на расчётный fallback.
   */
  async evaluateGoalMatch(input: GoalMatchAiInput): Promise<GoalMatchAiOutput> {
    const recording = findMockGoalMatchRecording(input, this.goalMatchRecordings);
    if (!recording) {
      this.logger.log('mock goal match: no recording', { provider: this.name, status: 'unavailable' });
      throw new AIUnavailableError(this.name, 'No recorded goal match response for this product');
    }
    const call = this.goalMatchCalls.get(recording.id) ?? 0;
    this.goalMatchCalls.set(recording.id, call + 1);
    this.logger.log('mock goal match finished', { provider: this.name, recording: recording.id, call: call + 1, status: 'ok' });
    return recording.responses[Math.min(call, recording.responses.length - 1)]!;
  }

  async explainProduct(): Promise<never> {
    throw new AIMethodNotImplementedError(this.name, 'explainProduct');
  }

  async generateMealPlan(input: GenerateMealPlanInput): Promise<MealPlan> {
    return mockMealPlan(input, this.createId);
  }

  async replaceMeal(): Promise<never> {
    throw new AIMethodNotImplementedError(this.name, 'replaceMeal');
  }
}
