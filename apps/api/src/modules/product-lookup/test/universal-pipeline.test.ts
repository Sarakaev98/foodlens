import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Logger } from '@nestjs/common';
import type { AIProvider } from '@foodlens/ai';
import { NOT_DETECTED, observed, type NutrientKey, type Product, type ProductCategory } from '@foodlens/core';
import { scoreProduct } from '@foodlens/scoring';
import type { NutritionTargetsService } from '../../nutrition-targets/nutrition-targets.service';
import { emptyBarcodeProduct, forScoring } from '../../scan/barcode-product';
import { ScanService } from '../../scan/scan.service';
import { MultiSourceProductLookup, missingNutritionFields } from '../multi-source-product-lookup';
import { mergeProductLookup } from '../product-merge';
import type { ProductLookupContext, ProductLookupProvider, ProductLookupResult } from '../product-lookup.provider';

Logger.overrideLogger(false);
const CODE = '1234567890128';
const full = { caloriesKcal: 200, proteinG: 10, carbsG: 20, sugarsG: 3, fatG: 9, saturatedFatG: 2, fiberG: 4, saltG: 0.5, sodiumMg: 200 };
const keys = Object.keys(full) as NutrientKey[];
function result(values: Partial<Record<NutrientKey, number | null>> = {}): ProductLookupResult {
  return { provider: 'open_food_facts', match: 'exact_barcode', barcode: CODE, name: 'Example original', brand: 'Example',
    nutrition: { basis: 'per_100g', values: { ...full, ...values }, derived: [] }, servingSize: { amount: 40, unit: 'g' },
    ingredients: [{ name: 'grain', percent: null }], additives: [], allergens: [] };
}
const product = (): Product => mergeProductLookup(emptyBarcodeProduct(CODE), result()).product;
function fallback(answer: ProductLookupResult | null) {
  const calls: ProductLookupContext[] = [];
  const provider: ProductLookupProvider = { name: 'web_search', needsBarcode: false, lookup: async (_, context) => { calls.push(context!); return answer; } };
  return { calls, provider };
}
const noValues = Object.fromEntries(keys.map(key => [key, null])) as Record<NutrientKey, null>;

describe('Universal nutrition pipeline: completeness, trust and scoring', () => {
  it('complete data skips enrichment; each missing nutrient triggers it with and without a barcode', async () => {
    const fields = { caloriesKcal: 'kcal', proteinG: 'protein', carbsG: 'carbs', sugarsG: 'sugars', fatG: 'fat', saturatedFatG: 'saturatedFat', fiberG: 'fiber', saltG: 'salt', sodiumMg: 'salt' };
    for (const barcode of [CODE, null]) {
      const complete = fallback(null);
      await new MultiSourceProductLookup([complete.provider]).begin(barcode).enrich(product());
      assert.equal(complete.calls.length, 0);
      for (const key of keys) {
        const base = product();
        const nutrition = { ...base.nutrition!, [key]: NOT_DETECTED, ...(['saltG', 'sodiumMg'].includes(key) ? { saltG: NOT_DETECTED, sodiumMg: NOT_DETECTED } : {}) };
        const search = fallback(null);
        await new MultiSourceProductLookup([search.provider]).begin(barcode).enrich({ ...base, nutrition });
        assert.equal(search.calls.length, 1, `${barcode}: ${key}`);
        assert.ok(search.calls[0]!.missingFields.includes(fields[key]));
      }
    }
  });
  it('a missing ingredient list triggers enrichment without requiring a barcode or missing nutrition', async () => {
    const search = fallback(null);
    await new MultiSourceProductLookup([search.provider]).begin(null).enrich({ ...product(), ingredients: NOT_DETECTED });
    assert.equal(search.calls.length, 1); assert.equal(search.calls[0]!.needsIngredients, true);
  });
  it('nulls cannot overwrite known data; unknown fields and OFF estimates stay unknown', async () => {
    const first = result({ sugarsG: null, saturatedFatG: null, fiberG: null });
    const next = fallback({ ...result({ ...noValues, sugarsG: 3 }), provider: 'web_search' });
    const phases: string[] = [];
    const enriched = await new MultiSourceProductLookup([{ name: 'open_food_facts', lookup: async () => ({ ...first, estimates: { saturatedFatG: 2 } }) }, next.provider])
      .begin(CODE, stage => phases.push(stage)).enrich(emptyBarcodeProduct(CODE));
    assert.equal(enriched.product.nutrition!.sugarsG.value, 3);
    assert.equal(enriched.product.nutrition!.caloriesKcal.value, 200);
    assert.equal(enriched.product.nutrition!.saturatedFatG.value, null);
    assert.equal(enriched.product.nutrition!.fiberG.value, null);
    assert.deepEqual(phases, ['PRODUCT_IDENTIFIED', 'PRIMARY_NUTRITION', 'MISSING_FIELDS', 'ENRICHMENT_STARTED', 'ENRICHMENT_RESULT', 'MERGED_NUTRITION']);
  });
  it('a weak result cannot clear an existing recipe, even if it requests replacement', () => {
    const base = product();
    const merged = mergeProductLookup(base, { ...result(noValues), match: 'name_only', replacesRecipe: true, corrections: ['caloriesKcal'] });
    assert.equal(merged.product, base); assert.equal(merged.report.skipped, 'low_confidence_match');
  });
  it('a different barcode cannot be merged; leading zero GTIN aliases are accepted', () => {
    const base = product();
    assert.equal(mergeProductLookup(base, { ...result(), barcode: '9876543210123' }).product, base);
    assert.equal(mergeProductLookup(base, { ...result(), barcode: `0${CODE}` }).report.skipped, null);
  });
  it('corrections cannot make an unverified attribute match verify itself', () => {
    const base = product();
    const merged = mergeProductLookup(base, { ...result({ caloriesKcal: 500, proteinG: 30, carbsG: 50, fatG: 20 }), match: 'verified_attributes', corrections: ['caloriesKcal', 'proteinG', 'carbsG', 'fatG'], replacesRecipe: true });
    assert.equal(merged.product, base); assert.equal(merged.report.skipped, 'unverified_match');
  });
  it('observed values and incompatible per-100 bases are protected', () => {
    const base = product();
    const label = { ...base, nutrition: { ...base.nutrition!, sugarsG: observed(3) } };
    assert.equal(mergeProductLookup(label, { ...result({ sugarsG: 9 }), corrections: ['sugarsG'] }).product.nutrition!.sugarsG.value, 3);
    const missing = { ...base, nutrition: { ...base.nutrition!, sugarsG: NOT_DETECTED } };
    const mismatch = { ...result(), nutrition: { ...result().nutrition!, basis: 'per_100ml' as const } };
    assert.equal(mergeProductLookup(missing, mismatch).product.nutrition!.sugarsG.value, null);
  });
  it('the same chain runs for multiple categories and ScanService scores the merged data', async () => {
    for (const category of ['bakery', 'ready_meal', 'yogurt', 'beverage'] as ProductCategory[]) {
      const primary = { ...result({ sugarsG: null, saturatedFatG: null, saltG: null, sodiumMg: null }), category };
      const next = fallback({ ...result(), provider: 'web_search' });
      const chain = new MultiSourceProductLookup([{ name: 'open_food_facts', lookup: async () => primary }, next.provider]);
      const plans = { findPlanForUser: async () => null } as unknown as NutritionTargetsService;
      const ai = { name: 'stub', analyzeProduct: async () => assert.fail('barcode data is sufficient') } as unknown as AIProvider;
      const scanned = await new ScanService(ai, plans, undefined, chain).analyze(undefined, 'user', { barcode: CODE });
      assert.equal(next.calls.length, 1, category);
      assert.deepEqual(missingNutritionFields(scanned.product), []);
      assert.deepEqual(scanned.score, scoreProduct(forScoring(scanned.product)));
      assert.ok(!scanned.score.missingFactors.includes('sugars'));
    }
  });
});
