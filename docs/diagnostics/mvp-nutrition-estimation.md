> Последующее исправление: Goal Match теперь получает тот же completed snapshot после estimation, что и Product Score. См. [goal-match-merged-nutrition.md](goal-match-merged-nutrition.md).

# FoodLens MVP: полный Product Score с estimation fallback

3 ноября 2026. Репозиторий `C:\Users\sarak\Documents\FoodLens`, ветка `dev`. Ничего не отправлялось в remote. Предыдущая диагностика `universal-pipeline.md` описывает прежние требования; текущий запрос разрешает оценку недостающих нутриентов.

## Результат

Успешно распознанный продукт проходит `scan → exact data → enrichment → estimation → normalized nutrition → existing Product Score`.

Новый этап выполняется в ScanService после базы, веб-поиска и доступного анализа фото, до единственного существующего scoreProduct. Он возвращает числовые значения всех девяти нутриентов, необходимых существующим формулам. Для продукта с названием, составом или прочитанной таблицей Score становится числом 0–10. Неизвестный barcode без названия/состава/таблицы не объявляется распознанным продуктом: для него остаётся запрос фото.

Формула, веса, пороги, калибровка и коэффициенты Product Score не менялись. Отдельной формулы для estimated продуктов нет. Низкая confidence estimates не блокирует вычисление и обычное отображение результата.

## Как устроены estimates

`nutrition-estimator.ts::estimateMissingNutrition` — чистая детерминированная функция `context-rules-v1`, без сети, запросов к модели, идентификаторов отдельных продуктов и брендов. Она использует:

- известную категорию; если категория отсутствует — общие слова типов еды в названии;
- известные калории и БЖУ; сахара и насыщенные жиры как нижние границы недостающих carbs/fat;
- состав и положение сахара/соли в порядке ингредиентов;
- указания на пальмовый/кокосовый/сливочный либо подсолнечный/оливковый жир;
- цельнозерновые ингредиенты, отруби и бобовые для клетчатки;
- product form, sugarSource и доступный размер порции.

Категорийные профили — явно оценочные MVP priors, а не проверенные анализы состава. Их числа находятся отдельно от scoring. Они заполняют только null. Бренд участвует в уже существующей идентификации/enrichment, но не определяет коэффициенты оценки. Processing продолжает учитываться прежним scoring по исходным semantics/ingredients; отдельного ослабляющего коэффициента обработки в estimator нет.

Gemini остаётся в существующем enrichment для извлечения текста найденных страниц. Estimation не требует Gemini и не зависит от доступности дополнительных токенов, сайтов или двух подтверждений.

При отсутствии самих БЖУ используются категорийные priors с ограничениями. Если калории известны, остаточная энергия распределяется между отсутствующими макросами с учётом уже известных сахаров/насыщенных жиров. Если калорий нет, они рассчитываются по 4/4/9. При наличии всех точных значений estimator сохраняет их объекты без изменения и не создаёт оценочных полей.

## Ограничения и provenance

- Сахара ограничены carbs; насыщенные жиры — fat, в том числе после округления.
- Оценённые макросы ограничены доступной массой на 100 г/мл; учитываются нижние границы из известных сахаров/насыщенных жиров.
- Клетчатка ограничена остатком массы, 30 г/100 и энергетическим пределом.
- Соль оценивается по профилю и позиции в составе, с верхней границей 5 г/100. Для специальных продуктов вроде чистой соли это ограничение не применяется к точным значениям: они сохраняются.
- Известная соль/натрий сначала пересчитываются друг в друга: `saltG = sodiumMg × 2.5 / 1000`, обратное `sodiumMg = saltG × 1000 / 2.5`. Отдельной независимой оценки натрия нет.
- Estimates масштабируются к исходной порции; точные значения не пересчитываются и не перезаписываются.
- Неизвестная основа либо недостающий размер порции получают явную оценочную basis metadata с low confidence. Это предположение MVP, а не найденный факт.
- Противоречия уже известных source values не «исправляются» подстановкой. Они отмечаются в `nutritionMetadata.constraints`; Score от этого не блокируется.

API сохраняет прежние value/provenance. Новые вычисленные значения имеют provenance=inferred и дополнительную отдельную маркировку:

```json
{
  "nutritionMetadata": {
    "version": "context-rules-v1",
    "basis": { "quality": "verified", "confidence": "high", "reason": "source" },
    "fields": {
      "sugarsG": {
        "quality": "estimated",
        "confidence": "low",
        "method": "context_rules",
        "reason": "category:...; carbohydrate bound; sugar ingredient position:..."
      }
    },
    "constraints": []
  }
}
```

Metadata создаётся для всех девяти полей: verified/estimated/ai_estimated, confidence, method и reason. `ai_estimated` предусмотрен контрактом; текущий оценщик использует estimated. Verified здесь обозначает принятые данные источника или арифметический пересчёт, а не лабораторное подтверждение: у записи OFF confidence=medium, у observed обычно high. У оценочных полей confidence=low, за исключением расчётной энергии по известным БЖУ с medium. Источники и URL точных полей остаются в fieldEvidence.

## API и UI

В scan.service.ts добавлены `ESTIMATION_INPUT`, `ESTIMATION_RESULT`, затем существующие `SCORING_INPUT`/`SCORING_RESULT`. Они идут под существующей настройкой scan debug, без фото, API keys или пользовательского профиля.

Если estimates дали полный Product Score, API больше не возвращает `needsPhoto`/`needs_nutrition_photo` для распознанного продукта. В UI используется обычная карточка с числом и вердиктом. Estimated нутриенты помечаются `≈`; небольшое пояснение: «Часть пищевых данных оценена автоматически.»

Логика preliminary для старых неполных результатов сохранена, но новый completed pipeline заполняет все три критичных фактора, поэтому успешно оценённые продукты в эту ветку не попадают. Частично неизвестные additives/processing не являются блокирующими нутриентами формулы и не заменяются вымышленными фактами.

Изменение касается Product Score. Персональный Goal Match по-прежнему получает точные/enriched данные с прежними проверками; estimates не выдаются его AI-валидатору за прочитанную этикетку. Его итог по-прежнему ограничивается Product Score существующим limitByProductScore.

## Реальная диагностика: Rollton и Choco Pie

Новые вызовы выполнены через собранный ScanService и настроенные OFF/Tavily/Gemini. Профиля пользователя и фото в этих диагностических вызовах нет. Полные этапы, исходные данные, metadata, причины отказов, scoring input и результат находятся в `mvp-nutrition-estimation-evidence.json`. Поисковая выдача может меняться; ниже результаты именно этого прогона.

| Этап | Rollton 4605496000815 | Choco Pie 4607084351385 |
|---|---|---|
| Primary OFF | 350 kcal, P=6 г, C=65 г, F=7,5 г; порция 40 г | около 506,67 kcal, округлено 507; P=4,5 г, C=63 г, F=18 г; порция 30 г |
| Первичные пропуски | sugars, saturatedFat, fiber, salt, sodium | те же; kcal дополнительно проверяется как аномалия относительно БЖУ |
| Enrichment | 8 поисков, 35 кандидатов, 9 прочитанных страниц; 10 credits | 8 поисков, 24 кандидата, 10 прочитанных страниц; 10 credits |
| Принятые дополнения | состав, новых нутриентов нет | calories=433, подтверждённые источниками; другие пропуски остались |
| После enrichment неизвестны | sugars, saturatedFat, fiber, salt, sodium | sugars, saturatedFat, fiber, salt, sodium |
| Estimation context | ready_meal, известные БЖУ, состав, соль на позиции 1 (индекс с нуля) | bakery, БЖУ, сахар на позиции 1, palm oil, соль на позиции 13 |
| Финальный Product Score | **3,2 / 10** | **1,8 / 10** |
| Confidence Score | low | low |
| missingFactors | [] | [] |
| needsPhoto | false | false |

Все значения ниже относятся к 100 г и являются фактическим финальным scoring input:

| Поле | Rollton | Статус/confidence | Choco Pie | Статус/confidence |
|---|---:|---|---:|---|
| Calories kcal | 350 | verified / medium | 433 | verified / medium, web correction |
| Protein g | 6 | verified / medium | 4,5 | verified / medium |
| Carbs g | 65 | verified / medium | 63 | verified / medium |
| Fat g | 7,5 | verified / medium | 18 | verified / medium |
| Sugars g | 3,9 | estimated / low | 28,35 | estimated / low |
| Saturated fat g | 2,25 | estimated / low | 9 | estimated / low |
| Fiber g | 3 | estimated / low | 2 | estimated / low |
| Salt g | 1,5 | estimated / low | 0,5 | estimated / low |
| Sodium mg | 600 | estimated / low, derived from salt | 200 | estimated / low, derived from salt |

В обеих строках constraints=[]: расчётные значения проходят ограничения. Эти estimates не заявляются как реальные данные конкретной упаковки.

Rollton: часть страниц без пригодной таблицы, `barista-ltd.ru` конфликтует с исходной рецептурой, `ru.nutrola.app` содержит подозрительные нули. Эти данные не становятся verified. Пробелы после поиска теперь закрываются общим estimator.

Choco Pie: подтверждённая калорийность 433 принята ДО estimation; исходные P/C/F сохранены. Неподтверждённые значения одного слабого сайта не переводятся в verified. Estimator независимо строит допустимые значения по контексту.

Gemini nutrition_extraction: model=gemini-3.5-flash-lite, prompt=1926, output=93, total=2019; thoughts/cached=null. Дополнительного Gemini-вызова для estimation нет.

## Тесты и проверки

- `pnpm test`: **1164 tests, 0 failures**: API 672, scoring 240, AI 117, nutrition 38, mobile 97. Core contract type tests также прошли.
- Новый `nutrition-estimator.test.ts`: 15 tests, включая полный source-only продукт, enrichment-before-estimation, сохранение точных значений, unknown name + ingredients + partial macros, категории, name-only, неизвестный barcode, salt/sodium, энергетические ограничения, ingredient order, порции, неизвестную основу, округление, 250 макро-контекстов, оба примера и отсутствие product-specific веток в production estimator.
- Старые source acceptance тесты продолжают проверять приём/отказ источников. `source-evidence-view.ts` скрывает из их проверяемого nutrition только estimated поля; score и metadata остаются фактическим финальным API-ответом. Новый estimator suite проверяет completed API без этой проекции.
- `pnpm typecheck`: успешно для всех packages/API/mobile.
- `pnpm --filter @foodlens/api build`: успешно.
- Реальный CLI для двух barcode: exit 0, оба числовых результата выше.
- Lint трёх изменённых UI-файлов: успешно.
- Полный `pnpm --filter @foodlens/mobile lint`: 12 ошибок в неизменённых этой работой `_layout.tsx`, `ProfileProvider.tsx`, `FocusIndicator.tsx`, `useNutritionTargets.ts` (display-name, refs during render, set-state-in-effect). Исправления этих компонентов в задачу не включались.

## Изменённые файлы этой итерации

Production:

1. `apps/api/src/modules/scan/nutrition-estimator.ts` — новый оценщик и ограничения.
2. `apps/api/src/modules/scan/scan.service.ts` — финальный estimation stage, логирование и завершённый статус.
3. `packages/core/src/product/product.ts` — optional nutritionMetadata и контракт происхождения каждого значения.
4. `apps/api/scripts/diagnose-product-pipeline.cjs` — вывод nutritionMetadata для любого barcode из аргументов CLI.
5. `apps/mobile/src/features/product-score/components/ProductScoreCard.tsx` — пояснение estimates у обычного результата.
6. `apps/mobile/src/features/scan/screens/ProductResultScreen.tsx` — передача estimated полей в карточку и таблицу.
7. `apps/mobile/src/features/scan/components/NutritionTable.tsx` — корректное общее пояснение автооценки.

Tests:

8. `apps/api/src/modules/scan/test/nutrition-estimator.test.ts` — новые тесты (описаны выше).
9. `apps/api/src/modules/scan/test/source-evidence-view.ts` — отдельная проекция принятых source values для тестов источников.
10. `apps/api/src/modules/scan/test/google-scan.test.ts` — завершённый Product Score при отсутствии таблицы, прежний Goal Match.
11. `apps/api/src/modules/scan/test/scan-barcode-first.test.ts` — новый контракт estimates/needsPhoto, сохранение неизвестного barcode и отказа чужим рецептурам.
12. `apps/api/src/modules/scan/test/scan-multi-photo.test.ts` — числовой Score после фото; прежние ограничения AI/Goal Match.
13. `apps/api/src/modules/scan/test/scan-multi-source.test.ts` — source evidence и итоговый numeric Score.
14. `apps/api/src/modules/scan/test/scan-open-food-facts.test.ts` — то же для OFF.
15. `apps/api/src/modules/scan/test/scan-single-source.test.ts` — source evidence, metadata и финальный Score.
16. `apps/api/src/modules/scan/test/scan-web-fallback.test.ts` — сохранены проверки совпадений/отказов/лимитов, обновлён конечный API-контракт.
17. `apps/api/src/modules/scan/test/scan.test.ts` — логи присутствия завершённых нутриентов и estimates в API.
18. `apps/api/src/modules/goal-match/test/goal-match-v4.test.ts` — сравнение Product Score с completed входом, тот же Goal Match.
19. `apps/mobile/test/estimated-nutrients.test.cjs` — обычный результат и пояснение автооценки.

Documentation: этот отчёт, JSON evidence, историческая пометка в `universal-pipeline.md`.

Работающий сервер API не перезапускался. Код собран и проверен отдельными процессами. Изменения и предыдущие незакоммиченные файлы оставлены локально на dev; push/commit не выполнялись.
