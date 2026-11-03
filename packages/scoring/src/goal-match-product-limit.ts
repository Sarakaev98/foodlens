import type { GoalMatch, GoalMatchV4, ProductScore } from '@foodlens/core';
import { V3_LEVELS } from './goal-match-v3-rules';

function level(value: number): 'great' | 'good' | 'fair' | 'poor' {
  return value >= V3_LEVELS.great ? 'great' : value >= V3_LEVELS.good ? 'good' : value >= V3_LEVELS.fair ? 'fair' : 'poor';
}

/**
 * Для цели питаться здоровее продукт не может подходить лучше, чем он хорош сам по себе: Goal Match не выше Product Score.
 * Ниже может быть: это персональные факторы. Другие цели не ограничиваются, у них польза может отличаться от общей оценки.
 */
export function limitByProductScore<T extends GoalMatch | GoalMatchV4>(goalMatch: T, score: ProductScore): T {
  if (goalMatch.goal !== 'eat_healthier' || goalMatch.version === 'goal-match-v1') return goalMatch;
  if (goalMatch.value === null || score.value === null || goalMatch.value <= score.value) return goalMatch;
  const { range } = goalMatch;
  return { ...goalMatch, value: score.value, level: level(score.value), range: range && { min: Math.min(range.min, score.value), max: score.value } };
}
