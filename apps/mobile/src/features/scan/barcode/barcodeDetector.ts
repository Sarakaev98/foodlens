/**
 * Штрихкод товара с живой камеры: подсказка к снимку. Сам по себе запрос не запускает: он уходит на сервер вместе со сканом.
 * Модуль чистый (без React и Expo), чтобы его можно было проверить в node:test.
 */

/** Коды на упаковках продуктов. QR и прочие 2D-коды не нужны. */
export const PRODUCT_BARCODE_TYPES = ['ean13', 'ean8', 'upc_a', 'upc_e'] as const;
export type ProductBarcodeType = (typeof PRODUCT_BARCODE_TYPES)[number];

/** EAN-8 / UPC-E (8), UPC-A (12), EAN-13 (13). */
const VALID_LENGTHS: readonly number[] = [8, 12, 13];

/** Тот же код повторно не сообщается в течение этого времени. */
export const DUPLICATE_WINDOW_MS = 3000;
/** Камера присылает события много раз в секунду: не чаще одного нового кода за этот интервал. */
export const MIN_INTERVAL_MS = 500;
/**
 * Код, не виденный дольше этого, к снимку не прикладывается: пользователь мог перейти к другому продукту.
 * Запас нужен, чтобы успеть повернуть упаковку к этикетке. Код виден на предпросмотре перед отправкой.
 */
export const MAX_CAPTURE_AGE_MS = 120_000;

export interface BarcodeEvent {
  readonly type: string;
  readonly data: string;
}

/** Цифры кода товара или null, если тип не товарный или код некорректный. */
export function normalizeProductBarcode(event: BarcodeEvent): string | null {
  if (!(PRODUCT_BARCODE_TYPES as readonly string[]).includes(event.type.toLowerCase())) return null;
  const digits = event.data.trim();
  if (!/^\d+$/.test(digits) || !VALID_LENGTHS.includes(digits.length)) return null;
  return digits;
}

export interface BarcodeDetector {
  /** Новый код, если о нём стоит сообщить (показать «Штрихкод найден»), иначе null. */
  accept(event: BarcodeEvent): string | null;
  /** Код для снимка с камеры: последний найденный, если он свежий. */
  latest(): string | null;
  reset(): void;
}

export function createBarcodeDetector(now: () => number = Date.now): BarcodeDetector {
  let last: { code: string; at: number; seenAt: number } | null = null;

  return {
    accept(event) {
      const code = normalizeProductBarcode(event);
      if (!code) return null;
      const at = now();
      if (last) {
        if (last.code === code) last.seenAt = at;
        if (last.code === code && at - last.at < DUPLICATE_WINDOW_MS) return null;
        if (last.code !== code && at - last.at < MIN_INTERVAL_MS) return null;
      }
      last = { code, at, seenAt: at };
      return code;
    },
    latest() {
      return last && now() - last.seenAt <= MAX_CAPTURE_AGE_MS ? last.code : null;
    },
    reset() {
      last = null;
    },
  };
}
