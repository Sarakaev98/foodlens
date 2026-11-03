# Web fallback v2: report

Date: October 31, 2026; the Tavily section was added the same day. No real requests were made to Tavily, Gemini or websites, and Scan was not run. No commit or push was made, and the agent did not change `.env`.

> **Current status (November 3, 2026).** Several numbers below have changed since this report: up to 8 searches, 10 page reads, 2 Tavily extracts and 2 Gemini text extractions per product, and 60 web searches per hour per API process. One page with the exact barcode, or with the brand and the full product name, and a matching recipe can now fill a missing field as an `estimated` value. The current constants are in `apps/api/src/modules/product-lookup/web-search-lookup.provider.ts`.

## Page search: Tavily

Hadji chose Tavily on the free plan: 1,000 credits a month, no card required. `WEB_SEARCH_LOOKUP=tavily` turns it on; search is off by default. The `gemini` mode stays in the code, but I do not recommend running it: as I read the Google Cloud terms (Service Terms, section 20(k)), they forbid opening pages from Grounding links and caching the result.

How it works: `TavilySearch.discoverSources` sends `POST https://api.tavily.com/search` with the key in the `Authorization: Bearer` header, `search_depth: basic`, `max_results: 5`, a 7-second timeout and no retries. The query is built only from the barcode, brand, name and package size. Sources are real URLs from Tavily results. Everything after that works as before: `PageFetcher`, JSON-LD, the table, Gemini without Search, and product verification in code.

Fallback reading: if no page that is sufficient on its own was found directly, and some pages did not open or came back empty, `/extract` is called once per scan for those URLs. The text goes through the same checks. Blocked URLs are never passed to it. `include_raw_content` is not used: the documentation does not say that it is free.

Credits per scan:

| Scenario | Credits |
|---|---|
| The label and OFF were enough | 0 |
| Search, pages read directly | 1 |
| Search and fallback reading | 2 |

Limits: `TAVILY_MONTHLY_CREDIT_LIMIT`, 900 by default, with the counter in API memory; 20 searches an hour; 100 requests a minute on a free Tavily key. When the credits run out, the step is skipped silently (`budget_exhausted`) and the scan continues. Responses 432 and 433 close the month. The counter resets when the API restarts, so check actual usage on app.tavily.com. When the free plan runs out it returns an error instead of charging money.

Errors 401, 429, 432, 5xx and timeouts never fail the scan and are never cached. The `tavily_usage` log records credits, the number of results and the domains. The key, the query and response bodies never reach the logs.

### Tavily terms

This is a reading of the terms, not legal advice.

- **Embedding:** section 3.2 of the Terms allows integration into customer applications, but the license in section 2 is worded as "internal business purposes". For a public product this is worth confirming with Tavily.
- **Storage and caching:** neither the Terms nor the AUP forbid it explicitly.
- **Reading the pages found:** not forbidden, but the terms of the sites themselves still apply.
- **Automated access:** the AUP forbids automated collection of data from the Services "except as expressly permitted". The Terms allow reasonable API use.
- **Attribution:** the Terms have no such requirement.
- **App users:** section 4 of the AUP requires terms for them that are no weaker than the AUP, so this must be added to the FoodLens terms before a public launch.
- **Accuracy:** section 5 of the AUP puts verification of the results on the customer. FoodLens code does that verification.
- **Data:** Tavily may store queries and results, so only product data is sent there. The AUP requires sensitive health data to be agreed separately; the user profile is never sent.

## 1. Architecture

Photo → `analyzeProduct` → barcode and OFF → gap check → page search → reading up to 3 pages → value extraction → product verification → filling empty fields only → `scoreProduct` → Goal Match.

It runs only if, after the label and OFF, sugars or saturatedFat are missing, or both salt and sodium are missing. Fiber and serving size never trigger it on their own; fiber is filled along the way.

The Product Score formula, Goal Match, reconciliation and the 100 g fallback did not change. FatSecret is off.

Differences from your description:

- The branch where the model returned nutrition JSON with Search was replaced, as items 1 and 4 required. `acceptSearchResponse`, `parseNutritionSearchText` and `comparisonOnly` were removed and replaced by new functions.
- Web values are accepted with the `verified_identity` level: the check happens in code before the merge.

## 2. How Search gets real URLs

This section describes the `gemini` mode. In `tavily` mode the sources come from Tavily results, see the start of the report.

`GoogleNutritionSearch.discoverSources` makes one request with `googleSearch`, as plain text, with no JSON and no `responseSchema`. Only `barcode`, `brand`, `name` and `serving` are sent. Macros, the photo and the profile cannot be passed to this type at all.

The model's response text is never read. Sources come only from `groundingMetadata.groundingChunks`: `{url, title, domain}`. A URL written in the text can never get into the pipeline. If there are no sources, the status is `no_grounded_source` and no pages are opened.

Risk: in the last real Choco Pie scan `groundingChunks` was empty. The request required JSON at the time. Whether sources arrive with plain text has only been checked on stub data.

## 3. How pages are read

`PageFetcher` (`web/page-fetcher.ts`):

- only `http` and `https`, no credentials in the URL;
- localhost, private and reserved addresses are blocked, including IPv4 inside IPv6 and names that resolve to such addresses;
- redirects are checked at every step, at most 5, and the final URL and domain are kept;
- a 5-second timeout, at most 2 MB, only `text/html` and `application/ld+json`.

The code chooses the pages, at most 3: first a more trusted domain tier, then more name matches in the title. A failure on one page does not affect the others.

Tiers (`web/source-tier.ts`): 1 is the manufacturer or a clean brand domain, 2 a major retailer, 3 a product database, 4 everything else. An SEO domain never gets a high tier even if the brand is in its name. The tier is based on the final domain; the words on the page do not affect it.

Limitations:

- I compiled the domain lists myself and did not check them against real sites, including manufacturer domains such as `orion.ru` and `snickers.ru`. They need a review before launch.
- A domain like `snickers.xyz` will also get tier 1.
- Major retailers often render pages with JavaScript or block robots. How many pages will actually be readable is unknown.
- The DNS check and the connection are separate, so protection against DNS spoofing in that short window is incomplete.

## 4. How nutrition is extracted

Order (`web/page-nutrition.ts`):

- **A. JSON-LD.** `Product` and `NutritionInformation`, including inside `@graph`. Only when `servingSize` is 100 g or 100 ml.
- **B. HTML table.** It needs a marker such as "на 100 г", "per 100 g" or similar, and only the window next to it is read. Russian and English labels, decimal commas, kJ to kcal, sodium in mg and g. "Saturated" and "sugars" are taken first so they do not end up in "fat" and "carbohydrates". A unit is required, so "sugar 12%" from an ingredient list never becomes a value.
- **C. Gemini without Search.** One request for all pages that A and B did not help with. Only the text fragment near the nutrition goes out, up to 12,000 characters per request. An unknown value is null.

Numbers from the AI are also checked against the page text: if the number is not there, the value is dropped. So an invented value cannot get through even if the page contains an instruction for the model.

Values per serving are not treated as values per 100 g. The existing merge rule converts sodium to salt and marks the value as derived.

## 5. Identity

The code makes the decision (`web/product-identity.ts`); the model takes no part in it.

- **The page barcode** is the strongest signal, but only together with the macros. It is searched for in the markup and in the page text. A barcode from a "similar products" block could in theory give a false match; the macro check protects against that.
- **Without a barcode** the brand, all variant words and the macros are required. The variant is the name without the brand and generic words: for "Snickers лесной орех" it is "лесной орех" (hazelnut). Spellings are compared through a synonym list, for example лесной орех and hazelnut.
- **Package size** is part of the cache key but not of the page check: pages often give values per 100 g without the package weight.

Acceptance:

| Case | Condition | identityMatch |
|---|---|---|
| A | exact barcode, macros match, tier 1–3 | `exact_barcode` |
| B | manufacturer, same variant, macros match | `official_variant` |
| C | two independent tier 1–3 domains, same variant, macros and values match | `two_sources` |

Difference from test 5 in your list: a retailer page without a barcode is not accepted alone, because item 10 requires a second independent source for it. With a barcode or a second source it is accepted, and both paths are covered by tests.

## 6. Tolerances

Comparison with the label; the larger of the two values applies:

| Field | Relative tolerance | Absolute tolerance |
|---|---|---|
| kcal | 5% | 15 kcal |
| protein, carbs, fat | 10% | 1 g |

At least 3 of the 4 values must be compared. Any single mismatch rejects the page. If the label has fewer than 3 macros, no paid request is made. A per-serving label is converted to 100 g using its serving size.

Agreement between two sources on a field:

| Field | Relative tolerance | Absolute tolerance |
|---|---|---|
| sugars, saturated fat, fiber | 5% | 0.5 g |
| salt | 10% | 0.1 g |
| sodium | 10% | 40 mg |

Examples from the tests:

- Snickers: fat 25 against 28.6, a difference of 3.6 with a tolerance of 2.86, rejected. That is the only mismatch; kcal and carbs pass.
- Choco Pie: carbs 70.5 against 63, a difference of 7.5 with a tolerance of 6.3; fat 16.1 against 18, a difference of 1.9 with a tolerance of 1.8. Rejected. The margin on fat is very small.
- 48 and 48.2 agree; 48 and 32 do not.

The tolerances were chosen from your two examples and have not been checked on other products.

## 7. Conflict and recipe rules

- `recipe_version_conflict`: the barcode matches, the macros differ. The values are not used.
- `different_product_or_recipe`: no barcode, the macros differ.
- `insufficient_identity`: too few macros, a weak source, another brand or variant, another basis.
- `no_grounded_source`: there are no sources in the metadata.
- `unresolved_conflict`: the accepted sources disagree. The field stays empty, values are never averaged, other fields are used.
- `accepted`: the values are accepted.

The label is never overwritten; the web only fills nulls.

Priority: your order puts trusted web pages with a barcode above OFF. In practice the web only requests fields that are missing after OFF, so it never replaces an OFF value. This differs from item 11: OFF currently stays, as test 14 requires. The two never conflict.

## 8. Provenance

The value is marked `web_search`, and `Product.fieldEvidence` records for each field:

```ts
{ field, source: 'web_search', url, domain, tier, confidence, identityMatch, retrievedAt }
```

`url` is the final page address, not a Google redirect. `confidence`: high for cases A and B on tiers 1–2, medium otherwise. For each page the `web_lookup` log records the domain, tier, extraction method, status, reason and the mismatched values, with no URL and no page text. The confidence of a whole product with web values is at most medium.

## 9. Cache

The key with a barcode: `barcode + missingFields`. Without a barcode: brand, normalized name, variant, package size, `missingFields`.

Only verified values are stored. A found result lives for 24 hours, "not found" for 1 hour, and errors are never cached. The cache lives in API memory, is empty after a restart, and nothing is written to the database. In `gemini` mode this caching falls under Google's prohibition. Tavily's Terms and AUP do not forbid caching.

## 10. Cost limits

Per scan, at most:

- 1 `analyzeProduct`;
- 1 page search, inside which Google may run several search queries;
- 1 AI extraction, only if there are pages without markup and without a table;
- 3 pages;
- 20 search calls an hour per API process.

The estimate below is for the `gemini` mode. In `tavily` mode search within the free credits costs $0, and only the Gemini token cost remains.

Cost estimate, excluding Goal Match:

| Scenario | Approximately |
|---|---|
| Regular scan | $0.004 |
| Scan + search | $0.018–0.074 |
| Scan + search + extraction | $0.019–0.075 |

This is an estimate, not a measurement: search costs $14 per 1,000 queries above the 5,000 free ones a month, with 1–5 queries per call. I have not confirmed this model's token price, and the token usage of search and extraction has not been measured yet. Within the free queries roughly only the token cost remains. The `gemini_usage` logs are written separately for `nutrition_search` and `nutrition_extraction`, so the first real run will give exact numbers.

## 11. Changed files

New:

- `apps/api/src/modules/product-lookup/web/page-fetcher.ts`
- `apps/api/src/modules/product-lookup/web/page-nutrition.ts`
- `apps/api/src/modules/product-lookup/web/product-identity.ts`
- `apps/api/src/modules/product-lookup/web/source-tier.ts`
- `apps/api/src/modules/product-lookup/web/tavily-search.ts`
- `apps/api/src/modules/product-lookup/test/tavily-search.test.ts`
- `apps/api/src/modules/product-lookup/test/web-page.test.ts`
- `docs/web-fallback-v2.md`

Changed:

- `packages/ai/src/providers/google/google-nutrition-search.ts`
- `packages/ai/src/providers/google/gemini-usage.ts`
- `packages/ai/src/index.ts`
- `packages/ai/src/test/google-nutrition-search.test.ts`
- `packages/core/src/product/product.ts`
- `apps/api/src/modules/product-lookup/web-search-lookup.provider.ts`
- `apps/api/src/modules/product-lookup/product-lookup.provider.ts`
- `apps/api/src/modules/product-lookup/product-lookup.module.ts`
- `apps/api/src/modules/product-lookup/product-merge.ts`
- `apps/api/src/modules/product-lookup/test/web-search.test.ts`
- `apps/api/src/modules/scan/scan.service.ts`
- `apps/api/src/config/app-config.ts`
- `apps/api/.env.example`
- `docs/google-scan-provider.md`

## 12. Tests and typecheck

- `pnpm typecheck`: passed, all 7 projects.
- `pnpm test`: 679 tests, 679 passed, 0 failed.

| Package | Tests |
|---|---|
| api | 286 |
| ai | 109 |
| scoring | 195 |
| mobile | 72 |
| nutrition | 17 |

All 23 scenarios are covered; the numbers are in the test names. Scenarios 8 and 9 are in `web-page.test.ts`, the rest in `web-search.test.ts`. The Tavily request shape, budget, errors and fallback reading are checked in `tavily-search.test.ts`.

Everything was checked on stub data. Real Tavily responses and site markup may differ, so test coverage does not prove that it works on real pages.

## 13. Is one real Snickers scan ready

Yes, the code is ready, and unlike the `gemini` mode, Tavily can be turned on for this test. One test will spend 1–2 free credits plus the usual Gemini usage. Hadji's separate permission comes first. Only the test itself will show what is found for Russian products. The domain lists in `web/source-tier.ts` are worth reviewing before a public launch.

Run from `apps/api`; the settings apply only to this process:

```powershell
$env:AI_PROVIDER='google'; $env:GOAL_MATCH_AI='google'; $env:WEB_SEARCH_LOOKUP='tavily'; pnpm build; if ($?) { node dist/main.js }
```

## Barcode-first

With a barcode the order is: OFF → Tavily when data is missing → Product Score → Goal Match. `analyzeProduct` is called only when a photo is sent and the data is not enough for a score or the ingredients for Goal Match are missing. Without a barcode the photo flow is unchanged.

Page verification:

1. **OFF or label macros exist.** They are the reference; the tolerances and variant rules stay the same.
2. **No macros.** Only a page with this barcode and at least 3 macros qualifies: a manufacturer site on its own, other tier 2–3 sites only together with a second independent source with the same values. If the macros disagree, nothing is used.
3. **Otherwise** no values are accepted, and Gemini is called if there is a photo.
4. **After Gemini** the pages are checked again against the label macros, which are part of the cache key. The label wins, and a conflict gives `recipe_version_conflict`. At most 2 searches per scan.

Without photo analysis Goal Match does not know the sugar source or the processing level and returns `ambiguous`. So they are derived from explicit words in the ingredient list of the barcode source with `medium` confidence; Goal Match itself did not change. Without ingredients and without a photo the Product Score is calculated, and Goal Match stays unavailable.

If the barcode data was enough, the label is not read, so the scan will not notice a different recipe behind a complete OFF record.

## Multi-step search

Search runs only if `sugars`, `saturatedFat`, `salt` or `sodium` is missing. Queries run one by one and stop as soon as the critical fields are found and verified (`web/search-strategy.ts`):

1. `<barcode>`
2. `<barcode> <brand> <name>`
3. `<brand> <name> [package size] пищевая ценность` (plus `nutrition facts` for Latin script)
4. `<brand> <name> <missing fields>`, only if pages were found but the required values were not on them

Macros never go into the queries. They are needed only to verify a page that was read.

Q4 always runs when Q1–Q3 gave no accepted page.

Limits per product for 24 hours: 4 queries (`WEB_SEARCH_MAX_QUERIES`), 3 page reads (`WEB_SEARCH_MAX_PAGES`), 1 Tavily extract read. At most 5 credits. No automatic retries. Each step reads up to 2 pages, and one read is always kept for Q4.

Before reading: sites outside the lists (tier 4) and sites that are not about products are not read. A page goes on if the barcode is in the title, snippet or URL, or if the title (without the part after `|`) contains the brand or the name. An obviously different variant from `VARIANT_WORDS` is dropped at once. After reading, a different variant is rejected even with a barcode. If the page does not state a variant, the barcode, brand and macros decide. A brand taken from the known start of the name is used only for verification.

Page parsing order: JSON-LD, product JSON embedded in the page, a table in the text. If critical fields are still missing, the text of one page goes into one Gemini request per product, with no retries. Conditions: the URL was found by search, the page is about this product (barcode, or name and brand), the code could not parse a table, and the site is not tier 4. Numbers that are not in the page text are dropped. The request is counted in the `web_lookup.aiExtractions` log.

`CachedProductLookupProvider` stores the result per barcode and gaps. Search memory keeps queries, pages and read errors for 24 hours: a repeated scan and the second pass after a photo check the same pages again without spending credits.

### Refining the name by barcode

A database may give an incomplete name: for 5449000022431 OFF returns "Coca Cola Orange", while the product is Coca-Cola Zero Orange. After each query, results with the exact barcode in the URL, title or snippet can refine the name (`web/identity-enrichment.ts`). The barcode is compared in full. One result from any site is enough if it contains the brand and the name words from the database. That site does not become a source of values. One known variant word from `VARIANT_WORDS` is taken. Several variants in one text, or disagreeing sources, cancel the refinement. Values from the results are never used. The name is needed only for search and verification; the Product keeps the database name. Log: `identity_enrichment`.

If there are few results, one page outside the lists with the exact barcode in its result is read only for the name. It counts toward the limit of 3 reads and is not added to the page list: its values, ingredients and allergens go neither into verification nor into the product. The name is looked for in the title and near the barcode. If the page does not open, one Tavily extract is possible within the overall limit.

Only short fragments around the barcode and the brand go into the log (`identity_context`, `identity_read`); the full text is never written.

An alias from one weak result or from a page outside the lists is good only for search (`aliasState: provisional`). Values from an official page without a barcode can be accepted once the alias is confirmed: two domains with the barcode, a strong source, or a second barcode query result (Q1, Q2) with the same brand and variant from another domain. Name search results (Q3, Q4) and the page itself do not confirm it: they find that name because it was searched for. A different variant in a result with the exact barcode gives `conflict`. A barcode on the page itself needs no confirmation.

An official page (tier 1, the real brand domain) with a confirmed name is accepted without a barcode on the page if it has macros and they pass the check.

### Page value checks

The whole page is rejected on `malformed_nutrition`: an unfilled template (`{{…}}`, `${…}`, `%name%`, NaN, undefined), a minus sign right next to a number, grams above 100, calories above 900. Or on `implausible_nutrition`: protein, carbs, fat, salt and fiber add up to more than 105; sugars exceed carbs by more than 0.5; saturated fat exceeds fat by more than 0.5; calories differ from 4/4/9 by more than 40 kcal or 35%. The check is shared with AI values. There is no separate calorie limit for drinks: oil and cream are also sold per 100 ml, and broken values are caught by the macro check.

### Per-field enrichment

Flow: barcode, the name from OFF (the web may refine it by the exact barcode), the list of what is missing, a search for exactly that, a check by field type, and filling only what is confirmed. With a barcode the web also runs just for the ingredients.

Queries: `"barcode"`, `"barcode" "brand" "name"`, then for ingredients `"brand" "name" ingredients` plus a dictionary word for the script of the name (`состав` and others), and the same as before for nutrition. If both are missing: one query for ingredients (with the local word) and one for nutrition. In total at most 4 queries, 3 reads, 1 Tavily extract, 5 credits.

Ingredients do not depend on the domain or on the page's nutrition. Option A: the barcode is on the page itself, the brand and variant do not conflict, and the name is from the same family. Option B: no barcode, but the brand, the full name and the variant match. List pages (by URL, title, or 4 or more different barcodes), sites that are not about products, and forums are rejected. Package size is not compared: OFF does not return it, and a serving is not a package.

While the ingredients are missing, pages outside the lists are read, and the check rejects their values (`weak_source`). If the page's values are not accepted, the ingredients come with `ingredientsOnly`: they are displayed, but `forScoring` removes them from Product Score, Goal Match and the product traits. The source, URL and confidence (at most medium) are in `fieldEvidence`, separately from the values.

The parser takes ingredients only from a strong context: a JSON-LD field, an ingredients key in product JSON, a section under an element with the text "Состав", "Ингредиенты", "Ingredients" and similar, a markdown line, or a label with a colon. The word must be whole, so "в составе" ("in the composition") is not a heading. Categories, NOVA, menus and ordinary paragraphs never become ingredients even if they look like a list. Without a strong context `ingredients = null`. Second line of defense: an enumeration of at least two parts, with no fragments and no unbalanced parentheses, otherwise `not_ingredients_content`. If the code did not find it on a verified page, 1 Gemini text request is possible (a shared limit with nutrition extraction; ingredients have priority). If even one part of the answer is not in the text, the whole answer is dropped.

The read outside the lists just for the name remains for the case when the name is unknown.

In `scan_flow`: `ingredients_found`, `ingredients_source`, `ingredients_accepted`, `ingredients_rejected`, `reject_reason`. `credits` in `web_lookup` come from the Tavily counter: it counts `usage.credits` from the response, or the successfully read URLs when that is absent. Assumption: a read that returned no pages is not charged (the Tavily documentation says so, and a real response showed the same).

If the data is still thin after all steps, the response contains `status: 'needs_nutrition_photo'`.
