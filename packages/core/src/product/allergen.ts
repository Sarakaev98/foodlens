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
  readonly presence: AllergenPresence;
}
