# A real Snickers scan with Tavily: diagnostics

Scan: November 1, 2026, 02:48 computer time, requestId `11459032-6696-453d-b91a-804e0b89b26f`.

Sources: the API log for this scan and the code. No new external requests were made, the code did not change, and no commit or push was made. The API kept running.

> **Updated note (November 3, 2026).** This report is historical. Since then the camera barcode is sent with the photo, more retailer domains are listed, the debug logs record page values and decisions, and the search limits were raised.

## Conclusion

The scan finished without errors, but no value was accepted. Score and Goal Match stayed null.

Main cause: the barcode never reached the API. So OFF did not run, and the strongest way to confirm the product, a barcode match, was unavailable. Without it the remaining options were confirmation from the manufacturer's site or from two independent sources. The results had no manufacturer site, and only one page from tier 1–3 sources was read.

A separate problem: the log does not store the values themselves. Many items can be answered only indirectly, which is noted in each section. Here “not logged” means the data is missing and cannot be recovered without a new request.

## 1. Barcode

Not recognized: `barcode: null`, `barcodePresent: false`, `hasBarcode: false`, `images: 1`.

The log does not show whether the phone sent a barcode. `parseScanBarcode` (`apps/api/src/modules/scan/scan-barcode.ts:7`) silently replaces an invalid value with null, and `CameraCapture` passes only what the detector caught before the photo was taken. “The camera did not see it” and “the value was discarded” cannot be told apart from the log.

## 2. What came from Gemini

| What | Value |
|---|---|
| `nutrition_status` | sugars, saturated_fat, salt: all `not_listed` |
| Present | calories, protein, carbs, fat |
| Absent | sugars, saturatedFat, fiber, salt, sodium |
| kcal, protein, carbs, fat numbers | not logged |
| Name, brand, variant | not logged |
| Basis and serving | not logged |

Indirectly: the brand and name were present, and the basis was not `unknown`, otherwise the search without a barcode would not have started (`gemini-search-lookup.provider.ts`, the start of `lookup`).

## 3. What Open Food Facts added

Nothing: OFF was not called. The log has no `product_lookup` line for this provider. Sources that need a barcode are filtered out when `barcode === null` (`multi-source-product-lookup.ts:65`). `barcodeLookup: null`.

## 4. Missing before Tavily

`missingFields`: `sugars`, `saturatedFat`, `salt`.

From the code, `sodiumMg` and `fiber` are also added to the request because they were absent (`multi-source-product-lookup.ts:42`). The field list with these additions is not logged.

## 5. Was Tavily called

Yes, `/search` once and `/extract` once. `triggered: true`, step result `miss`, 9006 ms. No errors and no retries.

## 6. Search query

The query text is deliberately not logged. The `tavilyQuery` template without a barcode: `{brand and name} {serving, if any} пищевая ценность` (nutrition facts). The exact text cannot be recovered, because the name and serving were not logged either.

## 7. What Tavily found

5 results. URLs are not logged, only domains.

| Domain | Tier | Reading |
|---|---|---|
| ozon.ru | 2 | chosen, did not open |
| calorizator.ru | 3 | chosen, read |
| beregifiguru.ru | 4 | chosen, read |
| megamarket.ru | 4 (not in the list) | not chosen |
| instagram.com | 4 | not chosen |

The tiers of the two unchosen domains are inferred from the code (`web/source-tier.ts:6`, `:26`); they are not in the log. At most 3 pages are read (`gemini-search-lookup.provider.ts:87`). There is no manufacturer site among the results. `megamarket.ru` is a major retailer, but it was not in my list, so it got tier 4 and lost its place.

## 8. Which pages could be read

| Domain | Directly | Fallback reading | Extraction method |
|---|---|---|---|
| ozon.ru | error `too_many_redirects`, more than 5 redirects (`web/page-fetcher.ts:6`, `:122`) | `/extract` returned 0 results | none |
| calorizator.ru | yes | not needed | `ai`: no markup and no table were found |
| beregifiguru.ru | yes | not needed | `html`, table |

It looks like ozon protects itself from robots, but that is an assumption: the log shows only the number of redirects. The reason `/extract` failed is not logged; `failed_results` is not recorded.

## 9. Values found

The sugars, saturatedFat, salt and sodium values from the pages are not logged. The `web_lookup` log keeps only the result and mismatching numbers, and there were no mismatches.

All that can be said:

- All four fields are empty in the final product.
- The log does not show whether they were found on calorizator.ru and beregifiguru.ru.
- There are no values from ozon.ru; the page was not read.

## 10. Accepted and rejected

Accepted: nothing, `accepted: []`. `unresolved: []`, the sources did not disagree. The final status is `insufficient_identity`.

## 11. Exact rejection reasons

**calorizator.ru:** status `insufficient_identity`, reason `variant_mismatch` (`web/product-identity.ts:132`).

Comparison with the tolerances: no conflicts, so all compared macros were within tolerance (kcal ±max(5%, 15), protein, carbs, fat ±max(10%, 1 g)). The numbers themselves are not in the log. Some of the name words did not make it into the variant; which ones is not logged.

Even without this error the page would not have passed on its own: tier 3 without a barcode requires a second independent source (`web/product-identity.ts:134`).

**beregifiguru.ru:** status `insufficient_identity`, reason `too_few_macros_to_compare` (`web/product-identity.ts:128`).

Fewer than 3 of the 4 macros could be compared, with no conflicts. The next check would have rejected the page too: tier 4 is `weak_source` (`:129`).

**ozon.ru:** did not take part in the check; the page was not read.

## 12. Did the product match our Snickers

| Signal | calorizator.ru | beregifiguru.ru | ozon.ru |
|---|---|---|---|
| Barcode | cannot be checked, ours is missing | cannot be checked | no data |
| Brand | matched (inferred from the order of checks) | not reached | no data |
| Variant | did not match | not reached | no data |
| Macros | within tolerance, at least 3 values | no conflicts, but fewer than 3 compared | no data |

Result: the match is not confirmed. Close macros with a different name can mean a similar product or the same product named with other words. The log cannot tell these apart. Whether calorizator.ru was rejected correctly cannot be said from the log.

## 13. Tavily credits

| Call | Credits |
|---|---|
| `/search` | 1, according to the Tavily response |
| `/extract` | 0, no successful pages |
| Total | 1 |

The 0 for `/extract` is counted by my code: there were no successful pages, and according to the documentation failures are not charged. The actual usage is worth checking on app.tavily.com.

## 14. Gemini usage

| Call | prompt | output | total | Other |
|---|---|---|---|---|
| `product_analysis` | 4900 | 1529 | 6429 | image 1116, text 3784, 1 photo, 0 retries, 4709 ms |
| `nutrition_extraction` | 1680 | 58 | 1738 | calorizator.ru only |
| Total | 6580 | 1587 | 8167 | 2 calls |

Goal Match AI was not called: `aiCalls: 0`, `outcome: terminal`, `cacheHit: false`. The search cache did not hit; this was the first request. The total scan duration was 13,721 ms.

## 15. Why Product Score is null

`score: null`, `unscoredReason: too_few_factors` (`packages/scoring/src/score-product.ts:67`). The score needs sugars, saturated fat and salt, and all three are empty: `not_listed` on the label, OFF not called, nothing accepted from the web.

Goal Match is null for the same reason: `unavailableReason: missing_nutrients`, result `terminal`, with no AI call. The formula and rules worked as designed.

## What got in the way, and the smallest fix

By impact:

1. **No barcode.** This disabled both OFF and case A.
2. **Too few strong sources.** No manufacturer site, ozon was closed, and `megamarket.ru` was not read because of the domain list.
3. **A strict variant check with a single source.** Even a correct match on calorizator.ru would have needed a second source. I do not suggest relaxing this without data: it protects against someone else's Snickers.
4. **Too few logs.** It is impossible to judge whether a page was rejected correctly.

The smallest step, nothing applied yet:

1. Add dev-only logs: the name, brand, macros and basis from Gemini, the query text, the values for each page, the variant words and the reasons `/extract` failed.
2. Add `megamarket.ru` to the retailer list.
3. Make the barcode more visible while taking the photo. The camera already has an indicator (`CameraCapture.tsx:97`), but only a fresh barcode caught before the photo is sent. The app could ask the user to point the camera at the barcode and wait for the indicator, or read the barcode from the photo.

After that one repeated scan will show what exactly is in the way. I would start with items 1 and 3: they are free and give the most. Repeating the scan without item 1 makes little sense.
