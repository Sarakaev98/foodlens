# FoodLens: fixing ingredient matching and sugar estimates

November 3, 2026. Branch dev. Estimator version: context-rules-v2. The Product Score and Goal Match formulas did not change. No push or commit was made at the time.

## The fix

Ingredient keywords are now matched against whole Unicode tokens after NFKC normalization, lower-casing and ё→е. The matcher uses `[\p{L}\p{M}]+` and fully bounded keyword patterns. «мед», «мёд» (honey) and the valid inflected forms меда/меду/медом are recognized. Камедь (gum, as in guar gum), медовый (“honey-flavored”) and honeycomb no longer become the honey ingredient. ASCII `\b` is not used for Cyrillic.

Ingredient parsing keeps the hierarchy of round and square brackets. Top-level sugar signals are separated from nested ones. Sugar inside a seasoning or sauce does not inherit the position of that component as a whole. Several levels of nesting, rough OCR lines with several components and an unclosed bracket are supported: its content stays nested.

High sugar estimates remain for chocolate/sweets/bakery/beverage/juice/dairy/yogurt/fruit. In other categories the positional increase is limited by a category-aware cap. The exception is an explicit stand-alone primary sugar ingredient: sugar, natural honey, cane sugar, corn syrup and so on. «Соус с сахаром» (“sauce with sugar”) or «приправа (сахар, ...)» (“seasoning (sugar, ...)”) do not trigger this exception on their own.

```text
positional = 0.65 (position 0), 0.45 (positions 1–2), 0.20 (later), 0 (no top-level signal)
proposed = max(category prior, positional, the semantic floor of a sweet category where it applies)
categoryCap = 1 for a sweet category or a strong primary sugar
              otherwise max(prior, min(0.20, 2 × prior))
share = min(proposed, categoryCap)
sugars = clamp(carbs × share, 0, carbs)
```

For ready_meal the prior is 0.06 and the usual cap is 0.12. Without a top-level sugar 0.06 is kept, even if sugar is mentioned inside a secondary component. An explicit stand-alone sugar as the first ingredient can give 0.65 as strong confirmation. These are general category rules with no barcode, brand or name exceptions.

The metadata reason keeps the top-level position, the nested count, and share/cap/capped. Existing exact values are kept; the setter fills only null. Estimates stay inferred/estimated with low confidence.

## Matcher audit

| Group | Result |
|---|---|
| sugar/honey/syrup/glucose/fructose/maltose | Whole tokens, controlled forms and plurals; no false positives for камедь/медовый/honeycomb/glucosamine/fructooligosaccharides |
| starch/flour/maltodextrin | Starch, flour, maltodextrin, carbohydrates and flavoring do not create a sugar signal |
| caramel color (сахарный колер) | The adjective сахарный (“sugar-based”) is not treated as a stand-alone sugar |
| fiber | whole grain/bran/oat/oatmeal and their Russian forms (whole-grain, bran, oat, legumes) are kept; brandy/goat do not match bran/oat |
| salt | Whole salt/соль/соли/солью; солист/saltwater do not match; the position is counted at the top level |
| saturated fat | palm/coconut/butter and exact Russian forms; no false positives for butternut/butterfly/palmaria |
| unsaturated fat | sunflower/olive and Russian forms; olivewood does not match |
| sweetener | Whole sucralose/stevia/подсластитель (sweetener) and so on; a longer arbitrary token does not match |

FOOD_TYPES are used for the category name, not for ingredients. Their classification policy did not change in this work.

## Real HTTP: noodles 4605496016700

The main API was restarted after test/typecheck/build passed: PID 13068, port 3000, phone address http://192.168.1.100:3000. .env did not change. The first request for this barcode in the new process: a real POST /scan/analyze with multipart barcode=4605496016700 and no photo. HTTP 200, **cacheHit:false**; requestId 42a55c95-3b46-41b9-b218-c1776d061253.

Source category.value=null; ready_meal was chosen by the generic word «лапш» (noodles) in the name. The primary sources and enrichment gave no sugars, so the regular estimator was used.

The ingredients from the actual response, unedited (Russian product data):

```json
{
  "value": [
    {
      "name": "Лапша (мука пшеничная в/с., масло растительное, крахмал кукурузный и тапиоковый, вода питьевая, соль, яичный порошок, загуститель (гуаровая камедь), стабилизатор (карбонат калия). разрыхлитель (сода пищевая), регулятор кислотности (лимонная кислота), усилитель вкуса и аромата (Е621))",
      "percent": null
    },
    {
      "name": "бульон-приправа (соль, мальтодекстрин, усилители вкуса и аромата (Е621, Е635), крахмал кукурузный, ароматизаторы, сушеные овощи и зелень (чеснок, лук репчатый, томаты, петрушка), сахар, пряности (перец красный, перец черный, куркума, перец душистый, кориандр), экстракт дрожжей, мясо говядины сушеное, масло растительное, красители (сахарный колер IV, экстракт паприки), агент антислеживающий (2551))",
      "percent": null
    },
    {
      "name": "овощи сушеные (соевый текстурат, кукуруза, морковь, лук зеленый). Продукт может содержать незначительное количество продуктов переработки молока. Хранить при температуре не выше 30°С и относительной влажности воздуха не более 75% изготовителя",
      "percent": null
    },
    {
      "name": "номер смены дата ЛеНИЯ",
      "percent": null
    }
  ],
  "provenance": "open_food_facts"
}
```

Detected signals:

```json
{
  "topLevelSugars": [],
  "nestedSugars": [
    {
      "componentIndex": 1,
      "ingredient": "сахар",
      "matchedTokens": [
        "сахар"
      ]
    }
  ],
  "strongTopLevelSugar": false,
  "sugarPosition": -1,
  "saltPosition": -1,
  "hasSaturatedFat": false,
  "hasUnsaturatedFat": false,
  "hasFiber": false,
  "sweetenerOnly": false
}
```

Guar gum (камедь) is no longer a honey signal. Real sugar is recognized only in the second component, the broth seasoning; caramel color does not become a separate sugar keyword.

| Value | Before | After |
|---|---:|---:|
| carbs, g/100 g (exact) | 56 | 56 |
| sugar position | 0, a false honey match in камедь | -1 at the top level; 1 nested signal |
| share | 0.65 | **0.06** |
| sugars estimate, g/100 g | 36.4 | **3.36** |
| salt estimate, g/100 g | 1.5 | **1.1** |
| Product Score | 1.3 | **2.6** |
| Goal Match | 1.3 | **2.6** |

The result of the general logic: 56×0.06=3.36. No desired value was substituted for this product.

Salt was also refined by the general nesting logic: salt inside the first component used to count as the first ingredient of the whole product. Now the top-level saltPosition is -1 and the 1.1 prior applies. The change in the estimates comes from refining both signals; the scoring coefficients did not change. Saturated fat=5.1, fiber=3, sodium=440 after conversion from salt. The exact kcal/P/C/F were kept.

Sugar metadata: estimated/low; basis=per_100g; constraints=[]. Both scores are numeric; Goal Match state=goal_match, unavailableReason=null. The exact JSON was saved locally as sugar-fix-noodles-http.json.

## Product comparison

Sugar per 100 g or 100 ml. The first four rows are real HTTP calls to the main API, each with cacheHit:false. Apple/yogurt/cola are existing project fixtures, clearly marked as such, with a test eat_healthier profile (2000 kcal, protein target 139 g). They were run through the old and new estimator and the unchanged scoring functions; these are not real package scans.

| Product | Sugars | Product Score | Goal Match | Mode |
|---|---:|---:|---:|---|
| Noodles with beef | 3.36 (estimated) | 2.6 | 2.6 | HTTP, cacheHit=false |
| Choco Pie | 28.35 (estimated) | 1.8 | 1.8 | HTTP, cacheHit=false |
| Alpen Gold peanut/cornflakes | 48 (estimated) | 2.3 | — (ambiguous) | HTTP, cacheHit=false |
| Alpen Gold peanut/cracker | 52 (verified) | 2.3 | 1.5 | HTTP, cacheHit=false |
| apple | 10.4 (verified in the fixture) | 7.1 | 7.1 | Fixture, unchanged |
| yogurt | 3.6 (verified in the fixture) | 9.4 | 8.7 | Fixture, unchanged |
| cola | 10.6 (verified in the fixture) | 3 | 2.5 | Fixture, unchanged |

Choco Pie and both Alpen Gold bars were also called over real HTTP BEFORE the restart. The sugar value and quality, Product Score and Goal Match matched the responses AFTER the fix. The frozen apple/yogurt/cola control inputs also gave the same result before and after.

At the user's request two peanut variants were checked: peanut/cornflakes 7622201696078 ([product page](https://gastronom-rnd.ru/katalog/konditerskiy-otdel/shokolad-i-plitki/shokoladalpengold-molochnyyarahiskukuruznyehlopya80g)) and salted peanut/cracker 7622201696313 ([variant identification](https://sostavista.ru/tovar/alpen-gold-shokolad-molochnyi-alpen-gold-s-solenym-arahisom-i-krekerom-8)). The table numbers come from the FoodLens HTTP response, not from these pages. The barcode of the user's package was not provided, so an exact match with either variant is not claimed.

For the cornflakes version Goal Match was and stays ambiguous: the sources gave no ingredients and no reliable semantic context. That is the existing sugarSource/processing uncertainty, not a result of the fix. The formula was not relaxed and no semantic facts were invented. For the cracker variant sugars=52 is a verified OFF value, kept unchanged.

## Checks

- pnpm test: **1213 tests, 0 failures**; API 721, scoring 240, AI 117, nutrition 38, mobile 97; the core contract checks also passed.
- 38 new regression cases: мед/мёд (honey), substring collisions, nested sugar/honey, nested and unclosed brackets, a rough OCR line, a strong primary sugar, savory caps, sweet categories, fats/fiber/salt/sweeteners, sugar<=carbs, protection of existing exact/inferred values, no specific barcode or brand in production code.
- Typecheck and API build: passed.
- Real HTTP 200/cacheHit:false for the noodles, Choco Pie and both Alpen Gold bars.
- The real GoalMatchCard/labels were checked on the JSON for the noodles, Choco Pie and Alpen Gold with cracker (stubbed native primitives, not a physical phone screen): the numbers and reasons are displayed.
- The API was left running for a new scan from the phone.

## Changed files

- apps/api/src/modules/scan/nutrition-ingredient-signals.ts — new token/component parsing, signals and the category cap.
- apps/api/src/modules/scan/nutrition-estimator.ts — uses the signals and caps instead of substring regexes; context-rules-v2 and diagnostic reasons.
- apps/api/src/modules/scan/test/nutrition-ingredient-signals.test.ts — regressions.
- docs/diagnostics/sugar-estimation-fix.md — this report.
- docs/diagnostics/sugar-estimation-fix-evidence.json — before/after, signals, HTTP events and controls (kept locally, not in the repository).
- docs/diagnostics/sugar-fix-noodles-http.json — the actual noodles response body (kept locally, not in the repository).

Other production source files, scoring formulas, dependencies, .env and mobile source code did not change. Nothing was pushed at the time.
