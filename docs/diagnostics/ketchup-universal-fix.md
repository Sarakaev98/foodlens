# Universal fix for sauce profiles and enrichment identity

dev, HEAD 033556fbc2ae35ae10878d9030591d936ac8eb6d. The scoring engine and .env did not change. There are no conditions on a brand or barcode. Nothing was pushed.

## Code

- nutrition-estimator.ts: context-rules-v3; ketchup/кетчуп/ketçap and tomato ketchup are recognized inside the existing sauce category. Separate priors for ketchup/mayonnaise/mustard/bbq/tomato_sauce/soy_sauce; verified fields are never replaced. A profile is chosen by generic words only when the category is missing, other or sauce.
- Ketchup priors per 100 g: protein 1, carbs 25, fat 0.3, sugarShare 0.8, saturatedShare 0.1, fiber 1, salt 2.2; kcal is derived by 4/4/9. This is a generic MVP estimate, not measured Heinz data.
- product-identity.ts: GTIN-8/UPC/EAN/GTIN-14 are compared in a 14-digit zero-padded form, with spaces and hyphens removed. A different barcode never counts as equal. The recipe markers No Sugar/No Sugar Added/Reduced Sugar/Reduced Fat/Zero/Light/Spicy are checked in both directions; the existing flavor and base-variant checks remain.
- gemini-search-lookup.provider.ts: ingredientsSource uses exact_barcode only when barcodeOnPage comes from an actual comparison with the target code; any unrelated barcode on the page no longer raises the provenance. A name match is exact_name with medium confidence; display-only data stays ingredientsOnly.
- scan.service.ts: forScoring is applied BEFORE estimation. The display-only ingredients are returned by the API but take no part in the estimation or scoring snapshot. The estimator itself also ignores ingredientsOnly (to protect other callers). Scoring and Goal Match use one completed nutrition snapshot. ConfirmBarcodeIdentity already builds semantics only from the forScoring product; nothing is derived from display-only ingredients.

## Real request

After building and restarting the main API: PID 34440, http://192.168.1.100:3000, /health={status:ok}. RequestId 6d78ad4f-6c20-4a97-ac13-4dca3c934e87. A real multipart POST /scan/analyze, barcode 8696362804671, no photo, HTTP 200, **cacheHit:false**. The OFF, web and search-memory caches were empty after the process started; global external caches were not cleared.

Identification: TOMATO KETCHUP / Heinz, OFF exact_barcode. Primary nutrition=null, serving=null, category=null, ingredients=null. Enrichment accepted nutrition from no page. The internal estimator category is sauce, profile ketchup; the API product.category stays not_detected, because the source gave no category (an inference is never presented as verified).

The No Sugar Added page was rejected as not_relevant before reading or merging. A regular Heinz tomato-ketchup page with another product code gave ingredients for display only: exact_name/medium, ingredientsOnly:true. **Ingredients actually used by the estimator=[]**. So syrup, stevia and salt from an unverified recipe do not change the priors. The display ingredients and their provenance are visible in the actual JSON.

| Field per 100 g | Result | Provenance / confidence |
|---|---:|---|
| kcal |106.7|inferred / estimated low|
| protein |1|inferred / estimated low|
| carbs |25|inferred / estimated low|
| sugars |20|inferred / estimated low|
| fat |0.3|inferred / estimated low|
| saturatedFat |0.03|inferred / estimated low|
| fiber |1|inferred / estimated low|
| salt |2.2|inferred / estimated low|
| sodium mg |880|inferred / estimated low|

Constraints=[]; Product Score 3.3/10, Goal Match 2.2/10 (eat_healthier/v3), numeric, confidence low; uncertainty sugarSource/processing/typicalServing/nutrition. MissingFactors=[additives], so no required nutrient is missing. needsPhoto=false in scan_flow; a successful response omits the optional needsPhoto. Gemini was not called.

All source decisions (full URLs, parsed values, barcode/variant flags and the scoring input are in the evidence JSON, kept locally):

| Domain | Product | Barcode match | Other variant | Nutrition decision |
|---|---|---|---|---|
| hakanitriyat.com | Heinz Ketçap 375 gr | true | false | other: no_per_100_nutrition |
| usmarmarket.com.tr | Heinz Ketçap (375 g) fiyatı - Salça & Sos | true | false | other: no_per_100_nutrition |
| erenlercep.com | HEINZ KETÇAP 375 GR-8696362804671 / Tokat'ın En Hesaplı Sanal Marketi | false | false | other: no_per_100_nutrition |
| bilgemar.com | Heinz Ketçap 310 ml 375 g*10 | true | false | other: no_per_100_nutrition |
| tarifi.ge | კეტჩუპი/ჰაინცი/კლასიკური/375მლ — სპარი / tarifi.ge | true | false | other: no_per_100_nutrition |
| heinz.com | Tomato Ketchup / Heinz | false | false | other: no_per_100_nutrition |
| world.openfoodfacts.org | TOMATO KETCHUP – Heinz | not evaluated | not evaluated | other: not_product_site |
| youtube.com | Heinz Tomato Ketchup Review | not evaluated | not evaluated | other: not_product_site |
| walmart.com | Heinz Tomato Ketchup, Multipack, 3 Pack, 44 oz Bottles - Walmart.com | false | false | other: no_per_100_nutrition |
| express.stopandshop.com | Heinz Tomato Ketchup Same-Day Delivery / Stop & Shop Express | false | false | other: no_per_100_nutrition |
| nal.usda.gov | Nutrients: Sugars, total (g) | not evaluated | not evaluated | other: not_relevant |
| healthline.com | Types of Sugar: 56 Common Ones You Should Know | not evaluated | not evaluated | other: not_relevant |
| extension.rutgers.edu | Added Sugars: Hidden in Plain View / Rutgers Cooperative Extension | not evaluated | not evaluated | other: not_relevant |
| stanfordhealthcare.org | Added Sugars | not evaluated | not evaluated | other: not_relevant |
| nutritionsource.hsph.harvard.edu | Added Sugar • The Nutrition Source | not evaluated | not evaluated | other: not_relevant |
| heart.org | Saturated Fats | not evaluated | not evaluated | other: not_relevant |
| accessdata.fda.gov | Interactive Nutrition Facts Label - Saturated Fat | not evaluated | not evaluated | other: not_relevant |
| news.christianacare.org | Nutrition Numbers Revealed: Fat Intake - ChristianaCare News | not evaluated | not evaluated | other: not_relevant |
| medlineplus.gov | Facts about saturated fats: MedlinePlus Medical Encyclopedia | not evaluated | not evaluated | other: not_relevant |
| mayoclinic.org | Dietary fat: Know which to choose - Mayo Clinic | not evaluated | not evaluated | other: not_relevant |
| amazon.com | Amazon Best Sellers: Best Salt | not evaluated | not evaluated | other: not_relevant |
| recipal.com | Salt, table Nutrition Facts - Find Calories & Macros Per Serving | not evaluated | not evaluated | other: not_relevant |
| discusscooking.com | What's in your salt? / Discuss Cooking - Cooking Forums | not evaluated | not evaluated | other: not_relevant |
| tiktok.com | Osmo Kitchen on TikTok | not evaluated | not evaluated | other: not_product_site |
| diamondcrystalsalt.com | Where to buy Diamond Crystal® Salt / Diamond Crystal® Salt | not evaluated | not evaluated | other: not_relevant |
| caloriecontrol.org | Food Calorie Calculator: Track Your Daily Intake - Calorie Control Council | not evaluated | not evaluated | other: not_relevant |
| mcdonalds.com | Nutrition Calculator: Macros, Calorie Tracker & More / McDonald’s | not evaluated | not evaluated | other: not_relevant |
| calories.info | Calories for Thousands of Foods: Your Calorie Chart Database | not evaluated | not evaluated | other: not_relevant |
| 49fss.com | [PDF] NUTRITION FACTS SHEET - public (1).xlsx | not evaluated | not evaluated | other: not_relevant |
| il-ru.openfoodfacts.org | TOMATO KETCHUP – Heinz | not evaluated | not evaluated | other: not_product_site |
| tools.myfooddata.com | Nutrition Facts for  Heinz - Tomato Ketchup | not evaluated | not evaluated | inaccessible: Page fetch: http_error |
| eatthismuch.com | 1 Tbsp Of Heinz Tomato Ketchup Nutrition Facts - Eat This Much | false | false | other: too_few_macros_on_page |
| giantfood.com | Heinz Tomato Ketchup / Giant Food | not evaluated | not evaluated | other: not_selected |
| heinz.com | Tomato Ketchup / Heinz | false | false | other: no_reference_without_barcode |
| tools.myfooddata.com | Nutrition Facts for Heinz, Tomato Ketchup | not evaluated | not evaluated | other: not_selected |
| calorieking.com | Calories in Heinz Tomato Ketchup / CalorieKing | not evaluated | not evaluated | other: not_selected |
| heinz.com | Tomato Ketchup with No Sugar Added / Heinz | not evaluated | not evaluated | other: not_relevant |
| fairwaymarket.com | Heinz Tomato Ketchup, 32 oz Bottle - Fairway | not evaluated | not evaluated | other: not_selected |

## Checks

Full pnpm test, pnpm typecheck, API build. The API suite after the latest regression additions: 745/745. New tests include: bilingual ketchup classification; 6 different sauce profiles; GTIN equivalence; a wrong barcode; an exact barcode; matching and non-matching recipe variants; ingredientsOnly regardless of sugar/salt; integration WebLookup checks of provenance and of the No Sugar Added rejection; protection of exact values and finite scores for noodles/puree/FAGE Total 0%/AlpenGold/mayonnaise. The last five checks are fixtures and are not presented as real HTTP scans of those products. The project's existing scenario suites were also run.

## Files in this task

1. apps/api/src/modules/scan/nutrition-estimator.ts
2. apps/api/src/modules/scan/scan.service.ts
3. apps/api/src/modules/product-lookup/web/product-identity.ts
4. apps/api/src/modules/product-lookup/gemini-search-lookup.provider.ts
5. apps/api/src/modules/scan/test/ketchup-regressions.test.ts (new)
6. apps/api/src/modules/product-lookup/test/web-search.test.ts
7. docs/diagnostics/ketchup-universal-fix.md
8. docs/diagnostics/ketchup-fix-evidence.json
9. docs/diagnostics/heinz-ketchup-fixed-response.json

Other existing changes in the working tree were not reverted. The API was left running for the phone. Nothing was pushed.
