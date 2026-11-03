# Универсальное исправление профилей соусов и enrichment identity

dev, HEAD 033556fbc2ae35ae10878d9030591d936ac8eb6d. Scoring engine и .env не менялись. Нет условий по бренду/штрихкоду. Ничего не push.

## Код

- nutrition-estimator.ts: context-rules-v3; ketchup/кетчуп/ketçap и tomato ketchup распознаются внутри существующей категории sauce. Отдельные priors ketchup/mayonnaise/mustard/bbq/tomato_sauce/soy_sauce; verified fields не заменяются. Профиль выбирается по общим словам, только если category отсутствует/other/sauce.
- Ketchup priors на100г: protein1, carbs25, fat0.3, sugarShare0.8, saturatedShare0.1, fiber1, salt2.2; kcal выводится по4/4/9. Это общая MVP-оценка, не измеренные данные Heinz.
- product-identity.ts: GTIN-8/UPC/EAN/GTIN-14 сравниваются по14-значной zero-padded форме, с удалением пробелов/дефисов. Другой barcode не даёт равенство. Recipe markers No Sugar/No Sugar Added/Reduced Sugar/Reduced Fat/Zero/Light/Spicy проверяются в обе стороны; прежние flavor/base-variant проверки сохранены.
- gemini-search-lookup.provider.ts: ingredientsSource использует exact_barcode только при barcodeOnPage, полученном из фактического сравнения целевого кода; наличие любого постороннего barcode больше не повышает provenance. Совпадение имени — exact_name, confidence medium; display-only остаётся ingredientsOnly.
- scan.service.ts: forScoring применяется ДО estimation. Показной состав возвращается в API, но в estimation/scoring snapshot не участвует. Сам estimator также игнорирует ingredientsOnly (защита других callers). Scoring и Goal Match используют один completed nutrition snapshot. ConfirmBarcodeIdentity уже строит semantics только по forScoring-продукту; эти сведения не извлекаются из display-only состава.

## Реальный запрос

После сборки и перезапуска основного API: PID34440, http://192.168.31.187:3000, /health={status:ok}. RequestId 6d78ad4f-6c20-4a97-ac13-4dca3c934e87. Настоящий multipart POST /scan/analyze, barcode8696362804671, безфото, HTTP200, **cacheHit:false**. OFF/web/search-memory пусты после запуска процесса; глобальные внешние кэши не удаляли.

Identification: TOMATO KETCHUP / Heinz, OFF exact_barcode. Primary nutrition=null, serving=null, category=null, ingredients=null. Enrichment не принял nutrition ни с одной страницы. Внутренняя estimator category=sauce, profile=ketchup; API product.category остаётся not_detected, поскольку источник категорию не дал (не выдаём inference за verified).

No Sugar Added page отклонена как not_relevant до чтения/merge. Обычная Heinz tomato-ketchup страница другого product code дала состав только для показа: exact_name/medium, ingredientsOnly:true. **Ingredients actually used by estimator=[]**. Таким образом syrup/stevia/salt из непроверенной рецептуры не изменяют priors. Показной состав и его provenance видны в фактическом JSON.

| Поле /100г | Результат | Provenance / confidence |
|---|---:|---|
| kcal |106.7|inferred / estimated low|
| protein |1|inferred / estimated low|
| carbs |25|inferred / estimated low|
| sugars |20|inferred / estimated low|
| fat |0.3|inferred / estimated low|
| saturatedFat |0.03|inferred / estimated low|
| fiber |1|inferred / estimated low|
| salt |2.2|inferred / estimated low|
| sodium mg |880|inferred / estimated low|

Constraints=[]; Product Score3.3/10, Goal Match2.2/10 (eat_healthier/v3), numeric, confidence low; uncertainty sugarSource/processing/typicalServing/nutrition. MissingFactors=[additives], т.е. пропущенных обязательных нутриентов нет. needsPhoto=false в scan_flow; успешный response опускает optional needsPhoto. Gemini не вызывался.

Все source decisions (полные URL, parsed values, barcode/variant flags и scoring input в evidence JSON):

| Domain | Product | Barcode match | Other variant | Nutrition decision |
|---|---|---|---|---|
| hakanitriyat.com | Heinz Ketçap 375 gr | true | false | other: no_per_100_nutrition |
| usmarmarket.com.tr | Heinz Ketçap (375 g) fiyatı - Salça & Sos | true | false | other: no_per_100_nutrition |
| erenlercep.com | HEINZ KETÇAP 375 GR-8696362804671 / Tokat'ın En Hesaplı Sanal Marketi | false | false | other: no_per_100_nutrition |
| bilgemar.com | Heinz Ketçap 310 ml 375 g*10 | true | false | other: no_per_100_nutrition |
| tarifi.ge | კეტჩუპი/ჰაინცი/კლასიკური/375მლ — სპარი / tarifi.ge | true | false | other: no_per_100_nutrition |
| heinz.com | Tomato Ketchup / Heinz | false | false | other: no_per_100_nutrition |
| world.openfoodfacts.org | TOMATO KETCHUP – Heinz | not evaluated | not evaluated | other: not_product_site |
| youtube.com | Heinz Tomato Ketchup Review | not evaluated | not evaluated | other: not_product_site |
| walmart.com | Heinz Tomato Ketchup, Multipack, 3 Pack, 44 oz Bottles - Walmart.com | false | false | other: no_per_100_nutrition |
| express.stopandshop.com | Heinz Tomato Ketchup Same-Day Delivery / Stop & Shop Express | false | false | other: no_per_100_nutrition |
| nal.usda.gov | Nutrients: Sugars, total (g) | not evaluated | not evaluated | other: not_relevant |
| healthline.com | Types of Sugar: 56 Common Ones You Should Know | not evaluated | not evaluated | other: not_relevant |
| extension.rutgers.edu | Added Sugars: Hidden in Plain View / Rutgers Cooperative Extension | not evaluated | not evaluated | other: not_relevant |
| stanfordhealthcare.org | Added Sugars | not evaluated | not evaluated | other: not_relevant |
| nutritionsource.hsph.harvard.edu | Added Sugar • The Nutrition Source | not evaluated | not evaluated | other: not_relevant |
| heart.org | Saturated Fats | not evaluated | not evaluated | other: not_relevant |
| accessdata.fda.gov | Interactive Nutrition Facts Label - Saturated Fat | not evaluated | not evaluated | other: not_relevant |
| news.christianacare.org | Nutrition Numbers Revealed: Fat Intake - ChristianaCare News | not evaluated | not evaluated | other: not_relevant |
| medlineplus.gov | Facts about saturated fats: MedlinePlus Medical Encyclopedia | not evaluated | not evaluated | other: not_relevant |
| mayoclinic.org | Dietary fat: Know which to choose - Mayo Clinic | not evaluated | not evaluated | other: not_relevant |
| amazon.com | Amazon Best Sellers: Best Salt | not evaluated | not evaluated | other: not_relevant |
| recipal.com | Salt, table Nutrition Facts - Find Calories & Macros Per Serving | not evaluated | not evaluated | other: not_relevant |
| discusscooking.com | What's in your salt? / Discuss Cooking - Cooking Forums | not evaluated | not evaluated | other: not_relevant |
| tiktok.com | Osmo Kitchen on TikTok | not evaluated | not evaluated | other: not_product_site |
| diamondcrystalsalt.com | Where to buy Diamond Crystal® Salt / Diamond Crystal® Salt | not evaluated | not evaluated | other: not_relevant |
| caloriecontrol.org | Food Calorie Calculator: Track Your Daily Intake - Calorie Control Council | not evaluated | not evaluated | other: not_relevant |
| mcdonalds.com | Nutrition Calculator: Macros, Calorie Tracker & More / McDonald’s | not evaluated | not evaluated | other: not_relevant |
| calories.info | Calories for Thousands of Foods: Your Calorie Chart Database | not evaluated | not evaluated | other: not_relevant |
| 49fss.com | [PDF] NUTRITION FACTS SHEET - public (1).xlsx | not evaluated | not evaluated | other: not_relevant |
| il-ru.openfoodfacts.org | TOMATO KETCHUP – Heinz | not evaluated | not evaluated | other: not_product_site |
| tools.myfooddata.com | Nutrition Facts for  Heinz - Tomato Ketchup | not evaluated | not evaluated | inaccessible: Page fetch: http_error |
| eatthismuch.com | 1 Tbsp Of Heinz Tomato Ketchup Nutrition Facts - Eat This Much | false | false | other: too_few_macros_on_page |
| giantfood.com | Heinz Tomato Ketchup / Giant Food | not evaluated | not evaluated | other: not_selected |
| heinz.com | Tomato Ketchup / Heinz | false | false | other: no_reference_without_barcode |
| tools.myfooddata.com | Nutrition Facts for Heinz, Tomato Ketchup | not evaluated | not evaluated | other: not_selected |
| calorieking.com | Calories in Heinz Tomato Ketchup / CalorieKing | not evaluated | not evaluated | other: not_selected |
| heinz.com | Tomato Ketchup with No Sugar Added / Heinz | not evaluated | not evaluated | other: not_relevant |
| fairwaymarket.com | Heinz Tomato Ketchup, 32 oz Bottle - Fairway | not evaluated | not evaluated | other: not_selected |

## Проверки

Полный pnpm test, pnpm typecheck, API build. API suite после последних regression additions:745/745. Новые tests включают: bilingual ketchup classification;6разных sauce profiles; GTIN equivalence;wrong barcode; exact barcode; matching/no matching recipe variants; ingredientsOnly независимо от sugar/salt; интеграционные WebLookup проверки provenance и rejection No Sugar Added; защита exact values и finite scores для noodles/puree/FAGE Total0%/AlpenGold/mayonnaise. Последние пять новых checks — fixtures, не выдаются за реальные HTTP сканы этих продуктов. Прежние scenario suites проекта также запущены.

## Файлы этой задачи

1. apps/api/src/modules/scan/nutrition-estimator.ts
2. apps/api/src/modules/scan/scan.service.ts
3. apps/api/src/modules/product-lookup/web/product-identity.ts
4. apps/api/src/modules/product-lookup/gemini-search-lookup.provider.ts
5. apps/api/src/modules/scan/test/ketchup-regressions.test.ts (новый)
6. apps/api/src/modules/product-lookup/test/web-search.test.ts
7. docs/diagnostics/ketchup-universal-fix.md
8. docs/diagnostics/ketchup-fix-evidence.json
9. docs/diagnostics/heinz-ketchup-fixed-response.json

Другие существующие изменения рабочего дерева не откатывались. API оставлен работающим для телефона. Ничего не push.
