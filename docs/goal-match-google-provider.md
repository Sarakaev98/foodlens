# Google Goal Match evaluator — implementation and real tests

Date: 29 October 2026. Branch: dev. No commit/push.

## Scope and exact changed files

- packages/ai/src/goal-match-provider.ts — text-only GoalMatchEvaluator interface.
- packages/ai/src/goal-match/goal-match-prompt.ts — initial implementation of the approved
  eat-healthier-rubric-v1; frozen before live tests, not tuned after responses.
- packages/ai/src/goal-match/goal-match-output-schema.ts — existing GoalMatchAiOutput shape
  with a Vertex responseSchema representation; no Google-specific output contract.
- packages/ai/src/providers/google/google-goal-match-provider.ts — real REST evaluator.
- packages/ai/src/index.ts — exports.
- packages/ai/src/test/google-goal-match-provider.test.ts — eight HTTP-stub unit tests.
- apps/api/src/config/app-config.ts — off|mock|google|meta and backend Google settings.
- apps/api/src/modules/ai/ai-provider.factory.ts — separate Google evaluator selection.
  The createAIProvider image-extraction function is unchanged.
- apps/api/src/modules/goal-match/goal-match.service.ts — types only, narrowing the required
  provider interface to name/model/evaluateGoalMatch. Validation/retry/cache/reconciliation
  logic is unchanged.
- apps/api/src/modules/goal-match/test/google-goal-match.test.ts — five evaluator integration
  tests with stubbed HTTP, including cache and semantic-invalid fallback.
- apps/api/.env.example — safe variable names and approved model default.
- apps/api/scripts/smoke-google-goal-match.cjs — explicitly invoked real-network smoke and
  integration runner, excluded from pnpm test.
- docs/goal-match-google-live-results.json — complete real generated outputs, validation,
  reconciliation, cache metadata and safe HTTP diagnostics.
- docs/goal-match-google-provider.md — this report.
- apps/api/.env — ignored local file only: the model setting was added and then changed
  with explicit user approval. Existing key, project, location and image-analysis mode retained.

No dependency or lockfile changes. Existing local work predates this task.

## Provider and request

GoogleGoalMatchProvider is backend-only and exposes only evaluateGoalMatch. It cannot
recognize an image. AI_PROVIDER remains mock; createAIProvider, Product Score,
Nutrition Engine, v3/v4 core, corridor, ceilings, restrictions, Mock recordings and Mobile
were not modified.

Request:
POST https://aiplatform.googleapis.com/v1/projects/test-project/locations/global/publishers/google/models/{model}:generateContent

Authentication is only the x-goog-api-key header, never a URL query.
responseMimeType is application/json; responseSchema uses the existing AI output fields.
No photo, Product Score, deterministic score, personal restrictions or raw age/sex is sent.
Provider shape validation is followed by the existing validateGoalMatchAiOutput inside
GoalMatchService before caching/reconciliation.

The provider has a 7.5-second aborting deadline (inside the unchanged service's 8-second
deadline). Missing credentials/config, auth/quota failures, HTTP errors, timeout,
network failure, malformed/blocked/incomplete output become safe AIProviderError values.
Bodies, causes and keys are not attached to those errors or logged. Scan uses its
existing deterministic fallback. Invalid semantic responses retain the existing one retry.

## Model change and temperature limitation

The first real smoke used the requested gemini-2.5-flash, project test-project,
location global. It reached Google and received HTTP 404 / NOT_FOUND in 437 ms.
No model JSON was produced.

Google's current lifecycle documentation lists retirement of gemini-2.5-flash on
20 October 2026. The user then explicitly approved gemini-3.5-flash-lite.
Defaults/config were updated to that model; no automatic fallback model was added.

Sources:
- [Model lifecycle](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/model-versions)
- [Gemini 3.5 Flash-Lite parameters](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-5-flash-lite)
- [Structured output](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/control-generated-output)

Important deviation from the original temperature=0 request: Google documents that
3.5 Flash-Lite ignores custom temperature/top-K/top-P. The request therefore omits
temperature and uses supported thinkingLevel=MINIMAL. The model default temperature
is 1.0; deterministic temperature=0 cannot be promised for this model. Identical accepted
inputs are stabilized by the unchanged application cache. For explicitly configured
legacy models, the original temperature=0/thinkingBudget=0 request path remains available.

The prompt file hash was frozen before live tests and is unchanged afterward.

## Real smoke — not a Mock AI evaluation

Model: gemini-3.5-flash-lite.
Project: test-project.
Location: global.
Secret: redacted.
HTTP: 200.
Total provider latency: 2392 ms.
Generated JSON parsed and passed validateGoalMatchAiOutput unchanged.

Greek yogurt raw output:
score 9.0, band excellent_fit, confidence high.
Factors: high_protein, low_sugar, low_salt, fits_portion.
Summary:
“Отличный продукт с высоким содержанием белка, минимальной обработкой и низким уровнем сахара.” (“An excellent product: high in protein, minimally processed and low in sugar.”)
Warnings: fiber_unknown.
v3: 8.7. Reconciled final: 9.0, source ai, final confidence medium.

The existing static yogurt fixture is normalized locally; no Mock evaluator or Meta
call supplies these scores. The complete raw JSON is in goal-match-google-live-results.json.

## Real GoalMatchService test — Greek yogurt

The service starts with an empty in-memory cache:
- First call: one actual Google HTTP 200, 2137 ms, cacheHit=false, aiCalls=1.
- Gemini: score 9.0, excellent_fit, high.
- Validator: valid, zero removed factors.
- Final: 9.0, source ai, confidence medium because fiber is unknown.
- adjusted=false, ai_disagreement=false.
- Identical repeat: cacheHit=true, aiCalls=0, no additional Google HTTP request.
- Metadata model: gemini-3.5-flash-lite.
- Cache key already includes canonical input, promptVersion, provider google and model.

Integration-call summary:
“Продукт отличается высоким содержанием белка и низким уровнем сахара при минимальной степени обработки.” (“High in protein and low in sugar, with minimal processing.”)
Factors:
high_protein “Высокое содержание белка” (high protein);
low_sugar “Низкое количество сахара” (low sugar);
low_salt “Низкое содержание соли” (low salt);
fits_portion “Умеренная калорийность порции” (moderate calories per portion).

The two separate uncached smoke/service calls had the same score (9.0), but some
dimension/text details differed. The cached repeat returned the accepted service answer.

## Real GoalMatchService test — Chips

Existing chips fixture: 536 kcal/100 g, serving 30 g, protein 6.5 g/100 g, salt 1.4 g/100 g,
processing ultra_processed. Its v3 score is 4.2.

Both real Google requests succeeded at HTTP level:
- Attempt 1: HTTP 200, 1686 ms; score 4.0, poor_fit, high.
- Attempt 2 (existing validation retry): HTTP 200, 1299 ms; score 4.0, poor_fit, high.

Both generated outputs were rejected by the unchanged validator with band_dimensions.
The declared poor_fit band requires two strong_negative dimensions, or one strong_negative
with processing exactly negative. Both outputs had one strong_negative, at processing,
and other negatives. They did not satisfy that implemented rubric rule.

Attempt 1 dimensions:
nutrientDensity negative; processing strong_negative; sugar positive;
fatQuality positive; sodium negative; portion positive.

Attempt 2 dimensions:
nutrientDensity negative; processing strong_negative; sugar neutral;
fatQuality negative; sodium negative; portion positive.

Both recognized ultra_processed and high_salt, with fits_portion as a smaller positive.
Attempt 1 summary:
“Ультрапереработанный продукт с высоким содержанием жиров и соли.” (“Ultra-processed, high in fat and salt.”)
Attempt 2 summary:
“Продукт является ультрапереработанным с высоким содержанием жиров и умеренным количеством соли.” (“Ultra-processed, high in fat, with moderate salt.”)

Final:
- outcome ai_invalid;
- value 4.2;
- source deterministic;
- confidence medium;
- ai=null: rejected AI reasons are not displayed;
- no invalid answer was cached.

No prompt, anchor, validator or scoring adjustment was made to force acceptance.
Further real requests stopped after these results. Full raw factors and fact references
for both attempts are preserved in the JSON report.

## Runtime activation

GOAL_MATCH_AI=google is supported and tested. The existing local GOAL_MATCH_AI setting
was left unchanged (unset -> off), because Mobile v4 is not connected in this task.
Real calls above explicitly construct the Google evaluator and exercise the existing
GoalMatchService; they do not switch the running Scan image-analysis provider.

To rerun intentionally, after pnpm test:
node apps/api/scripts/smoke-google-goal-match.cjs --smoke-only
node apps/api/scripts/smoke-google-goal-match.cjs --integration-only

The second command requires a successful, validated smoke with the same config.
These commands send real requests and are not part of the general test suite.

## Verification and security

- Full pnpm typecheck: passed.
- Full pnpm test: 300 runtime tests passed plus core type-contract tests.
  Scoring 170, AI 53, API 48, mobile 12, nutrition 17.
- New Google tests: eight provider tests and five API/service tests.
- Unit HTTP stubs cover success, 401/403/404, quota/server errors, deadline/cancellation,
  network errors, malformed JSON, invalid output, missing key/project, model config,
  secret-safe errors, thought/blocked responses.
- Service tests verify existing semantic validation/retry/fallback, cacheHit false/true
  and one HTTP request for two identical evaluations.
- 157 protected core/scoring/nutrition/mobile/Scan/cache/Mock/Meta files: hashes unchanged.
- .env is gitignored; no actual Google key found in tracked files or new source/tests/reports.
- Key never printed, never placed in URL, report, test data or mobile.
- No changes to prompt after seeing model results.
- No commit or push.
