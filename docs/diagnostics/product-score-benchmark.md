# Product Score: audit and offline benchmark

Date: November 1, 2026. No requests were made to Gemini, Tavily, OFF or Google. The Product Score formula did not change, and no calibration variant was applied. No commit or push was made, and `.env` was not changed.

> **Updated note (November 3, 2026).** This report is historical. Variant C was later adopted. The current formula is `product-score-v6`, with the lower floor at −16, the sum of all maximum penalties; and for `eat_healthier` the final Goal Match is never above the Product Score.

The benchmark values are typical, not measured. Only Roshen and your chips and curd product cases are set exactly. Run it with `pnpm --filter @foodlens/scoring benchmark`.

## Summary

- The guard was removed, and Goal Match and Product Score are independent again. Roshen can show 3.5 again.
- **My earlier conclusion was wrong.** On 10 products I called the compression at the bottom small. On 58 products 14 (24%) fell to 0, and 24 (41%) scored 2 or less. The bottom of the scale really does saturate.
- A zero for Roshen is an ordinary result, not a rare case.
- The order is good overall: 2 of 24 pairs are broken, both only because of an identical zero.
- I recommend variant C, but only after your decision: it removes every zero, does not touch the top of the scale and does not change the weights.

## 1. Where the guard was

- Logic: `packages/scoring/src/goal-match-score-guard.ts`, the file was deleted.
- The call and the `goal_match_guard` log: `apps/api/src/modules/scan/scan.service.ts`, lines 61–62, deleted.

## 2. What changed

- The guard, its export, call, log and tests were removed.
- The old mock chips expectation was restored: 5.7.
- Regression tests were added: `Product Score = 0` does not mean `Goal Match ≤ 2`, and the portion still changes Goal Match.
- An offline benchmark was added.
- The API was rebuilt and restarted without the guard. The settings apply only to that process: Google as the fallback, OFF and Tavily on. `/health` and `/profile` respond.

**Other dependencies of Goal Match on Product Score.** I checked the v3 calculation, the v4 AI input and prompt, the reconciliation corridor, confidence, the service and the app display. There are none. The prompt says explicitly that the Product Score is not available to the model.

There is one indirect link, which I kept: `ScanService` calls `scoreProduct()` to decide whether photo analysis is needed. The Goal Match value does not depend on it, but the decision affects which product data it receives. This is part of the barcode-first flow from your task.

## 3. Roshen after the guard was removed

- The calculated part: about 2.0.
- With AI in the v4 corridor: up to 3.5. Both real scans reached this value.

So the screen will again show `Product Score 0.0` and probably `Goal Match 3.5`. By design this is now a normal result.

## 4. Formula audit

| Part | Rule | Maximum |
|---|---|---|
| Base | constant | 8 |
| Protein | bonus from 5 to 10 g | +1.5 |
| Fiber | bonus from 3 to 6 g | +1.5 |
| Bonus total | capped | +2 |
| Sugars | food 5–22.5 g, weight 3; drinks 2.5–11.25, weight 5 | −6 |
| Saturated fat | 1.5–5 g, weight 3 | −5 |
| Salt | 0.3–1.5 g, weight 3 | −5 |
| Calories | food 80–400 kcal, weight 1.5; no penalty for drinks | −2.5 |
| Additives | 0.4 each | −2 |
| Ceiling | sugars, sat. fat or salt at high | 4 |
| Clamp | | 0–10 |

All penalties add up to 20.5, while bonuses total only 2.

**Missing data:**

- No sugars, saturated fat or salt: no score (`too_few_factors`).
- No calories, protein, fiber or additives: 0 points. So missing calories or additives is an advantage. Your chips case got 2.4, while typical chips with three additives got 0.7.
- Unknown basis: no score.

**What sends a product to 0.** A single factor cannot: its maximum is 6. A combination of two can: with sugars at the limit, 3.83 g of saturated fat is enough; with saturated fat at the limit, 22.5 g of sugars is enough. Salt and saturated fat form the same pairs.

## 5. Benchmark dataset

The set: 58 products covering all your categories. File: `packages/scoring/src/test/benchmark/product-score-benchmark.data.ts`.

| Product | Category | kcal | Protein | Fiber | Sugars | Sat. fat | Salt | Add. | Score | raw | Bonuses | Penalties | Limit |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Chicken breast | protein | 165 | 31 | 0 | 0 | 1 | 0.18 | 0 | 9.1 | 9.1 | protein +1.5 | energy -0.4 | — |
| Lentils | grains | 350 | 25 | 11 | 2 | 0.2 | 0.02 | 0 | 8.7 | 8.73 | protein +1, fiber +1 | energy -1.27 | — |
| Oatmeal | grains | 370 | 12 | 10 | 1 | 1.2 | 0.02 | 0 | 8.6 | 8.64 | protein +1, fiber +1 | energy -1.36 | — |
| Greek yogurt | dairy | 97 | 9 | 0 | 3.6 | 2.4 | 0.1 | 0 | 8.4 | 8.35 | protein +1.2 | saturatedFat -0.77, energy -0.08 | — |
| Cottage cheese 5% | dairy | 121 | 17 | 0 | 1.8 | 3 | 0.1 | 0 | 8.0 | 8.02 | protein +1.5 | saturatedFat -1.29, energy -0.19 | — |
| Water | drinks | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8.0 | 8 | — | — | — |
| Mineral water | drinks | 0 | 0 | 0 | 0 | 0 | 0.05 | 0 | 8.0 | 8 | — | — | — |
| Carrot | vegetables | 41 | 0.9 | 2.8 | 4.7 | 0 | 0.1 | 0 | 8.0 | 8 | — | — | — |
| Broccoli | vegetables | 34 | 2.8 | 2.6 | 1.7 | 0.1 | 0.08 | 0 | 8.0 | 8 | — | — | — |
| Tomato | vegetables | 18 | 0.9 | 1.2 | 2.6 | 0 | 0.01 | 0 | 8.0 | 8 | — | — | — |
| Tuna in water | protein | 116 | 26 | 0 | 0 | 0.3 | 0.9 | 0 | 7.8 | 7.83 | protein +1.5 | salt -1.5, energy -0.17 | — |
| Eggs | protein | 143 | 12.6 | 0 | 0.7 | 3.1 | 0.36 | 0 | 7.7 | 7.68 | protein +1.5 | saturatedFat -1.37, salt -0.15, energy -0.3 | — |
| Salmon | protein | 208 | 20 | 0 | 0 | 3.1 | 0.15 | 0 | 7.5 | 7.53 | protein +1.5 | saturatedFat -1.37, energy -0.6 | — |
| Natural yogurt | dairy | 62 | 3.5 | 0 | 4.7 | 2.1 | 0.12 | 0 | 7.5 | 7.49 | — | saturatedFat -0.51 | — |
| Rice | grains | 360 | 7 | 1.3 | 0.1 | 0.1 | 0 | 0 | 7.3 | 7.29 | protein +0.6 | energy -1.31 | — |
| Orange | fruit | 47 | 0.9 | 2.4 | 9.4 | 0 | 0 | 0 | 7.3 | 7.25 | — | sugars -0.75 | — |
| Lean beef | protein | 176 | 26 | 0 | 0 | 3.7 | 0.15 | 0 | 7.2 | 7.16 | protein +1.5 | saturatedFat -1.89, energy -0.45 | — |
| Apple | fruit | 52 | 0.3 | 2.4 | 10.4 | 0.03 | 0 | 0 | 7.1 | 7.07 | — | sugars -0.93 | — |
| Whole-grain bread | bread | 250 | 9 | 7 | 4 | 0.6 | 1.1 | 1 | 6.8 | 6.8 | protein +0.89, fiber +1.11 | salt -2, energy -0.8, additives -0.4 | — |
| Banana | fruit | 89 | 1.1 | 2.6 | 12.2 | 0.1 | 0 | 0 | 6.7 | 6.73 | — | sugars -1.23, energy -0.04 | — |
| Curd product (our case) | dairy | 97 | 11 | — | 1.5 | 3.5 | 0.7 | — | 6.7 | 6.71 | protein +1.5 | saturatedFat -1.71, salt -1, energy -0.08 | — |
| Milk 2.5% | dairy | 52 | 2.9 | 0 | 4.7 | 1.6 | 0.1 | 0 | 6.7 | 6.65 | — | sugars -1.26, saturatedFat -0.09 | — |
| Sugar-free cola | drinks | 0.3 | 0 | 0 | 0 | 0 | 0.02 | 4 | 6.4 | 6.4 | — | additives -1.6 | — |
| Sweetened yogurt | dairy | 95 | 3.2 | 0 | 12.5 | 1.5 | 0.12 | 2 | 5.8 | 5.84 | — | sugars -1.29, energy -0.07, additives -0.8 | — |
| Almonds | nuts | 579 | 21 | 12.5 | 4.4 | 3.8 | 0 | 0 | 5.7 | 5.69 | protein +1, fiber +1 | saturatedFat -1.97, energy -2.34 | — |
| White bread | bread | 265 | 8.5 | 2.7 | 4 | 0.5 | 1.2 | 1 | 5.5 | 5.53 | protein +1.05 | salt -2.25, energy -0.87, additives -0.4 | — |
| Orange juice | drinks | 45 | 0.7 | 0.2 | 8.4 | 0 | 0 | 0 | 4.6 | 4.63 | — | sugars -3.37 | — |
| Cornflakes | cereal | 378 | 7 | 3 | 8 | 0.3 | 1.1 | 1 | 4.3 | 4.29 | protein +0.6 | sugars -0.51, salt -2, energy -1.4, additives -0.4 | — |
| Walnuts | nuts | 654 | 15 | 6.7 | 2.6 | 6.1 | 0 | 0 | 3.6 | 3.56 | protein +1, fiber +1 | saturatedFat -3.94, energy -2.5 | — |
| Protein bar | bars | 400 | 30 | 10 | 5 | 5 | 0.5 | 5 | 3.0 | 3 | protein +1, fiber +1 | saturatedFat -3, salt -0.5, energy -1.5, additives -2 | — |
| Dessert yogurt | dairy | 130 | 3 | 0 | 16 | 3.5 | 0.15 | 3 | 3.0 | 2.97 | — | sugars -1.89, saturatedFat -1.71, energy -0.23, additives -1.2 | — |
| Chips (our case) | snacks | 536 | — | 4.4 | 0.6 | 3.1 | 1.4 | — | 2.4 | 2.44 | fiber +0.7 | saturatedFat -1.37, salt -2.75, energy -2.14 | — |
| Frozen pizza | ready meals | 250 | 10 | 2 | 4 | 4.5 | 1.3 | 3 | 2.4 | 2.43 | protein +1.5 | saturatedFat -2.57, salt -2.5, energy -0.8, additives -1.2 | — |
| Cola | drinks | 42 | 0 | 0 | 10.6 | 0 | 0.01 | 3 | 2.2 | 2.17 | — | sugars -4.63, additives -1.2 | — |
| Crackers | snacks | 430 | 10 | 3 | 5 | 3 | 1.8 | 2 | 2.0 | 2.02 | protein +1.5 | saturatedFat -1.29, salt -3.75, energy -1.64, additives -0.8 | — |
| Energy drink | drinks | 45 | 0 | 0 | 11 | 0 | 0.2 | 4 | 1.5 | 1.54 | — | sugars -4.86, additives -1.6 | — |
| Honey | sweets | 304 | 0.3 | 0.2 | 82 | 0 | 0 | 0 | 1.0 | 0.95 | — | sugars -6, energy -1.05 | — |
| Sweetened cereal | cereal | 390 | 7 | 3.5 | 30 | 1.5 | 0.9 | 2 | 0.8 | 0.81 | protein +0.6, fiber +0.25 | sugars -4.29, salt -1.5, energy -1.45, additives -0.8 | — |
| Chips | snacks | 540 | 6 | 4 | 1 | 3.5 | 1.5 | 3 | 0.7 | 0.73 | protein +0.3, fiber +0.5 | saturatedFat -1.71, salt -3, energy -2.16, additives -1.2 | — |
| Salted peanuts | nuts | 600 | 25 | 8.5 | 4 | 7 | 1.2 | 0 | 0.6 | 0.6 | protein +1, fiber +1 | saturatedFat -4.71, salt -2.25, energy -2.44 | — |
| Butter | fats | 717 | 0.6 | 0 | 0.1 | 51 | 0.02 | 0 | 0.5 | 0.5 | — | saturatedFat -5, energy -2.5 | — |
| Olive oil | fats | 884 | 0 | 0 | 0 | 14 | 0 | 0 | 0.5 | 0.5 | — | saturatedFat -5, energy -2.5 | — |
| Ketchup | sauces | 110 | 1.5 | 0.5 | 22 | 0 | 1.8 | 2 | 0.4 | 0.4 | — | sugars -2.91, salt -3.75, energy -0.14, additives -0.8 | — |
| Chocolate cereal balls | cereal | 410 | 7 | 5 | 35 | 2.5 | 0.6 | 3 | 0.1 | 0.1 | protein +0.6, fiber +1 | sugars -5.14, saturatedFat -0.86, salt -0.75, energy -1.55, additives -1.2 | — |
| Gouda cheese | dairy | 356 | 25 | 0 | 2.2 | 19 | 1.8 | 1 | 0.0 | -0.94 | protein +1.5 | saturatedFat -5, salt -3.75, energy -1.29, additives -0.4 | clamp 0 |
| Ice cream | sweets | 207 | 3.5 | 0.5 | 21 | 7 | 0.2 | 3 | 0.0 | -1.25 | — | sugars -2.74, saturatedFat -4.71, energy -0.6, additives -1.2 | clamp 0 |
| Dark chocolate 70% | sweets | 550 | 7 | 10 | 30 | 19 | 0.03 | 1 | 0.0 | -1.89 | protein +0.57, fiber +1.43 | sugars -4.29, saturatedFat -5, energy -2.2, additives -0.4 | clamp 0 |
| Caramel candy | sweets | 400 | 1 | 0 | 60 | 3 | 0.3 | 3 | 0.0 | -1.99 | — | sugars -6, saturatedFat -1.29, energy -1.5, additives -1.2 | clamp 0 |
| Mayonnaise | sauces | 620 | 0.5 | 0 | 3 | 5.5 | 1.5 | 3 | 0.0 | -2.13 | — | saturatedFat -3.43, salt -3, energy -2.5, additives -1.2 | clamp 0 |
| Boiled sausage | meat products | 260 | 12 | 0 | 1 | 9 | 2 | 4 | 0.0 | -2.19 | protein +1.5 | saturatedFat -5, salt -4.25, energy -0.84, additives -1.6 | clamp 0 |
| Cookies | sweets | 470 | 6 | 2 | 25 | 8 | 0.6 | 3 | 0.0 | -3.91 | protein +0.3 | sugars -3.43, saturatedFat -5, salt -0.75, energy -1.83, additives -1.2 | clamp 0 |
| Salami | meat products | 480 | 22 | 0 | 1 | 17 | 4 | 4 | 0.0 | -3.97 | protein +1.5 | saturatedFat -5, salt -5, energy -1.87, additives -1.6 | clamp 0 |
| Instant noodles | ready meals | 450 | 9 | 2.5 | 3 | 9 | 3 | 4 | 0.0 | -4.13 | protein +1.2 | saturatedFat -5, salt -5, energy -1.73, additives -1.6 | clamp 0 |
| Roshen chocolate (scan) | sweets | 456 | 3.3 | — | 58.6 | 11.2 | 0.01 | 1 | 0.0 | -5.16 | — | sugars -6, saturatedFat -5, energy -1.76, additives -0.4 | clamp 0 |
| Milk chocolate | sweets | 540 | 7 | 2.5 | 55 | 19 | 0.3 | 2 | 0.0 | -5.36 | protein +0.6 | sugars -6, saturatedFat -5, energy -2.16, additives -0.8 | clamp 0 |
| Snickers hazelnut | sweets | 514 | 7.5 | 2 | 48 | 10 | 0.37 | 3 | 0.0 | -5.65 | protein +0.75 | sugars -6, saturatedFat -5, salt -0.17, energy -2.03, additives -1.2 | clamp 0 |
| Snickers | sweets | 488 | 9 | 2 | 50 | 8.5 | 0.6 | 3 | 0.0 | -5.66 | protein +1.2 | sugars -6, saturatedFat -5, salt -0.75, energy -1.91, additives -1.2 | clamp 0 |
| Choco Pie | sweets | 430 | 4.5 | 4 | 37 | 10 | 0.69 | 5 | 0.0 | -6.6 | fiber +0.5 | sugars -5.49, saturatedFat -5, salt -0.97, energy -1.64, additives -2 | clamp 0 |

## 6. Distribution

| Variant | =0 | ≤1 | ≤2 | ≥9 | =10 | Mean |
|---|---|---|---|---|---|---|
| Current | 14 | 22 | 24 | 1 | 0 | 3.90 |

The scale is skewed downward: 41% of products are in the 0–2 range, and only one product, chicken breast, scored 9 or more. Nobody gets a 10.

**Roshen:** percentile 12, nobody is lower, and 14 products share its score. Zero is an ordinary result.

**Chips, your case:** 2.4, next to pizza and cola. Typical chips with additives score 0.7.

**Curd product:** 6.7, on a par with banana and milk. The −1.71 saturated fat penalty is almost fully offset by the +1.5 for protein, so moderately fat dairy products are not over-penalized. Cheese is penalized more: 0.0 with 19 g of saturated fat and 1.8 g of salt.

## 7. Products at 0

| Product | raw |
|---|---|
| Gouda cheese | −0.94 |
| Ice cream | −1.25 |
| Dark chocolate 70% | −1.89 |
| Caramel candy | −1.99 |
| Mayonnaise | −2.13 |
| Boiled sausage | −2.19 |
| Cookies | −3.91 |
| Salami | −3.97 |
| Instant noodles | −4.13 |
| Roshen chocolate | −5.16 |
| Milk chocolate | −5.36 |
| Snickers hazelnut | −5.65 |
| Snickers | −5.66 |
| Choco Pie | −6.60 |

A difference of almost 6 points is hidden. The ceiling of 4 never fired in the set.

## 8. Anomalies

**2 of 24 pairs are broken.** Both because of an identical zero:

- Boiled sausage and salami.
- Dark and milk chocolate.

**Other notable points:**

- Gouda 0.0 is below chips 0.7 and ketchup 0.4.
- Almonds 5.7 and walnuts 3.6 are below white rice 7.3: calories and saturated fat outweigh the rest.
- Olive oil and butter are equal at 0.5: the same limits fired, although they have 14 and 51 g of saturated fat.
- Sugar-free cola 6.4 is above orange juice 4.6 and sweetened yogurt 5.8.
- Milk 6.7 is below yogurt 7.5: for drinks lactose is penalized by the strict sugar threshold.
- Apple 7.1 and banana 6.7 are below water and vegetables: natural sugar is penalized too.
- The protein bar at 3.0 sits next to dessert yogurt.

Some of this follows from the rules themselves, so these are questions to decide rather than code errors.

## 9. Double penalties

**Sugar and calories, fat and calories: yes, there is repetition.** 45 of 51 food products have a calorie penalty, 38 of them together with a sugar or saturated fat penalty. The formula acknowledges this effect for drinks but not for food. Without it the order barely changes (correlation 0.97), and only cheese, dark chocolate and mayonnaise come off zero. This is a real inconsistency, but not the main cause of the zeros.

**Protein and fiber:** the bonus is too small to change the picture at the bottom. A maximum of 2 against penalties of up to 20.5. A protein bar with 30 g of protein already hits the bonus limit.

**Additives:** the scale is reasonable. The maximum is −2 for a product with five additives. On their own they never send a product to zero. For sugar-free cola −1.6 is the only minus.

**Sugars and saturated fat:** the two limits add up to 11, more than the base of 8. That is what causes the saturation: sugars are at the limit for 6 products, saturated fat for 13, both for 4.

## 10. Calibration variants

A simulation on the factors of the real function; not added to the code.

- **A. Lower penalty limits:** sugars 4, saturated fat 3.5, salt 3.5, calories 1.5.
- **B. Decreasing weights:** penalties in descending order with weights 1, 0.6, 0.4, 0.3.
- **C. Normalizing the bottom of the scale:** no change above raw 4; below 4, linear compression from the worst possible raw of −12.5. The weights do not change.

| Product | Current | A | B | C |
|---|---|---|---|---|
| Roshen | 0.0 | 0.0 | 0.0 | 1.8 |
| Chips, your case | 2.4 | 3.1 | 4.1 | 3.6 |
| Curd product | 6.7 | 6.7 | 7.2 | 6.7 |
| Natural yogurt | 7.5 | 7.5 | 7.5 | 7.5 |
| Apple | 7.1 | 7.1 | 7.1 | 7.1 |
| Cola | 2.2 | 2.8 | 2.2 | 3.6 |
| Milk chocolate | 0.0 | 0.0 | 0.0 | 1.7 |
| Dark chocolate 70% | 0.0 | 0.6 | 1.1 | 2.6 |
| Protein bar | 3.0 | 3.0 | 3.9 | 3.8 |
| Snickers | 0.0 | 0.0 | 0.0 | 1.7 |
| Butter | 0.5 | 3.0 | 1.5 | 3.2 |

| Variant | =0 | ≤1 | ≤2 | ≥9 | =10 | Mean | Order vs current | Broken pairs |
|---|---|---|---|---|---|---|---|---|
| Current | 14 | 22 | 24 | 1 | 0 | 3.90 | 1.000 | 2 |
| A | 11 | 15 | 18 | 1 | 0 | 4.19 | 0.986 | 0 |
| B | 10 | 12 | 20 | 1 | 0 | 4.32 | 0.989 | 1 |
| C | 0 | 0 | 6 | 1 | 0 | 4.93 | 0.993 | 0 |

**Pros and cons:**

- **A:** easy to explain, but 11 zeros remain, and the weights have to change.
- **B:** removes repeated risks best, but 10 zeros remain and the logic is more complex. Chips rise to 4.1.
- **C:** no zeros, the top untouched, the order preserved best of all. But the bottom of the scale is compressed: all bad products end up between 1.7 and 4, and cola and chips get 3.6. It does not remove the double counting of calories. The 0–1.5 range is practically unused.

## 11. What I recommend

Variant C, with the floor chosen separately: −12.5 is the theoretical minimum, while the worst raw in the set is −6.6. Closer to that value the scale is wider at the bottom: at −8 Roshen would get about 1 and cola 3.4. It is worth looking at the table at that value first, and applying it only after your decision.

I would consider the double counting of calories as a separate step. It does not solve the saturation, and changing two things at once is a bad idea: it would be unclear what caused the effect.

The benchmark is built on typical values. Before a final decision it is worth adding 10–15 real products from OFF.

## 12. Changed files

Deleted:

- `packages/scoring/src/goal-match-score-guard.ts`
- `packages/scoring/src/test/goal-match-score-guard.test.ts`

New:

- `packages/scoring/src/test/match-goal-independent.test.ts`
- `packages/scoring/src/test/benchmark/product-score-benchmark.data.ts`
- `packages/scoring/src/test/benchmark/product-score-variants.ts`
- `packages/scoring/src/test/benchmark/product-score-report.ts`
- `packages/scoring/src/test/benchmark/product-score-benchmark.test.ts`
- `docs/diagnostics/product-score-benchmark.md`

Changed:

- `apps/api/src/modules/scan/scan.service.ts`
- `apps/api/src/modules/scan/test/scan-barcode-first.test.ts`
- `apps/api/src/modules/goal-match/test/goal-match-v4.test.ts`
- `packages/scoring/src/index.ts`
- `packages/scoring/package.json`, the `benchmark` command
- `docs/diagnostics/mvp-core-audit.md`

## 13. Tests and typecheck

`pnpm typecheck` passed for all 7 projects. `pnpm test`: 745 of 745 (api 332, scoring 205, ai 109, mobile 82, nutrition 17). The benchmark tests need no network and check relative order, not predefined scores. Exact values are checked only for Roshen and your two cases.

## A mistake during the restart

I took the API process number from a truncated line and ran `Stop-Process` for PID 1892 instead of the real 18928. The errors were hidden, so I do not know whether such a process existed or whether it was stopped. Then I stopped the real API process. After that the API, Metro and `foodlens-postgres` were running. If something on the computer closed unexpectedly around 04:20–04:30, this may be the cause: just start that application again.

## Addendum: real OFF data

No network requests were made. The formula did not change. I checked the fixtures, project files, the database (read-only), logs and saved files.

**10–15 real products cannot be gathered locally: only 3 were found, and a score can be calculated for 2.** So recommendation C is not confirmed on real data.

| Barcode | Product | Where from | What is there |
|---|---|---|---|
| 3017620422003 | Nutella | the saved OFF response `off-sample.json` | all nutrition values, no additives in the file |
| 4823077621154 | Roshen | values from the screen after the scan, OFF confirmed by the log | all values, the OFF response was not saved |
| 4607084351385 | Choco Pie | a scan note: kcal 507 | no sugars, saturated fat or salt, no score (`too_few_factors`) |

The database has only `user_nutrition_profiles` and the migrations table; OFF responses are not stored there. The OFF cache lives in API memory and is not written to disk. The barcode `4607001771234` and the product «Чокопай» (Choco Pie) in the fixtures are invented for tests, and `4011100000000` is a test barcode too, so they were not used.

**The OFF subset, 2 products with a score:**

| Product | Current | C(−8) | C(−12.5) |
|---|---|---|---|
| Roshen | 0.0 | 0.9 | 1.8 |
| Nutella | 0.0 | 1.1 | 1.9 |

Nutella is above Roshen only because it has no additive data. Two sweet products say nothing about the distribution.

**The whole set, 59 products, mostly typical values:**

| Variant | =0 | ≤1 | ≤2 | ≥9 | =10 | Mean | Order vs current | Broken pairs of 26 |
|---|---|---|---|---|---|---|---|---|
| Current | 15 | 23 | 25 | 1 | 0 | 3.83 | 1.000 | 2 |
| C(−8) | 0 | 5 | 13 | 1 | 0 | 4.64 | 0.992 | 0 |
| C(−12.5) | 0 | 0 | 7 | 1 | 0 | 4.88 | 0.992 | 0 |

**Comparing the floor:**

| Product | Current | C(−8) | C(−12.5) |
|---|---|---|---|
| Snickers | 0.0 | 0.8 | 1.7 |
| Choco Pie, typical values | 0.0 | 0.5 | 1.4 |
| Milk chocolate | 0.0 | 0.9 | 1.7 |
| Dark chocolate 70% | 0.0 | 2.0 | 2.6 |
| Chips, typical | 0.7 | 2.9 | 3.2 |
| Cola | 2.2 | 3.4 | 3.6 |
| Butter | 0.5 | 2.8 | 3.2 |
| Protein bar | 3.0 | 3.7 | 3.8 |

**Preliminary conclusion:** on typical data C(−8) is better than C(−12.5): the bottom of the scale is used more widely, bad products stay noticeably lower, there are no zeros, and the order is preserved. But this is not confirmation yet: the data is mostly my typical values. The rise of chips from 0.7 to 2.9 and cola from 2.2 to 3.4 should also be judged on real products.

**What is missing:** drinks, dairy, yogurt, cheese, bread, cereal, meat products, fish, snacks, ready meals, sauces, nuts, bars.

**What a real check needs:** 13 `GET` requests to the OFF API v3.6 by exact barcode, with our User-Agent and at most 12 a minute, with no AI. If the barcodes are chosen through OFF search, that adds up to 13 search requests at a limit of 10 a minute.

Tests: `pnpm typecheck` passed, `pnpm test`: 747 of 747. Changes are only in the benchmark files: OFF records were added, along with the C(−8) variant, a report on the OFF subset and monotonicity tests.

## Addendum: 13 real OFF products and comparison with C(−8)

The Product Score formula did not change. No requests were made to Gemini or Tavily. No commit or push was made.

### Conclusion

**C(−8) is partly confirmed.** It passed on mechanics: no zeros, no checked ordering pair broken, the top of the scale unchanged. There is no confirmation on chocolate and chips: none were among the 13 real products. For the MVP C(−8) can be applied as a minimal fix, but it only removes the zeros. It does not fix oddities such as sugar-free Coca-Cola scoring above sardines.

### Requests and sample quality

All 13 requests were used. The first pass took 3 and covered every category. I made a second pass for raw records and a better selection, but OFF returned 503 for 5 of the 10 requests, and little useful came out of it.

Consequences:

- **Raw OFF records were saved for only 2 products.** For 11 the snapshot has values parsed from the response, without raw `nutriments`. All of them have the barcode, name, product URL, request URL, time and modification date. No values were added.
- **There are no chips and no chocolate bar.** In their place are Wasa crispbread and the Perly dairy dessert, as noted in the table.
- **There are almost no Russian products:** only Activia, marked with Russia as the country.
- Rejected: a sour cream that landed in the cheese category, and a record with a test barcode.

Snapshot: `packages/scoring/src/test/benchmark/off-products.snapshot.json`; the benchmark and the tests read only it and need no network. Source: Open Food Facts, ODbL license.

### 13 real products

| Category | Product | Barcode | kcal | Sugars | Sat. fat | Salt | Protein | Fiber | Add. | Current | raw | C(−8) | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| dessert | Perly (Copag) | 6111242100992 | 97 | 9.4 | 0 | 0 | 8 | 0 | 0 | 8.1 | 8.07 | 8.1 | salt 0; not a bar |
| natural yogurt | Le nature (Jaouda) | 6111242100206 | 78.5 | 0 | 2.4 | 0 | 4.2 | 0 | 0 | 7.2 | 7.23 | 7.2 | sugars 0 with carbs 8; salt 0 |
| snacks | Wasa Authentique | 7300400481595 | 336 | 1 | 0.4 | 1 | 9 | 19 | 0 | 7.0 | 7.05 | 7.0 | crispbread, not chips |
| bread | Pain De Mie Bio (La Boulangère) | 3760049790214 | 268 | 6.3 | 0.4 | 1.1 | 8.1 | 4.9 | 0 | 6.8 | 6.78 | 6.8 | — |
| sweetened yogurt | Activia borůvka | 8595002100527 | 86 | 10.8 | 1.8 | 0.15 | 3.8 | — | 0 | 6.7 | 6.72 | 6.7 | no fiber |
| cereal | Cruesly (PepsiCo France) | 3168930010265 | 462 | 12 | 2 | 0 | 8.5 | 10 | 1 | 6.2 | 6.18 | 6.2 | salt 0 |
| sugar-free drink | Coca-Cola sans sucres | 5449000214799 | 0.3 | 0 | 0 | 0.01 | 0 | 0 | 6 | 6.0 | 6 | 6.0 | — |
| nuts | Amandes (Alesto) | 20724696 | 621 | 4.8 | 4.3 | 0.01 | 24.5 | 12.1 | 0 | 5.1 | 5.1 | 5.1 | — |
| fish | Sardines Huile d'Olive (Parmentier) | 3019081238643 | 227 | 0 | 3.5 | 1.2 | 23 | — | 0 | 4.9 | 4.85 | 4.9 | no fiber |
| cheese | Jben (Jaouda) | 6111242106949 | 235 | 0 | 15 | 0.46 | 8 | 0 | 1 | 2.4 | 2.37 | 3.5 | sugars 0 with carbs 3.5 |
| sugary drink | Coca-Cola Original Taste | 5449000054227 | 42 | 10.6 | 0 | 0 | 0 | 0 | 3 | 2.2 | 2.17 | 3.4 | — |
| sausage | Knacki pur porc (Herta) | 3154230801795 | 265 | 1 | 9.1 | 1.928 | 13 | 0 | 1 | 0.0 | −0.84 | 2.4 | — |
| sauce | Barilla Pesto Genovese | 8076809513753 | 492 | 5 | 5.3 | 3.2 | 4.7 | 3 | 1 | 0.0 | −2.59 | 1.8 | — |

### Distribution

| Set | Variant | =0 | ≤1 | ≤2 | ≥9 | =10 | Mean | 0–2 / 2–4 / 4–6 / 6–8 / 8–10 |
|---|---|---|---|---|---|---|---|---|
| 13 real | Current | 2 | 2 | 2 | 0 | 0 | 4.82 | 2 / 2 / 2 / 6 / 1 |
| 13 real | C(−8) | 0 | 0 | 1 | 0 | 0 | 5.32 | 1 / 3 / 2 / 6 / 1 |
| All 72 | Current | 17 | 25 | 27 | 1 | 0 | 4.01 | 26 / 9 / 7 / 19 / 11 |
| All 72 | C(−8) | 0 | 5 | 14 | 1 | 0 | 4.77 | 11 / 24 / 7 / 19 / 11 |

Among the real products the share of zeros is lower, 2 of 13. But the sample has no chips or chocolate, so it is skewed upward. Across all 72 products 24% fall to 0. The real zeros, Knacki and pesto, show that the saturation is not only about sweets: sausage and sauce also hit zero.

### Order

34 pairs were checked, including 8 new ones on real products.

| Variant | Broken |
|---|---|
| Current | 2: boiled sausage and salami, dark and milk chocolate, both because of an identical zero |
| C(−8) | 0 |

C(−8) cannot change the order by construction: it only separates products with an identical zero. So this result is expected.

### Odd scores

- **Perly 8.1, the best of the 13.** It is a dairy dessert with 9.4 g of sugar. Part of the reason is the `salt 0` record.
- **Le nature 7.2:** `sugars 0` with 8 g of carbs does not look like a real value; the sugar penalty simply did not fire.
- **Cruesly 6.2 is above sardines 4.9 and almonds 5.1.** The cereal has `salt 0` and a large fiber bonus. Fish and nuts lose because of calories, saturated fat and salt.
- **Sugar-free Coca-Cola 6.0 is above sardines and almonds.** Six additives cost only −2. The formula reflects the benefit of whole foods poorly.
- **Activia 6.7 is close to natural yogurt:** the order is right, but the gap is small.
- **The raw benchmark exposes an OFF data problem:** a value of 0 can often mean “not filled in”. The formula treats it as a real zero.

C(−8) does not change these cases: they are above raw 4.

### Recommendation

1. Apply C(−8) if the zeros need fixing before the hackathon. Only the final scale below 4 needs to change. The rise is noticeable: cola 2.2 → 3.4, typical chips 0.7 → 2.9, Knacki 0 → 2.4.
2. Separately treat `0` values from OFF as suspicious when there are signs of a gap, for example `sugars 0` with 8 g of carbs. That is a data question, not a formula question.
3. Postpone whole-food bonuses and the calorie penalty: they need a separate check.

Tests: `pnpm typecheck` passed, `pnpm test`: 748 of 748.
