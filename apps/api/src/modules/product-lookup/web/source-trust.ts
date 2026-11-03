import type { SourceTier } from './source-tier';

/**
 * Единая шкала доверия к источникам. Никакой источник не абсолютная истина, кроме этикетки в руках пользователя:
 * значения Open Food Facts может исправить более сильный источник, но не слабый сайт.
 */
export const SOURCE_TRUST = {
  label_photo: 1,
  official_manufacturer: 0.95,
  exact_barcode_source: 0.9,
  open_food_facts: 0.8,
  trusted_web_product_page: 0.7,
  weak_web_source: 0.5,
} as const;

export type SourceTrust = keyof typeof SOURCE_TRUST;

/** Уровень страницы: домен плюс то, чем подтверждён товар. needsSecondSource: страница одна ничего не доказывает. */
export function pageTrust(tier: SourceTier, identityMatch: string | null, needsSecondSource: boolean): SourceTrust {
  if (tier === 1 && !needsSecondSource) return 'official_manufacturer';
  if (identityMatch === 'exact_barcode' && !needsSecondSource) return 'exact_barcode_source';
  return tier < 4 ? 'trusted_web_product_page' : 'weak_web_source';
}

export const outranks = (trust: SourceTrust, other: SourceTrust): boolean => SOURCE_TRUST[trust] > SOURCE_TRUST[other];

/** Отпечаток рецептуры: ккал / белки / углеводы / жиры на 100 г или мл. Часть ключа кэша и журнала. */
export function recipeFingerprint({ kcal, protein, carbs, fat }: { readonly kcal: number | null; readonly protein: number | null; readonly carbs: number | null; readonly fat: number | null }): string {
  return [kcal, protein, carbs, fat].map((value) => value ?? '').join('/');
}
