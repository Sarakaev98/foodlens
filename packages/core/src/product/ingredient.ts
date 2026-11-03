export interface Ingredient {
  /** Название как на этикетке, на языке этикетки. */
  readonly name: string;
  /** Доля в продукте, если указана, 0–100. */
  readonly percent: number | null;
}
