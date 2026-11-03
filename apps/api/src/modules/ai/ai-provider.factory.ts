import { Logger } from '@nestjs/common';
import { GoogleProvider, GoogleGoalMatchProvider, type GoalMatchEvaluator, MetaProvider, MockProvider, type AILogger, type AIProvider, type MockProviderConfig } from '@foodlens/ai';
import type { AppConfig } from '../../config/app-config';

/** iPhone visual check: chips golden data with protein missing, matching the existing v3 missing_nutrients regression. */
const CHIPS_VISUAL_TEST_ANALYSIS: NonNullable<MockProviderConfig['analysis']> = {
  image: { is_food_product: true, quality: 'clear', visible_sections: ['nutrition_table', 'ingredients_list'] },
  identity: {
    name: { value: 'Чипсы', evidence: 'visible_text' },
    brand: { value: null, evidence: 'not_visible' },
    category: { value: 'snack', evidence: 'visual_inference' },
  },
  nutrition_table: {
    visible: true, basis: 'per_100g', serving_size: { amount: 30, unit: 'g' },
    energy_kcal: 536, energy_kj: null,
    protein_g: null, fat_g: 34, carbohydrates_g: 53, sugars_g: 0.6,
    saturated_fat_g: 3.1, salt_g: 1.4, fiber_g: 4.4,
    sodium: { amount: null, unit: null },
  },
  ingredients: { visible: true, items: [
    { name: 'картофель', percent: null },
    { name: 'растительное масло', percent: null },
    { name: 'соль', percent: null },
    { name: 'сахар', percent: null },
    { name: 'ароматизатор', percent: null },
  ] },
  allergens: { statement_visible: true, items: [] },
  additives: [],
  confidence: { overall: 'high', identity: 'high', nutrition: 'high', ingredients: 'high' },
  semantics: {
    version: 'semantics-v1',
    sugarSource: { value: 'added', confidence: 'high', evidence: ['сахар'] },
    processing: { value: 'ultra_processed', confidence: 'high', evidence: ['ароматизатор'] },
    productForm: { value: 'food', confidence: 'high' },
    typicalServing: null,
  },
};

/** Единственное место, где выбирается конкретный AI-провайдер. */
export function createAIProvider(config: AppConfig): AIProvider {
  switch (config.ai.provider) {
    case 'google':
      return new GoogleProvider({ ...config.goalMatchAi.google, logger: nestLogger('GoogleProduct') });
    case 'meta':
      return new MetaProvider({
        apiKey: config.ai.modelApiKey,
        model: config.ai.model,
        timeoutMs: config.ai.timeoutMs,
        logger: nestLogger('MetaProvider'),
      });
    case 'mock':
      // Только при явном AI_PROVIDER=mock: при AI_PROVIDER=meta без ключа подмены нет, остаётся AI_NOT_CONFIGURED.
      new Logger('AIProvider').warn('AI_PROVIDER=mock: scans return a fixed demo product, Meta is not called');
      return new MockProvider({ logger: nestLogger('MockProvider'), analysis: CHIPS_VISUAL_TEST_ANALYSIS });
  }
}

/**
 * Провайдер для второго AI-вызова Goal Match v4 (eat_healthier). null: GOAL_MATCH_AI=off, вызова нет.
 * Выбирается отдельно от AI_PROVIDER: mock-оценку можно включить при настоящем распознавании и наоборот.
 */
export function createGoalMatchAIProvider(config: AppConfig): GoalMatchEvaluator | null {
  switch (config.goalMatchAi.mode) {
    case 'off':
      return null;
    case 'mock':
      new Logger('AIProvider').warn('GOAL_MATCH_AI=mock: eat_healthier Goal Match uses recorded AI answers, Meta is not called');
      return new MockProvider({ logger: nestLogger('MockGoalMatch') });
    case 'google':
      return new GoogleGoalMatchProvider({ ...config.goalMatchAi.google, logger: nestLogger('GoogleGoalMatch') });
    case 'meta':
      // Зарезервировано: evaluateGoalMatch у MetaProvider пока не отправляет запрос и всегда уводит в fallback.
      new Logger('AIProvider').warn('GOAL_MATCH_AI=meta is reserved: Meta is not called, Goal Match uses the deterministic fallback');
      return new MetaProvider({
        apiKey: config.ai.modelApiKey,
        model: config.ai.model,
        timeoutMs: config.ai.timeoutMs,
        logger: nestLogger('MetaProvider'),
      });
  }
}

/** Поля пишутся как JSON в одну строку: их удобно искать по requestId. */
export function nestLogger(context: string): AILogger {
  const logger = new Logger(context);
  return {
    log: (message, fields) => logger.log(`${message} ${JSON.stringify(fields)}`),
    warn: (message, fields) => logger.warn(`${message} ${JSON.stringify(fields)}`),
  };
}
