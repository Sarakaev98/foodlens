# Meal photo scan and nutrition estimation

## Meal photo flow

The mobile Scan screen can expose a meal mode with `FEATURE_MEAL_PHOTO` /
`EXPO_PUBLIC_FEATURE_MEAL_PHOTO`. The example environment files document the
flags; provider credentials stay on the backend.

`POST /scan/meal` accepts one JPEG, PNG or WebP in multipart field `image`.
The Google provider sends one schema-constrained Gemini request, without retries.
The backend validates components, checks energy against macros, drops impossible
items and computes totals from accepted components. The response is
`{ estimate }`, containing a meal name, components, totals, confidence,
calorie range and assumptions.

The result screen shows approximate calories/macros, recognised components and
an estimation disclaimer. It does not present a Product Score or Goal Match for
an arbitrary plate. Packaging scans continue through `POST /scan/analyze`.

Gemini usage is logged as `gemini_usage` with `type: meal_photo`, numeric token
counts and image count. Keys, photo data and provider error bodies are not logged.
Mock support and typed provider failures keep development/error paths testable.

## Add to Today

The meal result can create an entry through `POST /today/entries` with a stable
ID, the client's local date, name, source and calories/macros. Repeating the same
ID does not duplicate the entry. `GET /today?date=YYYY-MM-DD` returns entries and
their totals. The mobile store updates Today immediately after a successful add.

This MVP journal is in memory on the API and resets when the API restarts. It is
not durable storage. Client state is also in memory. Request validation bounds
entry sizes and entries per day; failed requests can be retried with the same ID.

## Packaged-product nutrition

The shared pipeline is:

`identify → exact sources → enrichment → estimation → merged nutrition → scores`

Existing source values, including zero, are preserved. Missing fields are filled
with disclosed estimates. `nutritionMetadata` records field quality, confidence,
method, constraints and subtype selection evidence. Estimated nutrients use the
same Product Score formula as source nutrients.

Category/subtype rules distinguish tomato passata, tomato paste, ketchup,
mayonnaise, mustard, BBQ, soy sauce, dairy, beverages and other food families.
Whole-token Unicode ingredient matching avoids substring errors such as
`камедь` being treated as honey. Nested seasoning ingredients do not inherit
their component's top-level position.

Subtype selection exposes confidence and uncertainty. Numeric energy/protein
values alone do not switch the product to dry mix, zero or high-protein profiles.
Dry food requires food-family/form/preparation or corroborating composition
signals. Prepared/cooked and water-first products block dry interpretation.
Dryness does not itself increase saturated-fat share; salt has separate
composition/category evidence. Unknown foods retain conservative priors, low
confidence and wide nutrition uncertainty.

Plausibility checks cover whole profiles while preserving measured data.
Estimated values respect carbs/fat, mass and known-energy bounds. Unresolved
source contradictions are flagged instead of silently replacing exact values.
The ranges are broad MVP checks, not laboratory measurements or medical advice.

## Goal Match availability

For `eat_healthier`, v3 keeps its existing numerical calculation and scenario
range. A range wider than three points no longer blocks a coherent, sufficiently
complete input merely because sugar origin or processing is unknown. It returns
the existing point estimate with low confidence and the full uncertainty range.

The wide-range gate still returns `ambiguous` when existing nutrition sanity
checks also find a contradiction. Missing critical nutrients, unknown basis or
an unusable serving retain their existing missing-data reasons. v4 sanity guards
and Product Score rules are unchanged.

Examples from real post-change requests (source availability can change):

| Product | Product Score | Goal Match |
|---|---:|---:|
| FAGE Total 0% | 9.5 | 9.4 |
| Heinz tomato ketchup | 3.4 | 1.9 |
| Instant noodles with seasoning | 2.0 | 2.0 |
| Tomato passata | 8.0 | 7.6 |
| Hazelnut milk chocolate | 2.3 | 1.5 |

These are diagnostic examples, not product-specific scoring branches. The
boundary/adversarial benchmark separately checks 299/300 kcal cooked meals,
prepared pasta/pizza, dry mixes, sauces, dairy, drinks and sweets, including
confidence, plausible ranges, exact-value preservation and missing-data policy.

## Validation

From the repository root:

```sh
pnpm test
pnpm typecheck
pnpm --filter @foodlens/api build
```

Mobile lint uses the existing Expo ESLint configuration. Related tests cover
Gemini transport/schema/usage, meal normalization and UI, idempotent Today
entries, subtype boundaries, plausibility and Goal Match availability.

Keep local environment files, API response captures, logs, screenshots and live
diagnostic scripts out of commits. Live provider diagnostics consume credits;
the automated tests use fixtures and stubbed transports.
