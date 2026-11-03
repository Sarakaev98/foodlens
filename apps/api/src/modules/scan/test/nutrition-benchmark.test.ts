import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NUTRIENT_KEYS, NOT_DETECTED, observed, type NutrientKey, type NutritionFacts, type Product, type ProductCategory } from '@foodlens/core';
import { scoreProduct } from '@foodlens/scoring';
import { emptyBarcodeProduct } from '../barcode-product';
import { estimateMissingNutrition, estimatedNutritionFields, nutritionEstimationProfile } from '../nutrition-estimator';
import { analyzeNutritionIngredients } from '../nutrition-ingredient-signals';

type Range = readonly [min: number, max: number];
type Ranges = Partial<Record<NutrientKey, Range>>;

const food = (name: string, category: ProductCategory | null = null, extra: Partial<Product> = {}): Product =>
  ({ ...emptyBarcodeProduct('1234567890128'), name: observed(name), category: category ? observed(category) : NOT_DETECTED, ...extra });
const label = (values: Partial<Record<NutrientKey, number>>): NutritionFacts =>
  ({ basis: 'per_100g', servingSize: NOT_DETECTED, ...Object.fromEntries(NUTRIENT_KEYS.map(key => [key, values[key] === undefined ? NOT_DETECTED : observed(values[key]!)])) }) as NutritionFacts;

/** Name-only estimates per 100 g/ml must stay inside a realistic range for the food, not hit one exact number. */
const BENCHMARK: readonly { name: string; category?: ProductCategory; subtype: string; ranges: Ranges }[] = [
  { name: 'Вода питьевая', subtype: 'water', ranges: { caloriesKcal: [0, 5], sugarsG: [0, 1], fatG: [0, 0.5] } },
  { name: 'Яблоко', category: 'fruit', subtype: 'fruit', ranges: { caloriesKcal: [30, 80], fatG: [0, 3], sugarsG: [5, 15] } },
  { name: 'Бананы', subtype: 'fruit', ranges: { caloriesKcal: [30, 110], fatG: [0, 3] } },
  { name: 'Овсяные хлопья', subtype: 'oats', ranges: { caloriesKcal: [330, 420], proteinG: [9, 17], fiberG: [6, 15], sugarsG: [0, 5] } },
  { name: 'Греческий йогурт 2%', subtype: 'greek_yogurt', ranges: { caloriesKcal: [50, 130], proteinG: [7, 12], sugarsG: [0, 6] } },
  { name: 'Йогурт клубника', subtype: 'sweet_yogurt', ranges: { caloriesKcal: [70, 130], sugarsG: [7, 16] } },
  { name: 'Молоко 3,2%', subtype: 'milk', ranges: { caloriesKcal: [40, 75], proteinG: [2.5, 4], fatG: [0, 5], sugarsG: [3, 6] } },
  { name: 'Овсяное молоко', subtype: 'plant_milk', ranges: { caloriesKcal: [30, 70], proteinG: [0, 4], fatG: [0, 4] } },
  { name: 'Хлеб пшеничный', subtype: 'bread', ranges: { caloriesKcal: [200, 300], fatG: [0, 8], sugarsG: [0, 8] } },
  { name: 'Торт медовик', subtype: 'cake', ranges: { caloriesKcal: [330, 480], sugarsG: [20, 45] } },
  { name: 'Молочный шоколад', subtype: 'chocolate', ranges: { caloriesKcal: [480, 600], sugarsG: [30, 60], fatG: [25, 40] } },
  { name: 'Печенье сахарное', subtype: 'cookies', ranges: { caloriesKcal: [400, 520], sugarsG: [15, 40] } },
  { name: 'Чипсы картофельные', subtype: 'chips', ranges: { caloriesKcal: [450, 580], fatG: [20, 38], sugarsG: [0, 10] } },
  { name: 'Крекер солёный', subtype: 'crackers', ranges: { caloriesKcal: [400, 480], sugarsG: [0, 15] } },
  { name: 'Лапша быстрого приготовления со вкусом курицы', subtype: 'instant_noodles', ranges: { caloriesKcal: [400, 520], saltG: [1.5, 5] } },
  { name: 'Макароны спагетти', subtype: 'pasta', ranges: { caloriesKcal: [330, 380], fatG: [0, 5], sugarsG: [0, 5] } },
  { name: 'Кетчуп томатный', subtype: 'ketchup', ranges: { caloriesKcal: [80, 140], proteinG: [0, 3], fatG: [0, 5], sugarsG: [10, 25] } },
  { name: 'Passata Rustica', category: 'sauce', subtype: 'passata', ranges: { caloriesKcal: [15, 60], fatG: [0, 2], saltG: [0, 1.5], proteinG: [0, 3] } },
  { name: 'Майонез Провансаль 67%', subtype: 'mayonnaise', ranges: { caloriesKcal: [550, 720], fatG: [55, 80] } },
  { name: 'Горчица русская', subtype: 'mustard', ranges: { caloriesKcal: [50, 160], saltG: [2, 5] } },
  { name: 'BBQ sauce', subtype: 'bbq', ranges: { caloriesKcal: [120, 180], sugarsG: [15, 35], fatG: [0, 5] } },
  { name: 'Соевый соус', subtype: 'soy_sauce', ranges: { caloriesKcal: [0, 80], fatG: [0, 1], saltG: [4, 5] } },
  { name: 'Coca-Cola', subtype: 'soda', ranges: { caloriesKcal: [35, 50], sugarsG: [9, 12], fatG: [0, 0.5], proteinG: [0, 1] } },
  { name: 'Coca-Cola Zero Sugar', subtype: 'zero_soda', ranges: { caloriesKcal: [0, 5], sugarsG: [0, 1], fatG: [0, 0.5] } },
  { name: 'Сок апельсиновый', subtype: 'juice', ranges: { caloriesKcal: [35, 60], fatG: [0, 1], sugarsG: [8, 12] } },
  { name: 'Тунец консервированный', subtype: 'tuna', ranges: { caloriesKcal: [100, 200], proteinG: [18, 30], carbsG: [0, 3] } },
  { name: 'Фасоль красная консервированная', subtype: 'beans', ranges: { caloriesKcal: [70, 130], fiberG: [4, 8], fatG: [0, 3] } },
  { name: 'Овощная смесь замороженная', subtype: 'vegetable', ranges: { caloriesKcal: [20, 60], fatG: [0, 3] } },
  { name: 'Сыр Российский', subtype: 'cheese', ranges: { caloriesKcal: [300, 420], proteinG: [18, 30], fatG: [20, 35] } },
  { name: 'Колбаса варёная', subtype: 'sausage', ranges: { caloriesKcal: [220, 320], fatG: [15, 30], saltG: [1.5, 3] } },
  { name: 'Арахисовая паста', subtype: 'peanut_butter', ranges: { caloriesKcal: [550, 680], fatG: [40, 55], proteinG: [20, 30] } },
  { name: 'Гранола с орехами', subtype: 'granola', ranges: { caloriesKcal: [380, 500] } },
];

function assertSane(product: Product): void {
  const n = product.nutrition!;
  for (const key of NUTRIENT_KEYS) assert.ok(Number.isFinite(n[key].value) && n[key].value! >= 0, key);
  assert.ok(n.sugarsG.value! <= n.carbsG.value! + 1e-9, 'sugars ≤ carbs');
  assert.ok(n.saturatedFatG.value! <= n.fatG.value! + 1e-9, 'saturated ≤ fat');
  assert.ok(n.proteinG.value! + n.carbsG.value! + n.fatG.value! <= 100.1, 'macro mass ≤ 100 g');
  assert.ok(n.caloriesKcal.value! <= 900, 'energy ≤ pure fat');
}

describe('Estimator benchmark: name-only estimates stay in a realistic range', () => {
  assert.ok(BENCHMARK.length >= 30);
  for (const item of BENCHMARK) it(`${item.name} → ${item.subtype}`, () => {
    const product = food(item.name, item.category ?? null);
    assert.equal(nutritionEstimationProfile(product).subtype, item.subtype);
    const result = estimateMissingNutrition(product);
    assertSane(result);
    for (const [key, [min, max]] of Object.entries(item.ranges) as [NutrientKey, Range][]) {
      const value = result.nutrition![key].value!;
      assert.ok(value >= min && value <= max, `${key} ${value} outside ${min}–${max}`);
    }
    assert.equal(typeof scoreProduct(result).value, 'number');
  });
});

describe('Neighbouring categories do not mix', () => {
  const cases: readonly [string, ProductCategory | null, string][] = [
    ['Томатный кетчуп', null, 'ketchup'], ['Соус томатный', null, 'tomato_sauce'], ['Пассата томатная', null, 'passata'],
    ['Томатное пюре', null, 'passata'], ['Domates Püresi', null, 'passata'], ['Томатная паста', null, 'tomato_paste'],
    ['Протёртые томаты', 'vegetable', 'passata'], ['Томатный сок', null, 'juice'], ['Сырный соус', null, 'sauce'],
    ['Чипсы со вкусом кетчупа', null, 'chips'], ['Чипсы со вкусом кетчупа', 'snack', 'chips'], ['Кетчуп', 'snack', 'snack'],
    ['Шоколадное печенье', null, 'cookies'], ['Конфеты шоколадные', 'sweets', 'candy'], ['Овсяное печенье', null, 'cookies'],
    ['Хлебцы ржаные', null, 'crispbread'], ['Крекеры', null, 'crackers'], ['Пирожное эклер', null, 'cake'], ['Круассан', null, 'bakery'],
    ['Спагетти', 'ready_meal', 'pasta'], ['Лапша', null, 'ready_meal'], ['Мюсли', null, 'granola'], ['Кукурузные хлопья', null, 'flakes'],
    ['Тунец в собственном соку', null, 'tuna'], ['Tuna in water', null, 'tuna'], ['Нут', null, 'beans'], ['Минеральная вода', null, 'water'],
    ['Pepsi Max', null, 'soda'], ['Лимонад', null, 'soda'], ['Сгущённое молоко', null, 'condensed_milk'], ['Соевое молоко', null, 'plant_milk'],
    ['Йогурт натуральный', null, 'yogurt'], ['Skyr', 'dairy', 'greek_yogurt'], ['Майонез', null, 'mayonnaise'], ['Sweetcorn', null, 'vegetable'],
  ];
  for (const [name, declared, expected] of cases) it(`${name}${declared ? ` (${declared})` : ''} → ${expected}`, () => {
    assert.equal(nutritionEstimationProfile(food(name, declared)).subtype, expected);
  });
  it('words match whole tokens: liver is not cookies, raw is not cheese, goat is not oats', () => {
    assert.notEqual(nutritionEstimationProfile(food('Печень куриная')).category, 'bakery');
    assert.notEqual(nutritionEstimationProfile(food('Сырокопчёная колбаса')).category, 'cheese');
    assert.equal(nutritionEstimationProfile(food('Сырокопчёная колбаса')).subtype, 'sausage');
    assert.notEqual(nutritionEstimationProfile(food('Goat milk')).subtype, 'oats');
  });
});

describe('Category-aware limits', () => {
  it('passata never gets an estimated 15 g fat, even from a misleading energy value', () => {
    const result = estimateMissingNutrition(food('Burcu Passata Rustica', 'sauce', { nutrition: label({ caloriesKcal: 191 }) }));
    assert.ok(result.nutrition!.fatG.value! <= 2);
    assert.ok(result.nutrition!.proteinG.value! <= 3);
  });
  it('ketchup in the generic fallback no longer gets 8 g protein', () => {
    assert.ok(estimateMissingNutrition(food('Heinz Tomato Ketchup', 'other')).nutrition!.proteinG.value! <= 3);
  });
  it('soda keeps fat near zero; zero soda keeps sugar near zero', () => {
    assert.ok(estimateMissingNutrition(food('Лимонад', 'beverage', { nutrition: label({ caloriesKcal: 60 }) })).nutrition!.fatG.value! <= 0.5);
    assert.ok(estimateMissingNutrition(food('Fanta Zero', 'beverage', { nutrition: label({ carbsG: 2 }) })).nutrition!.sugarsG.value! <= 1);
  });
  it('plain Greek yogurt gets no dessert-like sugar; a listed sugar lifts the limit', () => {
    const plain = estimateMissingNutrition(food('Греческий йогурт', 'yogurt', { nutrition: label({ carbsG: 12 }) }));
    assert.ok(plain.nutrition!.sugarsG.value! <= 6);
    const sweetened = estimateMissingNutrition(food('Греческий йогурт', 'yogurt', { nutrition: label({ carbsG: 12 }), ingredients: observed([{ name: 'молоко', percent: null }, { name: 'сахар', percent: null }]) }));
    assert.ok(sweetened.nutrition!.sugarsG.value! > 6);
  });
  it('chocolate and mayonnaise may be high in fat and sugar; soy sauce is salty but lean', () => {
    assert.ok(estimateMissingNutrition(food('Тёмный шоколад')).nutrition!.fatG.value! > 25);
    assert.ok(estimateMissingNutrition(food('Майонез')).nutrition!.fatG.value! > 55);
    const soy = estimateMissingNutrition(food('Соевый соус')).nutrition!;
    assert.ok(soy.saltG.value! >= 4 && soy.fatG.value! <= 1);
  });
  it('"no sugar added" keeps an estimated sugar low unless sugar is listed', () => {
    const result = estimateMissingNutrition(food('Heinz Tomato Ketchup No Sugar Added', 'sauce'));
    assert.equal(nutritionEstimationProfile(food('Heinz Tomato Ketchup No Sugar Added', 'sauce')).subtype, 'ketchup_no_sugar');
    assert.ok(result.nutrition!.sugarsG.value! <= 6);
    assert.ok(estimateMissingNutrition(food('Гранола без сахара')).nutrition!.sugarsG.value! < estimateMissingNutrition(food('Гранола')).nutrition!.sugarsG.value!);
  });
  it('a source value above the limit stays (exact > estimate) and is disclosed', () => {
    const result = estimateMissingNutrition(food('Passata', 'sauce', { nutrition: label({ fatG: 15 }) }));
    assert.equal(result.nutrition!.fatG.value, 15);
    assert.ok(result.nutritionMetadata!.constraints?.includes('category_limit_conflict:passata:fatG'));
  });
});

describe('Known products', () => {
  const BURCU = { caloriesKcal: 19, fatG: 0.2, saturatedFatG: 0, carbsG: 2.8, sugarsG: 2.3, fiberG: 1.6, proteinG: 0.9, saltG: 0.01 };
  it('Burcu passata: exact label values are kept, only sodium is derived', () => {
    for (const category of ['sauce', 'vegetable', null] as const) {
      const product = food('Burcu Passata Rustica', category, { nutrition: label(BURCU) });
      const result = estimateMissingNutrition(product);
      for (const [key, value] of Object.entries(BURCU)) assert.equal(result.nutrition![key as NutrientKey].value, value, key);
      assert.deepEqual(estimatedNutritionFields(result), []);
      assert.equal(result.nutrition!.sodiumMg.value, 4);
      assert.deepEqual(result.nutritionMetadata!.constraints, []);
    }
  });
  it('Burcu passata without a label: a passata estimate, not 191 kcal / 15 g fat / 1.8 g salt', () => {
    const n = estimateMissingNutrition(food('Burcu Passata Rustica', 'sauce')).nutrition!;
    assert.ok(n.caloriesKcal.value! < 60 && n.fatG.value! <= 2 && n.saltG.value! <= 1.5);
  });
  const named: readonly [string, ProductCategory | null, string][] = [
    ['Лапша быстрого приготовления Роллтон со вкусом курицы', 'ready_meal', 'instant_noodles'],
    ['Картофельное пюре с куриным вкусом', 'ready_meal', 'ready_meal'],
    ['Heinz Tomato Ketchup', 'sauce', 'ketchup'],
    ['Heinz Tomato Ketchup', null, 'ketchup'],
    ['FAGE Total 0%', 'yogurt', 'yogurt'],
    ['Alpen Gold Молочный шоколад', 'chocolate', 'chocolate'],
    ['Alpen Gold Молочный шоколад', null, 'chocolate'],
    ['Майонез Провансаль', 'sauce', 'mayonnaise'],
    ['Choco Pie', 'bakery', 'bakery'],
  ];
  for (const [name, category, expected] of named) it(`${name} → ${expected}; exact values preserved`, () => {
    const product = food(name, category);
    assert.equal(nutritionEstimationProfile(product).subtype, expected);
    const exact = food(name, category, { nutrition: label({ caloriesKcal: 123, proteinG: 4.5, carbsG: 11, fatG: 7, sugarsG: 3.3 }) });
    const result = estimateMissingNutrition(exact);
    for (const [key, value] of [['caloriesKcal', 123], ['proteinG', 4.5], ['carbsG', 11], ['fatG', 7], ['sugarsG', 3.3]] as const) assert.equal(result.nutrition![key].value, value);
    assertSane(estimateMissingNutrition(product));
  });
  it('FAGE Total 0%: an estimated sugar stays a dairy value, not dessert-like', () => {
    assert.ok(estimateMissingNutrition(food('FAGE Total 0%', 'yogurt', { nutrition: label({ caloriesKcal: 54, proteinG: 10.3, carbsG: 3, fatG: 0 }) })).nutrition!.sugarsG.value! <= 3);
  });
});

describe('Fallback "other"', () => {
  it('an unknown name is disclosed as unknown, with low confidence and no absurd values', () => {
    const result = estimateMissingNutrition(food('Новый продукт Альфа'));
    assert.equal(nutritionEstimationProfile(food('Новый продукт Альфа')).source, 'fallback');
    assertSane(result);
    assert.ok(result.nutritionMetadata!.constraints?.includes('category_unknown'));
    assert.equal(result.confidence.nutrition, 'low');
    assert.ok(Object.values(result.nutritionMetadata!.fields).every(field => field.confidence === 'low' || field.quality === 'verified'));
    assert.ok(result.nutrition!.caloriesKcal.value! >= 100 && result.nutrition!.caloriesKcal.value! <= 400);
  });
  it('a recognised name is not "other" even when the source said so', () => {
    assert.equal(nutritionEstimationProfile(food('Кетчуп', 'other')).subtype, 'ketchup');
    assert.equal(nutritionEstimationProfile(food('Хлеб', 'other')).category, 'bread');
  });
});

describe('Ingredient signals are whole Unicode tokens', () => {
  const signals = (...names: string[]) => analyzeNutritionIngredients(names.map(name => ({ name, percent: null })));
  it('камедь, медь and сахарозаменитель are not sugar; мёд and сироп are', () => {
    assert.equal(signals('вода', 'камедь ксантановая', 'медь').sugarPosition, -1);
    assert.equal(signals('вода', 'мёд').sugarPosition, 1);
    assert.equal(signals('глюкозный сироп', 'вода').strongTopLevelSugar, true);
    assert.equal(signals('вода', 'сахарозаменитель').sugarPosition, -1);
  });
  it('sweeteners only: erythritol, aspartame, sucralose', () => {
    for (const name of ['эритрит', 'aspartame', 'сукралоза', 'ацесульфам калия']) assert.equal(signals('вода', name).sweetenerOnly, true, name);
  });
  it('salt, oil and fiber words; no substring false positives', () => {
    assert.equal(signals('domates', 'tuz').saltPosition, 1);
    assert.equal(signals('вода', 'солод').saltPosition, -1);
    assert.equal(signals('рапсовое масло').hasUnsaturatedFat, true);
    assert.equal(signals('сливочное масло').hasSaturatedFat, true);
    assert.equal(signals('бобы').hasFiber, true);
    assert.equal(signals('бобышка').hasFiber, false);
    assert.equal(signals('Turkish şeker').sugarPosition, 0);
  });
  it('ingredients shown only for display never change the estimate', () => {
    const base = food('Греческий йогурт', 'yogurt');
    const displayOnly: Product = { ...base, ingredients: observed([{ name: 'сахар, соль', percent: null }]), fieldEvidence: [{ field: 'ingredients', source: 'web_search', url: 'https://example.test', domain: 'example.test', tier: 4, confidence: 'low', identityMatch: 'exact_name', retrievedAt: '2026-01-01', ingredientsOnly: true }] };
    assert.deepEqual(estimateMissingNutrition(displayOnly).nutrition, estimateMissingNutrition(base).nutrition);
  });
});

describe('Dry instant mixes', () => {
  it('high-energy noodles alone do not establish dry form; composition can confirm it', () => {
    const noodles = estimateMissingNutrition(food('Лапша с говядиной по-домашнему', null, { nutrition: label({ caloriesKcal: 400, proteinG: 6.5, carbsG: 56, fatG: 17 }) }));
    assert.equal(noodles.nutrition!.saltG.value, 1.1);
    assert.equal(noodles.nutritionMetadata!.selection!.subtype, 'ready_meal');
    const supported = estimateMissingNutrition(food('Лапша с говядиной по-домашнему', null, { nutrition: label({ caloriesKcal: 400, proteinG: 6.5, carbsG: 56, fatG: 17 }), ingredients: observed([{name:'лапша (мука), приправа (соль, овощи сушеные)',percent:null}]) }));
    assert.match(supported.nutritionMetadata!.fields.saltG.reason, /profile:dry_mix/);
    assert.equal(supported.nutritionMetadata!.selection!.confidence, 'high');
    const cooked = estimateMissingNutrition(food('Плов с курицей', null, { nutrition: label({ caloriesKcal: 160, proteinG: 7, carbsG: 20, fatG: 6 }) }));
    assert.match(cooked.nutritionMetadata!.fields.saltG.reason, /profile:ready_meal/);
  });
});
