import type { Product, ProductScore } from '@foodlens/core';

/**
 * Scoring Engine: детерминированная оценка продукта.
 * Зависит только от @foodlens/core и ничего не знает об AI.
 * Реализация появится на следующем этапе.
 */
export interface ScoringEngine {
  score(product: Product): ProductScore;
}
