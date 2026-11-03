/** Approved Claude design, 28 October 2026. All numbers here use the 0–10 formula scale. */
export const GOAL_MATCH_V3_VERSION = 'goal-match-v3';
export const EAT_HEALTHIER_BASE = 6;
export const MAX_HEALTH_BONUS = 4;
export const FREE_SUGAR_LIMIT_G = 50;
export const SATURATED_FAT_LIMIT_G = 20;
export const SALT_LIMIT_G = 5;
export const PROTEIN_BONUS_MAX = 2.5;
export const FIBER_BONUS_MAX = 1.5;
export const MIN_PROTEIN_PER_SERVING_G = 2;
export const SORTED_RISK_WEIGHTS = [1, 0.5, 0.25] as const;
export const V3_LEVELS = { great: 8, good: 6.5, fair: 4.5 } as const;
export const UNCERTAINTY_WIDTH = { high: 0.5, medium: 1.5, ambiguous: 3 } as const;

/** A linear ramp, including stable endpoints for zero-energy concentrations. */
export function ramp(value: number, start: number, end: number): number {
  return Math.max(0, Math.min(1, (value - start) / (end - start)));
}

export function clampHealthScore(value: number): number {
  return Math.max(0, Math.min(10, value));
}
