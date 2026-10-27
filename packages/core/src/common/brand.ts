/**
 * Номинальный тип поверх примитива: не даёт перепутать, например,
 * ProductId и MealId, хотя оба являются строками.
 */
export type Brand<T, B extends string> = T & { readonly __brand: B };
