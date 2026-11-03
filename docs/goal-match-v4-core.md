# Goal Match v4: core stages 1–5

Implemented locally on dev, 29 October 2026. Source: “AI-first Goal Match для eat_healthier”,
with the user's higher-priority corrections. No commit/push, provider call, API/mobile wiring,
.env edit, Product Score, Nutrition Engine, additive penalty, or other-goal change.

## Exact files in this task

| File | Change |
|---|---|
| packages/core/src/scoring/goal-match-ai.ts | New input/output contracts, closed band/dimension/factor/warning enums, AI metadata |
| packages/core/src/scoring/goal-match.ts | Opt-in GoalMatchV4 and its invalid_nutrition reason; live v1/v3 union unchanged |
| packages/core/src/scoring/index.ts | Export AI contracts |
| packages/core/package.json | Core type-contract test command; no dependency changes |
| packages/core/tsconfig.contract-tests.json | No-emit type-contract test configuration |
| packages/core/test/goal-match-ai.contract.ts | Valid/invalid type assignments, privacy and legacy compatibility checks |
| packages/scoring/src/nutrition-sanity.ts | Pure, partial-data-safe sanity check |
| packages/scoring/src/goal-match-ai-input.ts | prepareGoalMatchV4 guards, input builder, restriction-free deterministicBase |
| packages/scoring/src/goal-match-ai-validate.ts | Strict shape, rubric, references, numbers, code and language validation |
| packages/scoring/src/goal-match-reconcile.ts | Pure corridor, ceilings, restrictions and confidence reconciliation |
| packages/scoring/src/goal-match-v3.ts | Append-only export of existing deterministic extraction/calculation context |
| packages/scoring/src/index.ts | Export the opt-in core functions |
| packages/scoring/src/test/goal-match-v4.helpers.ts | Test-only product/input/output fixtures; not an AI provider |
| packages/scoring/src/test/nutrition-sanity.test.ts | Sanity rules, missing values, normalization, gate order |
| packages/scoring/src/test/goal-match-ai-input.test.ts | Exact yogurt example, privacy, missing protein |
| packages/scoring/src/test/goal-match-ai-validate.test.ts | All 18 factor codes and validation failure classes |
| packages/scoring/src/test/goal-match-reconcile.test.ts | Corridor boundaries, ceilings, restrictions and regression scenarios |
| packages/scoring/src/test/goal-match-v4-additional.test.ts | Confidence, warnings, missing aliases, finite values and legacy invariants |
| docs/goal-match-v4-core.md | This report and actual generated yogurt AI input |

Existing uncommitted work predates this task and is not included in this list.
Existing v3 tests/fixtures were not rewritten.

## Types and activation boundary

New exported types: GoalMatchAiInput, GoalMatchAiOutput, GoalMatchAiBand,
GoalMatchAiDimension/Value, GoalMatchAiNutrientLevel, GoalMatchAiFactor/Code,
GoalMatchAiWarning, GoalMatchAiMetadata, GoalMatchV4, GoalMatchV4UnavailableReason.

v4 includes source, ai, deterministic (the original v3 snapshot), adjusted,
ai_disagreement, and invalid_nutrition. GoalMatchV1/V3 remain valid and unchanged.
The live GoalMatch union deliberately remains v1|v3 until explicit API/mobile integration.
All v4 values are 0–10. Raw validated AI scores use steps of 0.5; corridor adjustment
can produce one-decimal final scores such as 5.7.

## Nutrition sanity

All comparisons use per-100 g/ml values; per-serving normalization requires a valid
known serving. Each comparison runs only if all of its own operands are known:

- sugars > carbs + 0.5;
- saturated fat > total fat + 0.5;
- protein + fat + carbs + salt > 105;
- abs(4*protein + 4*carbs + 9*fat + 2*fiber - kcal) > 40 AND > 0.35*kcal;
- salt > 30, or kcal > 900.

Sodium uses the existing conversion to salt (mg × 0.0025). Null/undefined/non-finite
operands are not converted to zero. Missing fiber prevents the energy comparison;
it does not prevent the other independently complete comparisons.
The new check is wired into prepareGoalMatchV4 after existing terminal/conflict/missing
guards and before not_applicable. The live v3 router is unchanged.

## Input and missing protein

The input contains product/normalized semantics, rounded nutrition facts and plan targets.
No Product Score, v3 score/range, allergens, diet, avoided terms, age or sex are sent.
Restrictions remain outside input.

The builder reuses v3 nutrients/serving/features/calculation. Risk levels use normalized
raw ramps; protein/fiber levels use actual v3 bonus/max ratios. Thresholds: high >=0.8,
moderate >=0.3, otherwise low; unavailable nutrient means unknown.
Facts are rounded once, from unrounded data, to one decimal.

Missing protein produces null per100/perServing/share/density fields, unknown protein
level and missing proteinG. It does not block preparation. Existing v3 bonus=0,
confidence<=medium, uncertainty protein, and no fabricated protein range are preserved.
Fiber behavior is preserved. Explicit deterministic zero inferences for sugars/saturated
fat are available derived facts, rather than missing fields.

As specified in section 7, accepted v4 AI results receive an additional low data-confidence
cap when both protein and fiber are missing, or an actually used AI serving has medium
confidence. The underlying v3 confidence is not changed. Plain provider-unavailable fallback
retains v3 confidence.

## Actual Greek yogurt AI input

Generated by buildGoalMatchAiInput, matching the document's 2230 kcal / 139 g protein plan
and the displayed label/ingredients. The test compares the complete object.

```json
{
  "version": "goal-match-ai-input-v1",
  "goal": "eat_healthier",
  "locale": "ru",
  "product": {
    "name": "Греческий йогурт 2%",
    "brand": null,
    "category": "dairy",
    "ingredients": [
      "молоко нормализованное",
      "закваска"
    ],
    "ingredientsStatus": "observed",
    "additives": [],
    "basis": "per_100g",
    "per100": {
      "kcal": 66,
      "proteinG": 9.5,
      "fatG": 2,
      "saturatedFatG": 1.3,
      "carbsG": 3.6,
      "sugarsG": 3.6,
      "fiberG": null,
      "saltG": 0.1
    },
    "serving": {
      "amount": 130,
      "unit": "g",
      "source": "label"
    }
  },
  "semantics": {
    "sugarSource": {
      "value": "intrinsic",
      "confidence": "high"
    },
    "processing": {
      "value": "whole_or_minimal",
      "confidence": "high"
    },
    "productForm": {
      "value": "food",
      "confidence": "high"
    }
  },
  "facts": {
    "perServing": {
      "kcal": 85.8,
      "proteinG": 12.4,
      "sugarsG": 4.7,
      "freeSugarsG": 0,
      "saturatedFatG": 1.7,
      "saltG": 0.1,
      "fiberG": null
    },
    "share": {
      "dailyKcalPct": 3.8,
      "proteinTargetPct": 8.9,
      "freeSugarLimitPct": 0,
      "saturatedFatLimitPct": 8.5,
      "saltLimitPct": 2.6
    },
    "density": {
      "proteinKcalPct": 57.6,
      "fiberPer100kcal": null,
      "saturatedFatPer100kcal": 2
    },
    "levels": {
      "protein": "high",
      "fiber": "unknown",
      "freeSugar": "low",
      "saturatedFat": "low",
      "salt": "low"
    }
  },
  "user": {
    "dailyKcal": 2230,
    "proteinTargetG": 139,
    "fatTargetG": 74,
    "carbsTargetG": 251
  },
  "missing": [
    "fiberG"
  ]
}
```

## Validator

- Strict closed schema: exact keys/enums, 1–4 unique factors, descending impact,
  1–3 fact references, Russian text lengths, one-sentence summary, finite half-point score.
- Score band boundaries and all five dimension-consistency rules.
- very_poor_fit main-role interpretation: at least 50% of energy from free sugars or
  saturated fat, or >=3 strong_negative dimensions. The document did not specify a numeric
  definition of “main role”; 50% is explicit here and tested. It is validation, not scoring.
- Fact references resolve own JSON scalar leaves; semantic object references and prototype
  paths are rejected. product.ingredients is the explicitly allowed list of strings;
  numeric ingredient indices are supported, .length is not a JSON leaf.
- A field in missing cannot be referenced or used through a derived nutrient alias.
- Numbers in text and summary must match referenced values; integer percentage rounding
  is allowed. References to product/brand, scores, user profile, etc. are not allowed.
- Preconditions and direction for all 18 factor codes. Ingredient-based codes require
  observed ingredients; word lists live in code. No product-name scoring rules.
- Unsupported warnings, forbidden medical language and unsupported absence claims rejected.
  “Без сахара” additionally requires known zero sugar; “без добавок” requires an observed,
  known empty additive list as well as whole_food.
- A single invalid non-high factor can be removed, with a medium confidence cap at reconciliation.
  A removed high factor, >1 removed factor, or no surviving factors invalidates the output.
- Summary errors invalidate the response (section 9's explicit whole-response rule).
  A deterministic fallbackSummary from up to two valid factors is returned for repair/retry.
  It never makes an otherwise invalid AI result usable. This resolves the document's
  simultaneous “replace summary” wording conservatively.

The validator returns errors; it does not call/retry a provider.

## Reconciliation

Inputs: validated AI output (or null), original deterministic v3, restriction-free
deterministicBase and its range, raw normalized risk ramps, and restrictions.

1. Terminal/conflict v3 results remain terminal; no AI result can override them.
2. Corridor is [clamp(base.range.min-3.5,0,10), clamp(base.range.max+1.5,0,10)].
3. Inside: take AI directly, no averaging.
4. Outside by <=1: clamp to boundary, source ai, adjusted true, confidence<=medium.
5. Further outside: take deterministic base, source deterministic, ai_disagreement true,
   confidence<=medium; ai=null, so no AI reasons leak into fallback.
6. Risk ceilings: sugar>=0.8 ->4.5; saturated fat>=0.8 ->5; salt>=0.8 ->5.5;
   >=2 high risks ->3.5.
7. Apply may_contain -3 and avoided -4 once, after ceilings, then clamp/round to 0–10
   and classify at the existing v3 thresholds 8/6.5/4.5.

Using restriction-free base avoids applying the same penalty twice or trying to reconstruct
a base from an already clipped zero result. No Product Score is accepted as an argument.

AI metadata retains the original validated output and version identifiers. Until provider
integration supplies model/cache metadata, model is explicitly “not-connected”.
The original v3 snapshot/range is retained in deterministic. An accepted AI result has
range=null: the contract provides no AI interval, so the code does not fabricate one.

## Regression results

| Case | v3 | AI proposal | Final | Source |
|---|---:|---:|---:|---|
| Chips | 4.2 | 3.0 | 3.0 | ai |
| Protein bar with explicitly declared test nutrients | 8.9 | 5.5 | 5.5 | ai |
| Cola hallucination | 2.5 | 9.0 | 2.5 | deterministic; disagreement |
| Chips optimistic proposal | 4.2 | 6.5 | 5.7 | ai; adjusted |
| Apple | 8.5 | 8.5 | 8.5 | ai |
| Chips, missing protein | 4.2 | not required | numeric preparation allowed | v3 preserved |
| Yogurt, missing protein | 6.6 | not required | numeric preparation allowed | v3 preserved |

The document's 9.2 AI example is invalid under its half-point schema, so 9.0 is the
schema-valid hallucination regression. 9.2 would be rejected even before reconciliation.
No claim is made about a real Meta model's behavior; all AI outputs here are test data.

## Verification

- Step 1 full pnpm typecheck: passed.
- Final full pnpm typecheck: passed.
- Full pnpm test: 261 runtime tests passed (scoring 170, API 20, mobile 12, AI 42,
  nutrition 17), plus core no-emit type-contract tests.
- 23 exact v3 before/after JSON comparisons: unchanged.
- 161 earlier Goal Match / Product Score baseline comparisons, including v1 and missing
  protein inputs: unchanged.
- Existing v3 functions are byte-for-byte unchanged within the source file; only the
  context-export function is appended.
- No Meta call or provider change, no new mock provider, no ScanService/mobile change,
  no .env/architecture activation, no commit/push.

## Scope decisions relative to the document

- Stages 1–5 only. Provider/cache/retry/API/mobile/goal registry integration remain deferred.
- invalid_nutrition is active only in the opt-in v4 preparation path, rather than changing
  the running v3 API/mobile contract.
- The missing typo is corrected: listed means unavailable.
- Missing protein follows current v3, never the obsolete critical-protein gate.
- Sanity checks require all operands; unknown fiber is not zero energy.
- Corridor comparisons use already clamped 0–10 bounds.
- Semantic references are leaf paths such as semantics.processing.value.
- Summary handling and the “main role” validation threshold are stated explicitly above;
  these are resolutions of ambiguous wording, not changes to the scoring formula.
