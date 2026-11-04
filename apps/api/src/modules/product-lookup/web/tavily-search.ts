import type { AILogger, DiscoveredSource, SourceDiscoveryInput, SourceDiscoveryResponse } from '@foodlens/ai';
import { normalizeProductName } from './product-identity';

export const TAVILY_TIMEOUT_MS = 7000;
const TAVILY_API = 'https://api.tavily.com';
const MAX_RESULTS = 5;
/** Чтение страниц: до 5 адресов стоят 1 кредит, а за скан читается не больше 3. */
const EXTRACT_CREDITS = 1;
const SEARCH_CREDITS = 1;
const MAX_LOGGED_TEXT = 160;

export type TavilyErrorCode = 'not_configured' | 'unavailable' | 'invalid_response' | `http_${number}`;

export class TavilySearchError extends Error {
  constructor(readonly code: TavilyErrorCode) {
    super(`Tavily search: ${code}`);
    this.name = 'TavilySearchError';
  }
}

/** Счётчик кредитов за календарный месяц. Живёт в памяти процесса: после перезапуска считает заново, поэтому лимит ниже бесплатных 1000. */
export class TavilyCreditBudget {
  private month = '';
  private used = 0;

  constructor(private readonly limit: number, private readonly now: () => number = Date.now) {}

  private sync(): void {
    const month = new Date(this.now()).toISOString().slice(0, 7);
    if (month === this.month) return;
    this.month = month;
    this.used = 0;
  }

  get spent(): number {
    this.sync();
    return this.used;
  }

  hasCredits(credits = 1): boolean {
    return this.spent + credits <= this.limit;
  }

  spend(credits: number): void {
    this.sync();
    this.used += credits;
  }

  /** Tavily сам сообщил, что лимит исчерпан: до конца месяца запросы бессмысленны. */
  exhaust(): void {
    this.sync();
    this.used = Math.max(this.used, this.limit);
  }
}

export interface TavilySearchConfig {
  readonly apiKey: string;
  readonly budget: TavilyCreditBudget;
  readonly logger: AILogger;
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
  /** Только в разработке: текст запроса и причины отказа чтения страниц. */
  readonly debug?: boolean;
}

export interface TavilyPageContent {
  readonly url: string;
  readonly content: string;
}

type Json = Record<string, unknown>;
const record = (value: unknown): value is Json => !!value && typeof value === 'object' && !Array.isArray(value);

/** Запрос собирается только из данных продукта. Макросов, фото и профиля в этом типе нет. */
export function tavilyQuery({ barcode, brand, name, serving }: SourceDiscoveryInput): string {
  const named = brand && name && !normalizeProductName(name).includes(normalizeProductName(brand)) ? `${brand} ${name}` : name ?? brand;
  return [barcode, named, serving, 'пищевая ценность'].filter(Boolean).join(' ');
}

function toSource(item: unknown): DiscoveredSource | null {
  if (!record(item) || typeof item.url !== 'string') return null;
  try {
    const url = new URL(item.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    // Отрывок целиком: штрихкод может быть далеко от начала. Значения из него не берутся, в журнал он не идёт.
    const snippet = typeof item.content === 'string' && item.content ? item.content : null;
    return { url: url.href, title: typeof item.title === 'string' ? item.title : '', domain: url.hostname.toLowerCase().replace(/^www\./, ''), ...(snippet ? { snippet } : {}) };
  } catch {
    return null;
  }
}

/** Поиск страниц через Tavily. Без повторов. В логах только числа и домены: ни ключа, ни тел ответов. */
export class TavilySearch {
  private readonly transport: typeof globalThis.fetch;
  private readonly timeoutMs: number;

  constructor(private readonly config: TavilySearchConfig) {
    this.transport = config.fetch ?? globalThis.fetch;
    this.timeoutMs = config.timeoutMs ?? TAVILY_TIMEOUT_MS;
  }

  isAvailable(): boolean {
    return this.config.apiKey.length > 0 && this.config.budget.hasCredits(SEARCH_CREDITS);
  }

  discoverSources(input: SourceDiscoveryInput, signal?: AbortSignal): Promise<SourceDiscoveryResponse> {
    return this.searchQuery(tavilyQuery(input), signal);
  }

  /** Один поисковый запрос готовым текстом. Текст строит стратегия поиска: макросов в нём нет. */
  async searchQuery(query: string, signal?: AbortSignal): Promise<SourceDiscoveryResponse> {
    const startedAt = Date.now();
    if (this.config.debug) this.config.logger.log('tavily_query', { query: query.slice(0, MAX_LOGGED_TEXT) });
    const response = await this.post('search', { query, search_depth: 'basic', max_results: MAX_RESULTS, include_usage: true }, signal);
    const sources = (Array.isArray(response.results) ? response.results : []).flatMap((item) => toSource(item) ?? []);
    const usage = record(response.usage) && typeof response.usage.credits === 'number' ? response.usage.credits : SEARCH_CREDITS;
    this.config.budget.spend(usage);
    this.logUsage('search', usage, sources.map((source) => source.domain), startedAt);
    return { sources, webSearchQueries: 1 };
  }

  /** Запасной путь для страниц, которые не прочитались напрямую. Кредит списывается только за успешное чтение. */
  async readPages(urls: readonly string[], signal?: AbortSignal): Promise<readonly TavilyPageContent[]> {
    if (urls.length === 0 || !this.config.budget.hasCredits(EXTRACT_CREDITS)) return [];
    const startedAt = Date.now();
    const response = await this.post('extract', { urls, extract_depth: 'basic', format: 'markdown', timeout: Math.floor(this.timeoutMs / 1000) - 1 }, signal);
    const pages = (Array.isArray(response.results) ? response.results : []).flatMap((item): TavilyPageContent[] =>
      (record(item) && typeof item.url === 'string' && typeof item.raw_content === 'string' ? [{ url: item.url, content: item.raw_content }] : []));
    if (this.config.debug && Array.isArray(response.failed_results)) {
      const failed = response.failed_results.flatMap((item) => {
        const domain = toSource(item)?.domain;
        return domain ? [{ domain, error: record(item) ? String(item.error ?? '').slice(0, MAX_LOGGED_TEXT) : '' }] : [];
      });
      if (failed.length > 0) this.config.logger.log('tavily_extract_failed', { failed });
    }
    const credits = pages.length > 0 ? EXTRACT_CREDITS : 0;
    this.config.budget.spend(credits);
    this.logUsage('extract', credits, pages.map((page) => toSource(page)?.domain ?? ''), startedAt);
    return pages;
  }

  private logUsage(endpoint: string, credits: number, domains: readonly string[], startedAt: number): void {
    this.config.logger.log('tavily_usage', { endpoint, credits, creditsThisMonth: this.config.budget.spent, resultCount: domains.length, domains, latencyMs: Date.now() - startedAt });
  }

  private async post(endpoint: 'search' | 'extract', body: Json, signal?: AbortSignal): Promise<Json> {
    signal?.throwIfAborted();
    if (!this.config.apiKey) throw new TavilySearchError('not_configured');
    let response: Response;
    try {
      response = await this.transport(`${TAVILY_API}/${endpoint}`, {
        method: 'POST', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]) : AbortSignal.timeout(this.timeoutMs),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.apiKey}` }, body: JSON.stringify(body),
      });
    } catch {
      throw this.failed(endpoint, 'unavailable');
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      if (response.status === 432 || response.status === 433) this.config.budget.exhaust();
      throw this.failed(endpoint, `http_${response.status}`);
    }
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      throw this.failed(endpoint, 'invalid_response');
    }
    if (!record(parsed)) throw this.failed(endpoint, 'invalid_response');
    return parsed;
  }

  private failed(endpoint: string, code: TavilyErrorCode): TavilySearchError {
    this.config.logger.warn('tavily_failed', { endpoint, code });
    return new TavilySearchError(code);
  }
}
