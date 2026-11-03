import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MockProvider } from '@foodlens/ai';
import { inferred, NOT_DETECTED, observed, type NutrientKey, type NutritionFacts, type Product } from '@foodlens/core';
import { mapOpenFoodFactsProduct } from '../open-food-facts.mapper';
import { mergeProductLookup } from '../product-merge';
import type { ProductLookupResult } from '../product-lookup.provider';
import { BARCODE, offProduct } from './open-food-facts.fixtures';

const lookup = (overrides: Record<string, unknown> = {}): ProductLookupResult => mapOpenFoodFactsProduct(offProduct(overrides), BARCODE)!;

/** Этикетка как у Choco Pie: четыре значения прочитаны, остальных нет. */
async function labelProduct(overrides: Partial<NutritionFacts> = {}, product: Partial<Product> = {}): Promise<Product> {
  const base = await new MockProvider().analyzeProduct({ kind: 'image', image: { mimeType: 'image/jpeg', base64: 'AA' } });
  return { ...base, ...product, nutrition: {
    basis: 'per_100g', servingSize: NOT_DETECTED, caloriesKcal: observed(430), proteinG: observed(4.5), carbsG: observed(63), fatG: observed(18),
    sugarsG: NOT_DETECTED, saturatedFatG: NOT_DETECTED, fiberG: NOT_DETECTED, saltG: NOT_DETECTED, sodiumMg: NOT_DETECTED, ...overrides,
  } };
}

describe('mergeProductLookup: nutrition', () => {
  it('a null from the photo is filled from the database, marked open_food_facts', async () => {
    const { product, report } = mergeProductLookup(await labelProduct(), lookup());
    const n = product.nutrition!;
    assert.deepEqual([n.sugarsG.value, n.sugarsG.provenance], [38, 'open_food_facts']);
    assert.deepEqual([n.saturatedFatG.value, n.saturatedFatG.provenance], [9, 'open_food_facts']);
    assert.deepEqual([n.fiberG.value, n.fiberG.provenance], [1.2, 'open_food_facts']);
    assert.deepEqual([n.saltG.value, n.saltG.provenance], [0.4, 'open_food_facts']);
    assert.deepEqual(report.filled.filter((f) => f.endsWith('G')), ['sugarsG', 'saturatedFatG', 'fiberG', 'saltG']);
  });
  it('sodium missing from the database is derived from salt and marked derived', async () => {
    const n = mergeProductLookup(await labelProduct(), lookup()).product.nutrition!;
    assert.deepEqual([n.sodiumMg.value, n.sodiumMg.provenance], [160, 'inferred']);
  });
  it('label values stay primary and keep observed; matching values count as confirmed', async () => {
    const { product, report } = mergeProductLookup(await labelProduct({ sugarsG: observed(37.5) }), lookup());
    assert.deepEqual([product.nutrition!.sugarsG.value, product.nutrition!.sugarsG.provenance], [37.5, 'observed']);
    assert.ok(report.confirmed.includes('sugarsG')); assert.deepEqual(report.conflicts, []);
  });
  it('a conflict keeps the label value, is reported, and is never averaged', async () => {
    const { product, report } = mergeProductLookup(await labelProduct({ sugarsG: observed(20) }), lookup());
    assert.equal(product.nutrition!.sugarsG.value, 20); assert.equal(product.nutrition!.sugarsG.provenance, 'observed');
    assert.deepEqual(report.conflicts, [{ field: 'sugarsG', label: 20, lookup: 38 }]);
    assert.equal(report.skipped, null);
    assert.equal(product.nutrition!.saltG.value, 0.4, 'one conflict does not stop the other fields');
  });
  it('two conflicting core values mean a different product: nothing is taken from it', async () => {
    const label = await labelProduct({ caloriesKcal: observed(100), proteinG: observed(20) }, { ingredients: NOT_DETECTED });
    const { product, report } = mergeProductLookup(label, lookup());
    assert.equal(report.skipped, 'different_product');
    assert.equal(product, label);
    assert.equal(product.nutrition!.sugarsG.value, null);
  });
  it('a database null never becomes 0', async () => {
    const empty = { ...lookup(), nutrition: { basis: 'per_100g' as const, derived: [], values: Object.fromEntries(
      (['caloriesKcal', 'proteinG', 'carbsG', 'sugarsG', 'fatG', 'saturatedFatG', 'fiberG', 'saltG', 'sodiumMg'] as NutrientKey[]).map((k) => [k, k === 'proteinG' ? 4.5 : null]),
    ) as Record<NutrientKey, number | null> } };
    const n = mergeProductLookup(await labelProduct(), empty).product.nutrition!;
    for (const key of ['sugarsG', 'saturatedFatG', 'fiberG', 'saltG', 'sodiumMg'] as const) {
      assert.equal(n[key].value, null, key); assert.equal(n[key].provenance, 'not_detected');
    }
  });
  it('a real 0 from the database is kept as 0', async () => {
    const zero = lookup();
    const values = { ...zero.nutrition!.values, sugarsG: 0 };
    assert.equal(mergeProductLookup(await labelProduct(), { ...zero, nutrition: { ...zero.nutrition!, values } }).product.nutrition!.sugarsG.value, 0);
  });
  it('a filled value that contradicts the label table is rejected, not used', async () => {
    const { product, report } = mergeProductLookup(await labelProduct({ carbsG: observed(30) }), lookup());
    assert.equal(product.nutrition!.sugarsG.value, null); assert.ok(report.rejected.includes('sugarsG'));
  });
  it('salt read from the label stays, and sodium read from the label is not replaced', async () => {
    const n = mergeProductLookup(await labelProduct({ sodiumMg: observed(160), saltG: inferred(0.4) }), lookup()).product.nutrition!;
    assert.deepEqual([n.saltG.provenance, n.sodiumMg.provenance], ['inferred', 'observed']);
  });
  it('without a table on the photo the database table is used, with medium nutrition confidence', async () => {
    const base = await labelProduct();
    const { product } = mergeProductLookup({ ...base, nutrition: null, confidence: { ...base.confidence, nutrition: null } }, lookup({ serving_quantity: 28 }));
    const n = product.nutrition!;
    assert.equal(n.basis, 'per_100g'); assert.equal(n.caloriesKcal.value, 430); assert.equal(n.caloriesKcal.provenance, 'open_food_facts');
    assert.equal(product.confidence.nutrition, 'medium'); assert.deepEqual(n.servingSize.value, { amount: 28, unit: 'g' });
  });
  it('a per-serving label is compared and filled after scaling; without a serving nothing mixes', async () => {
    const serving = await labelProduct({ basis: 'per_serving', servingSize: observed({ amount: 28, unit: 'g' }), caloriesKcal: observed(120), proteinG: observed(1.3), carbsG: observed(17.6), fatG: observed(5) });
    const { product, report } = mergeProductLookup(serving, lookup());
    assert.equal(report.skipped, null); assert.equal(product.nutrition!.sugarsG.value, 10.64);
    const noSize = await labelProduct({ basis: 'per_serving' });
    const unknown = mergeProductLookup(noSize, lookup());
    assert.equal(unknown.report.skipped, 'incompatible_basis'); assert.equal(unknown.product.nutrition!.sugarsG.value, null);
  });
  it('different bases never mix: per 100 g against per 100 ml, or an unknown basis', async () => {
    for (const basis of ['per_100ml', 'unknown'] as const) {
      const { product, report } = mergeProductLookup(await labelProduct({ basis }), lookup());
      assert.equal(report.skipped, 'incompatible_basis'); assert.equal(product.nutrition!.sugarsG.value, null);
    }
  });
});

describe('mergeProductLookup: serving', () => {
  it('fills only a missing serving and marks its source', async () => {
    const n = mergeProductLookup(await labelProduct(), lookup({ serving_quantity: 28 })).product.nutrition!;
    assert.deepEqual([n.servingSize.value, n.servingSize.provenance], [{ amount: 28, unit: 'g' }, 'open_food_facts']);
    const printed = mergeProductLookup(await labelProduct({ servingSize: observed({ amount: 30, unit: 'g' }) }), lookup({ serving_quantity: 28 })).product.nutrition!;
    assert.deepEqual([printed.servingSize.value, printed.servingSize.provenance], [{ amount: 30, unit: 'g' }, 'observed']);
  });
  it('without an explicit serving none appears, and AI typicalServing is never touched', async () => {
    const n = mergeProductLookup(await labelProduct(), lookup()).product.nutrition!;
    assert.equal(n.servingSize.value, null);
  });
  it('a serving in other units than the basis is not used', async () => {
    assert.equal(mergeProductLookup(await labelProduct(), lookup({ serving_quantity: 200, serving_quantity_unit: 'ml' })).product.nutrition!.servingSize.value, null);
  });
});

describe('mergeProductLookup: identity, ingredients, allergens, additives', () => {
  it('identity read from the photo stays; only missing identity is filled', async () => {
    const label = await labelProduct({}, { name: observed('С этикетки') });
    assert.equal(mergeProductLookup(label, lookup()).product.name.value, 'С этикетки');
    const missing = mergeProductLookup({ ...label, name: NOT_DETECTED, brand: NOT_DETECTED }, lookup()).product;
    assert.deepEqual([missing.name.value, missing.name.provenance], ['Чокопай', 'open_food_facts']);
    assert.equal(missing.brand.value, 'Lotte');
  });
  it('ingredients from the photo stay primary; the database fills only when none were read', async () => {
    const read = await labelProduct({}, { ingredients: observed([{ name: 'с упаковки', percent: null }]) });
    assert.equal(mergeProductLookup(read, lookup()).product.ingredients.value![0]!.name, 'с упаковки');
    const base = await labelProduct({}, { ingredients: NOT_DETECTED });
    const merged = mergeProductLookup({ ...base, confidence: { ...base.confidence, ingredients: null } }, lookup()).product;
    assert.equal(merged.ingredients.provenance, 'open_food_facts'); assert.equal(merged.ingredients.value!.length, 4);
    assert.equal(merged.confidence.ingredients, 'medium');
  });
  it('allergens: filled when unknown, added to the list, and "contains" wins over "may contain"', async () => {
    const unknown = mergeProductLookup(await labelProduct({}, { allergens: NOT_DETECTED }), lookup()).product.allergens;
    assert.equal(unknown.provenance, 'open_food_facts'); assert.equal(unknown.value!.length, 4);
    const read = await labelProduct({}, { allergens: observed([{ code: 'milk', presence: 'may_contain', provenance: 'observed' }, { code: 'fish', presence: 'contains', provenance: 'observed' }]) });
    const merged = mergeProductLookup(read, lookup()).product.allergens;
    assert.equal(merged.provenance, 'observed');
    assert.deepEqual(merged.value!.map((a) => [a.code, a.presence, a.provenance]).sort(), [
      ['eggs', 'contains', 'open_food_facts'], ['fish', 'contains', 'observed'], ['gluten', 'contains', 'open_food_facts'],
      ['milk', 'contains', 'open_food_facts'], ['soy', 'may_contain', 'open_food_facts'],
    ]);
  });
  it('additives: filled when unknown, added by code without duplicates, and the source is kept', async () => {
    const unknown = mergeProductLookup(await labelProduct({}, { additives: NOT_DETECTED }), lookup()).product.additives;
    assert.equal(unknown.provenance, 'open_food_facts'); assert.deepEqual(unknown.value!.map((a) => a.code), ['E322', 'E476']);
    const read = await labelProduct({}, { additives: observed([{ code: 'E322', name: 'лецитин' }]) });
    const merged = mergeProductLookup(read, lookup()).product.additives;
    assert.equal(merged.provenance, 'observed');
    assert.deepEqual(merged.value!.map((a) => [a.code, a.name, a.provenance]), [['E322', 'лецитин', undefined], ['E476', null, 'open_food_facts']]);
  });
  it('the database never removes anything and the merge does not mutate its input', async () => {
    const label = await labelProduct({ sugarsG: observed(38) });
    const snapshot = JSON.stringify(label);
    mergeProductLookup(label, lookup());
    assert.equal(JSON.stringify(label), snapshot);
  });
});
