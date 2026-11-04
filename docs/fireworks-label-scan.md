# Independent Fireworks Label Scan

Label mode uses its own required Nest DI token and explicit factory. Endpoint /scan/analyze with
mode=nutrition_label routes to that analyzer; ordinary Product mode uses PRODUCT_SCAN_AI_PROVIDER (legacy alias SCAN_AI_PROVIDER) and
Meal mode retains the existing AI_PROVIDER endpoint. No UI or response contract changes are needed.

Set in server-only apps/api/.env:

```dotenv
LABEL_SCAN_AI_PROVIDER=fireworks
# Existing FIREWORKS_API_KEY is reused; never put it in mobile or Git.
```

This selects accounts/fireworks/models/muse-spark-open through the existing FireworksProductProvider.
It retains low reasoning, 4096 output-token cap, 60s default FIREWORKS_SCAN_TIMEOUT_MS, prompts,
JSON schema, normalization, nullable-field handling and the recent response/error fixes.
Product Score, Goal Match, their input fields and calculations remain unchanged.
Label mode always analyzes the photo, bypassing the barcode/database lookup path and its cache.

Absent LABEL_SCAN_AI_PROVIDER defaults to google. To choose Gemini explicitly, set google and restart.
There is no model switch after an API error, timeout, missing key or bad response.
Changing PRODUCT_SCAN_AI_PROVIDER or its legacy alias SCAN_AI_PROVIDER does not select the Label analyzer.
The constructor default exists only for older directly-constructed test fixtures; production Nest
requires LABEL_SCAN_AI_PROVIDER injection and does not substitute the Product analyzer on failure.

For Label-only use, leave PRODUCT_SCAN_AI_PROVIDER=google and AI_PROVIDER=google, and set LABEL_SCAN_AI_PROVIDER=fireworks. Meal Plan is selected independently by MEAL_PLAN_PROVIDER. Product can also explicitly select Fireworks without changing Label.

Offline tests cover provider isolation, explicit Gemini alternative, missing-key/HTTP failure without
fallback, and exact normalization/Product Score/Goal Match parity for stubbed responses.

For one controlled iPhone check, restart the built API in Windows outside the network sandbox,
verify /health from the phone, select Scan > Label, photograph a readable nutrition table and press
Analyze ONCE after user authorization. Do not select Product or Meal for this check. Do not retry on failure.
Check fireworks_scan_http, fireworks_usage type=product_analysis, fireworks_scan and scan_flow
by requestId. scan_flow must show aiProvider=fireworks, the Muse Spark Open model and aiReason=nutrition_label.
Record status, call count, timings, tokens/cost and both scores before agreeing another paid check.
Gemini text enrichment/translation or separately configured Goal Match are independent existing flows,
not a fallback of the Label model. No paid model call is made while preparing this integration.
