export interface Ingredient {
  /** Название как в источнике (этикетка, база данных). */
  readonly name: string;
  /** Доля в продукте, если указана, 0–100. */
  readonly percent?: number;
}
