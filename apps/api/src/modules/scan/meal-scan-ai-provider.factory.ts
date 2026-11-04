import { FireworksMealPhotoProvider, GoogleProvider, type AIProvider } from '@foodlens/ai';
import type { AppConfig } from '../../config/app-config';
import { createAIProvider, nestLogger } from '../ai/ai-provider.factory';

export const MEAL_SCAN_AI_PROVIDER = Symbol('MEAL_SCAN_AI_PROVIDER');
export type MealScanAnalyzer = Pick<AIProvider, 'name' | 'analyzeMealPhoto'> & { readonly model?: string };

export function createMealScanAIProvider(config: AppConfig): MealScanAnalyzer {
  if (config.mealScanAi.provider === 'fireworks') {
    return new FireworksMealPhotoProvider({ apiKey: config.mealScanAi.fireworksApiKey,
      timeoutMs: config.mealScanAi.timeoutMs, logger: nestLogger('FireworksMealPhoto') });
  }
  if (config.mealScanAi.provider === 'google') {
    return new GoogleProvider({ ...config.goalMatchAi.google, logger: nestLogger('GoogleMealPhoto') });
  }
  // No explicit new setting: preserve the original AI_PROVIDER selection, including development mocks.
  return createAIProvider(config);
}
