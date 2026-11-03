# Goal Match band ordinal validation fix

29 October 2026, dev. No commit/push.

## Change

Only the processing threshold in the second poor_fit branch changed:

```ts
strongNegative === 2 ||
(strongNegative === 1 &&
  (dimensions.processing === 'negative' ||
   dimensions.processing === 'strong_negative'))
```

This applies the requested negative-or-worse semantics. It does not change the exact
strong-negative count rules or any score, band boundary, factor precondition or numeric check.

The original saved Chips responses now pass the band guard. Independent later factor
checks remain active; the old second response loses its unsupported-number salt factor
under the pre-existing one-non-high-factor removal rule.

## Audit of the other band/dimension rules

| Rule | Ordinal interpretation | Result |
|---|---|---|
| excellent_fit | Negative count includes negative and strong_negative. Positive count includes positive and strong_positive; one strong positive still explicitly required. | Already correct |
| good_fit | Strong negatives explicitly prohibited; ordinary negatives limited to one. | Already correct |
| mixed_fit | Explicit maximum of one strong_negative, not a negative-or-worse enum comparison. | Unchanged |
| poor_fit | Processing negative means negative or strong_negative. Exactly-two-SN branch retained. | Fixed |
| very_poor_fit | Explicit >=3 strong_negative count or existing energy-share criterion. | Unchanged |
| not_assessed | Unassessed state, outside positive/negative counts. | Already correct |

No additional ambiguous ordinal comparisons were found. No other band rule was modified.

## Tests before live requests

- Full pnpm typecheck passed.
- Full pnpm test passed: 311 runtime tests, plus core type-contract checks.
- Scoring 176, AI 54, API 52, mobile 12, nutrition 17.
- Mandatory cases: poor_fit / SN=1 accepts processing strong_negative;
  SN=1 elsewhere plus processing negative still passes;
  SN=1 elsewhere plus processing neutral fails.
- Additional coverage tests every processing enum/count combination, stronger positives
  in excellent_fit, the existing good_fit prohibition and mixed_fit count limit.
- Existing validator, Google provider, Mock v4 and v3 regression tests passed.
- The API regression asserting the old exact-equality bug was updated for the newly
  authorized behavior. Other saved fixture contents and Mock recordings were not changed.

## Exactly one real Chips call

Model: gemini-3.5-flash-lite. Prompt: unchanged eat-healthier-rubric-v2.
HTTP 200, 2666 ms. One request, no retry, no cache.

Raw output:
- score 3.5;
- band poor_fit;
- confidence high;
- dimensions:
  nutrientDensity negative;
  processing strong_negative;
  sugar positive;
  fatQuality neutral;
  sodium negative;
  portion positive.

Raw factors:
1. ultra_processed, negative/high:
   “Продукт ультрапереработан”
   facts: semantics.processing.value.
2. high_salt, negative/medium:
   “Содержание соли умеренное и составляет 1.4 г на 100 г”
   facts: product.per100.saltG, facts.levels.salt.
3. fits_portion, positive/low:
   “Порция составляет 8% от суточных калорий”
   facts: facts.share.dailyKcalPct.

Raw summary:
“Ультрапереработанный продукт с высоким содержанием жиров и умеренным количеством соли.”

Validator: valid=true, removedFactors=1, adjusted=true.
The ordinal band guard passed. The existing numeric-reference check removed high_salt:
1.4 is referenced, but 100 is not a numeric value of either referenced fact.
The accepted factors are ultra_processed and fits_portion.
No numeric-validation change or retry was made to restore the removed factor.

Reconciliation:
- v3 4.2;
- AI 3.5 lies inside corridor 0.7–5.7;
- final 3.5, source ai;
- confidence medium;
- adjusted=true reflects removal of a factor, not a score clamp;
- no corridor/risk-ceiling adjustment to the number.

This is a valid response after the validator's existing allowed cleanup, rather than
a claim that all generated reasons passed unchanged.

## Exactly one real Greek yogurt regression call

Chips returned valid=true, so the requested single yogurt call followed.
HTTP 200, 2157 ms. One request, no retry, no cache.

- v3 8.7;
- raw score 8.0;
- band good_fit;
- AI confidence high;
- all six dimensions positive;
- factors high_protein, low_sugar, low_salt;
- summary: “Продукт с высоким содержанием белка, низким количеством сахара и соли.”
- warning fiber_unknown;
- validator valid=true, removedFactors=0, adjusted=false;
- final 8.0, source ai, confidence medium (existing missing-fiber cap).

No score was forced toward a fixture anchor or previous live result.
The earlier 9.0 was a separate uncached model output, not an invariant.

## Artifacts

Full raw outputs, accepted factors, validation and final reconciliation:
[goal-match-google-ordinal-live.json](goal-match-google-ordinal-live.json).

## Exact files in this task

1. packages/scoring/src/goal-match-ai-validate.ts — processing negative-or-worse condition only.
2. packages/scoring/src/test/goal-match-band-ordinal.test.ts — six new ordinal regression tests.
3. apps/api/src/modules/goal-match/test/prompt-v2-regression.test.ts — update expectations
   that explicitly encoded the superseded exact-equality behavior.
4. apps/api/scripts/retest-google-goal-match-ordinal.cjs — separate explicit manual runner,
   one Chips request and, only after valid=true, one yogurt request.
5. docs/goal-match-google-ordinal-live.json — captured real results.
6. docs/goal-match-band-ordinal-fix.md — this report.

Prompt v2, anchors, promptVersion, v3/scoring formulas, corridor, reconciliation,
risk ceilings, Product Score, Nutrition Engine, provider API, output schema, Mobile,
Mock responses, cache code and .env remain unchanged.
No key was printed or placed in results.
No further requests or fixes were made after the two requested live calls.
