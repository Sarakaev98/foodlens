# Google multimodal Scan provider

29 October 2026, dev. No commit/push.

## Scope and exact changed/added files

1. packages/ai/src/providers/google/google-provider.ts — real multimodal GoogleProvider implementing the existing AIProvider.
2. packages/ai/src/providers/google/google-product-analysis.ts — alias of the existing raw schema, nullable-field preparation, provider-level quantity/evidence checks and Vertex schema representation.
3. packages/ai/src/providers/google/google-product-prompt.ts — image-extraction prompt based on existing extraction rules; separate from the unchanged Goal Match prompt v2.
4. packages/ai/src/index.ts — exports.
5. packages/ai/src/test/google-product-provider.test.ts — 15 HTTP-stub provider tests.
6. packages/core/src/product/product-source.ts — compatible google_vision provenance branch; same Product fields.
7. packages/ai/src/providers/meta/meta-product-normalizer.ts — optional vision source context only; default Meta/Mock behavior is byte-equivalent.
8. apps/api/src/config/app-config.ts — AI_PROVIDER supports google in addition to meta/mock.
9. apps/api/src/modules/ai/ai-provider.factory.ts — Google selection for Scan only; Goal Match selection stays independent.
10. apps/api/src/modules/scan/test/google-scan.test.ts — six HTTP-stub pipeline/config/error regression tests.
11. apps/api/.env.example — safe Google Scan option documentation; no secrets.
12. apps/api/.env — ignored local file: AI_PROVIDER=google and GOAL_MATCH_AI=google. Existing key/project/location/model retained.
13. docs/google-scan-provider.md — this report.

No dependency, lockfile or Mobile file changes.

## Two separate Google tasks

AI_PROVIDER=google selects GoogleProvider.analyzeProduct.
GOAL_MATCH_AI=google independently selects the existing GoogleGoalMatchProvider.
The flags can also be combined with off/mock/meta independently.

Both use the existing backend Google settings:
- project foodlens-513112;
- location global;
- model gemini-3.5-flash-lite;
- key read only on backend.

First request: actual image via inlineData {mimeType,data}, with its original base64 and
the actual JPEG/PNG/WebP MIME. No backend resizing, recompression or external OCR.
The content parts array leaves room for future multiple images, without adding that flow now.

Second request: existing GoalMatchAiInput, text-only normalized product/facts.
No image, base64, Product Score, v3 score, personal restrictions, age or sex is passed.
GoogleProvider can delegate evaluateGoalMatch to the existing evaluator as well, but
production selection still uses the independent flags/factories.
The extraction deadline is 60 seconds; the existing Goal Match deadline remains 7.5 seconds
inside its service deadline.

[Google image input documentation](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/image-understanding)

## Structured output and normalization

The Google raw schema is exactly META_PRODUCT_ANALYSIS_SCHEMA, not a new Product model.
The Vertex request representation maps nullable fields to supported nullable schema forms;
the local strict schema still rejects invalid structures, enums, basis and units.

Flow:
raw JSON -> prepareGoogleProductAnalysis -> strict shared schema + provider checks
-> normalizeMetaProductAnalysis -> shared Product.

Omitted nullable nutrition fields become null, never zero or guessed label values.
A missing printed serving is not invented. Existing semantics-v1 and its typicalServing
confidence/evidence rules remain unchanged. Unsupported semantic assertions without any
evidence become unknown/low in the Google raw adapter; known values are not inferred
from a brand/name.

Provider checks reject negative/out-of-range quantities using the existing normalization
plausibility bounds, zero/impossible serving sizes, invalid units and invalid ingredient
entries. Numeric label values require visible/readable nutrition-table evidence.
Invisible tables are discarded by the existing normalizer.
Ingredients remain ordered printed entries; unknown sections remain unknown.
The existing downstream invalid_nutrition guard remains unchanged.

The shared normalizer retains its observed/inferred/not_detected behavior, including
existing deterministic kJ->kcal and salt/sodium conversions marked appropriately.
No typical nutrition values are inserted.
Only provenance is configurable: Google results use google_vision / provider google /
google-product-analysis-v2. Meta and Mock retain their previous source exactly.

v2 gives Google its own system prompt with a per-row nutrition checklist. The response schema
has no field descriptions, and adds a diagnostic `nutrition_status` (observed / not_listed /
unreadable for sugars, saturated fat and salt). It is logged as `nutrition_status` and removed
before validation, so it never reaches Product. The Meta prompt and schema are unchanged.

## Multi-photo Scan

POST /scan/analyze accepts the old `image` field, or `images` with 1–3 files plus optional
`roles` (product | nutrition | ingredients, a JSON array or one value per photo). Invalid roles
are ignored. Limits: 3 photos, 10 MB per file, 14 MB in total, which stays under Gemini's
20 MB inline request limit after base64.

All photos go as inlineData parts in ONE generateContent call, with no retry. A one-photo
request is byte-identical to the single-image request. The multi-image prompt section and role
hints are added only for 2–3 photos. Meta uses the first photo; Mock ignores photos.
`gemini_usage` for product_analysis carries `numberOfImages` and `retries:0`.

## Barcode and Open Food Facts

A barcode is optional. The lookup runs in the API, in parallel with analyzeProduct, and nothing
from it is sent to Gemini. `GET https://world.openfoodfacts.org/api/v3.6/product/{barcode}.json`
is read-only, needs no key, and is limited to 15 reads per minute per IP. FoodLens stays at 12 and
pauses for a minute after a 429. Results are cached in memory: 24 h when found, 1 h when not found.

Only `nutrition.aggregated_set` with preparation `as_sold` and per `100g`/`100ml` is used.
Values with source `estimate` or modifier `~` are dropped. They are the database's guesses, not
package data. OFF changed this structure in v3.5, so the path pins v3.6.

The label wins: the database only fills empty fields, and values are never overwritten or
averaged. Provenance uses the existing field: `observed` (label_ai), `inferred` (derived),
`open_food_facts`. Two conflicting core values (kcal, protein, carbs, fat) are treated as a
different product and the record is ignored. If OFF has no product or is down, the scan continues
from the photo. Set `PRODUCT_LOOKUP=none` to disable it, and `OFF_CONTACT` to set the contact in
the User-Agent.

### Barcode-first scan

With a barcode, `ScanService` asks OFF, then web search, and scores the result. `analyzeProduct` runs
only if a photo was sent and the data is not enough for Product Score, or if there are no ingredients
for Goal Match. `POST /scan/analyze` accepts `barcode` with 0–3 images; without images and with too
little data the answer has `needsPhoto: true`. Details: `docs/web-fallback-v2.md`.

### Further sources

`MultiSourceProductLookup` tries sources in order. OFF starts with the photo analysis; the next
source runs only if sugars, saturated fat, or salt/sodium are still missing, and receives only
the barcode. FatSecret is implemented but disabled until `FATSECRET_CLIENT_ID` and
`FATSECRET_CLIENT_SECRET` are set. Records carry a match level: `exact_barcode` is used,
`verified_attributes` needs at least 2 matching core values, and `name_only` is never used.
When two databases disagree on a value, the field stays empty instead of picking one.

### Web search fallback

`WEB_SEARCH_LOOKUP=tavily` adds a third source after the databases; it is off by default. It runs
only if critical fields are still missing. Search only finds pages: one call sends barcode, brand,
name and serving, and only URLs from the search results are used. `gemini` is kept as an alternative
search through Google grounding. Code reads
at most 3 pages (`PageFetcher`: public addresses only, 5 s, 2 MB, HTML or JSON-LD) and extracts
nutrition from JSON-LD, then from the page table, then with at most one small Gemini call without
Search, whose numbers must be printed in the page text. Code then compares the page with the label
macros, which never leave the API, and accepts a value on an exact barcode, on the manufacturer's
page for the exact variant, or on two independent sources. Values fill only empty fields, with
provenance `web_search` and a `Product.fieldEvidence` entry. Details: `docs/web-fallback-v2.md`.

Do not enable `gemini`: Google Cloud Service Terms section 20(k) restrict automated use of Search
grounding links and caching of grounded results. See `docs/web-fallback-v2.md`.

Before production: set `OFF_CONTACT` to a real project email, keep the in-app attribution, and
review the ODbL obligations. See https://world.openfoodfacts.org/terms-of-use and
https://opendatacommons.org/licenses/odbl/1-0/

## Error handling and safe logging

Missing credentials/project, timeout, 401/403, quota/rate limit, network errors, malformed
JSON, invalid schema or impossible response values use the existing AIProviderError codes.
Scan maps them to its existing safe ScanError status/code. No raw Google error body,
key, image base64 or sensitive request payload is logged or attached as an error cause.

No-food/unreadable product results do not become a fixed/demo product.
A failed first call aborts Scan before Goal Match. There is no automatic Google->Mock
substitution. Goal Match fallback applies only after successful Product extraction.

Product analysis logging includes only provider, model, requestType product_analysis,
success/failure, latency and safe error code/status.

## Verification

- Full pnpm typecheck: passed.
- Full pnpm test: 342 runtime tests plus core type-contract checks.
  Scoring 186, AI 69, API 58, mobile 12, nutrition 17.
- 15 new Google image-provider tests and six new API/service pipeline tests.
- Covered all three MIME types/original bytes, valid normalization, missing/omitted fields,
  malformed JSON, invalid schema/units, negative/impossible values, absent table evidence,
  unsupported MIME, 403/quota/network failures, timeout, absent key/project, no secret
  leakage, ungrounded sugar/processing context, safe logs and both methods on one config.
- Two-step integration tests use stubbed HTTP: image extraction -> normalized Product
  -> unchanged Product Score 9.4 -> independent text-only Goal Match -> validator/reconcile.
- First-call failure sends no second request; second-call failure keeps the extracted
  Product and uses existing deterministic fallback.
- Mock Scan, Meta path, Mock Goal Match, Google Goal Match, v3 and other-goal regressions pass.
- Protected hash comparison found only the shared normalizer change; removing its optional
  source context makes that file identical to its before-task version.
- Goal Match prompt v2, validator, scoring, v3, reconciliation, corridor, ceilings,
  Nutrition Engine, Product Score, existing Google evaluator and Mobile are unchanged.
- Local .env is gitignored; actual key not found in sources/tests/reports.

## Real image status

A complete search, including ignored repository paths except dependencies/build caches,
found only the six application icon/splash assets. No real product photograph exists
in the repository.

No generated image, keyboard photo, screenshot, application icon or other substitute
was sent to Google. No real Google multimodal smoke or image end-to-end Scan has been
performed in this task. Unit test bytes are HTTP-stub-only test data.

The first real visual test remains to be performed with an actual product from iPhone.

## Local runtime

- AI_PROVIDER=google, GOAL_MATCH_AI=google.
- Docker Desktop recovered from stale IPC socket startup failures.
- Existing foodlens-postgres container started; pg_isready succeeds. No image/container/
  volume reset or recreation; existing eat_healthier profile remains present.
- API started: node dist/main.js from apps/api.
- GET http://127.0.0.1:3000/health -> 200.
- GET http://192.168.100.2:3000/health -> 200 from this computer.
- DB-backed profile and nutrition-target endpoints -> 200; profile goal eat_healthier.
- Metro running on 8081. Existing iOS bundle returns 200 and includes current API URL.
- Expo runtime env only: EXPO_PUBLIC_API_URL=http://192.168.100.2:3000 and
  REACT_NATIVE_PACKAGER_HOSTNAME=192.168.100.2. Mobile .env/source files were not changed.
- Expo Go URL: exp://192.168.100.2:8081.

Docker recovery operations only backed up runtime socket directories (Docker/run and
docker-secrets-engine containing zero-byte IPC entries). No WSL data disk, database,
container or volume data was changed.

## LAN limitation pending user approval

The active Ethernet network is Public. Windows has an existing inbound TCP block for
E:\\nodejs\\node.exe on Public networks. This can block iPhone access even though local/LAN-IP
health checks on the computer succeed.

A narrowly scoped helper was prepared but NOT run:
C:\\Users\\sarak\\AppData\\Local\\Temp\\foodlens-enable-lan.ps1

It requires Administrator UAC confirmation, backs up the affected rule names, creates
an inbound allowance only for LocalSubnet TCP 3000/8081 for that Node program, then disables
the conflicting Public TCP app block. Default Public inbound Block remains in place;
UDP and network profiles are not changed. User approval is pending.

API is running and ready locally. External-device accessibility is not claimed before
that firewall step and a phone-side health check.

After LAN access is allowed, connect iPhone to the same LAN, open
http://192.168.100.2:3000/health in Safari, then exp://192.168.100.2:8081 in Expo Go.
Take a photo of a real package with a readable nutrition table and ingredients.
Mobile v4 presentation remains a separate task.

No commit or push.
