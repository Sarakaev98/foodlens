import type {
  GoalMatch, GoalMatchV1, GoalMatchV3, GoalMatchV4, GoalMatchAiInput, GoalMatchAiOutput,
  GoalMatchAiFactorCode, GoalMatchAiWarning, GoalMatchAiBand,
} from '../src';

declare const v1: GoalMatchV1;
declare const v3: GoalMatchV3;
declare const v4: GoalMatchV4;
const existing1: GoalMatch = v1;
const existing3: GoalMatch = v3;
// v4 deliberately stays opt-in while live API and Mobile remain v1/v3.
// @ts-expect-error v4 must not silently enter the live API union
const existing4: GoalMatch = v4;
const version: 'goal-match-v4' = v4.version;
const original: GoalMatchV3 = v4.deterministic;
const reason: GoalMatchV4['unavailableReason'] = 'invalid_nutrition';
const band: GoalMatchAiBand = 'good_fit';
const code: GoalMatchAiFactorCode = 'sweeteners';
const warning: GoalMatchAiWarning = 'fiber_unknown';
// @ts-expect-error unapproved factor codes must not enter the contract
const invalidCode: GoalMatchAiFactorCode = 'additive_count';
// @ts-expect-error score bands are closed
const invalidBand: GoalMatchAiBand = 'healthy';
// @ts-expect-error warnings are closed
const invalidWarning: GoalMatchAiWarning = 'medical_advice';
declare const input: GoalMatchAiInput;
const protein: number | null = input.product.per100.proteinG;
// @ts-expect-error unknown protein must not silently become a number
const assumedProtein: number = input.product.per100.proteinG;
// @ts-expect-error AI input must never contain Product Score
input.productScore;
// @ts-expect-error AI input must never contain a deterministic score
input.deterministic;
// @ts-expect-error personal restrictions are intentionally absent
input.user.allergens;
declare const output: GoalMatchAiOutput;
const outputVersion: 'goal-match-ai-v1' = output.version;
// @ts-expect-error arbitrary dimensions are not part of the rubric
output.dimensions.medical;
void [existing1,existing3,existing4,version,original,reason,band,code,warning,invalidCode,invalidBand,invalidWarning,protein,assumedProtein,outputVersion];
