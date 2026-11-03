> **Updated note:** Goal Match now receives the same completed snapshot after estimation as the Product Score. See [goal-match-merged-nutrition.md](goal-match-merged-nutrition.md).

# FoodLens MVP: a complete Product Score with an estimation fallback

November 3, 2026. Repository `C:\Users\sarak\Documents\FoodLens`, branch `dev`. Nothing was sent to the remote at the time. The earlier diagnostics in `universal-pipeline.md` describe the previous requirements; the current request allows estimating missing nutrients.

## Result

A successfully recognized product goes through `scan → exact data → enrichment → estimation → normalized nutrition → existing Product Score`.

The new stage runs in ScanService after the database, web search and any available photo analysis, before the single existing scoreProduct. It returns numeric values for all nine nutrients the existing formulas need. For a product with a name, ingredients or a read table the Score becomes a number from 0 to 10. An unknown barcode with no name, ingredients or table is not declared a recognized product: a photo request remains for it.

The Product Score formula, weights, thresholds, calibration and coefficients did not change. There is no separate formula for estimated products. The low confidence of estimates does not block the calculation or the regular display of the result.

## How estimates work

`nutrition-estimator.ts::estimateMissingNutrition` is a pure deterministic function, `context-rules-v1`, with no network, no model requests, and no identifiers of specific products or brands. It uses:

- the known category; when the category is missing, generic food-type words in the name;
- the known calories and macros; sugars and saturated fat as lower bounds for missing carbs/fat;
- the ingredients and the position of sugar and salt in the ingredient order;
- signs of palm/coconut/butter fat or sunflower/olive fat;
- whole-grain ingredients, bran and legumes for fiber;
- product form, sugarSource and the available serving size.

Category profiles are explicitly estimated MVP priors, not verified composition analyses. Their numbers live separately from scoring. They only fill nulls. The brand takes part in the existing identification and enrichment but does not set the estimation coefficients. Processing is still counted by the existing scoring from the original semantics/ingredients; the estimator has no separate coefficient that softens processing.

Gemini stays in the existing enrichment step for extracting text from found pages. Estimation does not need Gemini and does not depend on extra tokens, sites or two confirmations being available.

When the macros themselves are missing, category priors with constraints are used. If calories are known, the remaining energy is distributed among the missing macros, taking into account the known sugars and saturated fat. If calories are missing, they are calculated by 4/4/9. When all exact values are present, the estimator keeps their objects unchanged and creates no estimated fields.

## Constraints and provenance

- Sugars are capped by carbs; saturated fat by fat, including after rounding.
- Estimated macros are capped by the available mass per 100 g/ml; lower bounds from known sugars and saturated fat are respected.
- Fiber is capped by the remaining mass, 30 g/100 g and an energy limit.
- Salt is estimated from the profile and its position in the ingredients, with an upper bound of 5 g/100 g. For special products such as pure salt this limit does not apply to exact values: they are kept.
- Known salt and sodium are first converted into each other: `saltG = sodiumMg × 2.5 / 1000`, and back `sodiumMg = saltG × 1000 / 2.5`. There is no separate independent sodium estimate.
- Estimates are scaled to the original serving; exact values are never recalculated or overwritten.
- An unknown basis or a missing serving size gets explicit estimated basis metadata with low confidence. This is an MVP assumption, not a found fact.
- Contradictions between known source values are not “fixed” by substitution. They are recorded in `nutritionMetadata.constraints`, and the Score is not blocked by them.

The API keeps the existing value/provenance. New calculated values have provenance=inferred and a separate additional marker:

```json
{
  "nutritionMetadata": {
    "version": "context-rules-v1",
    "basis": { "quality": "verified", "confidence": "high", "reason": "source" },
    "fields": {
      "sugarsG": {
        "quality": "estimated",
        "confidence": "low",
        "method": "context_rules",
        "reason": "category:...; carbohydrate bound; sugar ingredient position:..."
      }
    },
    "constraints": []
  }
}
```

Metadata is created for all nine fields: verified/estimated/ai_estimated, confidence, method and reason. `ai_estimated` is part of the contract; the current estimator uses estimated. Verified here means accepted source data or an arithmetic conversion, not laboratory confirmation: an OFF record has confidence=medium, an observed value usually high. Estimated fields have confidence=low, except energy calculated from known macros, which is medium. The sources and URLs of exact fields stay in fieldEvidence.

## API and UI

`ESTIMATION_INPUT` and `ESTIMATION_RESULT` were added to scan.service.ts, followed by the existing `SCORING_INPUT`/`SCORING_RESULT`. They are logged under the existing scan debug setting, with no photos, API keys or user profile.

If estimates gave a complete Product Score, the API no longer returns `needsPhoto`/`needs_nutrition_photo` for a recognized product. The UI uses the regular card with a number and a verdict. Estimated nutrients are marked `≈`, with a short note: «Часть пищевых данных оценена автоматически.» (“Some nutrition data was estimated automatically.”)

The preliminary logic for old incomplete results remains, but the new completed pipeline fills all three critical factors, so successfully estimated products never reach that branch. Partially unknown additives/processing are not blocking nutrients of the formula and are not replaced with invented facts.

The change concerns the Product Score. The personal Goal Match still receives exact/enriched data with the existing checks; estimates are never presented to its AI validator as a read label. Its result is still capped by the Product Score through the existing limitByProductScore.

## Real diagnostics: Rollton and Choco Pie

The new calls went through the built ScanService and the configured OFF/Tavily/Gemini. There is no user profile and no photo in these diagnostic calls. The full stages, source data, metadata, rejection reasons, scoring input and result are in `mvp-nutrition-estimation-evidence.json` (kept locally, not in the repository). Search results can change; below are the results of this particular run.

| Stage | Rollton 4605496000815 | Choco Pie 4607084351385 |
|---|---|---|
| Primary OFF | 350 kcal, P=6 g, C=65 g, F=7.5 g; serving 40 g | about 506.67 kcal, rounded to 507; P=4.5 g, C=63 g, F=18 g; serving 30 g |
| Initial gaps | sugars, saturatedFat, fiber, salt, sodium | the same; kcal is also checked as an anomaly against the macros |
| Enrichment | 8 searches, 35 candidates, 9 pages read; 10 credits | 8 searches, 24 candidates, 10 pages read; 10 credits |
| Accepted additions | ingredients, no new nutrients | calories=433, confirmed by sources; the other gaps remained |
| Unknown after enrichment | sugars, saturatedFat, fiber, salt, sodium | sugars, saturatedFat, fiber, salt, sodium |
| Estimation context | ready_meal, known macros, ingredients, salt at position 1 (zero-based) | bakery, macros, sugar at position 1, palm oil, salt at position 13 |
| Final Product Score | **3.2 / 10** | **1.8 / 10** |
| Score confidence | low | low |
| missingFactors | [] | [] |
| needsPhoto | false | false |

All values below are per 100 g and are the actual final scoring input:

| Field | Rollton | Status/confidence | Choco Pie | Status/confidence |
|---|---:|---|---:|---|
| Calories kcal | 350 | verified / medium | 433 | verified / medium, web correction |
| Protein g | 6 | verified / medium | 4.5 | verified / medium |
| Carbs g | 65 | verified / medium | 63 | verified / medium |
| Fat g | 7.5 | verified / medium | 18 | verified / medium |
| Sugars g | 3.9 | estimated / low | 28.35 | estimated / low |
| Saturated fat g | 2.25 | estimated / low | 9 | estimated / low |
| Fiber g | 3 | estimated / low | 2 | estimated / low |
| Salt g | 1.5 | estimated / low | 0.5 | estimated / low |
| Sodium mg | 600 | estimated / low, derived from salt | 200 | estimated / low, derived from salt |

Both rows have constraints=[]: the calculated values pass the constraints. These estimates are not claimed to be real data from a specific package.

Rollton: some pages had no usable table, `barista-ltd.ru` conflicts with the original recipe, and `ru.nutrola.app` contains suspicious zeros. That data never becomes verified. The gaps left after the search are now closed by the general estimator.

Choco Pie: the confirmed 433 kcal was accepted BEFORE estimation; the original P/C/F were kept. Unconfirmed values from a single weak site are not turned into verified ones. The estimator builds valid values from the context independently.

Gemini nutrition_extraction: model=gemini-3.5-flash-lite, prompt=1926, output=93, total=2019; thoughts/cached=null. There is no extra Gemini call for estimation.

## Tests and checks

- `pnpm test`: **1164 tests, 0 failures**: API 672, scoring 240, AI 117, nutrition 38, mobile 97. The core contract type tests also passed.
- The new `nutrition-estimator.test.ts`: 15 tests, including a complete source-only product, enrichment before estimation, preservation of exact values, an unknown name + ingredients + partial macros, categories, name-only, an unknown barcode, salt/sodium, energy constraints, ingredient order, servings, an unknown basis, rounding, 250 macro contexts, both examples, and no product-specific branches in the production estimator.
- The old source acceptance tests still check acceptance and rejection of sources. `source-evidence-view.ts` hides only the estimated fields from the nutrition they check; the score and metadata remain the actual final API response. The new estimator suite checks the completed API without this projection.
- `pnpm typecheck`: passed for all packages, the API and mobile.
- `pnpm --filter @foodlens/api build`: passed.
- The real CLI for both barcodes: exit 0, both numeric results above.
- Lint of the three changed UI files: passed.
- The full `pnpm --filter @foodlens/mobile lint`: 12 errors in `_layout.tsx`, `ProfileProvider.tsx`, `FocusIndicator.tsx` and `useNutritionTargets.ts`, which this work did not change (display-name, refs during render, set-state-in-effect). Fixing those components was not part of the task.

## Files changed in this iteration

Production:

1. `apps/api/src/modules/scan/nutrition-estimator.ts` — the new estimator and constraints.
2. `apps/api/src/modules/scan/scan.service.ts` — the final estimation stage, logging and the completed status.
3. `packages/core/src/product/product.ts` — optional nutritionMetadata and the provenance contract for each value.
4. `apps/api/scripts/diagnose-product-pipeline.cjs` — prints nutritionMetadata for any barcode passed as a CLI argument.
5. `apps/mobile/src/features/product-score/components/ProductScoreCard.tsx` — the estimates note on a regular result.
6. `apps/mobile/src/features/scan/screens/ProductResultScreen.tsx` — passes the estimated fields to the card and the table.
7. `apps/mobile/src/features/scan/components/NutritionTable.tsx` — the correct shared note about automatic estimation.

Tests:

8. `apps/api/src/modules/scan/test/nutrition-estimator.test.ts` — the new tests (described above).
9. `apps/api/src/modules/scan/test/source-evidence-view.ts` — a separate projection of accepted source values for the source tests.
10. `apps/api/src/modules/scan/test/google-scan.test.ts` — a completed Product Score without a table, the same Goal Match.
11. `apps/api/src/modules/scan/test/scan-barcode-first.test.ts` — the new estimates/needsPhoto contract, preservation of an unknown barcode and rejection of other recipes.
12. `apps/api/src/modules/scan/test/scan-multi-photo.test.ts` — a numeric Score after photos; the existing AI/Goal Match constraints.
13. `apps/api/src/modules/scan/test/scan-multi-source.test.ts` — source evidence and the final numeric Score.
14. `apps/api/src/modules/scan/test/scan-open-food-facts.test.ts` — the same for OFF.
15. `apps/api/src/modules/scan/test/scan-single-source.test.ts` — source evidence, metadata and the final Score.
16. `apps/api/src/modules/scan/test/scan-web-fallback.test.ts` — the match/rejection/limit checks were kept, and the final API contract was updated.
17. `apps/api/src/modules/scan/test/scan.test.ts` — presence logs for completed nutrients and estimates in the API.
18. `apps/api/src/modules/goal-match/test/goal-match-v4.test.ts` — the Product Score compared with the completed input, the same Goal Match.
19. `apps/mobile/test/estimated-nutrients.test.cjs` — the regular result and the automatic estimation note.

Documentation: this report, the JSON evidence and the historical note in `universal-pipeline.md`.

The running API server was not restarted. The code was built and checked in separate processes. The changes and earlier uncommitted files were left locally on dev; no push or commit was made at the time.
