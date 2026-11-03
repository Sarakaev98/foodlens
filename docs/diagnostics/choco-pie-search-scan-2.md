# Diagnostics: Choco Pie scan with Google Search, attempt 2

Scan: 31.10.2026, 19:32:45 local time, requestId `a4f263c3-4dea-4c4e-a72e-71989dbd8de5`.
Sources: the API log `api-nodocker.out.log`, the code, Google documentation and an offline run without network. No new requests were made to Gemini or Search, and the code did not change.

> **Updated note (November 3, 2026).** This report is historical. Google Search grounding was later replaced by Tavily page search (`WEB_SEARCH_LOOKUP=tavily`), see `docs/web-fallback-v2.md`.

## Summary

- Search ran, made 5 search queries and returned numbers, but not a single verifiable source.
- The code rejected everything. The source check fired before the macro check was even reached.
- An offline run showed that the macro check would have rejected these values too.
- The strategy is not too strict. The problem is that Search gives no sources. A likely but unproven cause: the “JSON only” response mode.

## 1. Barcode

`4607084351385`, `hasBarcode: true`. The barcode format (EAN-13 and so on) is not logged.

## 2. What came from the label

| Field | Value |
|---|---|
| Calories | 430 kcal, log `conflicts` |
| Protein, carbs, fat | present; the numbers of this scan are not logged. They matched OFF (`confirmed`) |
| Sugars, saturated fat, salt | absent, `nutrition_status`: `not_listed` |
| Fiber, sodium | absent, `nutrition_presence`: false |
| Basis | not logged for the label |
| Serving | not given by the label: OFF filled `servingSize` |

The values 4.5 / 63 / 18 in section 10 come from earlier scans and the label description.

## 3. What Open Food Facts added

Status `hit`, 310 ms, `exact_barcode`.

- Filled: `servingSize`, `ingredients`, `name`, `allergens`, `additives`. The values themselves are not logged.
- Confirmed: protein, carbs, fat.
- Conflict: calories, label 430, OFF 507. The label value stayed.
- Not in OFF: sugars, saturated fat, salt, sodium.

## 4. Missing before Search

`sugars`, `saturatedFat`, `salt` (log `missingFields`).

## 5. Search fallback

It ran: `triggered: true`, `status: miss`, 3118 ms.

## 6. Grounding queries

5 queries:

1. `4607084351385`
2. `Orion Choco Pie 4607084351385`
3. `Orion Choco Pie состав кбжу калорийность` (ingredients, macros, calories)
4. `"4607084351385"`
5. `"4607084351385" пищевая ценность` (nutrition facts)

## 7. groundingChunks

None at all: `groundingChunkCount: 0`, `groundingSupportCount: 0`, `domains: []`. There is no domain, title, URL or status to show.

`groundingMetadata` was present: `webSearchQueries` is read from it (`google-nutrition-search.ts:163`). The log cannot tell whether `groundingChunks` was an empty array or missing entirely: the code reduces both cases to `[]` (`google-nutrition-search.ts:76`).

Chunk URLs are deliberately not logged: they are Google redirects.

## 8. What Search returned

| Field | Value | Confirmation |
|---|---|---|
| sugars | 37 | none |
| saturatedFat | 10 | none |
| salt | 0.69 | none |
| sodium | null | |
| fiber | 4 | none |

Basis `per_100g`. The source according to the model: `posylka.de` (retailer). The metadata does not confirm it.

## 9. Accepted and rejected

Accepted: nothing. Rejected: sugars, saturatedFat, salt, fiber.

Exact cause: `gemini-search-lookup.provider.ts:46`, the condition `citations.length === 0`. The function returned `null`, so the status became `miss`, and merge was not called for this step.

## 10. Macro check

It did not run in the real scan: `citations.length === 0` (line 46) stopped processing earlier.

Calculation by the rule in `product-merge.ts:42-43`, tolerance `max(10% of the larger value, an absolute threshold)`:

| Field | Label | Search | Difference | Tolerance | Result |
|---|---|---|---|---|---|
| Calories | 430 | 443 | 13 | 44.3 | match |
| Protein | 4.5 | null | | | not compared |
| Carbs | 63 | 70.5 | 7.5 | 7.05 | conflict |
| Fat | 18 | 16.1 | 1.9 | 1.8 | conflict |

Two conflicts in core values give `different_product` (`product-merge.ts:200`).

An offline run of the real code with a substituted source: `skipped: "different_product"`, sugars stayed null. A control with close macros: sugars were accepted, `web_search`. The check works in both directions.

The margin is small: fat was outside the tolerance by 0.1 g, carbs by 0.45 g.

The earlier fix paid off: in the previous scan Search returned exactly our macros, and now it returns its own.

## 11. Exact barcode match

- OFF: yes, lookup by the exact barcode.
- Search: only the model's claim `barcodeExact: true`. There is no page, so nothing can confirm it.

## 12. Final provenance

| Field | Source |
|---|---|
| Calories, protein, carbs, fat | `observed` (label) |
| Serving, ingredients, name | `open_food_facts` |
| Allergens, additives | filled from OFF; the log does not show what came from the label |
| Brand | not logged and not among the fields OFF filled, so not from OFF |
| Sugars, saturated fat, salt, fiber, sodium | no data (`not_detected`) |

There are no `web_search` values.

## 13. Why Product Score = null

`score-product.ts:66-67`: if at least one required factor is missing, the reason is `too_few_factors`. The required factors are sugars, saturated fat and salt (`product-score-rules.ts:25`). All three are missing here.

## 14. Why Goal Match = null

Sugars, saturated fat and salt are missing, so `nutrients()` returned null (`goal-match-v3.ts:49`), then `missing_nutrients` (`goal-match-v3.ts:127`), then terminal (`goal-match-ai-input.ts:28`, `goal-match.service.ts:65`). AI was not called: `aiCalls: 0`. A test profile from a temporary database was used.

## 15. usageMetadata

| | prompt | output | total | image | text | thoughts | cached |
|---|---|---|---|---|---|---|---|
| analyzeProduct | 4842 | 618 | 5460 | 1058 | 3784 | null | null |
| Search | 504 | 123 | 627 | null | 504 | null | null |

## 16. Retries and cache

- Retries: 0.
- Gemini requests: 2.
- Cache hits: 0. This was the first scan after the API started.
- The Search response with a “nothing” result was cached for 1 hour.
- This log has a single scan.

## 17. Is Search worth keeping

**The strictness is justified.** The model named numbers with high confidence and no source at all, and its macros disagree with the label. Had we accepted that data, the Product Score would have been calculated on unverified numbers. The check must not be relaxed.

**The weak spot is the sources, but our configuration may be a factor.** Empty sources with queries appeared in two scans in a row. Other developers report the same: there are queries, `groundingChunks` is empty when JSON is requested, and sources come back without JSON. This is discussed on the Google forum and in cookbook issue #1274, which also mentions JSON requested only in the prompt text, as in our case. The maintainers closed the issue as fixed on October 5, 2026 for the Gemini API. There is no confirmation for Vertex and `gemini-3.5-flash-lite`, and our case differs: there are queries but no chunks. The official documentation does not describe this. So the cause is likely but unproven.

**Cost.** On Gemini 3 models Google charges for every search query. 5 queries beyond the free limit cost about $0.07, roughly 17 times more than a regular scan. The free limit of 5,000 queries a month covers about 1,000 such scans. Sources disagree on whether queries without sources are charged: the pricing page talks about queries with sources, while the forum reports charges. The actual bill should be checked in billing.

**Conclusion.**

- For products like Choco Pie Search currently gives no benefit. There is no point keeping it on permanently: `WEB_SEARCH_LOOKUP=off`.
- Show a partial result and explain to the user what is not on the package. This is needed in any case.
- To give Search a chance, run one controlled experiment: first a request with a regular text answer to see whether sources appear. If they do, the numbers can be parsed in a second step or straight from the text. If not, close this branch.
- Alternatives: a barcode database with coverage of the region (needs testing on real barcodes), or values entered by the user with the source marked.

## What the log does not show

- The protein, carbs and fat numbers, the serving and the label basis in this scan.
- The values of the fields OFF filled.
- Whether `groundingChunks` was an empty array or absent.
- `searchEntryPoint` and the model's response text (deliberately).
- The actual charge for search queries.

## Sources

- https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/grounding/grounding-with-google-search
- https://docs.cloud.google.com/gemini-enterprise-agent-platform/reference/rest/v1beta1/GroundingMetadata
- https://github.com/google-gemini/cookbook/issues/1274
- https://discuss.ai.google.dev/t/grounding-metadata-grounding-chunks-grounding-supports-empty-when-using-structured-output-with-google-search-tool/113240
- https://discuss.ai.google.dev/t/groundingchunks-missing-from-groundingmetadata-in-gemini-responses/131137
