import type { Product, ProductScore } from '@foodlens/core';

/**
 * Scoring Engine: детерминированная оценка продукта.
 * Зависит только от @foodlens/core и ничего не знает об AI.
 * Реализация v1: scoreProduct в score-product.ts, правила в product-score-rules.ts.
 */
export interface ScoringEngine {
  score(product: Product): ProductScore;
}
