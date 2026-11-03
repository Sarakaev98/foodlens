import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GoalMatchUserPlan, Product } from '@foodlens/core';
import { matchGoal } from '../match-goal';
import { scoreProduct } from '../score-product';

// Roshen из реального скана. Goal Match считается без Product Score: от него он не зависит и им не ограничен.
const v = (value: unknown) => ({ value, provenance: value === null ? 'not_detected' : 'observed' });
const field = (value: string) => ({ value, confidence: 'medium', evidence: ['ingredients'] });
const plan = { goal: 'eat_healthier', targets: { proteinG: 139 }, dietaryPreferences: [], allergens: [], avoidedIngredients: [] } as unknown as GoalMatchUserPlan;
const roshen = (serving: number) => ({
  nutrition: { basis: 'per_100g', servingSize: v({ amount: serving, unit: 'g' }), caloriesKcal: v(456), proteinG: v(3.3), carbsG: v(63.6), sugarsG: v(58.6), fatG: v(19.3), saturatedFatG: v(11.2), fiberG: v(null), saltG: v(0.01), sodiumMg: v(null) },
  ingredients: v([{ name: 'сахар', percent: null }]), allergens: v([]), category: v(null), additives: v([{ code: 'E476', name: null }]),
  semantics: { version: 'semantics-v1', sugarSource: field('added'), processing: field('ultra_processed'), productForm: { value: 'food', confidence: 'medium' }, typicalServing: null },
  confidence: { overall: 'high', identity: 'high', nutrition: 'high', ingredients: 'high' },
}) as unknown as Product;

describe('Goal Match is independent of Product Score', () => {
  it('the raw calculation knows nothing of Product Score: a small portion goes above it', () => {
    assert.ok(matchGoal(roshen(20), plan).value! > scoreProduct(roshen(20)).value!);
  });
  it('the portion still changes Goal Match while Product Score stays the same', () => {
    assert.equal(scoreProduct(roshen(100)).value, scoreProduct(roshen(20)).value);
    assert.ok(matchGoal(roshen(100), plan).value! < matchGoal(roshen(20), plan).value!);
  });
});
