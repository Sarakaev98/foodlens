import { API_URL } from './apiConfig';

/** Ошибка ответа API. status = 0, если сервер недоступен или не ответил вовремя (timedOut). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    readonly timedOut = false,
  ) {
    super(status === 0 ? (timedOut ? 'API did not respond in time' : 'API is unreachable') : `API responded with ${status}`);
    this.name = 'ApiError';
  }
}

type HttpMethod = 'GET' | 'PUT' | 'POST';

interface RequestOptions {
  readonly json?: unknown;
  readonly form?: FormData;
  readonly timeoutMs?: number;
}

async function request<T>(method: HttpMethod, path: string, { json, form, timeoutMs }: RequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = timeoutMs
    ? setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs)
    : undefined;

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      // Для FormData заголовок Content-Type с boundary выставляет сам fetch.
      headers: json === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: form ?? (json === undefined ? undefined : JSON.stringify(json)),
      signal: controller.signal,
    });
  } catch (error) {
    throw new ApiError(0, error, timedOut);
  } finally {
    clearTimeout(timer);
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, payload);
  return payload as T;
}

/** Единая точка HTTP-запросов. Экраны работают через сервисы фич, а не через fetch. */
export const apiClient = {
  get: <T>(path: string) => request<T>('GET', path),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, { json: body }),
  postForm: <T>(path: string, form: FormData, options: { readonly timeoutMs?: number } = {}) =>
    request<T>('POST', path, { form, ...options }),
};
