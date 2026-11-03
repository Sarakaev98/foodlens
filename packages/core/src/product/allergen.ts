import type { ExternalProvenance } from '../common';

/** 14 основных аллергенов (EU Regulation 1169/2011). */
export const ALLERGEN_CODES = [
  'gluten',
  'crustaceans',
  'eggs',
  'fish',
  'peanuts',
  'soy',
  'milk',
  'tree_nuts',
  'celery',
  'mustard',
  'sesame',
  'sulphites',
  'lupin',
  'molluscs',
] as const;

export type AllergenCode = (typeof ALLERGEN_CODES)[number];

export type AllergenPresence = 'contains' | 'may_contain';

export interface Allergen {
  readonly code: AllergenCode;
  /** contains: входит в состав; may_contain: «может содержать следы». */
  readonly presence: AllergenPresence;
  /** observed: явно указан на упаковке; inferred: выведен из ингредиента (например, «сухое молоко» → milk). */
  readonly provenance: 'observed' | 'inferred' | ExternalProvenance;
}

export function isAllergenCode(value: unknown): value is AllergenCode {
  return typeof value === 'string' && (ALLERGEN_CODES as readonly string[]).includes(value);
}
