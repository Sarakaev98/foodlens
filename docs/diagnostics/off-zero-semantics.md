# Open Food Facts: when 0 means a real zero

Date: November 1, 2026. No requests were made to OFF, Gemini or Tavily for this work. The Product Score formula did not change, and C(−8) was not applied. No commit or push was made, and `.env` was not changed.

## Conclusion

- The rule is implemented in `open-food-facts.mapper.ts`: a zero counts as real only if the value came from manufacturer or packaging data with no markers. Otherwise it is `null`.
- **11 of the 13 real products cannot be checked locally.** The benchmark used outdated v2 search fields that have no source. An exact answer needs 11 requests to OFF v3.6. I did not make them.
- C(−8) meets your condition in both modes: zeros 17 → 0, scores ≤ 2: 27 → 14, broken pairs 2 → 0. But the data cleanup is still incomplete: 7 of the 13 real products could not be checked.
- The strict mode is crude: it also removes Coca-Cola, whose zeros are almost certainly real. The reason is missing snapshot data, not product quality.

## 1. Which OFF fields show what

Checked on the local v3.6 response `off-sample.json`, two raw v2 records and our mapper.

| Field | Format | What it shows | Reliability |
|---|---|---|---|
| `nutrition.aggregated_set.nutrients.<n>.source` | v3.6 | where the value came from: `manufacturer`, `packaging`, `estimate` | high, the main signal |
| `...<n>.modifier` | v3.6 | `~` is an estimate; other values also mean imprecision | high |
| `input_sets[].nutrients.<n>.value_string` | v3.6 | what was actually entered in the set | high, but needed only for analysis |
| `<n>_modifier` | v2 | a value marker such as `~` | medium |
| `<n>_value` | v2 | a value was entered | medium, gives no source |
| `nutriments_estimated` | v2 | a separate set of estimates | useful, but not every record has it |
| `nutrition_data` | v2 | `on` only means the table is enabled | low |
| `states_tags` | both | `en:nutrition-facts-completed` describes the whole record | low: says nothing about a single field |

`no_nutrition_data`, `data_quality_*_tags`, `nutrient_levels` and `misc_tags` are absent from the local data or were not requested, so I do not rely on them and do not assess their reliability.

An example from Nutella: `fiber` is 0 with `source: packaging` and `value_string: "0"`, while 49 other values are `estimate`.

**The limit of the rule.** If a contributor typed 0 by hand instead of leaving the field empty, the source will be `packaging`. The OFF fields do not reveal this. So `sugars 0` with 8 g of carbs may survive even after the check. I did not guess values from carbs: that would be a heuristic, not data.

## 2. The rule

For sugars, saturatedFat, salt, sodium, fiber and protein a value of `0` is accepted only if both hold:

1. `source` is `manufacturer` or `packaging`.
2. There is no `modifier`.

Otherwise the field becomes `null`. The rule does not change values above zero, and estimates are still dropped.

If salt became `null` but a confirmed sodium value exists, salt is calculated by the existing rule as before. A derived value never becomes a confirmed zero.

If `sugars`, `saturatedFat` or `salt` became `null`, the Product Score is honestly not calculated (`too_few_factors`), and the scan may ask for a photo.

## 3. What changed

- `apps/api/src/modules/product-lookup/open-food-facts.mapper.ts`: the zero rule.
- `apps/api/src/modules/product-lookup/test/open-food-facts.test.ts`: tests for sugars, saturatedFat, salt, fiber, protein.
- `packages/scoring/src/test/benchmark/`: the snapshot is read in two modes, with a report and mode tests.

The running API still has the old mapper: it needs a rebuild before the next scan. I did not restart it.

## 4. Benchmark after normalization

- **As is:** the snapshot values unchanged.
- **Strict:** unconfirmed zeros become `null`.

The modes differ only for the 13 real products. Typical values and Roshen did not change.

| Set | Variant | No score | Scored | =0 | ≤1 | ≤2 | ≥9 | Mean |
|---|---|---|---|---|---|---|---|---|
| All 72, as is | Current | 0 | 72 | 17 | 25 | 27 | 1 | 4.01 |
| All 72, as is | C(−8) | 0 | 72 | 0 | 5 | 14 | 1 | 4.77 |
| All 72, strict | Current | 7 | 65 | 17 | 25 | 27 | 1 | 3.87 |
| All 72, strict | C(−8) | 7 | 65 | 0 | 5 | 14 | 1 | 4.67 |
| 13 OFF, as is | Current | 0 | 13 | 2 | 2 | 2 | 0 | 4.82 |
| 13 OFF, as is | C(−8) | 0 | 13 | 0 | 0 | 1 | 0 | 5.32 |
| 13 OFF, strict | Current | 7 | 6 | 2 | 2 | 2 | 0 | 4.27 |
| 13 OFF, strict | C(−8) | 7 | 6 | 0 | 0 | 1 | 0 | 4.97 |

Broken ordering pairs:

| Mode | Current | C(−8) |
|---|---|---|
| As is | 2 of 34 | 0 of 34 |
| Strict | 2 of 29 | 0 of 29 |

## 5. Control products

| Product | Unconfirmed zeros | As is | C(−8) | Strict | Strict C(−8) |
|---|---|---|---|---|---|
| Perly | fiber, saturatedFat, salt | 8.1 | 8.1 | no score | no score |
| Coca-Cola sans sucres | protein, fiber, sugars, saturatedFat | 6.0 | 6.0 | no score | no score |
| Sardines | sugars | 4.9 | 4.9 | no score | no score |
| Almonds | none | 5.1 | 5.1 | 5.1 | 5.1 |
| Knacki | none | 0.0 | 2.4 | 0.0 | 2.4 |
| Pesto | none | 0.0 | 1.8 | 0.0 | 1.8 |
| Chips, typical | not from OFF | 0.7 | 2.9 | 0.7 | 2.9 |
| Roshen | none | 0.0 | 0.9 | 0.0 | 0.9 |
| Snickers, typical | not from OFF | 0.0 | 0.8 | 0.0 | 0.8 |

The other products without a score in strict mode: Coca-Cola Original, Le nature, Jben, Cruesly. So the debatable high scores of Perly and Le nature really did rely on unconfirmed zeros.

## 6. What comes next

An exact answer needs 11 requests `GET https://world.openfoodfacts.org/api/v3.6/product/<barcode>.json`, with no AI and a pause of at least 5 seconds. It has to be v3.6, because `api/v2/product` does not give `source`. The barcodes:

5449000054227, 5449000214799, 6111242100206, 6111242106949, 3760049790214, 3168930010265, 7300400481595, 8076809513753, 20724696, 6111242100992, 3019081238643.

Tests: `pnpm typecheck` passed, `pnpm test`: 751 of 751.

## Addendum: checking against OFF v3.6

Exactly 11 `GET` requests to OFF v3.6 were made, all successful, with no retries. Gemini and Tavily were not used. The formula did not change. No commit or push was made.

### Conclusion

**C(−8) can be applied: your condition is met.** After the cleanup zeros go 17 → 0, scores ≤ 2 go 27 → 14, broken pairs 2 → 0. But the data cleanup changed almost nothing, and C(−8) will not fix two real problems:

1. **Suspicious OFF zeros passed the check.** All of them are marked `packaging`, so they look like values from the package.
2. **A new finding matters more than the zeros:** OFF drinks often come per `100g`, so our code treats them as food. In a real scan Coca-Cola will get **5.8 instead of 2.2**.

I recommend applying C(−8) and fixing the drink basis right away. The second matters more for the demo.

### What the zero check showed

| Metric | Value |
|---|---|
| Zeros in the checked fields | 24 |
| Confirmed by the rule | 23 |
| Became `null` | 1: the sardines' fiber, `estimate ~` |
| Sodium with `~` became `null` | 3: Wasa, pesto, sardines; salt is still present |

The other scores did not change. The only value change, the sardines' fiber, was already empty in the snapshot.

**The limit of the rule was confirmed.** The `source` field is not enough: `Le nature` with 0 sugars and `Perly` with 0 salt are `packaging`. For them OFF calculates its own estimate, which contradicts the zero:

| Product | Field | `packaging` value | OFF estimate |
|---|---|---|---|
| Le nature | sugars | 0 | 4.93 |
| Le nature | salt | 0 | 0.11 |
| Perly | salt | 0 | 0.065 |
| Perly | saturatedFat | 0 | 14.36 |

A rule “a `packaging` zero is not accepted if OFF's own estimate is noticeably higher” relies on OFF data rather than a guess. But a threshold would have to be chosen, and OFF's estimate is itself sometimes wrong: 14.36 g of saturated fat in a 97 kcal dairy dessert is impossible. So I did not apply it; that decision is yours. Cruesly and Coca-Cola have no such estimate and cannot be checked this way.

### The drink basis

| Basis | Coca-Cola score | Penalties |
|---|---|---|
| `per_100ml`, as in the benchmark | 2.2 | sugars −4.63, additives −1.2 |
| `per_100g`, as it will come from OFF | 5.8 | sugars −0.96, additives −1.2 |

The mapper takes the basis from `aggregated_set.per`, and for Coca-Cola that is `100g`. The benchmark treated drinks as `ml` from its own category, so this difference was hidden. In a real scan cola will score higher than pizza, chips and cereal. This is unrelated to C(−8) and not fixed.

### Benchmark

The numbers after normalization matched the snapshot:

| Set | Variant | No score | =0 | ≤1 | ≤2 | ≥9 | Mean | Broken pairs |
|---|---|---|---|---|---|---|---|---|
| All 72 | Current | 0 | 17 | 25 | 27 | 1 | 4.01 | 2 of 34 |
| All 72 | C(−8) | 0 | 0 | 5 | 14 | 1 | 4.77 | 0 of 34 |
| 13 OFF | Current | 0 | 2 | 2 | 2 | 0 | 4.82 | — |
| 13 OFF | C(−8) | 0 | 0 | 0 | 1 | 0 | 5.32 | — |

The Activia and Knacki values stayed from the first snapshot: they were not among these 11 requests. The Roshen, chips and Snickers values in the benchmark did not change.

| Product | Current | C(−8) | Note |
|---|---|---|---|
| Perly | 8.1 | 8.1 | salt and saturatedFat 0, `packaging`; the OFF estimate disagrees |
| Coca-Cola Zero | 6.0 | 6.0 | in a real scan the basis is `100g` |
| Sardines | 4.9 | 4.9 | fiber `null` |
| Le nature | 7.2 | 7.2 | sugars and salt 0, `packaging`; the OFF estimate disagrees |
| Cruesly | 6.2 | 6.2 | salt 0, `packaging` |
| Knacki | 0.0 | 2.4 | — |
| Pesto | 0.0 | 1.8 | — |
| Roshen | 0.0 | 0.9 | — |
| Snickers, typical | 0.0 | 0.8 | — |
| Chips, typical | 0.7 | 2.9 | — |
| Almonds | 5.1 | 5.1 | — |

### Other

The `<` modifier for non-zero values (Wasa: sugars `<1`, saturatedFat `<0.4`) currently gives an upper bound. That is safe for the penalty, so the rule does not change it.

The raw v3.6 `nutrition` for the 11 products, with URL, time and API version, is stored in `off-products.snapshot.json`.

The API was rebuilt with the new mapper and restarted: the process was checked before stopping, the settings apply only to that process, it listens on `0.0.0.0:3000`, and `/health` responds. Metro, Docker and Postgres were not touched.

`pnpm typecheck` passed, `pnpm test`: 751 of 751.

### All fields

| Product | Field | Value | source | modifier | Zero confirmed | Became null |
|---|---|---|---|---|---|---|
| Coca-Cola Original Taste | sugars | 10.6 g | packaging | — | — | no |
| Coca-Cola Original Taste | saturatedFat | 0 g | packaging | — | yes | no |
| Coca-Cola Original Taste | salt | 0 g | packaging | — | yes | no |
| Coca-Cola Original Taste | sodium | 0 g | packaging | — | yes | no |
| Coca-Cola Original Taste | fiber | 0 g | packaging | — | yes | no |
| Coca-Cola Original Taste | protein | 0 g | packaging | — | yes | no |
| Coca-Cola sans sucres | sugars | 0 g | packaging | — | yes | no |
| Coca-Cola sans sucres | saturatedFat | 0 g | packaging | — | yes | no |
| Coca-Cola sans sucres | salt | 0.01 g | packaging | — | — | no |
| Coca-Cola sans sucres | sodium | 0 g | packaging | — | yes | no |
| Coca-Cola sans sucres | fiber | 0 g | packaging | — | yes | no |
| Coca-Cola sans sucres | protein | 0 g | packaging | — | yes | no |
| Le nature | sugars | 0 g | packaging | — | yes | no |
| Le nature | saturatedFat | 2.4 g | packaging | — | — | no |
| Le nature | salt | 0 g | packaging | — | yes | no |
| Le nature | sodium | 0 g | packaging | — | yes | no |
| Le nature | fiber | 0 g | packaging | — | yes | no |
| Le nature | protein | 4.2 g | packaging | — | — | no |
| Jben | sugars | 0 g | packaging | — | yes | no |
| Jben | saturatedFat | 15 g | packaging | — | — | no |
| Jben | salt | 0.46 g | packaging | — | — | no |
| Jben | sodium | 0.184 g | packaging | — | — | no |
| Jben | fiber | 0 g | packaging | — | yes | no |
| Jben | protein | 8 g | packaging | — | — | no |
| Pain De Mie Bio | sugars | 6.3 g | packaging | — | — | no |
| Pain De Mie Bio | saturatedFat | 0.4 g | packaging | — | — | no |
| Pain De Mie Bio | salt | 1.1 g | packaging | — | — | no |
| Pain De Mie Bio | sodium | 0.44 g | packaging | — | — | no |
| Pain De Mie Bio | fiber | 4.9 g | packaging | — | — | no |
| Pain De Mie Bio | protein | 8.1 g | packaging | — | — | no |
| cruesly mélange de noix | sugars | 12 g | packaging | — | — | no |
| cruesly mélange de noix | saturatedFat | 2 g | packaging | — | — | no |
| cruesly mélange de noix | salt | 0 g | packaging | — | yes | no |
| cruesly mélange de noix | sodium | 0 g | packaging | — | yes | no |
| cruesly mélange de noix | fiber | 10 g | packaging | — | — | no |
| cruesly mélange de noix | protein | 8.5 g | packaging | — | — | no |
| AUTHENTIQUE | sugars | 1 g | manufacturer | < | — | no |
| AUTHENTIQUE | saturatedFat | 0.4 g | manufacturer | < | — | no |
| AUTHENTIQUE | salt | 1 g | manufacturer | — | — | no |
| AUTHENTIQUE | sodium | 0.4 g | manufacturer | ~ | — | yes |
| AUTHENTIQUE | fiber | 19 g | manufacturer | — | — | no |
| AUTHENTIQUE | protein | 9 g | manufacturer | — | — | no |
| Barilla PESTO alla GENOVESE | sugars | 5 g | manufacturer | — | — | no |
| Barilla PESTO alla GENOVESE | saturatedFat | 5.3 g | manufacturer | — | — | no |
| Barilla PESTO alla GENOVESE | salt | 3.2 g | manufacturer | — | — | no |
| Barilla PESTO alla GENOVESE | sodium | 1.28 g | manufacturer | ~ | — | yes |
| Barilla PESTO alla GENOVESE | fiber | 3 g | manufacturer | — | — | no |
| Barilla PESTO alla GENOVESE | protein | 4.7 g | manufacturer | — | — | no |
| Amandes décortiquées | sugars | 4.8 g | packaging | — | — | no |
| Amandes décortiquées | saturatedFat | 4.3 g | packaging | — | — | no |
| Amandes décortiquées | salt | 0.01 g | packaging | — | — | no |
| Amandes décortiquées | sodium | 0.004 g | packaging | — | — | no |
| Amandes décortiquées | fiber | 12.1 g | packaging | — | — | no |
| Amandes décortiquées | protein | 24.5 g | packaging | — | — | no |
| Perly | sugars | 9.4 g | packaging | — | — | no |
| Perly | saturatedFat | 0 g | packaging | — | yes | no |
| Perly | salt | 0 g | packaging | — | yes | no |
| Perly | sodium | 0 g | packaging | — | yes | no |
| Perly | fiber | 0 g | packaging | — | yes | no |
| Perly | protein | 8 g | packaging | — | — | no |
| Sardines Huile d'Olive Vierge Extra | sugars | 0 g | packaging | — | yes | no |
| Sardines Huile d'Olive Vierge Extra | saturatedFat | 3.5 g | packaging | — | — | no |
| Sardines Huile d'Olive Vierge Extra | salt | 1.2 g | packaging | — | — | no |
| Sardines Huile d'Olive Vierge Extra | sodium | 0.48 g | packaging | ~ | — | yes |
| Sardines Huile d'Olive Vierge Extra | fiber | 0 g | estimate | ~ | no | yes |
| Sardines Huile d'Olive Vierge Extra | protein | 23 g | packaging | — | — | no |
