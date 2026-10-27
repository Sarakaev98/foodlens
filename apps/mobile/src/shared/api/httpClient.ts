import { API_URL } from './apiConfig';

/** Ошибка ответа API. status = 0, если сервер недоступен. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(status === 0 ? 'API is unreachable' : `API responded with ${status}`);
    this.name = 'ApiError';
  }
}

type HttpMethod = 'GET' | 'PUT';

async function request<T>(method: HttpMethod, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new ApiError(0, error);
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, payload);
  return payload as T;
}

/** Единая точка HTTP-запросов. Экраны работают через сервисы фич, а не через fetch. */
export const apiClient = {
  get: <T>(path: string) => request<T>('GET', path),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
};
