# Product Scan: provider replacement

Set `PRODUCT_SCAN_AI_PROVIDER=fireworks` in the ignored `apps/api/.env` and provide the existing `FIREWORKS_API_KEY`. The legacy `SCAN_AI_PROVIDER` is used only if the explicit Product setting is absent. `google` retains Gemini. Label, Meal Scan and Meal Plan keep their independent settings.

## Original request flow

Barcode decoding, Open Food Facts, optional additional lookup sources, their order, caches and merge rules are unchanged. Sufficient database nutrition skips photo analysis. Incomplete records and unknown products follow the original photo-analysis conditions. A photo-analysis failure can still retain usable database data under the original rules; this is not a switch to another model. There is no mandatory barcode audit or new reference-only call.

Every existing Product AI task uses the selected provider: image analysis, nutrition/ingredient extraction from fetched pages, ingredient display translation and optional configured AI Goal Match. Prompts, extraction/translation parsers, normalization, source priorities, scoring formulas and user interface remain unchanged. `GOAL_MATCH_AI=off` stays off. Text/Goal Match caches keep their existing behavior; Goal Match uses the actual Meta model identity. OFF cache hits can legitimately skip AI. Product vision has no result cache.

Fireworks reuses the existing vision adapter and existing text-task prompts/parsers through a transport adapter. The adapter sends one POST per original task to the fixed Fireworks endpoint and `accounts/fireworks/models/muse-spark-open`; no automatic model fallback or transport retries. Text tasks retain their original output limits and caller timeouts. Keys, images, text, personal data and response bodies are not logged. Numeric usage and estimated USD cost are recorded when available.

## Search capability boundary

Meta does not directly implement Gemini's native `googleSearch` Grounding contract. `WEB_SEARCH_LOOKUP=gemini` with Product Fireworks is rejected explicitly, rather than silently disabling discovery. Use the existing `WEB_SEARCH_LOOKUP=tavily` and its server-side credential to preserve search/fetch/extract behavior: Tavily discovers pages and Meta performs the same existing text extraction. `off` remains supported. No dependency or new search architecture is introduced.

## Offline verification and controlled test

Paired Gemini/Meta fixture tests compare complete/partial/unknown/no-barcode flows, repeated scans/cache effects, vision failure with database fallback, translated display, optional Goal Match and scores. Transport tests compare exact prompts and output parsing for text extraction, translation and Goal Match, and exercise safe malformed/network/timeout behavior. Existing lookup tests cover web enrichment. All model responses are mocked.

After build/restart, verify `/health` from iPhone. For a deliberate vision test use an unknown barcode or an incomplete product with a clear packaging/nutrition photo; a complete OFF hit may correctly make zero AI calls. Press Analyze once, then inspect provider/model, request counts, usage and validation logs. Do not retry automatically. No live model request is part of preparation.
