# FoodLens: исправление ingredient matching и sugar estimates

3 ноября 2026. Ветка dev. Версия estimator: context-rules-v2. Формулы Product Score и Goal Match не менялись. Push/commit не выполнялись.

## Исправление

Ingredient keywords теперь сопоставляются с целыми Unicode-токенами после NFKC normalization, lower-case и ё→е. Используется `[\p{L}\p{M}]+` и полностью ограниченные keyword patterns. «мед», «мёд», допустимые формы меда/меду/медом распознаются. Камедь, медовый и honeycomb не становятся ингредиентом honey. ASCII `\b` для кириллицы не используется.

Разбор состава сохраняет иерархию круглых и квадратных скобок. Top-level sugar signals отделены от nested. Сахар внутри приправы/соуса не наследует позицию компонента в целом. Поддерживаются несколько уровней вложенности, грубые OCR-строки с несколькими компонентами и незакрытая скобка: её содержимое остаётся nested.

Высокие sugar estimates сохранены для chocolate/sweets/bakery/beverage/juice/dairy/yogurt/fruit. В остальных категориях позиционное повышение ограничено category-aware cap. Исключение — явно самостоятельный первичный сахарный ингредиент: сахар, натуральный мёд, тростниковый сахар, corn syrup и т.п. «Соус с сахаром» или «приправа (сахар, ...)» сами не дают это исключение.

```text
positional = 0.65 (позиция 0), 0.45 (позиции 1–2), 0.20 (позже), 0 (нет top-level сигнала)
proposed = max(category prior, positional, применимый сладкой категории semantic floor)
categoryCap = 1 для сладкой категории или сильного primary sugar
              иначе max(prior, min(0.20, 2 × prior))
share = min(proposed, categoryCap)
sugars = clamp(carbs × share, 0, carbs)
```

Для ready_meal prior=0.06, обычный cap=0.12. При отсутствии top-level сахара сохраняется 0.06, даже если сахар упомянут внутри вторичного компонента. Явный самостоятельный сахар первым ингредиентом может дать 0.65 как сильное подтверждение. Это общие категорийные правила, без barcode/brand/name exceptions.

Metadata reason сохраняет top-level position, nested count, share/cap/capped. Существующие точные значения сохраняются; set заполняет только null. Estimates остаются inferred/estimated с low confidence.

## Аудит matchers

| Группа | Результат |
|---|---|
| sugar/honey/syrup/glucose/fructose/maltose | Полные токены, контролируемые формы/plurals; нет камедь/медовый/honeycomb/glucosamine/fructooligosaccharides false positives |
| starch/flour/maltodextrin | Крахмал, мука, мальтодекстрин, carbohydrates и flavoring не создают сахарный сигнал |
| сахарный колер | Прилагательное сахарный не выдаётся за самостоятельный сахар |
| fiber | whole grain/bran/oat/oatmeal, цельнозерновые, отруби, овсяные и бобовые сохранены; brandy/goat не совпадают с bran/oat |
| salt | Целые salt/соль/соли/солью; солист/saltwater не совпадают; позиция считается на top level |
| saturated fat | palm/coconut/butter и точные русские формы; нет butternut/butterfly/palmaria false positives |
| unsaturated fat | sunflower/olive и русские формы; olivewood не совпадает |
| sweetener | Целые sucralose/stevia/подсластитель и т.п.; более длинный произвольный токен не совпадает |

FOOD_TYPES используются для названия категории, а не ингредиентов. Их классификационная политика в этой работе не менялась.

## Реальный HTTP: лапша 4605496016700

Основной API перезапущен после успешных test/typecheck/build: PID 13068, порт 3000, адрес телефона http://192.168.31.187:3000. .env не менялся. Первый запрос этого barcode в новом процессе: настоящий POST /scan/analyze с multipart barcode=4605496016700, без фото. HTTP 200, **cacheHit:false**; requestId 42a55c95-3b46-41b9-b218-c1776d061253.

Source category.value=null; выбран ready_meal по общему слову «лапш» в названии. Primary/enrichment не дали sugars, поэтому использован обычный estimator.

Состав из фактического ответа, без редактирования:

```json
{
  "value": [
    {
      "name": "Лапша (мука пшеничная в/с., масло растительное, крахмал кукурузный и тапиоковый, вода питьевая, соль, яичный порошок, загуститель (гуаровая камедь), стабилизатор (карбонат калия). разрыхлитель (сода пищевая), регулятор кислотности (лимонная кислота), усилитель вкуса и аромата (Е621))",
      "percent": null
    },
    {
      "name": "бульон-приправа (соль, мальтодекстрин, усилители вкуса и аромата (Е621, Е635), крахмал кукурузный, ароматизаторы, сушеные овощи и зелень (чеснок, лук репчатый, томаты, петрушка), сахар, пряности (перец красный, перец черный, куркума, перец душистый, кориандр), экстракт дрожжей, мясо говядины сушеное, масло растительное, красители (сахарный колер IV, экстракт паприки), агент антислеживающий (2551))",
      "percent": null
    },
    {
      "name": "овощи сушеные (соевый текстурат, кукуруза, морковь, лук зеленый). Продукт может содержать незначительное количество продуктов переработки молока. Хранить при температуре не выше 30°С и относительной влажности воздуха не более 75% изготовителя",
      "percent": null
    },
    {
      "name": "номер смены дата ЛеНИЯ",
      "percent": null
    }
  ],
  "provenance": "open_food_facts"
}
```

Detected signals:

```json
{
  "topLevelSugars": [],
  "nestedSugars": [
    {
      "componentIndex": 1,
      "ingredient": "сахар",
      "matchedTokens": [
        "сахар"
      ]
    }
  ],
  "strongTopLevelSugar": false,
  "sugarPosition": -1,
  "saltPosition": -1,
  "hasSaturatedFat": false,
  "hasUnsaturatedFat": false,
  "hasFiber": false,
  "sweetenerOnly": false
}
```

Камедь больше не сигнал honey. Настоящий сахар распознан только во втором компоненте — бульоне-приправе; сахарный колер не становится отдельным sugar keyword.

| Величина | До | После |
|---|---:|---:|
| carbs, г/100 г (точные) | 56 | 56 |
| sugar position | 0, ложный мед в камеди | -1 top level; 1 nested сигнал |
| коэффициент | 0.65 | **0.06** |
| sugars estimate, г/100 г | 36.4 | **3.36** |
| salt estimate, г/100 г | 1.5 | **1.1** |
| Product Score | 1.3 | **2.6** |
| Goal Match | 1.3 | **2.6** |

Результат общей логики: 56×0.06=3.36. Желаемое значение под товар не подставлялось.

Соль также уточнилась общей логикой вложенности: раньше соль внутри первого компонента считалась первым ингредиентом всего продукта. Теперь top-level saltPosition=-1 и применяется prior 1.1. Изменение оценок связано с уточнением обоих сигналов; scoring coefficients не менялись. Saturated fat=5.1, fiber=3, sodium=440 после пересчёта из соли. Точные kcal/P/C/F сохранены.

Metadata сахара: estimated/low; basis=per_100g; constraints=[]. Обе оценки numeric; Goal Match state=goal_match, unavailableReason=null. Точный JSON сохранён в sugar-fix-noodles-http.json.

## Сравнение продуктов

Сахар на 100 г или 100 мл. Первые четыре строки — реальные HTTP-вызовы основного API, каждый cacheHit:false. Apple/yogurt/cola — явно обозначенные существующие фикстуры проекта с тестовым eat_healthier профилем (2000 kcal, protein target 139 г). Они прогнаны через old/new estimator и неизменённые scoring functions; это не реальные сканы упаковок.

| Product | Sugars | Product Score | Goal Match | Режим |
|---|---:|---:|---:|---|
| Лапша с говядиной | 3.36 (estimated) | 2.6 | 2.6 | HTTP, cacheHit=false |
| Choco Pie | 28.35 (estimated) | 1.8 | 1.8 | HTTP, cacheHit=false |
| Alpen Gold арахис/хлопья | 48 (estimated) | 2.3 | — (ambiguous) | HTTP, cacheHit=false |
| Alpen Gold арахис/крекер | 52 (verified) | 2.3 | 1.5 | HTTP, cacheHit=false |
| apple | 10.4 (verified в фикстуре) | 7.1 | 7.1 | Фикстура, без изменений |
| yogurt | 3.6 (verified в фикстуре) | 9.4 | 8.7 | Фикстура, без изменений |
| cola | 10.6 (verified в фикстуре) | 3 | 2.5 | Фикстура, без изменений |

Choco Pie и оба Alpen Gold дополнительно вызваны реальным HTTP ДО перезапуска. Sugar value/quality, Product Score и Goal Match совпали с ответами ПОСЛЕ исправления. Замороженные контрольные входы apple/yogurt/cola также дали одинаковый результат до/после.

По уточнению пользователя проверены два арахисных варианта: арахис/кукурузные хлопья 7622201696078 ([карточка товара](https://gastronom-rnd.ru/katalog/konditerskiy-otdel/shokolad-i-plitki/shokoladalpengold-molochnyyarahiskukuruznyehlopya80g)) и солёный арахис/крекер 7622201696313 ([идентификация варианта](https://sostavista.ru/tovar/alpen-gold-shokolad-molochnyi-alpen-gold-s-solenym-arahisom-i-krekerom-8)). Числа таблицы взяты из FoodLens HTTP response, не из этих страниц. Barcode упаковки пользователя не сообщён; точное совпадение с одним из вариантов не утверждается.

У версии с хлопьями Goal Match был и остался ambiguous: источники не дали состава и надёжного semantic context. Это прежняя неопределённость sugarSource/processing, не результат исправления. Формула не ослаблялась, semantic facts не выдумывались. У варианта с крекером sugars=52 — verified OFF value, сохранён без изменений.

## Проверки

- pnpm test: **1213 tests, 0 failures**; API 721, scoring 240, AI 117, nutrition 38, mobile 97; core contract checks также прошли.
- 38 новых регрессионных случаев: мед/мёд, substring collisions, nested sugar/honey, вложенные/незакрытые скобки, грубая OCR-строка, strong primary sugar, savory caps, сладкие категории, жиры/клетчатка/соль/подсластители, sugar<=carbs, защита существующих exact/inferred values, отсутствие конкретных barcode/brand в production.
- Typecheck и API build: успешно.
- Реальные HTTP 200/cacheHit:false для лапши, Choco Pie и обоих Alpen Gold.
- Реальные GoalMatchCard/labels проверены на JSON лапши, Choco Pie и Alpen Gold с крекером (stub native primitives, не физический экран телефона): числа и причины отображаются.
- API оставлен работающим для нового скана с телефона.

## Изменённые файлы

- apps/api/src/modules/scan/nutrition-ingredient-signals.ts — новый разбор tokens/components, signals и category cap.
- apps/api/src/modules/scan/nutrition-estimator.ts — подключение signals/caps вместо substring regex; context-rules-v2 и диагностические reasons.
- apps/api/src/modules/scan/test/nutrition-ingredient-signals.test.ts — регрессии.
- docs/diagnostics/sugar-estimation-fix.md — этот отчёт.
- docs/diagnostics/sugar-estimation-fix-evidence.json — до/после, signals, события HTTP и controls.
- docs/diagnostics/sugar-fix-noodles-http.json — фактическое тело ответа лапши.

Другие production source files, scoring formulas, зависимости, .env и mobile source code не менялись. Ничего не push.
