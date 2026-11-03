> Historical diagnostics of earlier requirements. The current MVP uses an estimation fallback: see [mvp-nutrition-estimation.md](mvp-nutrition-estimation.md).

# FoodLens: universal nutrition enrichment

Date: November 3, 2026. Repository `C:\Users\sarak\Documents\FoodLens`, branch `dev`. The changes were local; no push or commit was made at the time. Before this work the repository already had many modified and untracked files; they were not reverted.

## Cause of the differences

For Rollton enrichment was not skipped. In a control request with the original code OFF returned only 350 kcal, 6 g protein, 65 g carbs and 7.5 g fat per 100 g. The Tavily search ran, but the sources gave no reliable additional nutrients. The ingredients were found separately.

For Choco Pie the original code accepted sugars 37.1 g, saturated fat 11 g and salt 0.2 g from `forkin.io` as `estimated`, `confidence: low`, `consensusCount: 1`. That was the general path for admitting a weak source, not a special branch for Choco Pie. It produced a profile that looked complete without independent confirmation of those three fields.

General logic problems found:

1. Calling the next source depended on sugars, saturated fat and salt; missing macros counted only with a barcode. Fiber was passed in the context along the way, but it did not trigger a search on its own, had no search word and did not prevent an early stop.
2. Missing ingredients triggered enrichment on their own only with a barcode, although the web provider can verify a product without one.
3. After the search, OFF estimates from the ingredients, numbers from a single weak page and averages of close but unconfirmed values could be substituted. That contradicts the requirement to leave unreliable values unknown.
4. Merge could clear the old recipe before a `name_only` rejection. `verified_attributes` corrections were applied before the original macros were checked and could make that check pass by themselves. The merge boundary also had no check for a different barcode returned explicitly.

The fixes do not guarantee that every nutrient is found: they make the search consistent and the acceptance of results stricter.

## Full data path

| Stage | Code and behavior |
|---|---|
| Camera/gallery | `apps/mobile/src/features/scan/components/CameraCapture.tsx`, `hooks/useProductScan.ts`, `services/scanApi.ts`: send the barcode and/or photos with roles in a multipart `POST /scan/analyze` |
| API input | `apps/api/src/modules/scan/scan.controller.ts`, `scan-barcode.ts`, `image-barcode.ts`: input validation; the camera barcode takes priority over a barcode read from the image |
| Orchestration | `scan.service.ts::resolveProduct`: barcode-first → sources; if data is missing, analysis of content photos. Without a barcode, photo analysis first, then the same MultiSourceProductLookup |
| Primary | `product-lookup.module.ts`: OFF, then FatSecret when credentials exist, then the configured web provider. In this environment OFF and Tavily are active; FatSecret is not connected |
| OFF | `open-food-facts.provider.ts` → `open-food-facts.mapper.ts`: API v3.6, `as_sold`, normalization of g/mg, kcal/kJ, basis, serving and ingredients; no data means null |
| Gemini photo | `packages/ai/src/providers/google/google-provider.ts`, `google-product-analysis.ts` → the shared `providers/meta/meta-product-normalizer.ts`: checks of structure, table visibility, units and valid values |
| Nutrition status | `googleNutritionStatus`: diagnostic observed/not_listed/unreadable. These statuses do not prevent web search; the actual gaps are determined from normalized null values |
| Missing | `multi-source-product-lookup.ts::missingNutritionFields`: kcal, protein, carbs, fat, sugars, saturatedFat, fiber, salt. Salt or sodium covers the pair; sodium is requested in the context when both are missing |
| Enrichment | `gemini-search-lookup.provider.ts` → `web/search-strategy.ts`: page search, reading HTML/JSON-LD/embedded JSON, Tavily fallback reading, and Gemini when needed to extract values from the text of a page that was found |
| Checks | `web/product-identity.ts`, `source-tier.ts`, `source-trust.ts`: barcode, brand, name/variant, basis, macros, plausibility; separation of recipes and independent domains |
| Merge | `product-merge.ts`: after the identity check; observed values are protected, null does not fill a field, incompatible bases are never mixed, conflicting recipes are rejected |
| Additional facts | `scan/barcode-product.ts`, `ingredient-facts.ts`: processing traits, allergens and additives from confirmed ingredients. Display-only ingredients are excluded through forScoring |
| Scoring | `packages/scoring/src/score-product.ts`: one deterministic formula after the merge; the user profile does not affect the Product Score |
| API response | `ScanService.analyze`: product, score, goalMatch, barcode; when barcode data is insufficient and there are no content photos, needsPhoto and status=needs_nutrition_photo |
| UI | `ProductResultScreen.tsx`, `NutritionTable.tsx`, `productScoreLabels.ts`, `ProductScoreCard.tsx`: show values and missingFactors. Two or more unknowns among sugars/saturatedFat/salt give «Предварительно» (“preliminary”) and «Данных недостаточно…» (“not enough data…”) |

The `nutrition_label` mode is deliberately separate: it analyzes only the table in the photo, without the barcode or databases. That is the explicit contract of a separate operation, and it was kept.

## How values are accepted now

Search runs for any missing supported nutrient, not by a list of products or categories. Missing ingredients can also trigger the web provider without a barcode, but the provider itself requires enough data for identification. When the data is complete and there are no anomalies, the next sources are skipped.

The search continues until the requested fields are filled or the planned steps and limits run out. The limits were not raised: by default 8 search queries, 10 read pages, 14 read attempts, 2 fallback extracts and 2 AI extractions per product. Caches and search memory are kept; a repeated scan does not have to make new network requests.

One strong source, or agreeing confirmation from at least two independent sites, can provide a value. A single weak source without confirmation, and equal conflicting groups, give no numeric substitution. OFF estimates from the ingredients are no longer applied either. There are no category averages.

Reliably found values keep fieldEvidence with the URL, domain, basis, trust, dataQuality, confidence and confirming sources. Original observed values are never replaced. Stronger confirmation can correct external data through the existing corrections/replacesRecipe mechanism, but a weak result can no longer change the object in advance to pass its own check.

Salt/sodium: `saltG = sodiumMg × 2.5 / 1000`; the reverse is `sodiumMg = saltG × 1000 / 2.5`, and the derived value is marked inferred. This is a conversion of a found fact, not a category estimate. Per-serving conversion is possible only with a known size and a compatible unit; 100 g and 100 ml are never mixed automatically during the merge. The existing drink classification in OFF separately allows the project's assumed density of 1; it did not change.

The serving comes from a reliable primary source or the label. Additives are filled from the database or from confirmed ingredients; missing tags in OFF do not mean “no additives”. No separate paid search was added just for serving size or additives.

## Diagnostics of the examples: real calls after the fixes

Settings: `WEB_SEARCH_LOOKUP=tavily`, sources `open_food_facts`, `web_search`. The requests went through ScanService without a photo and without a user plan; package AI analysis was not called. The results and stages were saved locally in `universal-pipeline-evidence.json`. These are new control scans, not a reconstructed historical log of a user scan.

| | Rollton 4605496000815 | Choco Pie 4607084351385 |
|---|---|---|
| OFF identification | Картофельное пюре с куриным вкусом (chicken-flavored mashed potatoes), Роллтон (Rollton), serving 40 g | Choco Pie, Orion, serving 30 g |
| Primary per 100 g | 350 kcal; P 6; C 65; F 7.5 | about 506.67 kcal (507 after rounding); P 4.5; C 63; F 18 |
| Missing | sugars, saturatedFat, salt; sodiumMg, fiber in the full context | the same; plus kcal as an anomaly against the macros |
| Enrichment | ran; 8 queries, 34 candidates, 8 pages read | ran; 8 queries, 22 candidates, 10 pages read |
| Tavily credits | 10 including fallback reads | 10 including fallback reads |
| Gemini extraction | 0 | 1 |
| Accepted | ingredients; no new nutrients accepted | kcal 433, confirmed by two sites; the other gaps were not filled |
| Result | sugars/saturatedFat/fiber/salt/sodium=null | sugars/saturatedFat/fiber/salt/sodium=null |
| Full ScanService score | 3.9; confidence=low; needsPhoto=true | 3.7; confidence=low; needsPhoto=true |

Rollton: `barista-ltd.ru` gives 377/10.5/75.3/3.8 instead of 350/6/65/7.5, hence `barcode_matches_macros_differ`. `ru.nutrola.app` contains suspicious zeros and was rejected as `implausible_nutrition:zero_saturated_fat`. `possy.ru`, `globalservice.kr`, `ayanmarket.kz`, `dixy.ru` and `semeiniy.kz` gave no usable per-100 g table. Some of the other URLs were unavailable or had too many redirects. A web hit here means found ingredients, not found nutrients.

Choco Pie: `forkin.io` lists 37.1 g sugars, 11 g saturated fat and 0.2 g salt, but each of them has only one weak source. These numbers are no longer applied. The 433 kcal is confirmed by `forkin.io` and `barista-ltd.ru`, so it can correct the anomalous 507 from OFF. `posylka.de` is a different recipe, 443/4/70.5/16.1, and was rejected. `en.orionworld.ru` and several shops gave no usable table. All detailed comparisons and accepted URLs are in the evidence.

> **Updated note (November 3, 2026):** one page with the exact barcode, or with the brand and full name, and a matching recipe now fills a missing field as `estimated`/low, so in the current code these `forkin.io` values are accepted as estimates.

Gemini usageMetadata was kept in the existing gemini_usage format: nutrition_extraction, model=gemini-3.5-flash-lite, prompt=1926, output=93, total=2019, thoughts/cached=null. Keys and network response bodies were not stored. The original diagnostic run before the fix bypassed ingredient-facts, so its Score is not used as a before/after comparison; the final scores above come from the full ScanService.

## Identification: verified boundaries

No special scoring or enrichment conditions were added for these barcodes. Production already had dictionaries of brand/name spellings, known brands and manufacturer/retailer domains. These are existing identification and trust hints, not nutrient tables or scoring coefficients; they were not extended for the examples. Unknown brands and categories go through the same chain but may need independent confirmation.

The current model has no separate manufacturer or package/net weight fields. Serving size is passed into the search context but does not guarantee the package size. They cannot be matched independently if the source does not provide these attributes. The exact barcode, the variant and the recipe check remain the main protections. This is a limitation of the original schema; no new package model was added in this fix. Verification of a manufacturer or weight that is absent from the input cannot be promised.

No finite strategy with limits can guarantee finding every web page that exists. When nothing is confirmed after the planned sources, null and a request for a photo of the table are the correct result.

## Files changed in this work

Main code:

- `apps/api/src/modules/product-lookup/multi-source-product-lookup.ts`: one nutrient completeness rule for both inputs, an ingredients trigger without a barcode, exclusion of OFF estimates, diagnostic stages.
- `apps/api/src/modules/product-lookup/gemini-search-lookup.provider.ts`: stopping only when all requested nutrients are found; exclusion of unconfirmed solo estimates and of averaging disputed values.
- `apps/api/src/modules/product-lookup/web/search-strategy.ts`: search words for fiber.
- `apps/api/src/modules/product-lookup/product-merge.ts`: checks before mutations; protection against another explicitly stated barcode; GTINs with leading zeros match.
- `apps/api/src/modules/scan/scan.service.ts`: search stages with requestId/barcode, SCORING_INPUT and SCORING_RESULT under the existing DEBUG_SCAN. Numbers and provenance only, with no photos, prompts, user plan or keys.
- `apps/api/scripts/diagnose-product-pipeline.cjs` (new): repeatable diagnostics of arbitrary barcodes from the CLI through the configured sources and ScanService.

Tests:

- `apps/api/src/modules/product-lookup/test/universal-pipeline.test.ts` (new): 8 checks, including every nutrient with and without a barcode, ingredients-only, null/estimates, merge protection and final scoring in four categories.
- `apps/api/src/modules/product-lookup/test/multi-source.test.ts`: complete fixtures include fiber.
- `apps/api/src/modules/product-lookup/test/web-search.test.ts`: weak and dependent sources do not fill gaps; the test rejecting invented AI values remains.
- `apps/api/src/modules/product-lookup/test/tavily-search.test.ts`: diagnostics of an unconfirmed page.
- `apps/api/src/modules/scan/test/scan-barcode-first.test.ts`: the gallery source fixture returns the barcode that was actually scanned instead of another one.
- `apps/api/src/modules/scan/test/scan-single-source.test.ts`: unverified fields stay null; different categories are filled with two independent confirmations.
- `apps/api/src/modules/scan/test/scan-web-fallback.test.ts`: completeness, continuing the search for fiber, no approximate substitutions, updated query/cache expectations.

Documentation: this report and `docs/diagnostics/universal-pipeline-evidence.json` (kept locally, not in the repository).

## Verification

- `pnpm test`: 1149 tests, 0 failures — API 657, scoring 240, AI 117, nutrition 38, mobile 97. The core contract checks also passed.
- `pnpm typecheck`: all workspace packages, the API and mobile passed.
- `pnpm --filter @foodlens/api build`: passed.
- The real diagnostic CLI for both barcodes: exit code 0; the results are above.
- The test that production code has no branches for specific barcodes or products passes. The new production conditions use no names, brands, barcode literals or category nutrient values.
- No UI or scoring formula changes were needed. The running API was not restarted; the updated code was checked in a separate process.

Any product with incomplete nutrition now goes through the same sequence: primary → normalization → the full list of gaps → the configured sources within limits → identity/basis/trust checks → merge → a single scoring. Without evidence the values stay null, and the UI honestly shows a preliminary score.
