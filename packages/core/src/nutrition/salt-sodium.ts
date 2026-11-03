/**
 * Соль и натрий: масса NaCl к массе натрия. Единственное место, где записан коэффициент
 * и формулы перевода. Порядок операций зафиксирован: результат совпадает с прежними
 * формулами бит в бит, поэтому округления в вызывающем коде не меняются.
 */
export const SALT_PER_SODIUM = 2.5;

/** Натрий в мг → соль в г: mg × 2.5 / 1000. */
export function saltGFromSodiumMg(sodiumMg: number): number {
  return (sodiumMg * SALT_PER_SODIUM) / 1000;
}

/** Соль в г → натрий в мг: g × 1000 / 2.5. */
export function sodiumMgFromSaltG(saltG: number): number {
  return (saltG * 1000) / SALT_PER_SODIUM;
}
