import { FireworksProductProvider, GoogleProvider, type AIProvider } from '@foodlens/ai';
import type { AppConfig } from '../../config/app-config';
import { nestLogger } from '../ai/ai-provider.factory';

export const SCAN_AI_PROVIDER = Symbol('SCAN_AI_PROVIDER');
export const LABEL_SCAN_AI_PROVIDER = Symbol('LABEL_SCAN_AI_PROVIDER');
export type ProductAnalyzer = Pick<AIProvider, 'analyzeProduct'> & { readonly name?: string; readonly model?: string };

/** Independent from Meal Plan, meal photos and the Goal Match evaluator. No fallback. */
export function createScanAIProvider(config: AppConfig): ProductAnalyzer {
  if (config.scanAi.provider === 'fireworks') return new FireworksProductProvider({
    apiKey: config.scanAi.fireworksApiKey, timeoutMs: config.scanAi.timeoutMs, logger: nestLogger('FireworksProduct'),
  });
  return new GoogleProvider({ ...config.goalMatchAi.google, logger: nestLogger('GoogleProduct') });
}


/** Label uses an explicit independent configuration; provider errors never switch models. */
export function createLabelScanAIProvider(config: AppConfig): ProductAnalyzer {
  return createScanAIProvider({ ...config, scanAi: { ...config.scanAi, provider: config.labelAi.provider } });
}
