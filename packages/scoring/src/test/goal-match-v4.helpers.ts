import type { GoalMatchAiInput, GoalMatchAiOutput, GoalMatchAiFactor, GoalMatchV3 } from '@foodlens/core';
import { buildGoalMatchAiInput } from '../goal-match-ai-input';
import { HEALTH_FIXTURES, fixtureProduct, healthPlan } from './eat-healthier.fixtures';
export type Mutable<T> = { -readonly [K in keyof T]: T[K] extends object ? Mutable<T[K]> : T[K] };
export const v4Product = (id='yogurt') => fixtureProduct(HEALTH_FIXTURES.find(x=>x.id===id)!);
export const v4Input = (id='yogurt'): Mutable<GoalMatchAiInput> => JSON.parse(JSON.stringify(buildGoalMatchAiInput(v4Product(id),healthPlan())!));
export function aiOutput(score=8.5, factors: readonly GoalMatchAiFactor[] = [{
  code:'high_protein', direction:'positive', impact:'high',
  facts:['facts.perServing.proteinG','facts.share.proteinTargetPct'], text:'12.4 g protein per serving, 9% of daily goal',
}]): GoalMatchAiOutput {
  return { version:'goal-match-ai-v1', score,
    band: score>=9?'excellent_fit':score>=7?'good_fit':score>=5?'mixed_fit':score>=3?'poor_fit':'very_poor_fit',
    confidence:'high',
    dimensions:{ nutrientDensity:'positive', processing:'strong_positive', sugar:'neutral', fatQuality:'neutral', sodium:'neutral', portion:'neutral' },
    factors, summary:'Fits your goal.', warnings:[] };
}
export function numericV3(value:number): GoalMatchV3 {
  return { version:'goal-match-v3', goal:'eat_healthier', value, level:value>=8?'great':value>=6.5?'good':value>=4.5?'fair':'poor',
    unavailableReason:null, state:'goal_match', confidence:'high', range:{min:value,max:value}, uncertainty:[], portion:null,factors:[] };
}
