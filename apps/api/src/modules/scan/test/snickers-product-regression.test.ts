import assert from 'node:assert/strict';
import { it } from 'node:test';
import { Logger } from '@nestjs/common';
import { NOT_DETECTED, observed, type Product } from '@foodlens/core';
import { withIngredientFacts } from '../ingredient-facts';
import { withProductIngredientFacts, ProductIngredientsDisplayService } from '../product-ingredient-facts';
import { productIngredientFactsText, isEnglishProductIngredientText } from '../product-ingredient-text';
import { ingredientTranslationPlan } from '../ingredients-display-text';
import { mapOpenFoodFactsProduct } from '../../product-lookup/open-food-facts.mapper';
import { confirmBarcodeIdentity, emptyBarcodeProduct, semanticsFromIngredients } from '../barcode-product';
import { ScanService } from '../scan.service';
import type { NutritionTargetsService } from '../../nutrition-targets/nutrition-targets.service';
import type { LookupStep } from '../../product-lookup/multi-source-product-lookup';
import { eatHealthierPlan } from '../../goal-match/test/goal-match-v4.fixtures';
Logger.overrideLogger(false);
const code = '4660085515163';
// Public OFF composition observed on 2026-11-04. Do not complete it using the brand name.
const raw = "shakar, kakao yog'i, sut, laktoza,";
const names = ['shakar', "kakao yog'i", 'sut', 'laktoza'];
const ingredients = observed(names.map(name => ({ name, percent: null })));
const product = () => ({ ...emptyBarcodeProduct(code), ingredients });
const step = (extra = {}) => ({ status: 'hit', result: { ingredients: ingredients.value, ingredientsIncomplete: true, ...extra } }) as LookupStep;

it('OFF preserves every supplied ingredient and records a dangling-list completeness warning', () => {
  const result = mapOpenFoodFactsProduct({ ingredients_text: raw, allergens_tags: [], additives_tags: [] }, code)!;
  assert.deepEqual(result.ingredients, ingredients.value);
  assert.equal(result.ingredientsIncomplete, true);
  assert.equal(result.allergens, null);
  assert.equal(mapOpenFoodFactsProduct({ ingredients_text: 'milk, sugar' }, code)!.ingredientsIncomplete, undefined);
});
it('Product infers milk from sut/laktoza before translation, retains source and never invents missing allergens', () => {
  const source = product(), copy = structuredClone(source);
  for (const name of ['sut', 'laktoza', 'milk', 'lactose']) {
    const p = withProductIngredientFacts({ ...source, ingredients: observed([{ name, percent: null }]) });
    assert.deepEqual(p.allergens.value, [{ code: 'milk', presence: 'contains', provenance: 'inferred' }]);
  }
  const p = withProductIngredientFacts(source);
  assert.deepEqual(p.ingredients, source.ingredients);
  assert.deepEqual(source, copy);
  assert.equal(p.allergens.value!.length, 1);
  // Existing Label/shared behavior is unchanged.
  assert.equal(withIngredientFacts(source).allergens.value, null);
  assert.equal(productIngredientFactsText('sutli laktozali coconut milk'), 'sutli laktozali coconut milk');
  assert.equal(withProductIngredientFacts({ ...source, ingredients: observed([{ name: 'coconut milk', percent: null }]) }).allergens.value, null);
});
it('Product lexical inference preserves may-contain scope and upgrades an existing milk trace', () => {
  const source = product();
  const trace = withProductIngredientFacts({ ...source, ingredients: observed([{ name: 'may contain sut', percent: null }]) });
  assert.equal(trace.allergens.value![0]!.presence, 'may_contain');
  const upgraded = withProductIngredientFacts({ ...source, allergens: observed([{ code: 'milk', presence: 'may_contain', provenance: 'open_food_facts' }]) });
  assert.equal(upgraded.allergens.value![0]!.presence, 'contains');
});
it('partial composition cannot earn moderately/minimally processed credit; explicit evidence and NOVA remain usable', () => {
  const p = confirmBarcodeIdentity(product(), [step()]);
  assert.equal(p.semantics!.processing.value, 'unknown');
  assert.equal(p.semantics!.processing.confidence, 'low');
  assert.equal(p.semantics!.sugarSource.value, 'added');
  assert.equal(confirmBarcodeIdentity(product(), [step({ nova: 4 })]).semantics!.processing.value, 'ultra_processed');
  const explicit = { ...product(), ingredients: observed([{ name: 'sugar, emulsifier E322', percent: null }]) };
  assert.equal(semanticsFromIngredients(explicit, true).processing.value, 'ultra_processed');
  assert.equal(semanticsFromIngredients(product()).processing.value, 'processed');
  // A subsequently replaced ingredient list does not inherit an old source warning.
  const replaced = { ...product(), ingredients: observed([{ name: 'milk', percent: null }]) };
  assert.equal(confirmBarcodeIdentity(replaced, [step()]).semantics!.processing.value, 'whole_or_minimal');
});
it("kakao yog'i participates in the original single translation batch; count/order/source survive", async () => {
  const calls: readonly string[][] = [];
  const translations: Record<string, string> = { shakar: 'sugar', "kakao yog'i": 'cocoa butter', sut: 'milk', laktoza: 'lactose' };
  const display = new ProductIngredientsDisplayService({ translateIngredients: async texts => {
    (calls as string[][]).push([...texts]); return texts.map(t => translations[t]!);
  } });
  const source = product(), p = await display.decorate(source);
  assert.deepEqual(calls, [names]);
  assert.deepEqual(p.ingredientsDisplay!.items.map(i => i.name), ['sugar', 'cocoa butter', 'milk', 'lactose']);
  assert.equal(p.ingredientsDisplay!.status, 'translated');
  assert.deepEqual(p.ingredients, source.ingredients);
  await display.decorate(source); assert.equal(calls.length, 1);
  assert.equal(isEnglishProductIngredientText("kakao yog'i"), false);
  const plan = ingredientTranslationPlan(ingredients.value!, isEnglishProductIngredientText);
  assert.throws(() => plan.assemble(['sugar', "kakao yog'i", 'milk', 'lactose']), /Non-English/);
});
it('failed/unsafe Product translation keeps all original ingredients without adding data', async () => {
  for (const output of [[], ['sugar'], ['sugar', 'cocoa butter and peanuts', 'milk', 'lactose']]) {
    const p = await new ProductIngredientsDisplayService({ translateIngredients: async () => output }).decorate(product());
    assert.equal(p.ingredientsDisplay!.status, 'fallback'); assert.deepEqual(p.ingredientsDisplay!.items, ingredients.value);
  }
});
it('barcode-only Snickers retains OFF flow: no vision, corrected allergens/semantics, one cached translation batch', async () => {
  const fact = (value: number, unit = 'g') => ({ value, unit, source: 'manufacturer' });
  const source = mapOpenFoodFactsProduct({ product_name: 'Snickers Super', ingredients_text: raw, allergens_tags: [],
    nutrition: { aggregated_set: { per: '100g', preparation: 'as_sold', nutrients: { 'energy-kcal': fact(494, 'kcal'), proteins: fact(8.1), carbohydrates: fact(59), fat: fact(25) } } } }, code)!;
  let vision = 0, translations = 0;
  const display = new ProductIngredientsDisplayService({ translateIngredients: async texts => { translations++;
    assert.deepEqual(texts, names); return ['sugar', 'cocoa butter', 'milk', 'lactose']; } });
  const plans = { findPlanForUser: async () => eatHealthierPlan() } as unknown as NutritionTargetsService;
  const ai = { name: 'fireworks', analyzeProduct: async (): Promise<Product> => { vision++; throw Error('Unexpected vision'); } };
  const svc = new ScanService(ai, plans, undefined, { name: 'open_food_facts', lookup: async () => source }, async () => null, undefined, ai, display);
  const result = await svc.analyze(undefined, 'test', { barcode: code });
  assert.equal(vision, 0); assert.equal(translations, 1);
  assert.equal(result.product.semantics!.processing.value, 'unknown');
  assert.equal(result.goalMatch.factors.some(f => f.kind === 'whole' && f.impact === 'positive'), false);
  assert.equal(result.product.allergens.value![0]!.code, 'milk');
  assert.deepEqual(result.product.ingredients.value, ingredients.value);
  assert.equal(result.product.nutrition!.caloriesKcal.value, 494);
});
