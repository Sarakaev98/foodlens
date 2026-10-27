/** Результат Scoring Engine. Формат общий для scoring, AI (explainProduct) и UI. */
export interface ProductScore {
  /** Итоговая оценка 0–100. */
  readonly value: number;
  readonly factors: readonly ScoreFactor[];
}

export type ScoreFactorImpact = 'positive' | 'negative' | 'neutral';

export interface ScoreFactor {
  /** Машинный идентификатор фактора, например "sugars.high". */
  readonly id: string;
  readonly impact: ScoreFactorImpact;
}
