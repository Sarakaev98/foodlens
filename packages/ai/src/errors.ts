import type { AIProviderMethod } from './ai-provider';

export class AIProviderError extends Error {
  constructor(
    readonly provider: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(`[${provider}] ${message}`, options);
    this.name = 'AIProviderError';
  }
}

/** Метод провайдера ещё не реализован. Явная ошибка вместо фейковых ответов. */
export class AIMethodNotImplementedError extends AIProviderError {
  constructor(provider: string, method: AIProviderMethod) {
    super(provider, `${method} is not implemented yet`);
    this.name = 'AIMethodNotImplementedError';
  }
}
