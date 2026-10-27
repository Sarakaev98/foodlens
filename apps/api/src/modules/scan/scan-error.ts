import type { AIProviderErrorCode } from '@foodlens/ai';

/** Коды ошибок сканирования, которые видит клиент. Mobile показывает по ним свой текст. */
export type ScanErrorCode =
  | 'IMAGE_MISSING'
  | 'IMAGE_UNSUPPORTED_TYPE'
  | 'IMAGE_TOO_LARGE'
  | 'IMAGE_INVALID'
  | 'AI_NOT_CONFIGURED'
  | 'AI_AUTH_FAILED'
  | 'AI_QUOTA_EXCEEDED'
  | 'AI_RATE_LIMITED'
  | 'AI_TIMEOUT'
  | 'AI_UNAVAILABLE'
  | 'AI_BAD_RESPONSE'
  | 'PRODUCT_NOT_RECOGNIZED'
  | 'SCAN_FAILED';

/** Ошибка, безопасная для отправки клиенту: только код, статус и короткий текст без технических деталей. */
export class ScanError extends Error {
  constructor(
    readonly code: ScanErrorCode,
    readonly status: number,
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ScanError';
  }

  withRequestId(requestId: string): ScanError {
    return new ScanError(this.code, this.status, this.message, requestId);
  }
}

const AI_ERRORS: Readonly<Record<AIProviderErrorCode, readonly [ScanErrorCode, number, string]>> = {
  not_configured: ['AI_NOT_CONFIGURED', 503, 'Product analysis is not configured on the server'],
  authentication_failed: ['AI_AUTH_FAILED', 502, 'The AI service rejected the server credentials'],
  quota_exceeded: ['AI_QUOTA_EXCEEDED', 503, 'The AI service quota is exhausted'],
  rate_limited: ['AI_RATE_LIMITED', 429, 'Too many requests to the AI service, try again shortly'],
  timeout: ['AI_TIMEOUT', 504, 'The AI service did not respond in time'],
  unavailable: ['AI_UNAVAILABLE', 502, 'The AI service is unavailable'],
  bad_request: ['AI_BAD_RESPONSE', 502, 'The AI service could not process the request'],
  invalid_response: ['AI_BAD_RESPONSE', 502, 'The AI service returned an invalid result'],
  refused: ['AI_BAD_RESPONSE', 502, 'The AI service declined to analyze this image'],
  normalization_failed: ['AI_BAD_RESPONSE', 502, 'The analysis result could not be processed'],
  product_not_recognized: ['PRODUCT_NOT_RECOGNIZED', 422, 'No food product could be recognized in the photo'],
  unsupported_input: ['SCAN_FAILED', 500, 'Unsupported analysis input'],
  not_implemented: ['SCAN_FAILED', 500, 'Analysis is not available'],
};

export function scanErrorFromAI(code: AIProviderErrorCode): ScanError {
  const [scanCode, status, message] = AI_ERRORS[code];
  return new ScanError(scanCode, status, message);
}
