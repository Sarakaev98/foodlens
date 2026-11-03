# FoodLens: Goal Match на итоговом nutrition snapshot

3 ноября 2026. Ветка dev, HEAD 033556fbc2ae35ae10878d9030591d936ac8eb6d; изменения локальные, push не выполнялся.

## Точная причина и исправление

В `apps/api/src/modules/scan/scan.service.ts::analyze` после estimation было два разных входа:

```ts
const completed = estimateMissingNutrition(flow.product);
const scoring = withIngredientFacts(forScoring(completed));
const score = scoreProduct(scoring);
// прежний код:
const rawGoalMatch = await this.matchGoal(withIngredientFacts(forScoring(flow.product)), await plan, requestId);
```

`flow.product` — результат источников до estimation. Goal Match вызывался после estimation по времени, но получал старый объект с null. Он не читал устаревший response/status из кэша, и nutrition_presence не управлял его gating: v3 проверял null непосредственно в переданном product.nutrition.

Теперь обе оценки получают один и тот же const `scoring`:

```ts
const score = scoreProduct(scoring);
const rawGoalMatch = await this.matchGoal(scoring, await plan, requestId);
const goalMatch = limitByProductScore(rawGoalMatch, score);
```

Никаких веток по названию/бренду/barcode нет. Scoring weights, v3/v1 числовые формулы, пороги и estimation algorithm не менялись.

Добавлены GOAL_MATCH_INPUT (nutrition + nutritionMetadata, без пользовательского плана) и GOAL_MATCH_RESULT под существующим debug flag. Проверки сравнивают SCORING_INPUT, GOAL_MATCH_INPUT и product.nutrition ответа: объекты сериализуются одинаково, provenance сохранён.

В v3 числовые inferred уже принимались: проверка missing работает по конечному числу/finite/nonnegative, а не по provenance observed. Есть небольшое уточнение metadata: если nutritionMetadata содержит estimated/ai_estimated поля или estimated basis, этот ввод не считается полностью прочитанной этикеткой. Используется существующая ветка confidence/uncertainty, включая uncertainty=nutrition. Это не меняет числовую формулу, но не позволяет одной оценённой клетчатке ошибочно повысить confidence до high.

## Путь данных

`POST /scan/analyze` → controller → normalize/lookup/enrichment → estimateMissingNutrition → completed → forScoring/withIngredientFacts → один `scoring` для scoreProduct и matchGoal → прежний limitByProductScore → response → useProductScan → GoalMatchCard.

v3 для eat_healthier теперь проверяет missing_nutrients на заполненных значениях. Настоящий отсутствующий сахар при ненулевых carbs на самой границе Goal Match по-прежнему даёт insufficient_data/missing_nutrients — это проверяется отдельно от estimator. Отсутствие профиля, неизвестная основа, недостающий semantic context и ограничения профиля сохраняют прежние политики.

Для других целей v1 тоже получает completed snapshot; его API-единицы остаются 0–100, mobile по-прежнему показывает 0–10. Опциональный v4 получает тот же completed product. Тестовые AI-ответы со stale предупреждением fiber_unknown больше не соответствуют заполненному входу и по-прежнему отклоняются валидатором; формулу и валидатор ради них не ослабляли.

## Реальная проверка endpoint

До перезапуска снова вызван настоящий HTTP endpoint для Rollton: Product Score=3.2, missingFactors=[], но Goal Match value=null, state=insufficient_data, unavailableReason=missing_nutrients. Сырой ответ сохранён как `goal-merged-rollton-before.json` в артефактах чата.

После успешных тестов и build прежний API остановлен, подтверждён свободный порт 3000. Новый API:

- PID **25316**, запуск 3 ноября в **08:42:01 Asia/Tbilisi**;
- workingDirectory `C:\Users\sarak\Documents\FoodLens\apps\api`;
- команда `E:\nodejs\node.exe dist/main.js`, свежая сборка текущего рабочего дерева dev;
- `/health`: HTTP 200, `{"status":"ok"}`;
- адрес телефона: `http://192.168.31.187:3000`;
- .env не менялся, SHA256 совпадает с предыдущим запуском.

Вызваны настоящие `POST http://192.168.31.187:3000/scan/analyze`, multipart/form-data с одним полем barcode, без фото. Это тот же endpoint и формат, что mobile analyzeBarcode. Fixtures, прямой вызов scoring engine или service-helper в этих HTTP-проверках не использовались.

| | Rollton 4605496000815 | Choco Pie 4607084351385 |
|---|---|---|
| HTTP | 200 | 200 |
| Request ID | 392ba591-9580-4024-89ac-7291e1bcc8e1 | 005deb46-f289-44ef-b127-51f3b51aacc0 |
| cacheHit | **false** | **false** |
| Product Score | **3.2/10** | **1.8/10** |
| Goal Match v3, до limitByProductScore | 4.0 | 2.3 |
| Goal Match в JSON | **3.2/10** | **1.8/10** |
| state | goal_match | goal_match |
| unavailableReason | null | null |
| confidence | medium | medium |
| uncertainty | [nutrition] | [nutrition] |
| Product Score missingFactors | [] | [] |
| missing_nutrients | false: unavailableReason=null | false: unavailableReason=null |

Последнее ограничение Goal Match величиной Product Score — существующая политика для eat_healthier. Совпадение двух оценок не означает новой одинаковой формулы.

Для каждого barcode это первый scan нового процесса. Кэши lookup providers и web search memory свежие; реальные enrichment_summary содержат cacheHit:false и 8 поисковых запросов. Никакие постоянные записи/планы пользователя не удалялись. Goal Match AI отключён текущей конфигурацией, используется v3.

### Merged nutrition и Goal Match input

Все значения на 100 г; значения из пяти последних строк — estimated/low, provenance=inferred. Известные БЖУ — прежние verified/source данные, confidence=medium. NutritionMetadata не удаляется перед Goal Match.

| Поле | Rollton | Choco Pie |
|---|---:|---:|
| caloriesKcal | 350 | 433, уточнено enrichment |
| proteinG | 6 | 4.5 |
| carbsG | 65 | 63 |
| fatG | 7.5 | 18 |
| sugarsG | 3.9 | 28.35 |
| saturatedFatG | 2.25 | 9 |
| fiberG | 3 | 2 |
| saltG | 1.5 | 0.5 |
| sodiumMg | 600 | 200 |
| servingSize | 40 g | 30 g |

Проверено равенство logged SCORING_INPUT.nutrition и GOAL_MATCH_INPUT.nutrition, а также равенство GOAL_MATCH_INPUT.nutritionMetadata метаданным в реальном response.

У Rollton v3 учитывает соль (0.6 г в порции, 12% дневного лимита) и ultra_processed; сахар поступает как 3.9 г/100, но его штраф зависит от прежнего sugarSource=intrinsic, поэтому фактор свободного сахара равен 0. Это поведение формулы не менялось. У Choco Pie учитываются свободный сахар, насыщенные жиры и обработка. Отдельные тесты с добавленным сахаром доказывают вклад inferred sugar при ненулевом штрафе.

Rollton: Gemini не вызывался. Choco Pie: существующее извлечение nutrition из текста страницы, model=gemini-3.5-flash-lite, usage prompt=1926, output=93, total=2019; thoughts/cached=null. Для Goal Match в этих HTTP-запросах Gemini не вызывался.

### Фактический JSON

Полные тела без ручных изменений:

- `goal-match-rollton-http.json` — полный ответ Rollton.
- `goal-match-choco-http.json` — полный ответ Choco Pie.
- `goal-match-merged-evidence.json` — этапы, входы/выходы, cacheHit, validation и результат проверки UI.

Ключевые фактические поля Goal Match Rollton:

```json
{
  "version": "goal-match-v3",
  "goal": "eat_healthier",
  "state": "goal_match",
  "value": 3.2,
  "level": "poor",
  "unavailableReason": null,
  "confidence": "medium",
  "uncertainty": ["nutrition"]
}
```

`missing_nutrients` не отдельное поле API: это код unavailableReason; он теперь null. `needsPhoto` и верхнеуровневый status отсутствуют в сыром успешном JSON, как и прежде; mobile трактует отсутствие needsPhoto как false. Дополнительные поля с искусственным false в тело ответа не добавлялись.

## Mobile UI на реальном ответе

Исполнены реальные GoalMatchCard и goalMatchLabels с JSON обоих HTTP-ответов, с подставными native primitives как в существующих mobile tests. Проверено:

- numeric value, state=goal_match, unavailableReason=null;
- строка «Для персональной оценки не хватает данных о пищевой ценности» отсутствует;
- для Rollton отображаются 3,2/10, «Плохо подходит», причины про соль и ультраобработанный продукт;
- для Choco Pie — 1,8/10, причины про свободный сахар, обработку и насыщенные жиры;
- существующее примечание про непроверенную халяль-сертификацию относится к сохранённому профилю и не является недостатком nutrition.

Код UI не менялся. Это проверка actual components, не наблюдение физического экрана телефона. Новый скан с телефона получит обновлённые значения от оставленного работающим API.

## Тесты и изменённые файлы

**1175 tests, 0 failures**: API 683, scoring 240, AI 117, nutrition 38, mobile 97; core contract type tests прошли. Typecheck и API build успешны. Реальные HTTP-проверки обоих barcode и UI-проверки обоих JSON прошли.

Production:

1. `apps/api/src/modules/scan/scan.service.ts` — передача того же scoring snapshot в Goal Match и диагностические логи.
2. `packages/scoring/src/goal-match-v3.ts` — использование estimated metadata только для confidence/uncertainty, без изменения числовой формулы.

Tests:

3. `apps/api/src/modules/scan/test/goal-match-merged.test.ts` — 11 новых проверок: verified/inferred nutrition, вклад сахара/насыщенных жиров/соли, estimated fiber, equality snapshot, настоящее missing, v1, Rollton и Choco Pie.
4. `apps/api/src/modules/goal-match/test/goal-match-v4.test.ts` — completed API input и сохранение raw boundary validation, включая stale AI warning.
5. `apps/api/src/modules/scan/test/google-scan.test.ts` — completed nutrition для Goal Match; тестовый AI-ответ соответствует заполненному входу.
6. `apps/api/src/modules/scan/test/scan-multi-photo.test.ts` — Goal Match после заполнения missing по нескольким фото.
7. `apps/api/src/modules/scan/test/scan-open-food-facts.test.ts` — числовой результат после completion без OFF.
8. `apps/api/src/modules/scan/test/scan.test.ts` — логи unavailableReason после completion и вклад оценённого белка.

Документация: этот отчёт, evidence, два фактических HTTP JSON и пометка об обновлении wiring в предыдущем отчёте mvp-nutrition-estimation.md.

Формулы, estimator, значения под примеры, .env и UI source files не менялись. API оставлен работающим, push/commit не выполнялись.
