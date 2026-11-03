export const SCAN_BARCODE_FIELD = 'barcode';

/**
 * Необязательный штрихкод из multipart-поля "barcode": только цифры, 8–14 знаков (EAN-8 … GTIN-14).
 * Некорректное значение не ломает скан: оно просто игнорируется (null).
 */
export function parseScanBarcode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const digits = raw.trim();
  return /^\d{8,14}$/.test(digits) ? digits : null;
}
