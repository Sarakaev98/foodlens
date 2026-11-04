import { FireworksProductTextAI, type GoogleNutritionSearch } from '@foodlens/ai';
import type { AppConfig } from '../../config/app-config';
import { createGoogleTextAI, nestLogger } from '../ai/ai-provider.factory';

export const LABEL_TEXT_AI = Symbol('LABEL_TEXT_AI');
export type LabelTranslator = Pick<GoogleNutritionSearch, 'translateIngredients'>;

/** Label translation follows Label selection, independently of Product and legacy AI_PROVIDER. */
export function createLabelTextAI(config: AppConfig): LabelTranslator {
  if (config.labelAi.provider === 'fireworks') {
    return new FireworksProductTextAI({
      apiKey: config.scanAi.fireworksApiKey,
      logger: nestLogger('FireworksLabelText'),
    });
  }
  return createGoogleTextAI(config);
}
