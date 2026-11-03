# Goal Match prompt v2 — band/dimension diagnostic and bounded live retest

Date: 29 October 2026. Branch dev. No commit/push.

## Exact cause before any code changes

The two previously saved real Chips outputs both declared score 4.0 and band poor_fit:

| Dimension | Original attempt 1 | Original attempt 2 |
|---|---|---|
| nutrientDensity | negative | negative |
| processing | strong_negative | strong_negative |
| sugar | positive | neutral |
| fatQuality | positive | negative |
| sodium | negative | negative |
| portion | positive | positive |

The unchanged validator's exact predicate is:

```ts
strongNegative === 2 ||
(strongNegative === 1 && dimensions.processing === 'negative')
```

Each output has strongNegative=1. The first branch needs exactly two, and the second
requires processing to equal the literal enum negative, not strong_negative.
Ordinary negatives at nutrientDensity and sodium do not count as strong_negative.

The original prompt already expressed the same poor_fit rule in shorthand. There was
no logical rule disagreement to repair in the validator; the prompt did not define the
counters and exact enum comparisons explicitly. The original architecture also says
two strong negatives OR one strong negative with negative processing.

The observable explanations suggest Gemini chose a poor band from its overall assessment
of processing and salt, without satisfying its own dimension pattern. This is an inference
from returned fields, not a claim about hidden reasoning.

## Minimal change

Only the band-consistency instructions were expanded; anchors and all scoring/factor
rules were retained.

Counters over all six dimensions:
- SN counts exact strong_negative.
- N counts negative or strong_negative.
- P counts positive or strong_positive.
- SP counts exact strong_positive.
- neutral/not_assessed count toward none of those.

Exact conditions now explicitly prefixed “If band = ..., MUST satisfy”:
- excellent_fit: N==0 && P>=2 && SP>=1.
- good_fit: SN==0 && N<=1.
- mixed_fit: SN<=1.
- poor_fit: SN==2 || (SN==1 && processing=="negative").
- very_poor_fit: SN>=3 || (kcal>0 && (freeSugarEnergy/kcal>=0.5 || saturatedFatG*9/kcal>=0.5)).
  The existing validator's sugarSource coefficient is stated literally: intrinsic/none=0,
  mixed=0.5, otherwise=1.

The prompt explicitly rejects the original invalid pattern, says ordinary negative is
not strong_negative, and requires a final predicate check. It also forbids changing
dimension severity merely to fit a desired score/anchor. Conditions can overlap; no new
band-priority rule was added.

promptVersion was raised from eat-healthier-rubric-v1 to eat-healthier-rubric-v2.
Necessary literal references were updated in metadata typing, reconciliation metadata,
cache identity, and the existing metadata assertion. Reconciliation math is unchanged.
A regression test proves the same input/provider/model now has a different key from v1.

## Real retest: Chips first

Model gemini-3.5-flash-lite, same local key/project/location; no .env edit.
A fresh service uses prompt v2. Only the existing maximum two attempts are permitted.

| Field | New attempt 1 | New attempt 2 |
|---|---|---|
| HTTP | 200 | 200 |
| Latency | 2095 ms | 1508 ms |
| Raw score | 3.0 | 3.0 |
| Band | poor_fit | poor_fit |
| AI confidence | high | high |
| nutrientDensity | negative | negative |
| processing | strong_negative | strong_negative |
| sugar | neutral | positive |
| fatQuality | neutral | neutral |
| sodium | negative | negative |
| portion | positive | positive |
| Validator | false: band_dimensions | false: band_dimensions |

Both still have SN=1 and processing=strong_negative.
The explicit prompt clarification did not produce a valid dimension/band combination.

Attempt 1 factors:
- ultra_processed (negative/high): “Ультрапереработанный продукт с добавками” (“ultra-processed, with additives”).
- high_salt (negative/medium): “Содержание соли составляет 1.4 г на 100 г” (“salt is 1.4 g per 100 g”).

Attempt 2 factors:
- ultra_processed (negative/high): “Продукт ультрапереработан” (“the product is ultra-processed”).
- high_salt (negative/medium): “Содержание соли умеренное: 1.4 г на 100 г” (“salt is moderate: 1.4 g per 100 g”).

The first failing band check short-circuits validation; the outputs are not being asserted
to pass later fact/number checks.

Final Chips: v3=4.2, final=4.2, source=deterministic, confidence=medium,
outcome=ai_invalid, ai=null. No rejected AI reasons enter the displayed result.

As explicitly requested, no more prompt changes or live attempts were made.
No stronger model was selected.

## Greek yogurt regression

Not run live: Chips failed twice, so the required prerequisite was not met.
The previous task's yogurt 9.0 result is historical, not a prompt-v2 regression result.
Mock v4, v3, provider and validator regression suites all passed offline.

## Full raw outputs

Both full, unmodified generated JSON objects with facts and summaries are preserved in
[goal-match-google-prompt-v2-live.json](goal-match-google-prompt-v2-live.json).

The original two score-4.0 responses remain unchanged in
[goal-match-google-live-results.json](goal-match-google-live-results.json).
They were also copied verbatim into a test-only regression fixture.

## Exact changed/added files

1. packages/ai/src/goal-match/goal-match-prompt.ts — explicit band predicates and self-check.
2. packages/core/src/scoring/goal-match-ai.ts — promptVersion metadata literal v2 only.
3. packages/scoring/src/goal-match-reconcile.ts — promptVersion metadata literal v2 only.
4. apps/api/src/modules/goal-match/goal-match-ai-cache.ts — promptVersion constant v2 only.
5. apps/api/src/modules/goal-match/test/goal-match-v4.test.ts — metadata assertion v2 only.
6. packages/ai/src/test/goal-match-prompt.test.ts — explicit prompt contract coverage.
7. apps/api/src/modules/goal-match/test/google-chips-band-regression.fixtures.ts — both original saved raw outputs, test data only.
8. apps/api/src/modules/goal-match/test/prompt-v2-regression.test.ts — unchanged rejection, exact admissible patterns, cache invalidation, Mock regression.
9. apps/api/scripts/retest-google-goal-match-prompt.cjs — manual bounded real retest, Chips before yogurt.
10. docs/goal-match-google-prompt-v2-live.json — new raw results.
11. docs/goal-match-google-prompt-v2.md — this report.

## Checks and security

- pnpm typecheck: passed.
- pnpm test: 305 runtime tests passed plus core type-contract checks.
  Scoring 170, AI 54, API 52, mobile 12, nutrition 17.
- Existing Google provider tests, validator tests, Mock v4 and v3 regressions passed.
- 173 protected-file hashes checked. Only the two required metadata-version literals
  changed in core/scoring; replacing v2 with v1 makes those files identical to their
  before-task copies.
- Validator, scoring formulas, v3, corridor, ceilings, reconciliation logic, Nutrition
  Engine, Product Score, Mobile, provider API, output schema and Mock responses unchanged.
- .env byte hash unchanged.
- Prompt hash frozen before first new live request and unchanged after failures.
- No key in new scripts, fixtures or reports. No raw upstream error diagnostics exposed.
- No commit or push.

Next decision belongs to the user: further prompt calibration or a stronger model.
