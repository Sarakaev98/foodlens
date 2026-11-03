import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { Logger } from '@nestjs/common';
import type { AIProvider } from '@foodlens/ai';
import { NUTRIENT_KEYS, NOT_DETECTED, observed, type NutrientKey, type NutritionFacts, type Product, type ProductCategory } from '@foodlens/core';
import { scoreProduct } from '@foodlens/scoring';
import type { NutritionTargetsService } from '../../nutrition-targets/nutrition-targets.service';
import { MultiSourceProductLookup } from '../../product-lookup/multi-source-product-lookup';
import { emptyBarcodeProduct } from '../barcode-product';
import { estimateMissingNutrition, estimatedNutritionFields } from '../nutrition-estimator';
import { ScanService } from '../scan.service';
Logger.overrideLogger(false);
const complete = { caloriesKcal: 350, proteinG: 6, carbsG: 65, fatG: 7.5, sugarsG: 3, saturatedFatG: 2, fiberG: 2, saltG: 1, sodiumMg: 400 };
function food(overrides: Partial<NutritionFacts> = {}, category: ProductCategory = 'other'): Product {
  return { ...emptyBarcodeProduct('1234567890128'), name: observed('Новый пищевой продукт'), category: observed(category), ingredients: observed([{ name: 'мука', percent: null }, { name: 'сахар', percent: null }, { name: 'растительное масло', percent: null }]),
    nutrition: { basis: 'per_100g', servingSize: NOT_DETECTED, ...Object.fromEntries(NUTRIENT_KEYS.map(key => [key, observed(complete[key])])), ...overrides } as NutritionFacts };
}
const gaps = { sugarsG: NOT_DETECTED, saturatedFatG: NOT_DETECTED, fiberG: NOT_DETECTED, saltG: NOT_DETECTED, sodiumMg: NOT_DETECTED };
function assertFull(product: Product) {
  const n = product.nutrition!;
  for (const key of NUTRIENT_KEYS) assert.ok(Number.isFinite(n[key].value) && n[key].value! >= 0, key);
  assert.ok(n.sugarsG.value! <= n.carbsG.value!); assert.ok(n.saturatedFatG.value! <= n.fatG.value!);
  const score = scoreProduct(product);
  assert.equal(typeof score.value, 'number'); assert.ok(score.value! >= 0 && score.value! <= 10);
  assert.ok(!score.missingFactors.some(f => ['sugars', 'saturatedFat', 'salt', 'fiber', 'energy', 'protein'].includes(f)));
}

describe('MVP estimation after exact enrichment', () => {
  it('complete data keeps all values and only verified metadata', () => {
    const base = food(); const result = estimateMissingNutrition(base);
    assert.deepEqual(estimatedNutritionFields(result), []);
    for (const key of NUTRIENT_KEYS) { assert.equal(result.nutrition![key], base.nutrition![key]); assert.equal(result.nutritionMetadata!.fields[key].quality, 'verified'); }
  });
  it('remaining gaps become disclosed estimates; exact values never change', () => {
    const base = food(gaps); const result = estimateMissingNutrition(base);
    assertFull(result);
    assert.deepEqual(new Set(estimatedNutritionFields(result)), new Set(Object.keys(gaps)));
    for (const key of ['caloriesKcal', 'proteinG', 'carbsG', 'fatG'] as NutrientKey[]) assert.equal(result.nutrition![key], base.nutrition![key]);
    assert.equal(result.nutritionMetadata!.fields.sugarsG.confidence, 'low');
    assert.equal(result.nutritionMetadata!.fields.sugarsG.method, 'context_rules');
    assert.deepEqual(estimateMissingNutrition(result), result, 'idempotent');
  });
  it('the ScanService runs enrichment before estimation and preserves the accepted value', async () => {
    const base = food(gaps); let calls = 0;
    const lookup = new MultiSourceProductLookup([{ name: 'web_search', needsBarcode: false, lookup: async () => {
      calls++; return { provider: 'web_search', match: 'verified_identity', barcode: '', name: null, brand: null, nutrition: { basis: 'per_100g', values: { ...Object.fromEntries(NUTRIENT_KEYS.map(key => [key, null])), sugarsG: 7 } as Record<NutrientKey, number | null>, derived: [] }, servingSize: null, ingredients: null, allergens: null, additives: null };
    } }]);
    const ai = { name: 'stub', analyzeProduct: async () => base } as unknown as AIProvider;
    const plans = { findPlanForUser: async () => null } as unknown as NutritionTargetsService;
    const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
    const scanned = await new ScanService(ai, plans, undefined, lookup, async () => null).analyze({ mimetype: 'image/jpeg', buffer, size: buffer.length }, 'u');
    assert.equal(calls, 1); assertFull(scanned.product);
    assert.equal(scanned.product.nutrition!.sugarsG.value, 7);
    assert.equal(scanned.product.nutritionMetadata!.fields.sugarsG.quality, 'verified');
    assert.equal(scanned.product.nutritionMetadata!.fields.saturatedFatG.quality, 'estimated');
    assert.deepEqual(scanned.score, scoreProduct(scanned.product));
  });
  it('an unfamiliar name with ingredients and partial macros gets the same full score pipeline', () => {
    const result = estimateMissingNutrition({ ...food({ ...gaps, caloriesKcal: NOT_DETECTED, proteinG: NOT_DETECTED }), name: observed('Незнакомый продукт Альфа') });
    assertFull(result); assert.ok(estimatedNutritionFields(result).includes('caloriesKcal'));
  });
  it('all categories and a name-only food have finite full inputs', () => {
    for (const category of ['water', 'beverage', 'yogurt', 'meat', 'nuts', 'bakery', 'snack', 'cereal', 'fruit', 'vegetable', 'other'] as ProductCategory[]) {
      assertFull(estimateMissingNutrition({ ...food({}, category), nutrition: null }));
    }
  });
  it('an unidentified barcode is not disguised as a recognized food', () => {
    const unknown = emptyBarcodeProduct('1234567890128');
    assert.equal(estimateMissingNutrition(unknown), unknown);
  });
  it('known sodium derives salt without inventing a category value', () => {
    const base = food({ ...gaps, sodiumMg: observed(200) });
    const result = estimateMissingNutrition(base);
    assert.equal(result.nutrition!.saltG.value, 0.5);
    assert.equal(result.nutritionMetadata!.fields.saltG.quality, 'verified');
    assert.equal(result.nutrition!["sodiumMg"], base.nutrition!["sodiumMg"]);
  });
  it('missing macros respect known energy and lower bounds from known sugars and saturated fat', () => {
    const result = estimateMissingNutrition(food({ proteinG: NOT_DETECTED, carbsG: NOT_DETECTED, fatG: NOT_DETECTED, sugarsG: observed(30), saturatedFatG: observed(4), caloriesKcal: observed(350) }));
    assertFull(result);
    const n = result.nutrition!;
    assert.ok(Math.abs(4 * n.proteinG.value! + 4 * n.carbsG.value! + 9 * n.fatG.value! - 350) < 0.2);
  });
  it('ingredient order, fat type and whole grain affect the estimates', () => {
    const run = (names: string[]) => estimateMissingNutrition({ ...food(gaps), ingredients: observed(names.map(name => ({ name, percent: null }))) });
    const sweet = run(['сахар', 'мука', 'пальмовое масло']); const grain = run(['цельнозерновая мука', 'подсолнечное масло', 'вода', 'сахар']);
    assert.ok(sweet.nutrition!.sugarsG.value! > grain.nutrition!.sugarsG.value!);
    assert.ok(sweet.nutrition!.saturatedFatG.value! > grain.nutrition!.saturatedFatG.value!);
    assert.ok(grain.nutrition!.fiberG.value! > sweet.nutrition!.fiberG.value!);
  });
  it('per-serving estimates scale consistently and keep source values', () => {
    const source = food({ ...gaps, basis: 'per_serving', servingSize: observed({ amount: 40, unit: 'g' }), caloriesKcal: observed(140), proteinG: observed(2.4), carbsG: observed(26), fatG: observed(3) });
    const serving = estimateMissingNutrition(source); const hundred = estimateMissingNutrition(food(gaps));
    assertFull(serving);
    for (const key of Object.keys(gaps) as NutrientKey[]) assert.ok(Math.abs(serving.nutrition![key].value! - hundred.nutrition![key].value! * 0.4) < 0.02, key);
    assert.equal(serving.nutrition!.caloriesKcal, source.nutrition!.caloriesKcal);
  });
  it('unknown basis or a missing serving size is explicitly estimated, without blocking scoring', () => {
    for (const basis of ['unknown', 'per_serving'] as const) {
      const result = estimateMissingNutrition(food({ ...gaps, basis, servingSize: NOT_DETECTED }));
      assertFull(result); assert.equal(result.nutritionMetadata!.basis.quality, 'estimated');
    }
  });
  it('bounds survive rounding and hundreds of macro contexts including zero', () => {
    for (let i = 0; i < 250; i++) {
      const protein = (i * 13 % 150) / 10, carbs = (i * 17 % 500) / 10, fat = (i * 7 % 250) / 10;
      const base = food({ ...gaps, proteinG: observed(protein), carbsG: observed(carbs), fatG: observed(fat), caloriesKcal: observed(4 * protein + 4 * carbs + 9 * fat) });
      const result = estimateMissingNutrition(base); assertFull(result);
      assert.ok(result.nutrition!.saltG.value! <= 5); assert.ok(result.nutrition!.fiberG.value! <= 30);
      for (const key of NUTRIENT_KEYS) if (base.nutrition![key].value !== null) assert.equal(result.nutrition![key], base.nutrition![key]);
    }
    assertFull(estimateMissingNutrition(food({ ...gaps, fatG: observed(0.008), carbsG: observed(0.008) })));
  });
  for (const fixture of [
    { barcode: '4605496000815', name: 'Картофельное пюре с куриным вкусом', category: 'ready_meal', macros: complete },
    { barcode: '4607084351385', name: 'Choco Pie', category: 'bakery', macros: { ...complete, caloriesKcal: 433, proteinG: 4.5, carbsG: 63, fatG: 18 } },
  ] as const) it(`${fixture.name}: completes the same pipeline without a special branch`, async () => {
    const values = { ...fixture.macros, sugarsG: null, saturatedFatG: null, fiberG: null, saltG: null, sodiumMg: null };
    const lookup = new MultiSourceProductLookup([{ name: 'open_food_facts', lookup: async () => ({ provider: 'open_food_facts', match: 'exact_barcode', barcode: fixture.barcode, name: fixture.name, brand: null, category: fixture.category, nutrition: { basis: 'per_100g', values, derived: [] }, servingSize: null, ingredients: [{ name: 'мука', percent: null }], allergens: null, additives: null }) }]);
    const plans = { findPlanForUser: async () => null } as unknown as NutritionTargetsService;
    const scanned = await new ScanService({ name: 'stub' } as AIProvider, plans, undefined, lookup).analyze(undefined, 'u', { barcode: fixture.barcode });
    assertFull(scanned.product); assert.equal(scanned.needsPhoto, undefined); assert.equal(scanned.status, undefined);
    assert.equal(scanned.product.nutrition!.carbsG.value, fixture.macros.carbsG);
  });
  it('production estimator has no diagnostic barcode or brand-specific branches', () => {
    const source = readFileSync(join(__dirname, '..', 'nutrition-estimator.js'), 'utf8');
    for (const forbidden of ['4605496000815', '4607084351385', 'Rollton', 'Роллтон', 'Choco Pie', 'Orion', 'forkin']) assert.ok(!source.includes(forbidden), forbidden);
  });
});
