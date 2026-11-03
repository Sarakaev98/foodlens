# Goal Match v4: provider, Mock AI и оркестрация API

28 октября 2026, локальная копия на ПК (C:\Users\sarak\Documents\FoodLens). Commit и push не делались. Mobile, Product Score, Nutrition Engine, формула v3, golden-фикстуры v3, другие цели, `.env` и ключи не тронуты. Meta не вызывается.

## 1. Изменённые файлы (19, больше ничего)

| Файл | Что |
|---|---|
| packages/ai/src/ai-provider.ts | метод `evaluateGoalMatch(input: GoalMatchAiInput): Promise<GoalMatchAiOutput>` |
| packages/ai/src/errors.ts | `AIUnavailableError` (код `unavailable`) |
| packages/ai/src/index.ts, providers/mock/index.ts | экспорты |
| packages/ai/src/providers/mock/mock-goal-match.ts (новый) | 5 записанных ответов, поиск записи |
| packages/ai/src/providers/mock/mock-provider.ts | `evaluateGoalMatch`, опция `goalMatchRecordings`, `model` |
| packages/ai/src/providers/meta/meta-provider.ts | `evaluateGoalMatch` зарезервирован: `not_implemented`, запроса нет |
| packages/ai/src/test/mock-goal-match.test.ts (новый) | 3 теста mock |
| apps/api/src/config/app-config.ts | `GOAL_MATCH_AI=off\|mock\|meta`, по умолчанию off |
| apps/api/.env.example | описание `GOAL_MATCH_AI=off` |
| apps/api/src/modules/ai/ai-provider.factory.ts | `createGoalMatchAIProvider(config)` |
| apps/api/src/modules/goal-match/goal-match.service.ts (новый) | оркестрация, таймаут, retry |
| apps/api/src/modules/goal-match/goal-match-ai-cache.ts (новый) | LRU-кэш и ключ |
| apps/api/src/modules/goal-match/goal-match.module.ts (новый) | DI |
| apps/api/src/modules/goal-match/test/goal-match-v4.fixtures.ts, goal-match-v4.test.ts (новые) | API-тесты A–L и кэш |
| apps/api/src/modules/scan/scan.service.ts | v4 только для eat_healthier при включённом AI |
| apps/api/src/modules/scan/scan.module.ts, scan.controller.ts | подключение модуля, тип ответа `ScanResult` |

Существующие тесты не менялись. Окончания строк сохранены как в исходных файлах (часть файлов CRLF).

## 2. Provider method

`AIProvider.evaluateGoalMatch(input)` получает только `GoalMatchAiInput` (факты, уровни, план, без Product Score, балла v3 и ограничений профиля) и возвращает сырой `GoalMatchAiOutput`. Провайдер ничего не проверяет: это делают `validateGoalMatchAiOutput` и `reconcileGoalMatch` в оркестрации. `analyzeProduct` не тронут. Если ответа нет, провайдер бросает `AIUnavailableError`. `MetaProvider.evaluateGoalMatch` бросает `AIMethodNotImplementedError` без сетевого запроса (это проверено тестом).

## 3. Mock responses

Mock узнаёт продукт по названию (подстрока, регистр и ё не важны) и ккал на 100 г/мл (±1). Балл v3 он не считает и не копирует. Для неизвестного продукта он бросает `AIUnavailableError`, и включается fallback.

| Запись | Названия | ккал | band | score | Факторы | Предупреждения |
|---|---|---|---|---|---|---|
| greek_yogurt | греческий йогурт / greek yogurt | 66 | good_fit | 8.5 | high_protein, whole_food, low_salt | fiber_unknown |
| apple | яблок / apple | 52 | good_fit | 8.5 | whole_food, fiber_source, intrinsic_sugar | — |
| chips | чипсы / chips | 536 | poor_fit | 3.0 | ultra_processed, high_salt | — |
| cola | кола / cola | 42 | very_poor_fit | 1.5 | high_sugar (70% лимита), ultra_processed | — |
| protein_bar | протеиновый батончик / protein bar | 350 | mixed_fit | 5.5 | sweeteners, ultra_processed, high_protein | sweeteners |

У каждого ответа есть dimensions, согласованные с band, пути фактов к листьям (`facts.perServing.proteinG`, `semantics.processing.value`, `product.ingredients` и т.п.), summary из одного предложения и confidence high. Тест прогоняет каждую запись через настоящий validator: все проходят без удалённых факторов (`adjusted=false`). Тексты чипсов не упоминают белок, поэтому тот же ответ валиден и для демо-чипсов с непрочитанным белком (AI_PROVIDER=mock). Для тестовых сценариев (галлюцинация, retry) в MockProvider передаются свои записи через `goalMatchRecordings`. Несколько ответов возвращаются по очереди, последний повторяется.

## 4. Config off|mock

| GOAL_MATCH_AI | Что происходит |
|---|---|
| не задан / `off` | провайдера нет, `GoalMatchService.enabled=false`, ScanService вызывает прежний `matchGoal`. Ответ побайтно совпадает с v3 (тест L) |
| `mock` | eat_healthier → v4 с записанными ответами; остальные продукты → fallback |
| `meta` | зарезервировано: MetaProvider, но запрос не отправляется, всегда fallback |
| другое | ошибка конфигурации при запуске |

Настройка не зависит от `AI_PROVIDER`. В твоём `.env` её нет, значит сейчас действует off и поведение не изменилось. Проверено запуском Nest DI для всех четырёх вариантов.

## 5. Pipeline

`ScanService.analyze` → `analyzeProduct` → `scoreProduct` (без изменений) → план → если `plan.goal === 'eat_healthier'` и AI включён, то `GoalMatchService.evaluate`, иначе прежний `matchGoal`.

`GoalMatchService.evaluate`: `prepareGoalMatchV4` (v3 и guards) → terminal? вернуть v4 `source=deterministic` без вызова AI → ключ кэша → кэш или `provider.evaluateGoalMatch` (таймаут) → `validateGoalMatchAiOutput` → при невалидном ответе один повтор → `reconcileGoalMatch` → `GoalMatchV4`.

Terminal: unavailable, conflict (аллерген или диета), insufficient_data (включая invalid_nutrition и missing_nutrients), not_applicable. Нет профиля и profile_unavailable идут прежним путём, потому что цель неизвестна. Любая неожиданная ошибка v4 логируется, и возвращается прежний v3: скан не падает.

## 6. Timeout, retry, cache

- **Timeout** 8000 мс на каждый вызов (`GOAL_MATCH_AI_TIMEOUT_MS`). После таймаута fallback, повтора нет.
- **Retry** максимум 2 вызова, только при невалидном ответе. Ошибка или таймаут провайдера — сразу fallback. Два невалидных ответа — fallback, confidence не выше medium.
- **Cache** in-memory LRU на Map, 1000 записей, вытесняется давно не использованная запись. Ключ — sha256 канонического JSON (ключи отсортированы) из: AI input, inputVersion, promptVersion `eat-healthier-rubric-v1`, имя провайдера и модель (`mock-goal-match-recordings-v1` или MODEL_NAME у Meta). Кэшируются только ответы, прошедшие validator. Ошибки, таймауты и невалидные ответы не кэшируются. При попадании `ai.cacheHit=true`, вызовов 0.
- Причина fallback (`ai_unavailable`, `ai_timeout`, `ai_invalid`, `ai_disagreement`, `terminal`) пишется в лог вместе с кодом ошибки. Тексты ошибок провайдера не попадают ни в лог, ни в ответ. Отдельного поля fallbackReason в контракте v4 нет, его я не добавлял.

## 7. Реальные ответы API

План 2000 ккал, белок 139 г. Ниже ответ ScanService. Снимок v3 `deterministic` сокращён до основных полей, полные ответы лежат в scan-responses.json (там же чипсы 6.5 → 5.7 и груша без mock-записи).

### Греческий йогурт
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

### Чипсы
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

### Протеиновый батончик
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

### Кола, галлюцинация AI 9.0
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

Когда источник `ai`, поле `factors` содержит только ограничения профиля (так устроен reconcile из этапа 5), а причины лежат в `ai.factors`. `range` у AI-оценки равен null.

## 8. Fallback

| Сценарий | Итог |
|---|---|
| Груша, mock-записи нет | source deterministic, 8.5 = v3, ai null |
| Провайдер бросил AIProviderError или TypeError | скан 200, v3 4.2, текста ошибки в ответе нет |
| Таймаут (тест 30 мс) | скан 200, v3 4.2, outcome ai_timeout, 1 вызов |
| Два невалидных ответа | 2 вызова, v3 4.2, confidence medium |
| Невалидный, затем валидный | 2 вызова, AI 3.0 |
| Кола 9.0 | deterministic 2.5, ai_disagreement=true |
| Чипсы 6.5 | AI, прижато к 5.7, adjusted=true, medium |
| Нет калорий (insufficient_data) | AI не вызван |
| Аллерген молоко (conflict) | AI не вызван, 0, conflict |
| Белок не прочитан | AI вызван, `missing` содержит proteinG; ответ с «много белка» отклонён, после 2 попыток fallback |

## 9. Тесты

Запуск в чистой копии репозитория (тот же исходный код, `pnpm install`, `pnpm typecheck`, `pnpm test`):

| Пакет | Было | Стало |
|---|---|---|
| core (type-contract, tsc) | ok | ok |
| nutrition | 17/17 | 17/17 |
| ai | 42/42 | 45/45 |
| scoring (v3 golden, Product Score, v4 core) | 170/170 | 170/170 |
| api | 20/20 | 43/43 |
| mobile (на ПК, node --test) | 12/12 | 12/12 |

Итого 264 → 287, все зелёные, typecheck всех пакетов проходит. Новые API-тесты: A–L, выбор режима, проверка всех mock-ответов настоящим validator, кэш (попадание, отсутствие кэша для ошибок, ключ, LRU). Тесты v3 и Product Score в scoring не менялись и проходят. На ПК под Windows `pnpm typecheck` и `pnpm test` я не запускал (там нужен pnpm, а в Linux-VM ссылки pnpm не читаются), но mobile-тесты прогнал, а sha256 всех 19 файлов на ПК совпали с проверенными.

## 10. Mobile

Mobile не менялся: diff с резервной копией до этапа показывает только 19 файлов из таблицы. Важно: текущая карточка знает только v1 и v3 и прочитает `goal-match-v4` как v1 (value/10). Поэтому `GOAL_MATCH_AI=mock` с iPhone включать только после этапа Mobile. При off в ответе по-прежнему v3.

## 11. Git

Commit и push не делались. До этапа на ПК сделана резервная копия исходников (вне репозитория).
