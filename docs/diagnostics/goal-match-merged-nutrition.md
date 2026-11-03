# FoodLens: Goal Match on the final nutrition snapshot

November 3, 2026. Branch dev, HEAD 033556fbc2ae35ae10878d9030591d936ac8eb6d; the changes were local and not pushed at the time.

## Exact cause and fix

In `apps/api/src/modules/scan/scan.service.ts::analyze` there were two different inputs after estimation:

```ts
const completed = estimateMissingNutrition(flow.product);
const scoring = withIngredientFacts(forScoring(completed));
const score = scoreProduct(scoring);
// previous code:
const rawGoalMatch = await this.matchGoal(withIngredientFacts(forScoring(flow.product)), await plan, requestId);
```

`flow.product` is the result of the sources before estimation. Goal Match was called after estimation in time, but it received the old object with nulls. It did not read a stale response or status from a cache, and nutrition_presence did not control its gating: v3 checked for null directly in the product.nutrition it was given.

Now both scores receive the same `scoring` constant:

```ts
const score = scoreProduct(scoring);
const rawGoalMatch = await this.matchGoal(scoring, await plan, requestId);
const goalMatch = limitByProductScore(rawGoalMatch, score);
```

There are no branches by name, brand or barcode. Scoring weights, the v3/v1 numeric formulas, thresholds and the estimation algorithm did not change.

GOAL_MATCH_INPUT (nutrition + nutritionMetadata, without the user's plan) and GOAL_MATCH_RESULT logs were added under the existing debug flag. The checks compare SCORING_INPUT, GOAL_MATCH_INPUT and the response's product.nutrition: the objects serialize identically and provenance is kept.

v3 already accepted numeric inferred values: the missing check looks at a finite, non-negative number, not at observed provenance. There is one small metadata refinement: if nutritionMetadata contains estimated/ai_estimated fields or an estimated basis, the input is not treated as a fully read label. The existing confidence/uncertainty branch is used, including uncertainty=nutrition. This does not change the numeric formula, but it stops a single estimated fiber value from wrongly raising confidence to high.

## Data path

`POST /scan/analyze` → controller → normalize/lookup/enrichment → estimateMissingNutrition → completed → forScoring/withIngredientFacts → one `scoring` for scoreProduct and matchGoal → the existing limitByProductScore → response → useProductScan → GoalMatchCard.

v3 for eat_healthier now checks missing_nutrients on the filled values. A truly missing sugar value with non-zero carbs at the Goal Match boundary still gives insufficient_data/missing_nutrients; this is tested separately from the estimator. A missing profile, an unknown basis, missing semantic context and profile restrictions keep their existing policies.

For other goals v1 also receives the completed snapshot; its API units stay 0–100, and mobile still shows 0–10. The optional v4 receives the same completed product. Test AI answers with a stale fiber_unknown warning no longer match the filled input and are still rejected by the validator; neither the formula nor the validator was relaxed for them.

## Real endpoint check

Before the restart the real HTTP endpoint was called again for Rollton: Product Score=3.2, missingFactors=[], but Goal Match value=null, state=insufficient_data, unavailableReason=missing_nutrients. The raw response was saved in the chat artifacts as `goal-merged-rollton-before.json`.

After the tests and the build passed, the old API was stopped and port 3000 was confirmed free. The new API:

- PID **25316**, started November 3 at **08:42:01 Asia/Tbilisi**;
- workingDirectory `C:\Users\sarak\Documents\FoodLens\apps\api`;
- command `E:\nodejs\node.exe dist/main.js`, a fresh build of the current dev working tree;
- `/health`: HTTP 200, `{"status":"ok"}`;
- phone address: `http://192.168.1.100:3000`;
- .env did not change; its SHA256 matches the previous run.

Real `POST http://192.168.1.100:3000/scan/analyze` calls were made, multipart/form-data with a single barcode field and no photo. That is the same endpoint and format as mobile analyzeBarcode. No fixtures, direct scoring engine calls or service helpers were used in these HTTP checks.

| | Rollton 4605496000815 | Choco Pie 4607084351385 |
|---|---|---|
| HTTP | 200 | 200 |
| Request ID | 392ba591-9580-4024-89ac-7291e1bcc8e1 | 005deb46-f289-44ef-b127-51f3b51aacc0 |
| cacheHit | **false** | **false** |
| Product Score | **3.2/10** | **1.8/10** |
| Goal Match v3, before limitByProductScore | 4.0 | 2.3 |
| Goal Match in JSON | **3.2/10** | **1.8/10** |
| state | goal_match | goal_match |
| unavailableReason | null | null |
| confidence | medium | medium |
| uncertainty | [nutrition] | [nutrition] |
| Product Score missingFactors | [] | [] |
| missing_nutrients | false: unavailableReason=null | false: unavailableReason=null |

The final cap of Goal Match by the Product Score is the existing policy for eat_healthier. The two scores being equal does not mean a new shared formula.

For each barcode this was the first scan of the new process. The lookup provider caches and the web search memory were fresh; the real enrichment_summary contains cacheHit:false and 8 search queries. No persistent records or user plans were deleted. Goal Match AI is off in the current configuration, so v3 is used.

### Merged nutrition and Goal Match input

All values are per 100 g; the values in the last five rows are estimated/low with provenance=inferred. The known macros are the existing verified/source data with confidence=medium. NutritionMetadata is not removed before Goal Match.

| Field | Rollton | Choco Pie |
|---|---:|---:|
| caloriesKcal | 350 | 433, refined by enrichment |
| proteinG | 6 | 4.5 |
| carbsG | 65 | 63 |
| fatG | 7.5 | 18 |
| sugarsG | 3.9 | 28.35 |
| saturatedFatG | 2.25 | 9 |
| fiberG | 3 | 2 |
| saltG | 1.5 | 0.5 |
| sodiumMg | 600 | 200 |
| servingSize | 40 g | 30 g |

The logged SCORING_INPUT.nutrition and GOAL_MATCH_INPUT.nutrition were checked to be equal, as were GOAL_MATCH_INPUT.nutritionMetadata and the metadata in the real response.

For Rollton, v3 counts salt (0.6 g per serving, 12% of the daily limit) and ultra_processed; sugar arrives as 3.9 g/100 g, but its penalty depends on the existing sugarSource=intrinsic, so the free sugar factor is 0. That formula behavior did not change. For Choco Pie free sugar, saturated fat and processing are counted. Separate tests with added sugar prove the contribution of inferred sugar when the penalty is non-zero.

Rollton: Gemini was not called. Choco Pie: the existing nutrition extraction from page text, model=gemini-3.5-flash-lite, usage prompt=1926, output=93, total=2019; thoughts/cached=null. Gemini was not called for Goal Match in these HTTP requests.

### Actual JSON

The full bodies without manual edits were saved next to this report locally and are not included in the repository:

- `goal-match-rollton-http.json` — the full Rollton response.
- `goal-match-choco-http.json` — the full Choco Pie response.
- `goal-match-merged-evidence.json` — stages, inputs/outputs, cacheHit, validation and the UI check result.

Key actual Goal Match fields for Rollton:

```json
{
  "version": "goal-match-v3",
  "goal": "eat_healthier",
  "state": "goal_match",
  "value": 3.2,
  "level": "poor",
  "unavailableReason": null,
  "confidence": "medium",
  "uncertainty": ["nutrition"]
}
```

`missing_nutrients` is not a separate API field: it is an unavailableReason code, and it is now null. `needsPhoto` and the top-level status are absent from the raw successful JSON, as before; mobile treats a missing needsPhoto as false. No artificial false fields were added to the response body.

## Mobile UI on the real response

The real GoalMatchCard and goalMatchLabels were run with the JSON of both HTTP responses, with stubbed native primitives as in the existing mobile tests. Checked:

- a numeric value, state=goal_match, unavailableReason=null;
- the line «Для персональной оценки не хватает данных о пищевой ценности» (“not enough nutrition data for a personal score”) is absent;
- Rollton shows 3,2/10, «Плохо подходит» (“poor fit”) and reasons about salt and an ultra-processed product;
- Choco Pie shows 1,8/10 and reasons about free sugar, processing and saturated fat;
- the existing note about unverified halal certification comes from the saved profile and is not a nutrition gap.

The UI code did not change. This is a check of the actual components, not an observation of the physical phone screen. A new scan from the phone will get the updated values from the API that was left running.

## Tests and changed files

**1175 tests, 0 failures**: API 683, scoring 240, AI 117, nutrition 38, mobile 97; the core contract type tests passed. Typecheck and the API build succeeded. The real HTTP checks of both barcodes and the UI checks of both JSON responses passed.

Production:

1. `apps/api/src/modules/scan/scan.service.ts` — passing the same scoring snapshot to Goal Match, plus diagnostic logs.
2. `packages/scoring/src/goal-match-v3.ts` — using estimated metadata only for confidence/uncertainty, without changing the numeric formula.

Tests:

3. `apps/api/src/modules/scan/test/goal-match-merged.test.ts` — 11 new checks: verified/inferred nutrition, the contribution of sugar/saturated fat/salt, estimated fiber, snapshot equality, truly missing data, v1, Rollton and Choco Pie.
4. `apps/api/src/modules/goal-match/test/goal-match-v4.test.ts` — completed API input and preserved raw boundary validation, including a stale AI warning.
5. `apps/api/src/modules/scan/test/google-scan.test.ts` — completed nutrition for Goal Match; the test AI answer matches the filled input.
6. `apps/api/src/modules/scan/test/scan-multi-photo.test.ts` — Goal Match after missing values are filled from several photos.
7. `apps/api/src/modules/scan/test/scan-open-food-facts.test.ts` — a numeric result after completion without OFF.
8. `apps/api/src/modules/scan/test/scan.test.ts` — unavailableReason logs after completion and the contribution of estimated protein.

Documentation: this report, the evidence, the two actual HTTP JSON files and a note about the updated wiring in the earlier report mvp-nutrition-estimation.md.

Formulas, the estimator, values tuned to examples, .env and UI source files did not change. The API was left running; no push or commit was made at the time.
