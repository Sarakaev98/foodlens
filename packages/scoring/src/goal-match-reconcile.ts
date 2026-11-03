import type { ConfidenceLevel, GoalMatchAiMetadata, GoalMatchAiOutput, GoalMatchFactor, GoalMatchV3, GoalMatchV4 } from '@foodlens/core';
import { clampHealthScore, V3_LEVELS } from './goal-match-v3-rules';
import { deterministicV4 } from './goal-match-ai-input';

export interface GoalMatchReconciliationInput {
  /** Schema/fact-validated output; null means no usable AI answer. */
  readonly ai: GoalMatchAiOutput | null;
  readonly deterministic: GoalMatchV3;
  /** v3 with NO may_contain / avoided penalties, including its unclipped range. */
  readonly deterministicBase: GoalMatchV3;
  readonly riskRamps: { readonly sugars: number; readonly saturatedFat: number; readonly salt: number };
  readonly restrictions: readonly GoalMatchFactor[];
  readonly aiStatus?: 'unavailable' | 'invalid';
  readonly validationAdjusted?: boolean;
  /** Extra v4 data cap from preparation (missing both bonuses / medium AI serving). */
  readonly dataConfidence?: ConfidenceLevel;
  readonly metadata?: { readonly model: string; readonly cacheHit: boolean };
}
const confidenceOrder: readonly ConfidenceLevel[] = ['low','medium','high'];
function minConfidence(...levels: ConfidenceLevel[]): ConfidenceLevel {
  return confidenceOrder[Math.min(...levels.map(x=>confidenceOrder.indexOf(x)))]!;
}
const round = (x: number) => Math.round((x + Number.EPSILON)*10)/10;
export function goalMatchRiskCeiling(risks: GoalMatchReconciliationInput['riskRamps']): number {
  let ceiling = 10;
  if (risks.sugars >= .8) ceiling = Math.min(ceiling,4.5);
  if (risks.saturatedFat >= .8) ceiling = Math.min(ceiling,5);
  if (risks.salt >= .8) ceiling = Math.min(ceiling,5.5);
  if (Object.values(risks).filter(x=>x>=.8).length >= 2) ceiling = Math.min(ceiling,3.5);
  return ceiling;
}
/** Pure reconciliation. No provider, IO, Product Score, averaging, or retry. */
export function reconcileGoalMatch(input: GoalMatchReconciliationInput): GoalMatchV4 {
  const { deterministic: d, deterministicBase: base, ai, riskRamps, restrictions } = input;
  if (d.state !== 'goal_match' || d.level === 'conflict' || d.value === null) return deterministicV4(d);
  if (base.value === null || base.range === null) throw new Error('Numeric deterministicBase required');
  if (!Object.values(riskRamps).every(x=>Number.isFinite(x) && x>=0 && x<=1)) throw new Error('Invalid risk ramps');
  const low = clampHealthScore(base.range.min - 3.5), high = clampHealthScore(base.range.max + 1.5);
  let value = base.value, source: GoalMatchV4['source'] = 'deterministic', adjusted = false, disagreement = false;
  let confidence = d.confidence ?? 'medium';
  let accepted: GoalMatchAiMetadata | null = null;
  if (ai) {
    if (!Number.isFinite(ai.score) || ai.score < 0 || ai.score > 10) throw new Error('AI score must be validated in 0–10');
    const distance = ai.score < low ? low-ai.score : ai.score > high ? ai.score-high : 0;
    if (distance > 1 + 1e-10) {
      disagreement = true; confidence = minConfidence(confidence,'medium');
    } else {
      source = 'ai'; value = Math.max(low,Math.min(high,ai.score));
      adjusted = distance > 1e-10 || !!input.validationAdjusted;
      confidence = minConfidence(confidence,input.dataConfidence ?? confidence,ai.confidence,...(adjusted ? ['medium' as const] : []));
      accepted = { ...ai, inputVersion:'goal-match-ai-input-v1', promptVersion:'eat-healthier-rubric-v2',
        model:input.metadata?.model ?? 'not-connected', cacheHit:input.metadata?.cacheHit ?? false };
    }
  } else if (input.aiStatus === 'invalid') confidence = minConfidence(confidence,'medium');
  const ceiling = goalMatchRiskCeiling(riskRamps);
  // Constraints are applied to the restriction-free result once, after ceilings.
  const penalty = restrictions.reduce((sum,f) => sum +
    (f.kind === 'allergens' && f.level === 'may_contain' ? 3 : f.kind === 'avoidedIngredients' && f.level === 'conflict' ? 4 : 0),0);
  value = round(clampHealthScore(Math.min(value,ceiling)-penalty));
  const level = value >= V3_LEVELS.great ? 'great' : value >= V3_LEVELS.good ? 'good' : value >= V3_LEVELS.fair ? 'fair' : 'poor';
  return { ...d, version:'goal-match-v4', source, ai:accepted, deterministic:d, adjusted,
    ai_disagreement:disagreement, value, level, confidence,
    factors: source === 'ai' ? restrictions : d.factors,
    range: source === 'ai' ? null : d.range };
}
