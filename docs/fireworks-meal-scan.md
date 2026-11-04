# Fireworks Meal Scan

Meal Scan remains `POST /scan/meal` with one multipart `image` (JPEG, PNG or WebP).
Only the AI transport is selected independently. Set in the ignored server-side `apps/api/.env`:

```dotenv
MEAL_SCAN_AI_PROVIDER=fireworks
# Existing server-only FIREWORKS_API_KEY must be present.
# FIREWORKS_MEAL_SCAN_TIMEOUT_MS=45000
```

`MEAL_SCAN_AI_PROVIDER=google` selects Gemini explicitly. When absent, the legacy `AI_PROVIDER`
selection (including development mocks) is retained. No automatic model fallback or retry is added.
Product, Label, Meal Plan and their configuration are unchanged.

The Fireworks adapter reuses the existing endpoint/model constants and the exact Meal Photo system/user
prompts and JSON Schema. It sends one image as an image_url data URI, selects
`accounts/fireworks/models/muse-spark-open`, `reasoning_effort=low`, `max_tokens=1024`, `stream=false`.
The original 45-second deadline is retained and covers both waiting for headers and body reading.
Unexpected models, truncated output, refusals, tool calls and missing/invalid schema fields fail safely.
Missing fields are never filled using invented values. The existing normalizer retains its own policy
for dropping implausible components, reconciling calories/macros and summing accepted items.

No meal-result cache existed in the server path, and none is introduced. A new explicit Analyze action
still makes one model request. The existing `{ estimate }` response, components/weights, nutrient totals,
confidence/range/assumptions, mobile flow and Add to Today remain unchanged. Today uses its existing stable
entry ID and deduplication. Its existing in-memory persistence is unchanged.

## Safe diagnostics

`meal_scan_provider` identifies the actual selected analyzer. `fireworks_meal_photo_http` records request
start, headers/status and body timing. `fireworks_meal_photo` records success/failure and fixed validation
codes. `fireworks_usage` with `type=meal_photo` records token counts and estimated USD cost when available.
These share the requestId with `meal photo finished` / `meal photo failed`, which includes normalization
counts and end-to-end duration. No credentials, photos, base64, prompts, model text or personal data are logged.
The cost estimate uses the existing integration's dated rates (2026-11-04), not a billing guarantee.

## Offline regression checks

Tests compare exact prompts, schema, raw parsing and API normalization against the Gemini implementation.
They cover all supported image MIME types, multiple components, nullable ranges, impossible components,
missing required fields, model/HTTP/network/JSON errors, refusal, deadlines before/after headers, late
responses, usage/cost, independent routing, absence of fallback/cache and unchanged Add to Today deduplication.
All model responses are local fixtures; implementation and checks do not call paid models.

## One controlled iPhone test

1. Build and restart the Windows API with the setting above; preserve the other provider settings.
2. On iPhone in the same Wi-Fi, open `http://192.168.31.187:3000/health` and verify `{"status":"ok"}`.
3. In the existing Scan UI select Meal, take/select one clear photo of a prepared meal, and press Analyze once.
   Do not select Product or Label, and do not retry automatically after an error.
4. Inspect the logs for exactly one Fireworks `type=meal_photo` request and the expected model/status,
   deadline/normalization result, tokens, estimated cost and end-to-end duration.
5. Compare displayed components, portions and approximate calories/macros with the meal. Optionally press
   Add to Today once and check the same totals there; adding the result does not request AI analysis.
6. Review this result before committing or pushing the Meal Scan implementation.
