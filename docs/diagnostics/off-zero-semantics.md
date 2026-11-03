# Open Food Facts: когда 0 значит настоящий ноль

Дата: 1 ноября 2026. Запросов к OFF, Gemini и Tavily для этой работы не было. Формула Product Score не менялась, C(−8) не применён. Commit и push не делались, `.env` не менялся.

## Вывод

- Правило реализовано в `open-food-facts.mapper.ts`: ноль считается настоящим, только если значение пришло из данных производителя или упаковки и без пометок. Иначе это `null`.
- **Проверить 11 из 13 реальных продуктов локально нельзя.** Бенчмарк брал устаревшие поля поиска v2, где источника нет. Для точного ответа нужно 11 запросов к OFF v3.6. Я их не делал.
- C(−8) выполняет ваше условие в обоих режимах: нули 17 → 0, оценки ≤ 2: 27 → 14, нарушенные пары 2 → 0. Но очистка данных пока неполная: 7 из 13 реальных продуктов проверить не удалось.
- Строгий режим грубый: он убирает и Coca-Cola, где нули наверняка настоящие. Причина в нехватке данных снимка, а не в качестве продукта.

## 1. Какие поля OFF что показывают

Проверено на локальном ответе v3.6 `off-sample.json`, двух сырых записях v2 и нашем маппере.

| Поле | Формат | Что показывает | Надёжность |
|---|---|---|---|
| `nutrition.aggregated_set.nutrients.<n>.source` | v3.6 | откуда значение: `manufacturer`, `packaging`, `estimate` | высокая, главный сигнал |
| `...<n>.modifier` | v3.6 | `~` оценка; другие значения тоже означают неточность | высокая |
| `input_sets[].nutrients.<n>.value_string` | v3.6 | что реально введено в набор | высокая, но нужна только для разбора |
| `<n>_modifier` | v2 | пометка значения, например `~` | средняя |
| `<n>_value` | v2 | значение было введено | средняя, источника не даёт |
| `nutriments_estimated` | v2 | отдельный набор оценок | полезен, но есть не у всех записей |
| `nutrition_data` | v2 | `on` значит только, что таблица включена | низкая |
| `states_tags` | обе | `en:nutrition-facts-completed` описывает запись целиком | низкая: не отвечает за отдельное поле |

`no_nutrition_data`, `data_quality_*_tags`, `nutrient_levels` и `misc_tags` в локальных данных отсутствуют или не запрашивались, поэтому я на них не опираюсь и их надёжность не оцениваю.

Пример из Nutella: `fiber` равна 0 с `source: packaging` и `value_string: "0"`, а 49 других значений это `estimate`.

**Предел правила.** Если участник вручную ввёл 0 вместо пустого поля, источник будет `packaging`. Поля OFF этого не показывают. Поэтому `sugars 0` при углеводах 8 может сохраниться даже после проверки. Угадывать значения по углеводам я не стал: это эвристика, а не данные.

## 2. Правило

Для sugars, saturatedFat, salt, sodium, fiber и protein значение `0` принимается, только если одновременно:

1. `source` равен `manufacturer` или `packaging`.
2. `modifier` отсутствует.

Иначе поле становится `null`. Значения выше нуля правило не меняет, оценки по-прежнему отбрасываются.

Если соль стала `null`, но есть подтверждённый натрий, соль считается существующим правилом как раньше. Выведенное значение не становится подтверждённым нулём.

Если `sugars`, `saturatedFat` или `salt` стали `null`, Product Score честно не считается (`too_few_factors`), а скан может запросить фото.

## 3. Что изменено

- `apps/api/src/modules/product-lookup/open-food-facts.mapper.ts`: правило нуля.
- `apps/api/src/modules/product-lookup/test/open-food-facts.test.ts`: тесты для sugars, saturatedFat, salt, fiber, protein.
- `packages/scoring/src/test/benchmark/`: снимок читается в двух режимах, отчёт и тесты режимов.

Запущенный API ещё со старым маппером: его нужно пересобрать перед следующим сканом. Я его не перезапускал.

## 4. Benchmark после нормализации

- **Как есть:** значения снимка без изменений.
- **Строго:** неподтверждённые нули становятся `null`.

Режимы отличаются только для 13 реальных продуктов. Типичные значения и Roshen не менялись.

| Набор | Вариант | Без оценки | С оценкой | =0 | ≤1 | ≤2 | ≥9 | Среднее |
|---|---|---|---|---|---|---|---|---|
| Все 72, как есть | Текущая | 0 | 72 | 17 | 25 | 27 | 1 | 4.01 |
| Все 72, как есть | C(−8) | 0 | 72 | 0 | 5 | 14 | 1 | 4.77 |
| Все 72, строго | Текущая | 7 | 65 | 17 | 25 | 27 | 1 | 3.87 |
| Все 72, строго | C(−8) | 7 | 65 | 0 | 5 | 14 | 1 | 4.67 |
| 13 OFF, как есть | Текущая | 0 | 13 | 2 | 2 | 2 | 0 | 4.82 |
| 13 OFF, как есть | C(−8) | 0 | 13 | 0 | 0 | 1 | 0 | 5.32 |
| 13 OFF, строго | Текущая | 7 | 6 | 2 | 2 | 2 | 0 | 4.27 |
| 13 OFF, строго | C(−8) | 7 | 6 | 0 | 0 | 1 | 0 | 4.97 |

Нарушенные пары порядка:

| Режим | Текущая | C(−8) |
|---|---|---|
| Как есть | 2 из 34 | 0 из 34 |
| Строго | 2 из 29 | 0 из 29 |

## 5. Контрольные продукты

| Продукт | Неподтверждённые нули | Как есть | C(−8) | Строго | Строго C(−8) |
|---|---|---|---|---|---|
| Perly | fiber, saturatedFat, salt | 8.1 | 8.1 | нет оценки | нет оценки |
| Coca-Cola без сахара | protein, fiber, sugars, saturatedFat | 6.0 | 6.0 | нет оценки | нет оценки |
| Сардины | sugars | 4.9 | 4.9 | нет оценки | нет оценки |
| Миндаль | нет | 5.1 | 5.1 | 5.1 | 5.1 |
| Knacki | нет | 0.0 | 2.4 | 0.0 | 2.4 |
| Песто | нет | 0.0 | 1.8 | 0.0 | 1.8 |
| Чипсы, типичные | не из OFF | 0.7 | 2.9 | 0.7 | 2.9 |
| Roshen | нет | 0.0 | 0.9 | 0.0 | 0.9 |
| Snickers, типичный | не из OFF | 0.0 | 0.8 | 0.0 | 0.8 |

Остальные продукты без оценки в строгом режиме: Coca-Cola Original, Le nature, Jben, Cruesly. Значит, спорные высокие оценки Perly и Le nature действительно опирались на неподтверждённые нули.

## 6. Что нужно дальше

Точный ответ дадут 11 запросов `GET https://world.openfoodfacts.org/api/v3.6/product/<barcode>.json`, без AI, с паузой не меньше 5 секунд. Нужен именно v3.6, потому что `api/v2/product` не даёт `source`. Штрихкоды:

5449000054227, 5449000214799, 6111242100206, 6111242106949, 3760049790214, 3168930010265, 7300400481595, 8076809513753, 20724696, 6111242100992, 3019081238643.

Тесты: `pnpm typecheck` прошёл, `pnpm test`: 751 из 751.

## Дополнение: проверка по OFF v3.6

Сделано ровно 11 запросов `GET` к OFF v3.6, все успешны, повторов не было. Gemini и Tavily не использовались. Формула не менялась. Commit и push не делались.

### Вывод

**C(−8) применять можно: ваше условие выполнено.** После очистки нули 17 → 0, оценки ≤ 2: 27 → 14, нарушенные пары 2 → 0. Но очистка данных почти ничего не изменила, и C(−8) не исправит две настоящие проблемы:

1. **Подозрительные нули OFF прошли проверку.** Все они помечены `packaging`, то есть выглядят как значения с упаковки.
2. **Новая находка важнее нулей:** напитки OFF часто приходят на `100g`, поэтому наш код считает их едой. Coca-Cola при реальном скане получит **5.8 вместо 2.2**.

Рекомендую применить C(−8) и сразу исправить основу напитков. Второе важнее для демо.

### Что показала проверка нулей

| Показатель | Значение |
|---|---|
| Нулей в проверенных полях | 24 |
| Подтверждены по правилу | 23 |
| Стали `null` | 1: клетчатка сардин, `estimate ~` |
| Натрий с `~` стал `null` | 3: Wasa, песто, сардины, соль при этом есть |

Остальные оценки не изменились. Единственное изменение значения, клетчатка сардин, в снимке и так было пустым.

**Предел правила подтвердился.** Поля `source` недостаточно: `Le nature` с сахарами 0 и `Perly` с солью 0 это `packaging`. Для них OFF сам считает оценку, которая противоречит нулю:

| Продукт | Поле | Значение `packaging` | Оценка OFF |
|---|---|---|---|
| Le nature | sugars | 0 | 4.93 |
| Le nature | salt | 0 | 0.11 |
| Perly | salt | 0 | 0.065 |
| Perly | saturatedFat | 0 | 14.36 |

Правило «ноль `packaging` не принимается, если своя оценка OFF заметно выше» опирается на данные OFF, а не на догадку. Но порог пришлось бы выбирать, а оценка OFF сама бывает неточной: 14.36 г насыщенных жиров для молочного десерта на 97 ккал невозможны. Поэтому я его не применял, это решение за вами. У Cruesly и Coca-Cola такой оценки нет, и проверить их так нельзя.

### Основа напитков

| Основа | Score Coca-Cola | Штрафы |
|---|---|---|
| `per_100ml`, как в бенчмарке | 2.2 | sugars −4.63, additives −1.2 |
| `per_100g`, как придёт из OFF | 5.8 | sugars −0.96, additives −1.2 |

Маппер берёт основу из `aggregated_set.per`, и у Coca-Cola там `100g`. Бенчмарк считал напитки `ml` по своей категории, поэтому эта разница была скрыта. В реальном скане cola получит оценку выше, чем пицца, чипсы и хлопья. Это не связано с C(−8) и не исправлено.

### Benchmark

Цифры после нормализации совпали со снимком:

| Набор | Вариант | Без оценки | =0 | ≤1 | ≤2 | ≥9 | Среднее | Нарушено пар |
|---|---|---|---|---|---|---|---|---|
| Все 72 | Текущая | 0 | 17 | 25 | 27 | 1 | 4.01 | 2 из 34 |
| Все 72 | C(−8) | 0 | 0 | 5 | 14 | 1 | 4.77 | 0 из 34 |
| 13 OFF | Текущая | 0 | 2 | 2 | 2 | 0 | 4.82 | — |
| 13 OFF | C(−8) | 0 | 0 | 0 | 1 | 0 | 5.32 | — |

Значения Активии и Knacki остались из первого снимка: их в этих 11 запросах не было. Значения Roshen, чипсов и Snickers в бенчмарке не менялись.

| Продукт | Текущая | C(−8) | Замечание |
|---|---|---|---|
| Perly | 8.1 | 8.1 | salt и saturatedFat 0, `packaging`; оценка OFF не согласна |
| Coca-Cola Zero | 6.0 | 6.0 | в реальном скане основа `100g` |
| Сардины | 4.9 | 4.9 | клетчатка `null` |
| Le nature | 7.2 | 7.2 | sugars и salt 0, `packaging`; оценка OFF не согласна |
| Cruesly | 6.2 | 6.2 | salt 0, `packaging` |
| Knacki | 0.0 | 2.4 | — |
| Песто | 0.0 | 1.8 | — |
| Roshen | 0.0 | 0.9 | — |
| Snickers, типичный | 0.0 | 0.8 | — |
| Чипсы, типичные | 0.7 | 2.9 | — |
| Миндаль | 5.1 | 5.1 | — |

### Другое

Модификатор `<` для ненулевых значений (Wasa: sugars `<1`, saturatedFat `<0.4`) сейчас даёт верхнюю границу. Это безопасно для штрафа, поэтому правило его не меняет.

Сырая `nutrition` v3.6 по 11 продуктам с URL, временем и версией API хранится в `off-products.snapshot.json`.

API пересобран с новым маппером и перезапущен: процесс проверен перед остановкой, настройки только для процесса, слушает `0.0.0.0:3000`, `/health` отвечает. Metro, Docker и Postgres не трогал.

`pnpm typecheck` прошёл, `pnpm test`: 751 из 751.

### Все поля

| Продукт | Поле | Значение | source | modifier | Ноль подтверждён | Стало null |
|---|---|---|---|---|---|---|
| Coca-Cola Original Taste | sugars | 10.6 g | packaging | — | — | нет |
| Coca-Cola Original Taste | saturatedFat | 0 g | packaging | — | да | нет |
| Coca-Cola Original Taste | salt | 0 g | packaging | — | да | нет |
| Coca-Cola Original Taste | sodium | 0 g | packaging | — | да | нет |
| Coca-Cola Original Taste | fiber | 0 g | packaging | — | да | нет |
| Coca-Cola Original Taste | protein | 0 g | packaging | — | да | нет |
| Coca-Cola sans sucres | sugars | 0 g | packaging | — | да | нет |
| Coca-Cola sans sucres | saturatedFat | 0 g | packaging | — | да | нет |
| Coca-Cola sans sucres | salt | 0.01 g | packaging | — | — | нет |
| Coca-Cola sans sucres | sodium | 0 g | packaging | — | да | нет |
| Coca-Cola sans sucres | fiber | 0 g | packaging | — | да | нет |
| Coca-Cola sans sucres | protein | 0 g | packaging | — | да | нет |
| Le nature | sugars | 0 g | packaging | — | да | нет |
| Le nature | saturatedFat | 2.4 g | packaging | — | — | нет |
| Le nature | salt | 0 g | packaging | — | да | нет |
| Le nature | sodium | 0 g | packaging | — | да | нет |
| Le nature | fiber | 0 g | packaging | — | да | нет |
| Le nature | protein | 4.2 g | packaging | — | — | нет |
| Jben | sugars | 0 g | packaging | — | да | нет |
| Jben | saturatedFat | 15 g | packaging | — | — | нет |
| Jben | salt | 0.46 g | packaging | — | — | нет |
| Jben | sodium | 0.184 g | packaging | — | — | нет |
| Jben | fiber | 0 g | packaging | — | да | нет |
| Jben | protein | 8 g | packaging | — | — | нет |
| Pain De Mie Bio | sugars | 6.3 g | packaging | — | — | нет |
| Pain De Mie Bio | saturatedFat | 0.4 g | packaging | — | — | нет |
| Pain De Mie Bio | salt | 1.1 g | packaging | — | — | нет |
| Pain De Mie Bio | sodium | 0.44 g | packaging | — | — | нет |
| Pain De Mie Bio | fiber | 4.9 g | packaging | — | — | нет |
| Pain De Mie Bio | protein | 8.1 g | packaging | — | — | нет |
| cruesly mélange de noix | sugars | 12 g | packaging | — | — | нет |
| cruesly mélange de noix | saturatedFat | 2 g | packaging | — | — | нет |
| cruesly mélange de noix | salt | 0 g | packaging | — | да | нет |
| cruesly mélange de noix | sodium | 0 g | packaging | — | да | нет |
| cruesly mélange de noix | fiber | 10 g | packaging | — | — | нет |
| cruesly mélange de noix | protein | 8.5 g | packaging | — | — | нет |
| AUTHENTIQUE | sugars | 1 g | manufacturer | < | — | нет |
| AUTHENTIQUE | saturatedFat | 0.4 g | manufacturer | < | — | нет |
| AUTHENTIQUE | salt | 1 g | manufacturer | — | — | нет |
| AUTHENTIQUE | sodium | 0.4 g | manufacturer | ~ | — | да |
| AUTHENTIQUE | fiber | 19 g | manufacturer | — | — | нет |
| AUTHENTIQUE | protein | 9 g | manufacturer | — | — | нет |
| Barilla PESTO alla GENOVESE | sugars | 5 g | manufacturer | — | — | нет |
| Barilla PESTO alla GENOVESE | saturatedFat | 5.3 g | manufacturer | — | — | нет |
| Barilla PESTO alla GENOVESE | salt | 3.2 g | manufacturer | — | — | нет |
| Barilla PESTO alla GENOVESE | sodium | 1.28 g | manufacturer | ~ | — | да |
| Barilla PESTO alla GENOVESE | fiber | 3 g | manufacturer | — | — | нет |
| Barilla PESTO alla GENOVESE | protein | 4.7 g | manufacturer | — | — | нет |
| Amandes décortiquées | sugars | 4.8 g | packaging | — | — | нет |
| Amandes décortiquées | saturatedFat | 4.3 g | packaging | — | — | нет |
| Amandes décortiquées | salt | 0.01 g | packaging | — | — | нет |
| Amandes décortiquées | sodium | 0.004 g | packaging | — | — | нет |
| Amandes décortiquées | fiber | 12.1 g | packaging | — | — | нет |
| Amandes décortiquées | protein | 24.5 g | packaging | — | — | нет |
| Perly | sugars | 9.4 g | packaging | — | — | нет |
| Perly | saturatedFat | 0 g | packaging | — | да | нет |
| Perly | salt | 0 g | packaging | — | да | нет |
| Perly | sodium | 0 g | packaging | — | да | нет |
| Perly | fiber | 0 g | packaging | — | да | нет |
| Perly | protein | 8 g | packaging | — | — | нет |
| Sardines Huile d'Olive Vierge Extra | sugars | 0 g | packaging | — | да | нет |
| Sardines Huile d'Olive Vierge Extra | saturatedFat | 3.5 g | packaging | — | — | нет |
| Sardines Huile d'Olive Vierge Extra | salt | 1.2 g | packaging | — | — | нет |
| Sardines Huile d'Olive Vierge Extra | sodium | 0.48 g | packaging | ~ | — | да |
| Sardines Huile d'Olive Vierge Extra | fiber | 0 g | estimate | ~ | нет | да |
| Sardines Huile d'Olive Vierge Extra | protein | 23 g | packaging | — | — | нет |
