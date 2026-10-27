/**
 * Откуда взялось значение:
 * - observed: прочитано на изображении (текст этикетки, логотип);
 * - inferred: выведено из увиденного (категория по виду упаковки, соль из натрия);
 * - not_detected: на изображении этого нет, значение null.
 */
export const DATA_PROVENANCES = ['observed', 'inferred', 'not_detected'] as const;

export type DataProvenance = (typeof DATA_PROVENANCES)[number];

/** Значение вместе с происхождением. null всегда означает «не найдено», а не ноль. */
export type Detected<T> =
  | { readonly value: T; readonly provenance: 'observed' | 'inferred' }
  | { readonly value: null; readonly provenance: 'not_detected' };

export const NOT_DETECTED: Detected<never> = { value: null, provenance: 'not_detected' };

export function observed<T>(value: T): Detected<T> {
  return { value, provenance: 'observed' };
}

export function inferred<T>(value: T): Detected<T> {
  return { value, provenance: 'inferred' };
}
