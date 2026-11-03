# Roshen: breaking down Product Score 0.0 and Goal Match 3.5

Scan: November 1, 2026, 03:29:58 computer time, requestId `10695419-8b41-4df5-8273-4bd30f1ad53d`, barcode `4823077621154`.

Sources: the API log of this scan, the Metro log, the code and a local run of the real `scoreProduct()` and `calculateEatHealthier()` from the built `packages/scoring`. No new requests were made to Gemini, Tavily or OFF. The code did not change, and no commit or push was made.

> **Updated note (November 3, 2026).** This report is historical. The current Product Score (`product-score-v6`) compresses the bottom of the scale down to −16, so this product now scores 2.1 instead of 0.0, and for `eat_healthier` the final Goal Match is never above the Product Score.

## Conclusion

- 0.0 is the expected result of the current formula: the raw sum is −5.16, and the lower bound of 0 raised it to 0.
- The ceiling of 4 played no role here.
- Main cause: two maximum penalties, sugars −6 and saturated fat −5, add up to more than the base of 8. Calories and additives did not affect the result.
- Calories are double-counted, but that is not what produced 0.0.
- Goal Match 3.5 came from the AI. The calculated part gives 2.0, and the difference is allowed by the v4 rules.
- The scan went entirely through the barcode: no photo, `analyzeProduct` was not called, and Tavily was not needed.

The numbers are not written to the log. The nutrition values below come from the screen in your message, and the source of each field is confirmed by the log.

## 1. Provenance

`scan_flow`: `images: 0`, `offHit: true`, `tavilyUsed: false`, `geminiCalled: false`, `geminiReason: "not_needed"`. The `product_lookup` line for OFF: `match: "exact_barcode"`, and `filled` contains every field below except serving.

| Field | Value | Source |
|---|---|---|
| kcal | 456 | `open_food_facts`* |
| protein | 3.3 | `open_food_facts` |
| carbs | 63.6 | `open_food_facts` |
| sugars | 58.6 | `open_food_facts` |
| fat | 19.3 | `open_food_facts` |
| saturatedFat | 11.2 | `open_food_facts` |
| salt | 0.01 | `open_food_facts` |
| sodium | 4 mg | `open_food_facts`** |
| fiber | none | `not_detected` |
| serving | 43 g | `open_food_facts`*** |
| additives | E476 | `open_food_facts` |
| ingredients | present | `open_food_facts` |

\* If OFF has no `energy-kcal`, the value is converted from kJ and marked `inferred` (`open-food-facts.mapper.ts:56-57`). Which case applies here is not logged.

\** In `filled` and with `fields.sodium: true`, this value comes from the OFF record. 4 mg is exactly 0.01 g of salt ÷ 2.5, so OFF may have derived it itself. The log cannot tell.

\*** `fields.serving: true`, but the serving does not appear in `filled`: this is a quirk of `tableFromLookup` (`product-merge.ts:79`). The 43 g is visible on the screen and in the calculation.

**Where sugars 58.6, saturatedFat 11.2 and salt 0.01 came from:** from the OFF record `nutrition.aggregated_set` for the exact barcode, through the mapper (`open-food-facts.mapper.ts:60-75`). Nothing was read from the label. The mapper drops values marked as estimates, so these three were not marked as estimates in OFF. Who entered them in OFF and whether they match the package is unverified.

## 2. Did Tavily take part

No, it was not needed. The `web_search` line: `status: "not_needed"`, `triggered: false`, `missingFields: []`. 0 credits, no URLs, no fields, nothing accepted or rejected.

This scan had a single Gemini request, for Goal Match: prompt 3726, output 255, total 3981. The scan took 2259 ms.

## 3. Product Score calculation

Thresholds from `product-score-rules.ts`: `BASE_SCORE` :16, `MAX_BONUS` :19, `HIGH_LEVEL_CEILING` :22, `SUGARS_RULE` :57, `SATURATED_FAT_RULE` :68, `SALT_RULE` :76, `ENERGY_RULE` :87, `PROTEIN_RULE` :95, `FIBER_RULE` :98, `ADDITIVES_RULE` :104. Penalty formula: `min(maxPenalty, weight × max(0, value − low) / (high − low))`.

| Step | Calculation | Without the limit | Result |
|---|---|---|---|
| Base | constant | | +8 |
| fiber | no value, the factor is not counted | | 0 |
| protein | 3.3 < 5 | | 0 |
| sugars | 3 × (58.6 − 5) / (22.5 − 5) | −9.1886 | −6 (limit) |
| saturatedFat | 3 × (11.2 − 1.5) / (5 − 1.5) | −8.3143 | −5 (limit) |
| salt | 0.01 ≤ 0.3 | | 0 |
| energy | 1.5 × (456 − 80) / (400 − 80) = −1.7625 | | −1.76 |
| additives | 1 × 0.4, limit 2 | | −0.4 |
| Sum | 8 − 6 − 5 − 1.76 − 0.4 | | −5.16 |
| Ceiling of 4 | applies only if raw > 4 (`score-product.ts:77`) | | did not fire |
| Lower bound | `roundScore`: max(0, −5.16) | | 0.0 |

The real `scoreProduct()` gave the same: `value: 0`, `raw: -5.16`, `ceiling: null`. The difference between −1.7625 and −1.76 is because the code rounds factor points to 0.01.

## 4. Why exactly 0.0

The sum of penalties and the lower bound of 0 fired, not the ceiling. Sugars pull down the most, −6, followed by saturated fat, −5.

Variants calculated with the real function, the formula unchanged:

| Variant | raw | Score |
|---|---|---|
| As is | −5.16 | 0.0 |
| Without additives | −4.76 | 0.0 |
| Without the calorie penalty | −3.40 | 0.0 |
| Without calories and additives, only sugar + satFat + salt | −3.00 | 0.0 |
| Without the saturated fat penalty | −0.16 | 0.0 |
| Without the sugar penalty | 0.84 | 0.8 |
| Without the sugar and saturated fat penalties | 5.84 | 5.8 |
| Fiber 6 g, maximum bonus | −3.66 | 0.0 |
| Protein 10 g, maximum bonus | −3.66 | 0.0 |

Removing any single factor except sugar does not change the result.

## 5. Is the formula reasonable

**Rule compliance:** complete. Each step follows `product-score-rules.ts`.

**Penalty limits:** the two limits add up to 11, more than the base of 8. Any product with high sugars and high saturated fat gets 0 regardless of everything else. A check with notional dark chocolate values (sugars 30, saturated fat 20, protein 7, fiber 9) also gave 0. So within this group the score does not distinguish products, and the bonuses cannot reach it.

**The ceiling of 4:** with such values it does not work, because the sum of penalties is already below it.

**Double counting:**

| Pair | Present? | Effect here |
|---|---|---|
| Sugar and calories | yes: 58.6 g ≈ 234 kcal of 456 | −1.76 shared with sugar and fat, no effect on the result |
| Saturated fat and calories | yes: 11.2 g ≈ 101 kcal | the same |
| Total fat and saturated fat | no: only saturated fat is penalized | none |
| Additives and ultra-processing | not inside the Product Score: there is no processing factor there | none |
| A penalty and a ceiling for the same high level | built into the rules | did not fire |

Sugar and saturated fat provide about 73% of this product's calories. The formula itself acknowledges this effect: for drinks the calorie penalty is zero, with the explanation that “their calories are sugar that is already counted” (`product-score-rules.ts`, `ENERGY_RULE`). Food has no such exception. This is an inconsistency in the model, but it does not affect the Roshen result.

There is no triple counting of one risk. The main problem is not double counting, but that the penalty limits make products at the bottom of the scale indistinguishable.

## 6. Product Score and Goal Match

The divergence is normal by design: these are different models, and Goal Match does not receive the Product Score as input.

| | Product Score | Goal Match |
|---|---|---|
| Base | 8 | 6 |
| Basis | per 100 g | the 43 g serving, when present |
| The person | no | goal and restrictions |
| Calories | penalty | no |
| Several risks | sum | descending, with weights 1, 0.5, 0.25 |
| Sugar | all sugars | free sugar, taking the source into account |
| Processing | no | yes |
| Additives | yes | no |
| AI | no | v4 can adjust within the rules |

The calculated v3 part for a 43 g serving, with the real function:

```
Base                     6
Sugars: 50.4% of limit   −3      (risk 3 × 1)
Saturated: 24.08%        −0.528  (risk 1.056 × 0.5)
Salt                      0
Ultra-processed          −0.5
Protein and fiber         0
Result                   1.972 ≈ 2.0
```

Here I assumed `sugarSource: added` and `processing: ultra_processed` from the explanations on the screen. The values themselves are not logged.

Why the screen shows 3.5:

- Log: `outcome: "ai_accepted"`, `aiCalls: 1`.
- The v4 corridor (`goal-match-reconcile.ts`): from `min − 3.5` to `max + 1.5`, that is 0–3.5. The risk ceiling of 4.5 does not interfere.
- `ai_accepted` means the AI answer did not need adjusting. So the AI returned 3.5, the top of the corridor. The AI answer itself is not logged; this is an inference from the rules.

So the number on the screen is 1.5 above the calculation because of the AI. That does not contradict the v4 rules, but a product with 58.6 g of sugar ended up at the very top of the allowed range.

## 7. UI

**Where the entity in the name came from.** The mapper takes `product_name` as is and only collapses whitespace (`open-food-facts.mapper.ts:26`, `:146`). It does not decode HTML entities, and React Native shows the text literally. Most likely the entity is already in the OFF data. The name itself is not logged, so the exact form of the string, `&quot;` or a double `&amp;quot;`, cannot be confirmed.

Decoding locally is safe: the result is shown as plain text, not HTML. No AI is needed.

**Minimal fix, not applied.** In the mapper's `text()`, apply the shared decoder from `decodeEntities` (`web/page-nutrition.ts:45`), extended with `&#x..;`. Run it up to twice to cover `&amp;quot;`. The text becomes `"`.

**Why the category was not detected.** In a barcode scan only `analyzeProduct` sets the category, and it was not called. The `FIELDS` of the OFF request contain no categories (`open-food-facts.provider.ts:7`), the mapper does not read them, and `emptyBarcodeProduct` sets `NOT_DETECTED`. The category does not affect the Product Score or Goal Match, but the diet check uses it (`match-goal.ts:246`).

**Minimal fix, not applied.** Add `categories_tags` to the existing OFF request; it is not a new request. In the mapper, add a table from tags to `ProductCategory`, for example `en:chocolates` to `chocolate`, and leave an unknown tag as `not_detected`. No new AI call is needed.

## 8. What to check next

1. **Roshen values on the package.** Compare sugars 58.6, saturatedFat 11.2 and salt 0.01 with the label: right now this is data from a single unverified OFF record.
2. **A product set for the Product Score.** Run 15–20 different products locally and decide whether the score should distinguish products at the bottom of the scale. Changing the formula because of one chocolate is not worth it.
3. **The calorie penalty for food.** See whether it is needed in its current form, given the logic for drinks.
4. **Logs.** Record the nutrition values, the energy source, the semantics and the AI answer for Goal Match.
5. **AI in Goal Match.** Check on several products how often the AI goes to the top of the corridor.
6. **Snickers.** In the same run, the previous scan without a barcode rejected vkusvill.ru and calorizator.ru with `variant_mismatch`: Gemini wrote «лесного» (an inflected form of “hazelnut”), and the synonym list did not have that form. The macros matched. This is unrelated to Roshen but affects the next Snickers test.

The phone logs also showed that the Roshen code was caught (`camera_barcode_detected`) and sent with `images: 0`, so barcode-first worked as designed.
