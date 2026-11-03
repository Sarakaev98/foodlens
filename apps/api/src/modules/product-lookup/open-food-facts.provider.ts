import { mapOpenFoodFactsProduct, OPEN_FOOD_FACTS_PROVIDER } from './open-food-facts.mapper';
import type { ProductLookupProvider, ProductLookupResult } from './product-lookup.provider';

export const OPEN_FOOD_FACTS_BASE_URL = 'https://world.openfoodfacts.org';
/** Версия закреплена: формат nutrition менялся в v3.5, а новые версии могут менять его снова. */
const API_PATH = '/api/v3.6/product';
export const OFF_REQUEST_FIELDS = [
  'product_name', 'product_name_ru', 'brands', 'nutrition', 'serving_size', 'serving_quantity', 'serving_quantity_unit',
  'ingredients_text', 'ingredients_text_ru', 'allergens_tags', 'traces_tags', 'additives_tags', 'categories_tags', 'categories_hierarchy', 'nova_group',
].join(',');

/** Скан не должен заметно ждать базу: дольше ответа Gemini ждать нет смысла. */
export const OPEN_FOOD_FACTS_TIMEOUT_MS = 3500;
/** Лимит базы: 15 запросов чтения в минуту с IP. Держимся ниже него. */
export const OPEN_FOOD_FACTS_MAX_PER_MINUTE = 12;
/** После 429 база не запрашивается эту паузу. */
const RATE_LIMIT_PAUSE_MS = 60_000;
const MINUTE_MS = 60_000;

export interface OpenFoodFactsConfig {
  /** Контакт для User-Agent вида "FoodLens/0.1.0 (contact)", как требует база. */
  readonly contact: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => number;
}

export class OpenFoodFactsError extends Error {
  constructor(readonly code: 'rate_limited' | 'unavailable' | 'invalid_response') {
    super(`Open Food Facts: ${code}`);
    this.name = 'OpenFoodFactsError';
  }
}

/** Точный поиск по штрихкоду, только чтение. Поиска по названию и записи здесь нет. */
export class OpenFoodFactsProductLookupProvider implements ProductLookupProvider {
  readonly name = OPEN_FOOD_FACTS_PROVIDER;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly transport: typeof globalThis.fetch;
  private readonly now: () => number;
  private readonly userAgent: string;
  private recent: number[] = [];
  private pausedUntil = 0;

  constructor(config: OpenFoodFactsConfig) {
    this.baseUrl = (config.baseUrl ?? OPEN_FOOD_FACTS_BASE_URL).replace(/\/+$/, '');
    this.timeoutMs = config.timeoutMs ?? OPEN_FOOD_FACTS_TIMEOUT_MS;
    this.transport = config.fetch ?? globalThis.fetch;
    this.now = config.now ?? Date.now;
    this.userAgent = `FoodLens/0.1.0 (${config.contact})`;
  }

  async lookup(barcode: string | null): Promise<ProductLookupResult | null> {
    if (!barcode) return null;
    this.reserveRequest();
    let response: Response;
    try {
      response = await this.transport(`${this.baseUrl}${API_PATH}/${encodeURIComponent(barcode)}.json?fields=${OFF_REQUEST_FIELDS}`, {
        method: 'GET',
        headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new OpenFoodFactsError('unavailable');
    }
    if (response.status === 404) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    if (response.status === 429) {
      this.pausedUntil = this.now() + RATE_LIMIT_PAUSE_MS;
      await response.body?.cancel().catch(() => undefined);
      throw new OpenFoodFactsError('rate_limited');
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new OpenFoodFactsError('unavailable');
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new OpenFoodFactsError('invalid_response');
    }
    const product = body && typeof body === 'object' ? (body as { product?: unknown }).product : null;
    return mapOpenFoodFactsProduct(product, barcode);
  }

  /** Лимит на стороне FoodLens: лучше пропустить базу, чем получить блокировку IP. */
  private reserveRequest(): void {
    const now = this.now();
    if (now < this.pausedUntil) throw new OpenFoodFactsError('rate_limited');
    this.recent = this.recent.filter((at) => now - at < MINUTE_MS);
    if (this.recent.length >= OPEN_FOOD_FACTS_MAX_PER_MINUTE) throw new OpenFoodFactsError('rate_limited');
    this.recent.push(now);
  }
}
