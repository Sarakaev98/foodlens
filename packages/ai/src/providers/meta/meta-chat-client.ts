import { AIProviderError, type AIProviderErrorCode } from '../../errors';
import type { AILogger } from '../../ai-logger';
import type { JsonSchema } from '../../json-schema/json-schema';

const PROVIDER = 'meta';

export interface MetaChatClientConfig {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly model: string;
  /** Таймаут одной попытки. */
  readonly timeoutMs: number;
  /** Всего попыток, включая первую. */
  readonly maxAttempts: number;
  readonly retryBaseDelayMs: number;
  readonly fetch: typeof fetch;
  readonly sleep: (ms: number) => Promise<void>;
  readonly logger: AILogger;
}

export interface StructuredImageRequest {
  readonly requestId: string;
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly image: { readonly mimeType: string; readonly base64: string };
  readonly schemaName: string;
  readonly schema: JsonSchema;
  readonly maxCompletionTokens: number;
}

export interface StructuredResponse {
  /** JSON, уже разобранный JSON.parse. Проверку схемы делает вызывающий код. */
  readonly content: unknown;
  readonly responseId: string | null;
  readonly attempts: number;
}

interface ChatCompletionResponse {
  readonly id?: string;
  readonly choices?: readonly {
    readonly finish_reason?: string;
    readonly message?: { readonly content?: string | null; readonly refusal?: string | null };
  }[];
  readonly usage?: { readonly prompt_tokens?: number; readonly completion_tokens?: number };
}

/** Повторяем только то, что может пройти со второй попытки. 4xx (кроме 429) не повторяем. */
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_RETRY_AFTER_MS = 10_000;

/**
 * Тонкий клиент Meta Chat Completions для запросов «изображение → JSON по схеме».
 * Знает про HTTP, таймауты и повторы, но ничего не знает о продуктах.
 */
export class MetaChatClient {
  constructor(private readonly config: MetaChatClientConfig) {}

  async completeStructured(request: StructuredImageRequest): Promise<StructuredResponse> {
    const body = JSON.stringify({
      model: this.config.model,
      messages: [
        { role: 'system', content: request.systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'text', text: request.userPrompt },
            {
              type: 'image_url',
              image_url: { url: `data:${request.image.mimeType};base64,${request.image.base64}`, detail: 'high' },
            },
          ],
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: request.schemaName, schema: request.schema, strict: true },
      },
      temperature: 0,
      max_completion_tokens: request.maxCompletionTokens,
    });

    for (let attempt = 1; ; attempt++) {
      try {
        const response = await this.send(body);
        return { ...this.parse(response), attempts: attempt };
      } catch (error) {
        const retry = error instanceof RetryableError && attempt < this.config.maxAttempts;
        if (!retry) throw error instanceof RetryableError ? error.cause : error;

        const delayMs = error.retryAfterMs ?? this.backoffMs(attempt);
        this.config.logger.warn('meta request retry', {
          requestId: request.requestId,
          attempt,
          code: error.cause.code,
          httpStatus: error.cause.httpStatus,
          delayMs,
        });
        await this.config.sleep(delayMs);
      }
    }
  }

  private async send(body: string): Promise<ChatCompletionResponse> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(Object.assign(new Error('Request timed out'), { name: 'TimeoutError' })),
      this.config.timeoutMs,
    );
    try {
      return await this.request(body, controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  private async request(body: string, signal: AbortSignal): Promise<ChatCompletionResponse> {
    let response: Response;
    try {
      response = await this.config.fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.config.apiKey}`, 'Content-Type': 'application/json' },
        body,
        signal,
      });
    } catch (error) {
      if (isTimeout(error)) {
        // Повтор после таймаута удвоил бы ожидание пользователя, поэтому сразу ошибка.
        throw new AIProviderError(PROVIDER, 'timeout', `No response within ${this.config.timeoutMs} ms`, { cause: error });
      }
      throw new RetryableError(new AIProviderError(PROVIDER, 'unavailable', 'Network error', { cause: error }));
    }

    if (!response.ok) {
      const error = new AIProviderError(PROVIDER, codeForStatus(response.status), await describeError(response), {
        httpStatus: response.status,
      });
      if (RETRYABLE_STATUSES.has(response.status)) {
        throw new RetryableError(error, retryAfterMs(response.headers.get('retry-after')));
      }
      throw error;
    }

    try {
      return (await response.json()) as ChatCompletionResponse;
    } catch (error) {
      if (isTimeout(error)) {
        throw new AIProviderError(PROVIDER, 'timeout', `No response within ${this.config.timeoutMs} ms`, { cause: error });
      }
      throw new AIProviderError(PROVIDER, 'invalid_response', 'Response body is not JSON', { cause: error });
    }
  }

  private parse(response: ChatCompletionResponse): Omit<StructuredResponse, 'attempts'> {
    const choice = response.choices?.[0];
    const message = choice?.message;
    if (message?.refusal) throw new AIProviderError(PROVIDER, 'refused', 'Model refused the request');
    if (choice?.finish_reason === 'content_filter') throw new AIProviderError(PROVIDER, 'refused', 'Blocked by content filter');
    if (choice?.finish_reason === 'length') throw new AIProviderError(PROVIDER, 'invalid_response', 'Response was truncated');
    if (typeof message?.content !== 'string') throw new AIProviderError(PROVIDER, 'invalid_response', 'Response has no content');

    try {
      // Strict structured output: content целиком является JSON, никакого markdown.
      return { content: JSON.parse(message.content) as unknown, responseId: response.id ?? null };
    } catch (error) {
      throw new AIProviderError(PROVIDER, 'invalid_response', 'Content is not valid JSON', { cause: error });
    }
  }

  private backoffMs(attempt: number): number {
    const jitter = Math.random() * this.config.retryBaseDelayMs * 0.25;
    return this.config.retryBaseDelayMs * 2 ** (attempt - 1) + jitter;
  }
}

class RetryableError extends Error {
  constructor(
    override readonly cause: AIProviderError,
    readonly retryAfterMs: number | null = null,
  ) {
    super(cause.message);
  }
}

function codeForStatus(status: number): AIProviderErrorCode {
  if (status === 401 || status === 403) return 'authentication_failed';
  if (status === 402) return 'quota_exceeded';
  if (status === 429) return 'rate_limited';
  if (status === 504) return 'timeout';
  if (status >= 500) return 'unavailable';
  return 'bad_request';
}

/** Берём только тип и код ошибки Meta: текст может содержать фрагменты запроса. */
async function describeError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { type?: unknown; code?: unknown } };
    const parts = [body.error?.type, body.error?.code].filter((part) => typeof part === 'string' && part.length <= 64);
    return `HTTP ${response.status}${parts.length ? ` (${parts.join(', ')})` : ''}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

function retryAfterMs(header: string | null): number | null {
  const seconds = header === null ? NaN : Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds * 1000, MAX_RETRY_AFTER_MS) : null;
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}
