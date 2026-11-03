import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Product } from '@foodlens/core';
import { scoreProduct } from '../score-product';

// Контрольный набор: типичные значения на 100 г/мл, не измерения. Только Roshen взят из реального скана.
// Значения Product Score зафиксированы как есть: при изменении формулы этот тест должен упасть.
const v = (value: unknown) => ({ value, provenance: value === null ? 'not_detected' : 'observed' });
type Row = readonly [name: string, unit: 'g' | 'ml', kcal: number, protein: number, sugars: number, saturated: number, fiber: number | null, salt: number, additives: number, score: number];
const CONTROL: readonly Row[] = [
  ['овсянка', 'g', 370, 12, 1, 1.2, 10, 0.02, 0, 8.6],
  ['вода', 'ml', 0, 0, 0, 0, 0, 0, 0, 8],
  ['творог 5%', 'g', 121, 17, 1.8, 3, 0, 0.1, 0, 8],
  ['йогурт натуральный', 'g', 62, 3.5, 4.7, 2.1, 0, 0.12, 0, 7.5],
  ['яблоко', 'g', 52, 0.3, 10.4, 0.03, 2.4, 0, 0, 7.1],
  ['cola', 'ml', 42, 0, 10.6, 0, 0, 0.01, 3, 3.5],
  ['сладкие хлопья', 'g', 390, 7, 30, 1.5, 3.5, 0.9, 2, 3.3],
  ['чипсы', 'g', 540, 6, 1, 3.5, 4, 1.5, 3, 3.2],
  ['Roshen', 'g', 456, 3.3, 58.6, 11.2, null, 0.01, 1, 2.1],
  ['Snickers лесной орех', 'g', 514, 7.5, 48, 10, 2, 0.37, 3, 2],
];

function product([, unit, kcal, protein, sugars, saturated, fiber, salt, additives]: Row): Product {
  return {
    nutrition: { basis: unit === 'ml' ? 'per_100ml' : 'per_100g', servingSize: v(null), caloriesKcal: v(kcal), proteinG: v(protein), carbsG: v(null), sugarsG: v(sugars), fatG: v(null), saturatedFatG: v(saturated), fiberG: v(fiber), saltG: v(salt), sodiumMg: v(null) },
    additives: v(Array.from({ length: additives }, (_, index) => ({ code: `E10${index}`, name: null }))),
    confidence: { overall: 'high', identity: 'high', nutrition: 'high', ingredients: 'high' },
  } as unknown as Product;
}

describe('Product Score control set', () => {
  it('keeps the current value of each control product', () => {
    for (const row of CONTROL) assert.equal(scoreProduct(product(row)).value, row[9], row[0]);
  });
  it('good products stay on top and obviously poor ones at the bottom', () => {
    const scores = CONTROL.map((row) => scoreProduct(product(row)).value!);
    assert.ok(Math.min(...scores.slice(0, 5)) >= 7);
    assert.ok(Math.max(...scores.slice(5)) < 4);
  });
});
