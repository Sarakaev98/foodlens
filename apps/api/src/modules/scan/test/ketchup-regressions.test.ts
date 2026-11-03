import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NOT_DETECTED, observed, type Product } from '@foodlens/core';
import { scoreProduct } from '@foodlens/scoring';
import { emptyBarcodeProduct, forScoring } from '../barcode-product';
import { estimateMissingNutrition, nutritionEstimationProfile } from '../nutrition-estimator';
import { parsePage } from '../../product-lookup/web/page-nutrition';
import { identityFacts, ingredientsRejectReason, normalizedBarcode } from '../../product-lookup/web/product-identity';
const food = (name: string): Product => ({ ...emptyBarcodeProduct('1234567890128'), name: observed(name) });
const context = (name = 'Tomato Ketchup') => ({ name, brand: 'Example', serving: null, basis: 'unknown', kcal: null, protein: null, carbs: null, fat: null, missingFields: [] });
const page = (name: string, code = '') => parsePage(`<h1>Example ${name}</h1><p>${code}</p><p>Ingredients: tomatoes, salt, stevia.</p>`);
describe('Sauce profiles and validated ingredients', () => {
  for (const name of ['TOMATO KETCHUP', 'ketchup', 'кетчуп', 'томатный кетчуп', 'ketçap']) it(`${name} uses tomato condiment profile`, () => {
    const p = food(name), profile = nutritionEstimationProfile(p);
    assert.equal(profile.category, 'sauce'); assert.equal(profile.subtype, 'ketchup');
    const n = estimateMissingNutrition(p).nutrition!;
    assert.ok(n.fatG.value! < 1); assert.ok(n.proteinG.value! < 3); assert.ok(n.sugarsG.value! > 10);
    assert.equal(typeof scoreProduct(estimateMissingNutrition(p)).value, 'number');
  });
  it('different sauce types have different macro profiles', () => {
    const names = ['ketchup', 'mayonnaise', 'mustard', 'BBQ sauce', 'tomato sauce', 'soy sauce'];
    const profiles = names.map(name => nutritionEstimationProfile(food(name)));
    assert.ok(profiles.every(p => p.category === 'sauce'));
    assert.equal(new Set(profiles.map(p => p.subtype)).size, names.length);
    assert.ok(profiles[1]!.prior.fat > 50);
  });
  it('barcode equality is normalized, not presence of any code', () => {
    assert.equal(identityFacts(page('Tomato Ketchup','1234567890135'), context(), '1234567890128').barcodeMatch, false);
    assert.equal(identityFacts(page('Tomato Ketchup','01234567890128'), context(), '1234567890128').barcodeMatch, true);
    assert.equal(normalizedBarcode('1234-5678-9012'), normalizedBarcode('00123456789012'));
    assert.equal(normalizedBarcode(''), null);
  });
  for (const variant of ['No Sugar Added', 'No Sugar', 'Reduced Sugar', 'Reduced Fat', 'Light', 'Zero', 'Spicy']) it(`rejects ${variant} against ordinary/classic ketchup in both directions`, () => {
    assert.equal(ingredientsRejectReason(page(`Tomato Ketchup ${variant}`), context('Classic Tomato Ketchup'), '1234567890128'), 'variant_conflict');
    assert.equal(ingredientsRejectReason(page('Original Tomato Ketchup'), context(`${variant} Tomato Ketchup`), '1234567890128'), 'variant_conflict');
  });
  it('same variant remains usable by name but never claims exact barcode', () => {
    const p = page('Tomato Ketchup No Sugar Added');
    assert.equal(identityFacts(p, context('Tomato Ketchup No Sugar Added'), '1234567890128').barcodeMatch, false);
    assert.equal(ingredientsRejectReason(p, context('Tomato Ketchup No Sugar Added'), '1234567890128'), null);
  });
  it('display-only ingredients never alter estimated sugars or salt', () => {
    const base = food('ketchup');
    const untrusted: Product = { ...base, ingredients: observed([{name:'stevia, salt, E621',percent:null}]), fieldEvidence:[{field:'ingredients',source:'web_search',url:'https://example.test',domain:'example.test',tier:4,confidence:'low',identityMatch:'exact_name',retrievedAt:'2026-01-01',ingredientsOnly:true}] };
    assert.deepEqual(estimateMissingNutrition(untrusted).nutrition, estimateMissingNutrition(base).nutrition);
    assert.equal(forScoring(untrusted).ingredients, NOT_DETECTED);
  });
  for (const name of ['Лапша', 'Пюре картофельное', 'FAGE Total 0%', 'Alpen Gold chocolate', 'mayonnaise']) it(`${name} retains finite scoring and exact data`, () => {
    const p = food(name), result = estimateMissingNutrition(p);
    assert.equal(typeof scoreProduct(result).value, 'number');
    const exact = { ...p, nutrition: { ...result.nutrition!, sugarsG: observed(4.2) } };
    assert.equal(estimateMissingNutrition(exact).nutrition!.sugarsG.value,4.2);
  });
});
