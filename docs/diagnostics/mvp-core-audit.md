# Core MVP audit: web fallback, Product Score, Goal Match

Date: November 1, 2026. No real requests were made to Gemini, Tavily or OFF, no commit or push was made, and `.env` was not changed. The consistency guard was not applied; this is an analysis and a recommendation.

> **Updated note (November 3, 2026).** This report is historical. The guard described below was applied and later removed. The current rule is simpler: for `eat_healthier` the final Goal Match is never above the Product Score (`limitByProductScore` in `packages/scoring/src/goal-match-product-limit.ts`). The Product Score formula is now `product-score-v6`.

The values of the control products are typical, not measured. Only Roshen comes from a real scan. For Snickers hazelnut the 514/7.5/56/28.6 from the label are real, while sugars 48, saturated fat 10, salt 0.37 and fiber 2 are typical. The calculations use the real `scoreProduct()` and the deterministic Goal Match v3 with a real profile (`eat_healthier`, protein target 139 g); AI took no part.

## Summary

- The web fallback logic works, but it will not complete Snickers yet. The grammar fix removed a false rejection, but the pages that were read simply do not have all the required values.
- The Product Score separates products correctly: good ones 7.1–8.6, bad ones 0–2.2.
- There is compression at the bottom, but it is small: only two chocolates fell to zero.
- I recommend a guard only for `eat_healthier`: **when Product Score ≤ 4, the final Goal Match is at most Product Score + 2.** Roshen becomes 2.0 instead of 3.5, and good products do not change.

## 1. Does the barcode/web fallback work

Yes, architecturally the chain works, and safety is preserved:

- OFF complete: Roshen got a Score without Gemini or Tavily (a real scan).
- No OFF, pages found: Tavily reads the pages, and the code checks the macros and the variant (real scans).
- The label wins over the web, another variant and another recipe are rejected, and no value is accepted without a source (tests).

The real case “barcode → Tavily → fields filled → Score” is not confirmed yet: Snickers has never reached that step with a barcode.

## 2. Where matching gets in the way

**Fixed.** Gemini wrote «С лесного орехом» (an inflected “with hazelnut”), and the synonyms did not have that form, so vkusvill.ru and calorizator.ru got `variant_mismatch`. A deterministic normalization of Russian endings was added (`wordStem` in `web/product-identity.ts`) on both sides and in the synonym table, with a minimum stem length of 4. The rules were not relaxed.

Tests: the real vkusvill and calorizator titles match the forms «лесной», «лесного», «лесным» and «hazelnut». Classic, White and Crisper do not match, and a regular Snickers with other macros and Choco Pie are rejected.

**Not solved yet, and this matters more.** From the log of the same scan:

| Page | Variant after the fix | sugars | saturatedFat | salt |
|---|---|---|---|---|
| vkusvill.ru | yes | no | no | no |
| calorizator.ru | yes | no | no | no |
| health-diet.ru (earlier scan) | yes | 48.6 | no | no |
| barista-ltd.ru, tier 4 | yes, but a weak source | 19.7 | no | no |
| fitaudit.ru, tier 4 | not read | not logged | not logged | not logged |

Conclusion: with these pages Snickers without a barcode will still not get a Score. The required values are either not printed or not seen by the parser, and each field must be confirmed by two sources. Which cause applies to each page is unknown from the log: page text is not stored. The sugars of 48.6 and 19.7 on different pages also disagree, so web data for this product cannot be trusted without cross-checking.

I tried additional changes but reverted them: they go beyond the scope or relax the rules. Options for your decision:

- Add `fitaudit.ru` as a tier 3 product database: safe, but I have not checked the page tier.
- Widen the table window from 900 to 2500 characters: saturated fat in long tables may sit further away.
- Treat the product as confirmed by two pages and take the value from one of them. This relaxes your case C rule, so it is not introduced without your consent.

## 3. Product Score of the control products

Points on a base of 8. The values are pinned in `packages/scoring/src/test/product-score-control.test.ts`.

| Product | Score | raw | Sugars | Sat. fat | Salt | kcal | Protein | Fiber | Additives |
|---|---|---|---|---|---|---|---|---|---|
| Oatmeal | 8.6 | 8.64 | 0 | 0 | 0 | −1.36 | +1 | +1 | 0 |
| Water | 8.0 | 8.00 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Cottage cheese 5% | 8.0 | 8.02 | 0 | −1.29 | 0 | −0.19 | +1.5 | 0 | 0 |
| Yogurt | 7.5 | 7.49 | 0 | −0.51 | 0 | 0 | 0 | 0 | 0 |
| Apple | 7.1 | 7.07 | −0.93 | 0 | 0 | 0 | 0 | 0 | 0 |
| Cola | 2.2 | 2.17 | −4.63 | 0 | 0 | 0 | 0 | 0 | −1.2 |
| Sweetened cereal | 0.8 | 0.81 | −4.29 | 0 | −1.5 | −1.45 | +0.6 | +0.25 | −0.8 |
| Chips | 0.7 | 0.73 | 0 | −1.71 | −3 | −2.16 | +0.3 | +0.5 | −1.2 |
| Roshen | 0.0 | −5.16 | −6 | −5 | 0 | −1.76 | 0 | 0 | −0.4 |
| Snickers | 0.0 | −5.65 | −6 | −5 | −0.17 | −2.03 | +0.75 | 0 | −1.2 |

**The order makes sense:** good products at the top, bad ones at the bottom, with a large gap (2.2 and 7.1).

Debatable points; they do not force a formula change yet:

- The apple is below cottage cheese and yogurt: the Product Score also penalizes natural sugar.
- Cola is above chips and cereal. This follows from one strong minus against several medium ones, not an obvious error.

## 4. Compression at the bottom

It exists but is limited. 2 of 10 fell to 0: both chocolates, raw −5.16 and −5.65. The difference between them is hidden by the lower bound. The other bad products are distinguishable (0.7, 0.8, 2.2).

The reason is mechanical: the sugar and saturated fat penalty limits add up to 11, while the base is 8. For chocolates and similar sweets the score does not tell products apart. For a hackathon this is acceptable: they really are at the bottom.

**Double counting.** The calorie penalty partly repeats sugar and fat; the formula already accounts for this for drinks. Without it Roshen and Snickers stay at 0, cereal would become 2.3, chips 2.9, oatmeal 10. The order of the groups does not change, so there is no proven bias. I do not recommend changing the formula.

## 5. Why Roshen got 0

The sum: 8 − 6 − 5 − 1.76 − 0.4 = −5.16, and the lower bound gave 0. The ceiling of 4 played no role. The full calculation: `docs/diagnostics/roshen-score.md`.

## 6. The recommended consistency guard

**Rule:** only for `eat_healthier`, after the v4 reconciliation and restriction penalties, when the Product Score is known:

```
Product Score ≤ 4 → Goal Match = min(Goal Match, Product Score + 2)
```

**Where the numbers come from, rather than guesswork:**

- `k = 2`: the smallest value at which the calculated Goal Match of Roshen, Snickers, cereal and cola does not change. With `k = 1` Roshen, Snickers and cereal are pressed against the Product Score, almost a copy. With `k = 3` Roshen with AI can show 3.0, and the contradiction remains.
- `Score ≤ 4`: above this level a fixed gap is not needed. It is the formula's ceiling for high risk (`HIGH_LEVEL_CEILING`). Good products in the set start at 7.1, so the guard does not touch them. The set has no products with a Score of 2.2–7; that is a blind spot.

**Result:**

| Product | Score | GM calculated | GM max with AI | After: calculated | After: max with AI |
|---|---|---|---|---|---|
| Apple | 7.1 | 8.5 | 10 | 8.5 | 10 |
| Yogurt | 7.5 | 6.1 | 7.6 | 6.1 | 7.6 |
| Cottage cheese | 8.0 | 8.6 | 10 | 8.6 | 10 |
| Oatmeal | 8.6 | 8.6 | 10 | 8.6 | 10 |
| Water | 8.0 | not applicable | | not applicable | |
| Cola | 2.2 | 2.5 | 4.0 | 2.5 | 4.0 |
| Cereal | 0.8 | 2.4 | 3.9 | 2.4 | 2.8 |
| Chips | 0.7 | 4.0 | 5.5 | 2.7 | 2.7 |
| Roshen | 0.0 | 2.0 | 3.5 | 2.0 | 2.0 |
| Snickers | 0.0 | 1.4 | 2.9 | 1.4 | 2.0 |

“Max with AI” is the top of the v4 corridor, not a real AI answer. The real Roshen 3.5 becomes 2.0.

**What is kept:**

- Goal Match is not a copy: yogurt is below its Score, the apple above.
- The effect of the portion: Roshen 20 g 2.0, 43 g 2.0, 100 g 1.0.
- The goal and restrictions still apply.

**What is lost:** for chips a 15–30 g portion no longer matters, because the value hits the 2.7 ceiling.

**Options considered:**

| Option | Pros | Cons |
|---|---|---|
| `Score ≤ 4 → GM ≤ Score + 2` (recommended) | one clear gap, the calculation barely changes | chips hit the ceiling; at a Score of 4 the ceiling disappears at once |
| `Score ≤ 2 → GM ≤ Score + 1` | stronger | almost a copy of the Score, the portion effect is lost at the bottom |
| Bands: `≤ 2 → 2.5`, `≤ 4 → 4.4` | easy to explain | a jump between a Score of 2.0 and 2.1 |
| Forbid AI from raising above the calculation when the Score is low | does not touch the calculation, removes Roshen's rise | chips stay at 4.0 with a Score of 0.7 |

Where to apply it: `goal-match-reconcile.ts` or right after it in `goal-match.service.ts`. It needs the Product Score as an input and a log line when it fires. The AI explanation text stays the same, which is worth checking. The rule does not apply to other goals.

## 7. What a hackathon MVP actually needs

Done: word form normalization. No decision needed: the Product Score stays unchanged.

Remaining, in order:

1. Apply the guard after your consent.
2. Rebuild the API: the process running now does not have the matching fix yet.
3. Run one Snickers scan **with a barcode** and look at `web_candidate`: the logs now show the values of each page.
4. Based on that log, decide what is needed: a wider table window, adding `fitaudit.ru`, or relaxing the two-source rule.
5. For the demo, check 3–5 products that exist in OFF in advance.

## 8. What can wait

- Compression at the bottom and telling chocolates apart.
- The calorie penalty for food.
- The natural sugar penalty.
- Translations, HTML entities, categories and styling.
- A large benchmark.
- Tavily terms for a public launch.
- Fallback barcode reading from the photo.

## Tests and typecheck

Code changes: normalization in `web/product-identity.ts`, tests in `web-page.test.ts` and `web-search.test.ts`, the new `product-score-control.test.ts` (pins the current values without changing the formula).

`pnpm typecheck` passed for all 7 projects. `pnpm test`: 736 of 736 (api 331, scoring 197, ai 109, mobile 82, nutrition 17).

## The guard that was applied

Hadji chose option A. `limitGoalMatchByProductScore` in `packages/scoring/src/goal-match-score-guard.ts` was applied in `ScanService` to the final Goal Match after the v4 reconciliation and restriction penalties. Each time it fired, the `goal_match_guard` log recorded it.

Later Hadji removed this guard, and Goal Match and Product Score became independent again. The reason and the benchmark: `docs/diagnostics/product-score-benchmark.md`.
