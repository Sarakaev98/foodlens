import type { AIProviderMethod } from './ai-provider';

/**
 * Машинный код ошибки провайдера. По нему API выбирает HTTP-статус,
 * а mobile показывает понятное сообщение. Тексты от провайдера наружу не уходят.
 */
export type AIProviderErrorCode =
  | 'not_configured'
  | 'authentication_failed'
  | 'quota_exceeded'
  | 'rate_limited'
  | 'timeout'
  | 'unavailable'
  | 'bad_request'
  | 'invalid_response'
  | 'refused'
  | 'product_not_recognized'
  | 'normalization_failed'
  | 'unsupported_input'
  | 'not_implemented';

export class AIProviderError extends Error {
  constructor(
    readonly provider: string,
    readonly code: AIProviderErrorCode,
    message: string,
    options?: ErrorOptions & { readonly httpStatus?: number },
  ) {
    super(`[${provider}] ${message}`, options);
    this.name = 'AIProviderError';
    this.httpStatus = options?.httpStatus;
  }

  /** HTTP-статус ответа провайдера, если ошибка пришла от него. */
  readonly httpStatus: number | undefined;
}

/** Метод провайдера ещё не реализован. Явная ошибка вместо фейковых ответов. */
export class AIMethodNotImplementedError extends AIProviderError {
  constructor(provider: string, method: AIProviderMethod) {
    super(provider, 'not_implemented', `${method} is not implemented yet`);
    this.name = 'AIMethodNotImplementedError';
  }
}
