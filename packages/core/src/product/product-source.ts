import type { Brand } from '../common';

export type Barcode = Brand<string, 'Barcode'>;

/**
 * Откуда получены данные о продукте. Дискриминированное объединение:
 * новый способ получения добавляется новой веткой, не ломая существующие.
 */
export type ProductSource =
  | { readonly kind: 'barcode'; readonly barcode: Barcode; readonly provider: string }
  | { readonly kind: 'image'; readonly provider: string }
  | { readonly kind: 'manual' };

export type ProductSourceKind = ProductSource['kind'];
