/**
 * Откуда взялось значение:
 * - observed: прочитано на изображении (текст этикетки, логотип);
 * - inferred: выведено из увиденного (категория по виду упаковки, соль из натрия);
 * - open_food_facts, fatsecret: значение из внешней базы по штрихкоду, на фото его не было;
 * - web_search: значение из открытых источников, найденное через Google Search;
 * - not_detected: на изображении этого нет, значение null.
 * В этих же значениях выражаются источники label_ai (observed) и derived (inferred).
 */
export const EXTERNAL_PROVENANCES = ['open_food_facts', 'fatsecret', 'web_search'] as const;
export type ExternalProvenance = (typeof EXTERNAL_PROVENANCES)[number];

export const DATA_PROVENANCES = ['observed', 'inferred', ...EXTERNAL_PROVENANCES, 'not_detected'] as const;

export type DataProvenance = (typeof DATA_PROVENANCES)[number];

/** Значение вместе с происхождением. null всегда означает «не найдено», а не ноль. */
export type Detected<T> =
  | { readonly value: T; readonly provenance: 'observed' | 'inferred' | ExternalProvenance }
  | { readonly value: null; readonly provenance: 'not_detected' };

export const NOT_DETECTED: Detected<never> = { value: null, provenance: 'not_detected' };

export function observed<T>(value: T): Detected<T> {
  return { value, provenance: 'observed' };
}

export function inferred<T>(value: T): Detected<T> {
  return { value, provenance: 'inferred' };
}

export function fromExternalSource<T>(value: T, source: ExternalProvenance): Detected<T> {
  return { value, provenance: source };
}

export function fromOpenFoodFacts<T>(value: T): Detected<T> {
  return fromExternalSource(value, 'open_food_facts');
}

export function isExternalProvenance(provenance: string): provenance is ExternalProvenance {
  return (EXTERNAL_PROVENANCES as readonly string[]).includes(provenance);
}
