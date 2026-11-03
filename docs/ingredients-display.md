# English ingredient display

`POST /scan/analyze` retains the original composition in `product.ingredients` (including source provenance). Nutrition normalization, enrichment, estimation, allergens, processing, Product Score and Goal Match continue to consume that original data.

After scoring, `IngredientsDisplayService` adds the optional presentation-only `product.ingredientsDisplay`:

- `items`: English ingredient names with the original item order and `percent` properties.
- `language`: `en`, or `original` on fallback.
- `status`: `unchanged`, `translated`, or `fallback`.
- `sourceHash`: hash of the original names/percentages and projection version.

The mobile Product Result composition section reads `ingredientsDisplay.items`, falling back to `ingredients.value` for older responses. Other consumers keep reading the original composition. The former “as on packaging, untranslated” composition caption is removed.

Local language detection and an English food/technical vocabulary skip already-English text. When translation is needed, one batch uses the existing shared `GoogleNutritionSearch` transport/configuration through `translateIngredients`; it does not use Search, images, user profiles or scores. Usage is logged as `ingredients_translation`.

E identifiers, quantities, percentages, brackets and list delimiters are retained locally and reassembled in their original positions. Translated fragments are schema checked and validated for count, language and unexpected structure. Lexical hyphens (e.g. anti-caking) are allowed. Like any language detector or machine translation, semantic accuracy cannot be guaranteed; rejected/unavailable translations return the original composition without changing score availability.

An in-memory, bounded cache (256 compositions) reuses successful results for 24 hours and failures for 30 seconds; identical concurrent requests share one promise. A response already carrying the matching projection hash is reused. The cache resets on API restart; the display projection travels with the result and can be retained by existing client result storage.

Tests cover English/Russian/Turkish, nested composition, E-numbers, percentages, fallback, cache/deduplication, existing AI transport, mobile display and equality of raw/scoring/Goal Match data across barcode, photo, label and web enrichment paths.
