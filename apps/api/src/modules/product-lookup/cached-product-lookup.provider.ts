import type { ProductLookupContext, ProductLookupProvider, ProductLookupResult } from './product-lookup.provider';

export const LOOKUP_CACHE_SIZE = 500;
export const LOOKUP_FOUND_TTL_MS = 24 * 60 * 60 * 1000;
/** Продукт могут добавить в базу: «не найдено» хранится меньше. */
export const LOOKUP_NOT_FOUND_TTL_MS = 60 * 60 * 1000;

interface Entry {
  readonly result: ProductLookupResult | null;
  readonly expiresAt: number;
}

/**
 * Кэш в памяти вокруг любого источника: повторный анализ того же штрихкода не ходит в сеть.
 * Сбрасывается при перезапуске API. Ошибки не кэшируются, одновременные запросы объединяются.
 */
export class CachedProductLookupProvider implements ProductLookupProvider {
  readonly name: string;
  readonly needsBarcode?: boolean;
  private readonly entries = new Map<string, Entry>();
  private readonly pending = new Map<string, Promise<ProductLookupResult | null>>();

  /** Отдельный экземпляр на источник, поэтому записи разных источников не смешиваются. */
  constructor(private readonly inner: ProductLookupProvider, private readonly now: () => number = Date.now, private readonly foundTtlMs = LOOKUP_FOUND_TTL_MS) {
    this.name = inner.name;
    if (inner.needsBarcode !== undefined) this.needsBarcode = inner.needsBarcode;
  }

  lookup(barcode: string | null, context?: ProductLookupContext): Promise<ProductLookupResult | null> {
    const key = this.inner.cacheKey?.(barcode, context) ?? barcode ?? '';
    const entry = this.entries.get(key);
    if (entry && entry.expiresAt > this.now()) {
      // Map хранит порядок вставки: перестановка в конец делает кэш LRU.
      this.entries.delete(key);
      this.entries.set(key, entry);
      return Promise.resolve(entry.result);
    }
    const running = this.pending.get(key);
    if (running) return running;
    const request = this.inner.lookup(barcode, context).then((result) => {
      this.store(key, result);
      return result;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, request);
    return request;
  }

  private store(barcode: string, result: ProductLookupResult | null): void {
    this.entries.delete(barcode);
    if (this.entries.size >= LOOKUP_CACHE_SIZE) this.entries.delete(this.entries.keys().next().value as string);
    this.entries.set(barcode, { result, expiresAt: this.now() + (result ? this.foundTtlMs : LOOKUP_NOT_FOUND_TTL_MS) });
  }
}
