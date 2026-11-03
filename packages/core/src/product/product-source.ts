import type { Brand } from '../common';

export type Barcode = Brand<string, 'Barcode'>;

/**
 * Откуда получены данные о продукте. Дискриминированное объединение:
 * новый способ получения добавляется новой веткой, не ломая существующие.
 */
export type ProductSource =
  | {
      /** Распознавание фотографии упаковки через Meta. */
      readonly type: 'meta_vision';
      readonly provider: 'meta';
      /** Время анализа, ISO 8601. */
      readonly analyzedAt: string;
      /** Версия схемы и промпта анализа: по ней видно, каким алгоритмом получены данные. */
      readonly analysisVersion: string;
    }
  | {
      /** Распознавание фотографии через Google; downstream Product remains shared. */
      readonly type: 'google_vision';
      readonly provider: 'google';
      readonly analyzedAt: string;
      readonly analysisVersion: string;
    }
  | { readonly type: 'barcode'; readonly barcode: Barcode; readonly provider: string }
  | { readonly type: 'manual' };

export type ProductSourceType = ProductSource['type'];
