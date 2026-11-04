# Fireworks for product photo Scan

Product and Label modes can explicitly select the Fireworks vision adapter. Provider selection remains server-side; no automatic fallback is enabled.

Label mode has a separate LABEL_SCAN_AI_PROVIDER setting; see fireworks-label-scan.md.
SCAN_AI_PROVIDER now selects Product mode only. Neither setting controls Meal mode.

## Enable product photo analysis

In apps/api/.env set:

```dotenv
SCAN_AI_PROVIDER=fireworks
# Existing server-side credential; do not copy it into mobile or Git:
# FIREWORKS_API_KEY=...
# Optional, defaults to 60000 ms:
FIREWORKS_SCAN_TIMEOUT_MS=60000
```

Absent SCAN_AI_PROVIDER (or google) selects the existing GoogleProvider for product photo analysis.
This new flag is independent of the legacy AI_PROVIDER used by the prepared-meal photo endpoint.
Keep AI_PROVIDER=google to preserve that endpoint. MEAL_PLAN_PROVIDER and GOAL_MATCH_AI are unchanged.
There is no automatic model fallback and no transport retry. Missing Fireworks key returns an explicit safe error.
Runtime provider choices belong in the ignored local .env; credentials and local settings are not committed.

## Integration boundaries

The new SCAN_AI_PROVIDER DI token is injected only into ScanService. MealPhotoService retains AI_PROVIDER.
Meal Plan, Today, Product Score, Goal Match, barcode decoding, Open Food Facts, product lookup/enrichment,
nutrition estimation, ingredients display and mobile UI code are unchanged.
The existing barcode-first flow can return sufficient database data without any vision call.
On partial database results, the existing flow still decides whether to analyze photos and how to merge them.
It can preserve database data on an AI error; this is not a switch to another model.
Existing Google text enrichment/ingredient translation and the separately selected Goal Match evaluator may still run.
Selecting Fireworks for product images does not replace those independent text operations.

## Contract and transport

One POST https://api.fireworks.ai/inference/v1/chat/completions uses the existing Fireworks model and endpoint
constants. Model: accounts/fireworks/models/muse-spark-open, reasoning_effort=low, max_tokens=4096,
stream=false. Redirects are rejected; the deadline bounds waiting for headers and reading the body.
The input contains 1–3 original JPEG, PNG or WebP images as image_url data:<mime>;base64,<bytes> parts.
Image order and role hints are preserved; the normal, multi-image and nutrition-label prompt strings
are imported unchanged from the current Google extraction path.

The existing extraction JSON Schema is sent in native Fireworks json_schema format, including the same
nutrition_status diagnostic fields present in Gemini's Vertex response schema. Responses use the existing
prepareGoogleProductAnalysis, validGoogleProductQuantities and normalizeMetaProductAnalysis functions.
Nullable-field repairs, observed/inferred provenance, nutrients, ingredients, allergens, additives,
confidence and all semantics/typicalServing fields used downstream are preserved.
Unreadable or absent values stay unknown; no brand-based invented facts or zeros are introduced.
Truncation, refusal, malformed JSON, wrong model, invalid numbers and schema violations are rejected safely.

No core ProductSource contract change is needed: the existing meta_vision/provider=meta describes the Meta
model family, while analysisVersion=fireworks-muse-spark-product-analysis-v1 and server logs distinguish
the Fireworks transport from the existing Meta Model API. The actual model is logged explicitly.

Numeric-only diagnostic events: fireworks_scan_http (stages, status, durations), fireworks_scan
(requestId, model, numberOfImages, success/error, retries=0) and fireworks_usage (type=product_analysis,
tokens and estimated USD cost). Images, base64, keys, request/response bodies and reasoning are not logged.
Costs use the existing integration's dated standard serverless rates: $1.25/M input, $0.15/M cached input,
$4.25/M output; missing usage yields unknown cost. This estimate can differ from actual billing.

## Offline verification

New tests compare the whole normalized product (except intentional source metadata) against Gemini,
and compare exact Product Score and Goal Match results for identical extraction fixtures.
Tests also cover three-image ordering, MIME types, label prompts, nutritional nulls, safe errors,
timeouts before/after headers, late responses, usage/cost and no fallback/retries.
An API test verifies that complete Open Food Facts barcode data makes zero Fireworks calls;
another verifies that Label mode bypasses databases and makes one mocked vision call.
All new transports and image bytes are synthetic. No live Fireworks request was performed.

## One controlled iPhone scan (requires explicit permission; not executed)

1. Review offline checks, then obtain explicit permission before any paid test.
2. For the Label-mode test below set LABEL_SCAN_AI_PROVIDER=fireworks in apps/api/.env and verify FIREWORKS_API_KEY is present without printing it. Set SCAN_AI_PROVIDER=fireworks only when separately testing Product mode.
   Leave MEAL_PLAN_PROVIDER, AI_PROVIDER and GOAL_MATCH_AI unchanged. Keep the file ignored by Git.
3. Build with pnpm build and restart only the API outside the Codex network sandbox in Windows.
   Start from the API package using pnpm --filter @foodlens/api start; it loads apps/api/.env.
4. Verify /health through localhost and http://<Windows-LAN-IP>:3000 from Safari on iPhone.
   Use the existing Expo app pointed at that API; never put the key into EXPO_PUBLIC variables.
5. For exactly one deliberate vision attempt, select Scan > Label, choose/take one clear nutrition-label
   photo, and press Analyze once. This mode bypasses barcode lookup. Do not select Meal, which is a separate endpoint.
   Product mode can be used for a packaging/ingredients set, but a barcode/database hit can legitimately avoid vision.
6. Do not retry on error. Inspect fireworks_scan_http, fireworks_usage type=product_analysis and
   fireworks_scan by the same requestId; confirm provider=fireworks and the expected model.
   Check observed nutrition versus the label and the existing Product Score/Goal Match result.
   A Label photo may legitimately leave ingredients/allergens unknown and yield a partial score.
7. Report status, stage/durations, call count, usage/cost and any safe validation error before another attempt.
   Restore LABEL_SCAN_AI_PROVIDER=google (or remove it) and restart if returning Label to Gemini.

One vision attempt sends every selected image in a single request. Independent configured enrichment or
Goal Match text calls are possible under the existing flow; they are not Fireworks vision retries.

References checked on 2026-11-04:
- https://docs.fireworks.ai/guides/querying-vision-language-models
- https://fireworks.ai/models/fireworks/muse-spark-open
