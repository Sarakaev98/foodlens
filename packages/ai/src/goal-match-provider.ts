import type { GoalMatchAiInput, GoalMatchAiOutput } from '@foodlens/core';

/** A text-only second-step evaluator; never used for Scan image extraction. */
export interface GoalMatchEvaluator {
  readonly name: string;
  readonly model?: string;
  evaluateGoalMatch(input: GoalMatchAiInput): Promise<GoalMatchAiOutput>;
}
