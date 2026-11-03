# Product Score v3: C(−8) and drinks

Date: November 1, 2026. No requests were made to Gemini, Tavily or OFF. No commit or push was made, and `.env` was not changed.

> **Updated note (November 3, 2026).** This report is historical. The current formula is `product-score-v6`: the lower part of the scale is now compressed down to a floor of −16, the sum of all maximum penalties, instead of −8.

## What changed

**C(−8).** `PRODUCT_SCORE_VERSION` is now `product-score-v3`. `calibrateLowScale` was added to `packages/scoring/src/score-product.ts`: a sum below 4 is compressed linearly, so −8 becomes 0 and 4 stays 4. A sum of 4 and above does not change. The ceiling of 4 works as before. Weights, thresholds and penalty limits did not change.

**Drinks.** Detection was updated before the real scan. In `open-food-facts.mapper.ts`:

1. The OFF request includes `categories_tags` and `categories_hierarchy`.
2. A drink is detected only by category: `en:beverages`, `en:waters`, `en:sodas`, `en:juices`, `en:fruit-juices`, `en:milks`, `en:dairy-drinks`.
3. Exclusions take priority: oils, sauces, dressings, condiments, vinegars, syrups and cooking cream.
4. The `ml` unit proves nothing. Without categories the status is `unknown` and the basis stays as in OFF.
5. Values per `100g` for a drink are read as per 100 ml: a density of 1 is assumed.
6. The dev log `product_lookup` shows `basis` and `beverage_classification`.

**Confirmed zeros** are not discarded because of the OFF estimate, as you decided.

Product Score and Goal Match stay independent. The cola Goal Match is now calculated as a drink, because the basis became `per_100ml`.

## Coca-Cola

The real mapper and the real `scoreProduct()` on saved v3.6 responses.

| Product | Basis before | Score before | Basis after | Serving | Score after | raw | Penalties |
|---|---|---|---|---|---|---|---|
| Coca-Cola Original | `per_100g` | 5.8 | `per_100ml` | 250 ml | 3.4 | 2.17 | sugars −4.63, additives −1.2 |
| Coca-Cola Zero | `per_100g` | 6.0 | `per_100ml` | 330 ml | 6.0 | 6.0 | additives −2 |

The basis fix alone would give 2.2, and C(−8) raises that to 3.4.

## Products after C(−8)

| Product | raw | v2 | v3 |
|---|---|---|---|
| Oatmeal | 8.64 | 8.6 | 8.6 |
| Cottage cheese 5% | 8.02 | 8.0 | 8.0 |
| Water | 8 | 8.0 | 8.0 |
| Broccoli | 8 | 8.0 | 8.0 |
| Eggs | 7.68 | 7.7 | 7.7 |
| Salmon | 7.53 | 7.5 | 7.5 |
| Natural yogurt | 7.49 | 7.5 | 7.5 |
| Apple | 7.07 | 7.1 | 7.1 |
| Curd product, your case | 6.71 | 6.7 | 6.7 |
| Almonds | 5.69 | 5.7 | 5.7 |
| Chips, your case | 2.44 | 2.4 | 3.5 |
| Chips, typical | 0.73 | 0.7 | 2.9 |
| Roshen | −5.16 | 0.0 | 0.9 |
| Snickers hazelnut | −5.65 | 0.0 | 0.8 |
| Snickers | −5.66 | 0.0 | 0.8 |

Except for Roshen and your two cases, the product values are typical.

## Scale check

| Metric | v2 | v3 |
|---|---|---|
| =0 | 17 | 0 |
| ≤1 | 25 | 5 |
| ≤2 | 27 | 14 |
| ≥9 | 1 | 1 |
| =10 | 0 | 0 |
| Mean | 4.01 | 4.77 |
| Broken pairs out of 34 | 2 | 0 |

**The top of the scale did not change.** For all 37 products with raw ≥ 4 the v2 and v3 scores match, including all 11 with raw ≥ 8. Ordering is intact: the compression is monotonic, and a test pins that.

The mobile app has no version strings or scale thresholds that need changing.

## What remains

- **The category fields of the v3.6 response have not been seen live yet.** If OFF does not return them, cola stays on `per_100g` and gets 5.8. The first real scan will show this in `beverage_classification`.
- The bottom of the scale is dense: chips at 3.5 and Coca-Cola at 3.4 are almost side by side. That is the expected price of having no zeros.
- Below raw 4 the sum of factor points no longer equals the final score: the result goes through compression. The app does not show individual points.
- In Coca-Cola Zero six additives cost −2, so it stays high.
- Suspicious zeros such as `Le nature` with 0 sugars remain, as you decided.

## Tests

`pnpm typecheck` passed for all 7 projects. `pnpm test`: 762 of 762 (api 341, scoring 213, ai 109, mobile 82, nutrition 17).

The API was rebuilt and restarted: the process was checked before stopping, the settings apply only to that process, it listens on `0.0.0.0:3000`, and `/health` responds. Metro, Docker and Postgres did not change.
