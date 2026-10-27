import { MetaProvider, type AIProvider } from '@foodlens/ai';
import type { AppConfig } from '../../config/app-config';

/** Единственное место, где выбирается конкретный AI-провайдер. */
export function createAIProvider(config: AppConfig): AIProvider {
  switch (config.ai.provider) {
    case 'meta':
      return new MetaProvider({ apiKey: config.ai.metaApiKey });
  }
}
