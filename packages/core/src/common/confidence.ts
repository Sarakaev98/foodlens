/** Уверенность в данных. Уровни, а не проценты: UI и scoring работают с понятными градациями. */
export const CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const;

export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

const CONFIDENCE_RANK: Readonly<Record<ConfidenceLevel, number>> = { low: 0, medium: 1, high: 2 };

/** Самый низкий из уровней: итог не может быть увереннее своих частей. */
export function lowestConfidence(first: ConfidenceLevel, ...rest: readonly ConfidenceLevel[]): ConfidenceLevel {
  return rest.reduce((lowest, level) => (CONFIDENCE_RANK[level] < CONFIDENCE_RANK[lowest] ? level : lowest), first);
}
