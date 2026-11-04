# Fireworks for Meal Plan

Implemented on `feat/fireworks-meal-plan`, based on local `dev` at `0054b0f`.
No runtime API response, MealPlan, MealPlanResult, mobile UI, or nutrition contract changes.

## Configuration

In `apps/api/.env`, set `MEAL_PLAN_PROVIDER=fireworks` to use Meta Muse Spark Open only for Meal Plan.
`FIREWORKS_API_KEY` must remain server-side in this file. Never copy it to mobile, logs or Git.
Optional `FIREWORKS_MEAL_PLAN_TIMEOUT_MS=60000` controls the complete request/body deadline.
The model and HTTPS endpoint are fixed in the provider; redirects and transport retries are disabled.

Without MEAL_PLAN_PROVIDER, or with `MEAL_PLAN_PROVIDER=google`, Meal Plan uses the existing GoogleMealPlanProvider.
Its Google configuration is unchanged. AI_PROVIDER continues to select Scan; GOAL_MATCH_AI continues to select Goal Match.
There is no Fireworks-to-Google fallback, including on authentication errors, timeouts and invalid JSON.
The local .env was switched to Fireworks only for the explicitly authorized iPhone test. It remains ignored and is not part of this change.

## Data and validation

Fireworks uses the existing MEAL_PLAN_SYSTEM_PROMPT, mealPlanUserPrompt and MEAL_PLAN_OUTPUT_SCHEMA.
It sends the schema through response_format.type=json_schema. The response must identify the expected model,
contain exactly one assistant choice, finish with stop, and contain JSON matching the existing schema.
Refusals, markdown fences, truncation, extra fields, empty plans, blank names, zero/negative calories and negative macros are rejected.
Daily totals are calculated with the same sumMeals function as Gemini.

MealPlanService still applies validateMealPlan, dietary preferences, allergens, avoided ingredients,
calorie/macro and portion checks, and the existing single corrective generation using the SAME selected provider.
Persistent dietary violations result in 422; provider errors result in the existing safe 503 response.
A safe first plan can still be retained if correction fails, and nutrition-only deviations can still return withinTargets=false.
The cache and variety history are unchanged.

The existing validators use food dictionaries and estimates; they cannot prove that all ingredients, synonyms,
or nutritional claims are correct. This limitation is unchanged. The shared prompt requests tighter targets
than the existing validator tolerances; neither was modified.
The earlier smoke test proved basic model access, not this full structured Meal Plan request.
Native schema support and practical latency/quality remain to be verified in an explicitly authorized live generation.

## Diagnostics

Server logs contain meal_plan_provider with provider, fixed model, requestId, correction flag, success,
latency and planId when a plan is produced. planId correlates a returned/cached plan with its generator.
Fireworks usage logs use the same requestId, numeric prompt/output/total/cached counts and estimatedCostUsd,
including responses rejected during parsing. Google retains gemini_usage and adds correlation fields.
These are server logs, not added public/mobile fields or database columns. They need the usual log retention to persist across restarts.
Prompts, profile text, generated meals, keys, reasoning text and upstream error bodies are not logged by the new provider.

USD estimate uses standard serverless prices checked 2026-11-04: input $1.25/M, cached input $0.15/M,
output $4.25/M. Formula: ((input-cached)*1.25 + cached*0.15 + output*4.25)/1e6.
Missing usage produces null cost. Missing/invalid cache counts conservatively count input as uncached.
This is a dated estimate; billing may differ. Google cost is null; its existing numeric usage is retained.

Sources: https://fireworks.ai/models/fireworks/muse-spark-open
and https://docs.fireworks.ai/structured-responses/structured-response-formatting

## Running one controlled generation on iPhone

1. Confirm the API is running this branch and has a valid saved user profile/targets.
2. Set MEAL_PLAN_PROVIDER=fireworks in apps/api/.env, leaving AI_PROVIDER and GOAL_MATCH_AI unchanged.
3. Stop the previous API process before starting the new build, so the phone cannot hit the old server.
   From the repository root run `pnpm build`, then `pnpm --filter @foodlens/api start` in Windows with network access.
   The existing bootstrap loads .env from apps/api as the API package working directory. Do not print its contents.
4. Connect iPhone to the same LAN and the existing Expo app. Its API URL must point to this Windows API;
   EXPO_PUBLIC_API_URL, if needed, is http://<Windows-LAN-IP>:3000. Never put the Fireworks key in mobile.
5. Open Your Meal Plan and press Create Plan (or Refresh Plan) ONCE. This sends one POST /meal-plan/generate.
   Do not refresh, tap again or retry on failure. Opening the screen only reads the cache and does not generate.
6. Inspect meal_plan_provider / fireworks_usage logs: provider=fireworks, model=accounts/fireworks/models/muse-spark-open,
   success, requestId and the returned planId. Check nutrition validation and sum per-attempt cost for this generation.
7. Restore MEAL_PLAN_PROVIDER=google (or remove the setting) and restart the API when finished.
   Restart also clears the existing in-memory plan cache.

One UI generation can make up to TWO paid requests because the existing nutritional correction is preserved.
There are no transport retries or provider switches. Each request has max_tokens=4096, not the smoke test limit of 64:
64 tokens cannot hold a complete day's existing JSON contract. Stop after this one UI action and review logs before another.

## Offline verification

- pnpm test: 1506 tests passed (API 932, AI 154, nutrition 47, scoring 251, mobile 122), zero failures.
- pnpm typecheck: passed across the workspace, including API and mobile.
- pnpm build: shared packages and API build passed.
- git diff --check: passed.
- New tests use injected transports/synthetic responses only, including deadlines, HTTP errors, schema failures,
  redaction, usage/cost, exclusive provider routing and dietary rejection by the existing service.
- Automated checks use no real Fireworks calls. No new dependency is needed. Secrets and diagnostic logs are excluded from version control.


## HTTP stage diagnostics and proposed tuning (2026-11-04)

The first full live Meal Plan attempt hit the local 60000 ms deadline (observed 60013 ms),
without a usage record. It did not reach nutritional validation or correction.
That log did not distinguish waiting for headers from body reading and cannot establish the server-side cause.

New fireworks_http events: request_started, headers_received, body_read_started, body_read_completed,
json_parsed. They share requestId with usage and final meal_plan_provider logs.
Final records retain HTTP status even if body reading times out. Timing uses a monotonic clock:
waitingHeadersMs (also headersMs once complete), bodyMs, jsonParseMs, responseValidationMs and elapsedMs.
An incomplete stage records elapsed time up to failure; null means the stage was not reached.
Body completion logs its UTF-8 byte count only. No raw header values, payload, reasoning or profile text is logged.
Non-streaming header latency can include provider-side queueing and generation; it does not isolate DNS/TLS or compute time.
responseValidationMs covers local envelope/schema checking and plan mapping, not the service's later dietary validation.

After user approval, the request sets reasoning_effort=low. Other parameters remain max_tokens=4096,
stream=false, strict json_schema; temperature, top_p and thinking omitted. Timeout remains 60000 ms.
4096 is a ceiling, not a requested fixed length. The successful controlled test used 1157 output tokens; one example does not establish a safe smaller cap.
Do not reduce the cap blindly: reasoning plus the final multi-meal JSON may be truncated, which must remain rejected.

User-approved minimal optimization: reasoning_effort=low, retaining the cap, prompt/schema,
nutritional validation and timeout. Meta's official model card documents low/medium/high/xhigh and an xhigh model default;
low/medium favor faster shorter answers. Fireworks documents reasoning_effort for supported models,
but its public API reference does not enumerate Muse-specific support or promise its default matches Meta's.
No per-model hard numeric reasoning budget was confirmed; do not invent a budget_tokens/thinking setting or use none.
JSON schema formatting is not evidence that reasoning computation is absent.
The controlled live test succeeded with low effort in 18480 ms. This supports the optimization, but does not prove the previous timeout was caused by reasoning rather than queueing or another server-side delay.
Changing temperature is not a reliable latency fix; streaming alone cannot finish a complete validated JSON plan sooner.

Sources checked:
- https://huggingface.co/meta-models/Muse-Spark-Open-816B-A42B
- https://dev.meta.ai/docs/muse-spark-open/settings
- https://docs.fireworks.ai/guides/reasoning
- https://docs.fireworks.ai/api-reference/post-chatcompletions

New offline tests distinguish timeout before headers vs body timeout with HTTP 200, malformed envelope JSON vs
schema rejection, HTTP failure without body leakage, unchanged request parameters and late replies after abort.
The API is restarted deliberately after offline checks to load reasoning_effort=low and the HTTP stage diagnostics. No live generation is performed during preparation.


## Observed controlled iPhone result

One Fireworks request, no correction or transport retry, HTTP 200. Complete provider latency 18480 ms
(headers 18461 ms, body 7 ms). Usage: 647 prompt tokens including 448 cached input tokens,
1157 completion tokens, 1804 total. Estimated cost at the dated rates above: $0.0052332.
The plan was newly generated; cached input tokens do not mean a cached meal plan was returned.
The previous attempt timed out at 60013 ms before this stage instrumentation existed.

No further model calls are made by the test/build/publish workflow.
