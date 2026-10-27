import { Logger } from '@nestjs/common';
import { MetaProvider, type AILogger, type AIProvider } from '@foodlens/ai';
import type { AppConfig } from '../../config/app-config';

/** Единственное место, где выбирается конкретный AI-провайдер. */
export function createAIProvider(config: AppConfig): AIProvider {
  switch (config.ai.provider) {
    case 'meta':
      return new MetaProvider({
        apiKey: config.ai.modelApiKey,
        model: config.ai.model,
        timeoutMs: config.ai.timeoutMs,
        logger: nestLogger('MetaProvider'),
      });
  }
}

/** Поля пишутся как JSON в одну строку: их удобно искать по requestId. */
function nestLogger(context: string): AILogger {
  const logger = new Logger(context);
  return {
    log: (message, fields) => logger.log(`${message} ${JSON.stringify(fields)}`),
    warn: (message, fields) => logger.warn(`${message} ${JSON.stringify(fields)}`),
  };
}
