import type { NutrientKey, ServingSize } from '@foodlens/core';
import type { ProductLookupProvider, ProductLookupResult } from './product-lookup.provider';

export const FATSECRET_PROVIDER = 'fatsecret';
const TOKEN_URL = 'https://oauth.fatsecret.com/connect/token';
const BARCODE_URL = 'https://platform.fatsecret.com/rest/food/barcode/find-by-id/v2';
/** Токен живёт 24 часа: обновляем чуть раньше срока. */
const TOKEN_MARGIN_MS = 60_000;
export const FATSECRET_TIMEOUT_MS = 3500;
const RATE_LIMIT_PAUSE_MS = 60_000;
/** Коды ошибок FatSecret в теле ответа 200. */
const NO_FOOD_FOUND = 211;
const INVALID_TOKEN = 13;
/** Те же границы правдоподобия на 100 г/мл, что у этикетки и Open Food Facts. */
const MAX_KCAL = 900;
const MAX_GRAMS = 100;
const MAX_SODIUM_MG = 40_000;

export interface FatSecretConfig {
  /** Только из env на сервере. Никогда не логируются и не попадают в mobile. */
  readonly clientId: string;
  readonly clientSecret: string;
  /** Страна набора данных, например "RU". Без неё FatSecret отвечает из набора США. */
  readonly region?: string;
  readonly language?: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => number;
}

export class FatSecretError extends Error {
  constructor(readonly code: 'rate_limited' | 'unavailable' | 'invalid_response' | 'not_authorized') {
    super(`FatSecret: ${code}`);
    this.name = 'FatSecretError';
  }
}

type Json = Record<string, unknown>;
const record = (value: unknown): value is Json => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

function amount(value: unknown): number | null {
  const number = typeof value === 'string' && value.trim() ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) && number >= 0 ? number : null;
}

const round = (value: number): number => Math.round(value * 100) / 100;
const within = (value: number | null, max: number): number | null => (value !== null && value <= max ? round(value) : null);

/** GTIN-13 с ведущими нулями, как требует API. Более длинный код без ведущего нуля не поддерживается. */
export function toGtin13(barcode: string): string | null {
  if (!/^\d{8,14}$/.test(barcode)) return null;
  const digits = barcode.length === 14 && barcode.startsWith('0') ? barcode.slice(1) : barcode;
  return digits.length <= 13 ? digits.padStart(13, '0') : null;
}

/** Порция с весом: только из неё можно пересчитать на 100 г/мл. Сначала порция по умолчанию. */
function metricServing(servings: unknown): Json | null {
  const list = record(servings) ? servings.serving : null;
  const items = (Array.isArray(list) ? list : [list]).filter(record).filter((serving) =>
    (serving.metric_serving_unit === 'g' || serving.metric_serving_unit === 'ml') && (amount(serving.metric_serving_amount) ?? 0) > 0);
  return items.find((serving) => serving.is_default === '1') ?? items[0] ?? null;
}

/** Чистая функция: ответ barcode v2 → значения на 100 г/мл. Отсутствующее значение остаётся null, не 0. */
export function mapFatSecretFood(food: unknown, barcode: string): ProductLookupResult | null {
  if (!record(food)) return null;
  const serving = metricServing(food.servings);
  const size = serving ? amount(serving.metric_serving_amount)! : null;
  const unit = serving?.metric_serving_unit as ServingSize['unit'] | undefined;
  const per100 = (key: string): number | null => {
    const value = serving ? amount(serving[key]) : null;
    return value === null || size === null ? null : (value * 100) / size;
  };
  const values: Record<NutrientKey, number | null> = {
    caloriesKcal: within(per100('calories'), MAX_KCAL), proteinG: within(per100('protein'), MAX_GRAMS), carbsG: within(per100('carbohydrate'), MAX_GRAMS),
    sugarsG: within(per100('sugar'), MAX_GRAMS), fatG: within(per100('fat'), MAX_GRAMS), saturatedFatG: within(per100('saturated_fat'), MAX_GRAMS),
    fiberG: within(per100('fiber'), MAX_GRAMS), saltG: null, sodiumMg: within(per100('sodium'), MAX_SODIUM_MG),
  };
  const hasValues = Object.values(values).some((value) => value !== null);
  // «100 г» в списке порций это основа таблицы, а не размер порции.
  const isRealServing = serving !== null && size !== null && serving.measurement_description !== unit;
  return {
    provider: FATSECRET_PROVIDER,
    match: 'exact_barcode',
    barcode,
    name: text(food.food_name),
    brand: text(food.brand_name),
    nutrition: hasValues ? { basis: unit === 'ml' ? 'per_100ml' : 'per_100g', values, derived: [] } : null,
    servingSize: hasValues && isRealServing ? { amount: size, unit: unit! } : null,
    ingredients: null,
    allergens: null,
    additives: null,
  };
}

/**
 * Точный поиск по штрихкоду в FatSecret, только чтение. Отправляется только штрихкод.
 * Без ключей адаптер не создаётся (см. product-lookup.module.ts).
 */
export class FatSecretProductLookupProvider implements ProductLookupProvider {
  readonly name = FATSECRET_PROVIDER;
  private readonly timeoutMs: number;
  private readonly transport: typeof globalThis.fetch;
  private readonly now: () => number;
  private token: { readonly value: string; readonly expiresAt: number } | null = null;
  private pausedUntil = 0;

  constructor(private readonly config: FatSecretConfig) {
    this.timeoutMs = config.timeoutMs ?? FATSECRET_TIMEOUT_MS;
    this.transport = config.fetch ?? globalThis.fetch;
    this.now = config.now ?? Date.now;
  }

  async lookup(barcode: string | null): Promise<ProductLookupResult | null> {
    const gtin = barcode ? toGtin13(barcode) : null;
    if (!barcode || !gtin) return null;
    if (this.now() < this.pausedUntil) throw new FatSecretError('rate_limited');
    const token = await this.accessToken();
    const query = new URLSearchParams({ barcode: gtin, format: 'json', flag_default_serving: 'true' });
    if (this.config.region) query.set('region', this.config.region);
    if (this.config.region && this.config.language) query.set('language', this.config.language);
    const response = await this.request(`${BARCODE_URL}?${query}`, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    const body = await this.json(response);
    const error = body.error;
    if (record(error)) {
      if (Number(error.code) === NO_FOOD_FOUND) return null;
      if (Number(error.code) === INVALID_TOKEN) this.token = null;
      throw new FatSecretError('not_authorized');
    }
    return mapFatSecretFood(body.food, barcode);
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > this.now()) return this.token.value;
    const credentials = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64');
    const scope = this.config.region ? 'barcode localization' : 'barcode';
    const response = await this.request(TOKEN_URL, {
      method: 'POST',
      headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'client_credentials', scope }).toString(),
    });
    const body = await this.json(response);
    const value = text(body.access_token);
    const lifetime = amount(body.expires_in);
    if (!value || lifetime === null) throw new FatSecretError('not_authorized');
    this.token = { value, expiresAt: this.now() + lifetime * 1000 - TOKEN_MARGIN_MS };
    return value;
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await this.transport(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch {
      throw new FatSecretError('unavailable');
    }
    if (response.ok) return response;
    await response.body?.cancel().catch(() => undefined);
    if (response.status === 429) {
      this.pausedUntil = this.now() + RATE_LIMIT_PAUSE_MS;
      throw new FatSecretError('rate_limited');
    }
    throw new FatSecretError(response.status === 401 || response.status === 403 ? 'not_authorized' : 'unavailable');
  }

  private async json(response: Response): Promise<Json> {
    try {
      const body: unknown = await response.json();
      if (record(body)) return body;
    } catch {
      // Ниже общий ответ для битого тела.
    }
    throw new FatSecretError('invalid_response');
  }
}
