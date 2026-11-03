# Goal Match v4: provider, Mock AI and API orchestration

October 28, 2026, local copy on the PC (C:\Users\sarak\Documents\FoodLens). No commit or push was made. Mobile, Product Score, the Nutrition Engine, the v3 formula, the v3 golden fixtures, other goals, `.env` and keys were not touched. Meta is never called.

## 1. Changed files (19, nothing else)

| File | What |
|---|---|
| packages/ai/src/ai-provider.ts | the `evaluateGoalMatch(input: GoalMatchAiInput): Promise<GoalMatchAiOutput>` method |
| packages/ai/src/errors.ts | `AIUnavailableError` (code `unavailable`) |
| packages/ai/src/index.ts, providers/mock/index.ts | exports |
| packages/ai/src/providers/mock/mock-goal-match.ts (new) | 5 recorded answers, record lookup |
| packages/ai/src/providers/mock/mock-provider.ts | `evaluateGoalMatch`, the `goalMatchRecordings` option, `model` |
| packages/ai/src/providers/meta/meta-provider.ts | `evaluateGoalMatch` is reserved: `not_implemented`, no request |
| packages/ai/src/test/mock-goal-match.test.ts (new) | 3 mock tests |
| apps/api/src/config/app-config.ts | `GOAL_MATCH_AI=off\|mock\|meta`, off by default |
| apps/api/.env.example | description of `GOAL_MATCH_AI=off` |
| apps/api/src/modules/ai/ai-provider.factory.ts | `createGoalMatchAIProvider(config)` |
| apps/api/src/modules/goal-match/goal-match.service.ts (new) | orchestration, timeout, retry |
| apps/api/src/modules/goal-match/goal-match-ai-cache.ts (new) | LRU cache and key |
| apps/api/src/modules/goal-match/goal-match.module.ts (new) | DI |
| apps/api/src/modules/goal-match/test/goal-match-v4.fixtures.ts, goal-match-v4.test.ts (new) | API tests A–L and the cache |
| apps/api/src/modules/scan/scan.service.ts | v4 only for eat_healthier with AI enabled |
| apps/api/src/modules/scan/scan.module.ts, scan.controller.ts | module wiring, the `ScanResult` response type |

Existing tests did not change. Line endings were kept as in the original files (some files use CRLF).

## 2. Provider method

`AIProvider.evaluateGoalMatch(input)` receives only `GoalMatchAiInput` (facts, levels, the plan; no Product Score, no v3 score and no profile restrictions) and returns the raw `GoalMatchAiOutput`. The provider checks nothing: `validateGoalMatchAiOutput` and `reconcileGoalMatch` do that in the orchestration. `analyzeProduct` is untouched. If there is no answer, the provider throws `AIUnavailableError`. `MetaProvider.evaluateGoalMatch` throws `AIMethodNotImplementedError` without any network request (a test checks this).

## 3. Mock responses

The mock recognizes a product by name (substring; case and ё do not matter) and by kcal per 100 g/ml (±1). It neither calculates nor copies the v3 score. For an unknown product it throws `AIUnavailableError`, and the fallback takes over.

| Record | Names | kcal | band | score | Factors | Warnings |
|---|---|---|---|---|---|---|
| greek_yogurt | греческий йогурт / greek yogurt | 66 | good_fit | 8.5 | high_protein, whole_food, low_salt | fiber_unknown |
| apple | яблок / apple | 52 | good_fit | 8.5 | whole_food, fiber_source, intrinsic_sugar | — |
| chips | чипсы / chips | 536 | poor_fit | 3.0 | ultra_processed, high_salt | — |
| cola | кола / cola | 42 | very_poor_fit | 1.5 | high_sugar (70% of the limit), ultra_processed | — |
| protein_bar | протеиновый батончик / protein bar | 350 | mixed_fit | 5.5 | sweeteners, ultra_processed, high_protein | sweeteners |

Every answer has dimensions consistent with the band, fact paths to leaves (`facts.perServing.proteinG`, `semantics.processing.value`, `product.ingredients` and so on), a one-sentence summary and high confidence. A test runs every record through the real validator: all pass with no removed factors (`adjusted=false`). The chips texts do not mention protein, so the same answer is valid for the demo chips with unread protein (AI_PROVIDER=mock). Test scenarios (hallucination, retry) pass their own records to MockProvider through `goalMatchRecordings`. Several answers are returned in turn, and the last one repeats.

## 4. Config off|mock

| GOAL_MATCH_AI | What happens |
|---|---|
| unset / `off` | no provider, `GoalMatchService.enabled=false`, ScanService calls the existing `matchGoal`. The response is byte-for-byte the same as v3 (test L) |
| `mock` | eat_healthier → v4 with recorded answers; other products → fallback |
| `meta` | reserved: MetaProvider, but no request is sent, always fallback |
| anything else | configuration error at startup |

The setting does not depend on `AI_PROVIDER`. Your `.env` does not have it, so off applies now and behavior did not change. Checked by starting Nest DI for all four values.

## 5. Pipeline

`ScanService.analyze` → `analyzeProduct` → `scoreProduct` (unchanged) → plan → if `plan.goal === 'eat_healthier'` and AI is enabled, `GoalMatchService.evaluate`, otherwise the existing `matchGoal`.

`GoalMatchService.evaluate`: `prepareGoalMatchV4` (v3 and guards) → terminal? return v4 with `source=deterministic` without calling AI → cache key → cache or `provider.evaluateGoalMatch` (with timeout) → `validateGoalMatchAiOutput` → one retry on an invalid answer → `reconcileGoalMatch` → `GoalMatchV4`.

Terminal: unavailable, conflict (allergen or diet), insufficient_data (including invalid_nutrition and missing_nutrients), not_applicable. No profile and profile_unavailable take the existing path, because the goal is unknown. Any unexpected v4 error is logged and the existing v3 is returned: the scan never fails.

## 6. Timeout, retry, cache

- **Timeout** 8000 ms per call (`GOAL_MATCH_AI_TIMEOUT_MS`). After a timeout, fallback with no retry.
- **Retry** at most 2 calls, only on an invalid answer. A provider error or timeout goes straight to fallback. Two invalid answers mean fallback with confidence at most medium.
- **Cache** an in-memory LRU on a Map, 1000 entries, evicting the least recently used. The key is a sha256 of canonical JSON (sorted keys) of: the AI input, inputVersion, promptVersion `eat-healthier-rubric-v1`, the provider name and the model (`mock-goal-match-recordings-v1` or MODEL_NAME for Meta). Only answers that passed the validator are cached. Errors, timeouts and invalid answers are never cached. On a hit `ai.cacheHit=true` and there are 0 calls.
- The fallback reason (`ai_unavailable`, `ai_timeout`, `ai_invalid`, `ai_disagreement`, `terminal`) is logged together with the error code. Provider error texts reach neither the log nor the response. The v4 contract has no separate fallbackReason field, and I did not add one.

## 7. Real API responses

Plan: 2000 kcal, protein 139 g. Below is the ScanService response. The v3 `deterministic` snapshot is cut down to the main fields; the full responses are in scan-responses.json (which also has chips 6.5 → 5.7 and a pear with no mock record). The `text` and `summary` fields are the Russian user-facing strings produced by the recorded AI answers.

### Greek yogurt
```json
{
  "score": {
    "value": 9.4,
    "version": "product-score-v2"
  },
  "goalMatch": {
    "version": "goal-match-v4",
    "goal": "eat_healthier",
    "state": "goal_match",
    "value": 8.5,
    "level": "great",
    "unavailableReason": null,
    "portion": {
      "basis": "serving",
      "amount": 130,
      "unit": "g",
      "caloriesKcal": 85.8
    },
    "factors": [],
    "confidence": "medium",
    "range": null,
    "uncertainty": [
      "fiber"
    ],
    "source": "ai",
    "ai": {
      "version": "goal-match-ai-v1",
      "band": "good_fit",
      "score": 8.5,
      "confidence": "high",
      "dimensions": {
        "nutrientDensity": "strong_positive",
        "processing": "positive",
        "sugar": "positive",
        "fatQuality": "neutral",
        "sodium": "positive",
        "portion": "positive"
      },
      "factors": [
        {
          "code": "high_protein",
          "direction": "positive",
          "impact": "high",
          "facts": [
            "facts.perServing.proteinG",
            "facts.levels.protein"
          ],
          "text": "Много белка на порцию."
        },
        {
          "code": "whole_food",
          "direction": "positive",
          "impact": "medium",
          "facts": [
            "semantics.processing.value"
          ],
          "text": "Простой состав без глубокой переработки."
        },
        {
          "code": "low_salt",
          "direction": "positive",
          "impact": "low",
          "facts": [
            "product.per100.saltG"
          ],
          "text": "Почти нет соли."
        }
      ],
      "summary": "Хороший выбор для цели: много белка и простой состав.",
      "warnings": [
        "fiber_unknown"
      ],
      "inputVersion": "goal-match-ai-input-v1",
      "promptVersion": "eat-healthier-rubric-v1",
      "model": "mock-goal-match-recordings-v1",
      "cacheHit": false
    },
    "adjusted": false,
    "ai_disagreement": false,
    "deterministic": {
      "version": "goal-match-v3",
      "value": 8.7,
      "level": "great",
      "confidence": "medium",
      "range": {
        "min": 8.7,
        "max": 8.7
      },
      "factors": "…"
    }
  }
}
```

### Chips
```json
{
  "score": {
    "value": 2.9,
    "version": "product-score-v2"
  },
  "goalMatch": {
    "version": "goal-match-v4",
    "goal": "eat_healthier",
    "state": "goal_match",
    "value": 3,
    "level": "poor",
    "unavailableReason": null,
    "portion": {
      "basis": "serving",
      "amount": 30,
      "unit": "g",
      "caloriesKcal": 160.79999999999998
    },
    "factors": [],
    "confidence": "high",
    "range": null,
    "uncertainty": [],
    "source": "ai",
    "ai": {
      "version": "goal-match-ai-v1",
      "band": "poor_fit",
      "score": 3,
      "confidence": "high",
      "dimensions": {
        "nutrientDensity": "negative",
        "processing": "strong_negative",
        "sugar": "neutral",
        "fatQuality": "negative",
        "sodium": "strong_negative",
        "portion": "neutral"
      },
      "factors": [
        {
          "code": "ultra_processed",
          "direction": "negative",
          "impact": "high",
          "facts": [
            "semantics.processing.value"
          ],
          "text": "Ультрапереработанный снек."
        },
        {
          "code": "high_salt",
          "direction": "negative",
          "impact": "medium",
          "facts": [
            "facts.perServing.saltG",
            "facts.levels.salt"
          ],
          "text": "Много соли для небольшой порции."
        }
      ],
      "summary": "Ультрапереработанный солёный снек, для цели подходит слабо.",
      "warnings": [],
      "inputVersion": "goal-match-ai-input-v1",
      "promptVersion": "eat-healthier-rubric-v1",
      "model": "mock-goal-match-recordings-v1",
      "cacheHit": false
    },
    "adjusted": false,
    "ai_disagreement": false,
    "deterministic": {
      "version": "goal-match-v3",
      "value": 4.2,
      "level": "poor",
      "confidence": "high",
      "range": {
        "min": 4.2,
        "max": 4.2
      },
      "factors": "…"
    }
  }
}
```

### Protein bar
```json
{
  "score": {
    "value": 8.3,
    "version": "product-score-v2"
  },
  "goalMatch": {
    "version": "goal-match-v4",
    "goal": "eat_healthier",
    "state": "goal_match",
    "value": 5.5,
    "level": "fair",
    "unavailableReason": null,
    "portion": {
      "basis": "serving",
      "amount": 60,
      "unit": "g",
      "caloriesKcal": 210
    },
    "factors": [],
    "confidence": "high",
    "range": null,
    "uncertainty": [],
    "source": "ai",
    "ai": {
      "version": "goal-match-ai-v1",
      "band": "mixed_fit",
      "score": 5.5,
      "confidence": "high",
      "dimensions": {
        "nutrientDensity": "positive",
        "processing": "strong_negative",
        "sugar": "neutral",
        "fatQuality": "neutral",
        "sodium": "neutral",
        "portion": "neutral"
      },
      "factors": [
        {
          "code": "sweeteners",
          "direction": "negative",
          "impact": "high",
          "facts": [
            "product.ingredients"
          ],
          "text": "В составе есть подсластитель."
        },
        {
          "code": "ultra_processed",
          "direction": "negative",
          "impact": "medium",
          "facts": [
            "semantics.processing.value"
          ],
          "text": "Ультрапереработанный батончик."
        },
        {
          "code": "high_protein",
          "direction": "positive",
          "impact": "medium",
          "facts": [
            "facts.perServing.proteinG",
            "facts.levels.protein"
          ],
          "text": "Белка много."
        }
      ],
      "summary": "Белка много, но это ультрапереработанный батончик с подсластителем.",
      "warnings": [
        "sweeteners"
      ],
      "inputVersion": "goal-match-ai-input-v1",
      "promptVersion": "eat-healthier-rubric-v1",
      "model": "mock-goal-match-recordings-v1",
      "cacheHit": false
    },
    "adjusted": false,
    "ai_disagreement": false,
    "deterministic": {
      "version": "goal-match-v3",
      "value": 8.9,
      "level": "great",
      "confidence": "high",
      "range": {
        "min": 8.9,
        "max": 8.9
      },
      "factors": "…"
    }
  }
}
```

### Cola, AI hallucination 9.0
```json
{
  "score": {
    "value": 3.4,
    "version": "product-score-v2"
  },
  "goalMatch": {
    "version": "goal-match-v4",
    "goal": "eat_healthier",
    "state": "goal_match",
    "value": 2.5,
    "level": "poor",
    "unavailableReason": null,
    "portion": {
      "basis": "serving",
      "amount": 330,
      "unit": "ml",
      "caloriesKcal": 138.6
    },
    "factors": [
      {
        "id": "protein.ok",
        "kind": "protein",
        "level": "ok",
        "impact": "neutral",
        "points": 0,
        "value": 0,
        "portionShare": 0,
        "matches": []
      },
      {
        "id": "fiber.ok",
        "kind": "fiber",
        "level": "ok",
        "impact": "neutral",
        "points": 0,
        "value": 0,
        "portionShare": null,
        "matches": []
      },
      {
        "id": "whole.ok",
        "kind": "whole",
        "level": "ok",
        "impact": "neutral",
        "points": 0,
        "value": 0,
        "portionShare": null,
        "matches": []
      },
      {
        "id": "sugars.high",
        "kind": "sugars",
        "level": "high",
        "impact": "negative",
        "points": -3,
        "value": 34.98,
        "portionShare": 69.96,
        "matches": []
      },
      {
        "id": "saturatedFat.ok",
        "kind": "saturatedFat",
        "level": "ok",
        "impact": "neutral",
        "points": 0,
        "value": 0,
        "portionShare": 0,
        "matches": []
      },
      {
        "id": "salt.ok",
        "kind": "salt",
        "level": "ok",
        "impact": "neutral",
        "points": 0,
        "value": 0,
        "portionShare": 0,
        "matches": []
      },
      {
        "id": "processing.high",
        "kind": "processing",
        "level": "high",
        "impact": "negative",
        "points": -0.5,
        "value": null,
        "portionShare": null,
        "matches": []
      }
    ],
    "confidence": "medium",
    "range": {
      "min": 2.5,
      "max": 2.5
    },
    "uncertainty": [],
    "source": "deterministic",
    "ai": null,
    "adjusted": false,
    "ai_disagreement": true,
    "deterministic": {
      "version": "goal-match-v3",
      "value": 2.5,
      "level": "poor",
      "confidence": "high",
      "range": {
        "min": 2.5,
        "max": 2.5
      },
      "factors": "…"
    }
  }
}
```

When the source is `ai`, the `factors` field holds only profile restrictions (that is how the stage 5 reconcile works), and the reasons are in `ai.factors`. `range` is null for an AI score.

## 8. Fallback

| Scenario | Result |
|---|---|
| Pear, no mock record | source deterministic, 8.5 = v3, ai null |
| Provider threw AIProviderError or TypeError | scan 200, v3 4.2, no error text in the response |
| Timeout (30 ms in the test) | scan 200, v3 4.2, outcome ai_timeout, 1 call |
| Two invalid answers | 2 calls, v3 4.2, confidence medium |
| Invalid, then valid | 2 calls, AI 3.0 |
| Cola 9.0 | deterministic 2.5, ai_disagreement=true |
| Chips 6.5 | AI, clamped to 5.7, adjusted=true, medium |
| No calories (insufficient_data) | AI not called |
| Milk allergen (conflict) | AI not called, 0, conflict |
| Protein not read | AI called, `missing` contains proteinG; an answer saying “high in protein” is rejected, fallback after 2 attempts |

## 9. Tests

Run in a clean copy of the repository (the same source, `pnpm install`, `pnpm typecheck`, `pnpm test`):

| Package | Before | After |
|---|---|---|
| core (type-contract, tsc) | ok | ok |
| nutrition | 17/17 | 17/17 |
| ai | 42/42 | 45/45 |
| scoring (v3 golden, Product Score, v4 core) | 170/170 | 170/170 |
| api | 20/20 | 43/43 |
| mobile (on the PC, node --test) | 12/12 | 12/12 |

Total 264 → 287, all green, typecheck passes for every package. New API tests: A–L, mode selection, a check of every mock answer by the real validator, the cache (hit, no caching of errors, the key, LRU). The v3 and Product Score tests in scoring did not change and pass. I did not run `pnpm typecheck` and `pnpm test` on the Windows PC (that needs pnpm, and pnpm links are unreadable in the Linux VM), but I ran the mobile tests, and the sha256 of all 19 files on the PC matched the verified ones.

## 10. Mobile

Mobile did not change: a diff against the backup taken before this stage shows only the 19 files from the table. Important: the current card knows only v1 and v3 and will read `goal-match-v4` as v1 (value/10). So turn on `GOAL_MATCH_AI=mock` from the iPhone only after the Mobile stage. With off the response is still v3.

## 11. Git

No commit or push was made. A backup of the sources (outside the repository) was taken on the PC before this stage.
