import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Logger } from '@nestjs/common';
import type { AIProvider } from '@foodlens/ai';
import { inferred, NOT_DETECTED, observed, type NutrientKey, type Product } from '@foodlens/core';
import { limitByProductScore, matchGoal, scoreProduct } from '@foodlens/scoring';
import { demoProduct, eatHealthierPlan } from '../../goal-match/test/goal-match-v4.fixtures';
import type { NutritionTargetsService } from '../../nutrition-targets/nutrition-targets.service';
import { estimateMissingNutrition } from '../nutrition-estimator';
import { ScanService } from '../scan.service';

Logger.overrideLogger(false);
const plan = eatHealthierPlan();
const base = () => demoProduct({ id: 'generic-meal', name: 'Обычный пищевой продукт', portion: 100,
  values: [350, 6, 7.5, 65, 12, 4, 2, 3], sugarSource: 'added', processing: 'ultra_processed', productForm: 'food', ingredients: ['мука', 'сахар', 'растительное масло', 'соль'] });
const partial = (product = base()): Product => ({ ...product, nutrition: { ...product.nutrition!, sugarsG: NOT_DETECTED, saturatedFatG: NOT_DETECTED, fiberG: NOT_DETECTED, saltG: NOT_DETECTED, sodiumMg: NOT_DETECTED } });
const file = () => { const buffer = Buffer.from([0xff,0xd8,0xff,0xe0,0,0x10,0x4a,0x46]); return { mimetype: 'image/jpeg', buffer, size: buffer.length }; };
async function scan(product: Product, goal = plan) {
  const ai = { name: 'stub', analyzeProduct: async () => product } as unknown as AIProvider;
  const plans = { findPlanForUser: async () => goal } as unknown as NutritionTargetsService;
  return new ScanService(ai, plans, undefined, undefined, async () => null).analyze(file(), 'unit-user');
}

describe('Goal Match uses the completed nutrition snapshot', () => {
  it('coherent completed nutrition and unknown semantics remain numeric through ScanService', async () => {
    const p = demoProduct({id:'generic-condiment',name:'Обычный томатный соус',portion:100,
      values:[102,1.2,0.1,23.2,22.67,0,1.77,1],sugarSource:'unknown',processing:'unknown',productForm:'food',ingredients:[]});
    const input: Product = {...p, ingredients: NOT_DETECTED, nutrition: {...p.nutrition!,fiberG:NOT_DETECTED}};
    const result = await scan(input);
    assert.ok(result.goalMatch.version === 'goal-match-v3');
    assert.equal(result.goalMatch.state,'goal_match'); assert.equal(typeof result.goalMatch.value,'number');
    assert.equal(result.goalMatch.unavailableReason,null); assert.equal(result.goalMatch.confidence,'low');
    assert.ok(result.goalMatch.range!.max-result.goalMatch.range!.min>3);
    assert.ok(result.goalMatch.uncertainty.includes('nutrition'));
    assert.equal(result.product.nutrition!.fiberG.provenance,'inferred');
  });
  it('verified nutrition produces numeric v3', () => {
    const gm = matchGoal(base(), plan);
    assert.equal(gm.version, 'goal-match-v3'); assert.equal(gm.state, 'goal_match');
    assert.equal(typeof gm.value, 'number'); assert.equal(gm.unavailableReason, null);
    assert.equal(gm.confidence, 'high');
  });
  for (const [field, kind] of [['sugarsG','sugars'], ['saturatedFatG','saturatedFat'], ['saltG','salt']] as const) {
    it(`inferred ${field} contributes exactly as its observed value, with lower confidence`, () => {
      const verified = base(); const n = verified.nutrition!;
      const input = { ...verified, nutrition: { ...n, [field]: inferred(n[field].value!) } };
      const gm = matchGoal(input, plan), exact = matchGoal(verified, plan);
      assert.equal(gm.state, 'goal_match'); assert.equal(gm.value, exact.value);
      assert.equal(gm.unavailableReason, null); assert.equal(gm.confidence, 'medium');
      assert.ok(gm.version === 'goal-match-v3' && gm.uncertainty.includes('nutrition'));
      const factor = gm.factors.find(f => f.kind === kind)!;
      assert.equal(factor.value, n[field].value); assert.ok(factor.points < 0);
      assert.equal(input.nutrition[field].provenance, 'inferred');
    });
  }
  it('all remaining estimates are numeric and retain low-confidence field metadata', async () => {
    const result = await scan(partial());
    assert.equal(result.goalMatch.state, 'goal_match'); assert.equal(typeof result.goalMatch.value, 'number');
    assert.equal(result.goalMatch.unavailableReason, null);
    assert.ok(result.goalMatch.version === 'goal-match-v3' && result.goalMatch.uncertainty.includes('nutrition'));
    for (const field of ['sugarsG','saturatedFatG','fiberG','saltG','sodiumMg'] as NutrientKey[]) {
      assert.equal(result.product.nutrition![field].provenance, 'inferred');
      assert.equal(result.product.nutritionMetadata!.fields[field].quality, 'estimated');
      assert.equal(result.product.nutritionMetadata!.fields[field].confidence, 'low');
    }
  });
  it('an estimated fiber value is disclosed even when all critical inputs came from the label', async () => {
    const product = base();
    const result = await scan({ ...product, nutrition: { ...product.nutrition!, fiberG: NOT_DETECTED } });
    assert.equal(result.goalMatch.state, 'goal_match');
    assert.notEqual(result.goalMatch.confidence, 'high');
    assert.ok(result.goalMatch.version === 'goal-match-v3' && result.goalMatch.uncertainty.includes('nutrition'));
    assert.equal(result.product.nutritionMetadata!.fields.fiberG.quality, 'estimated');
  });
  it('Product Score and Goal Match consume the same logged snapshot after estimation', async () => {
    const lines: string[] = [];
    const capture = (message: unknown) => lines.push(String(message));
    Logger.overrideLogger({ log: capture, warn: capture, error: capture });
    try {
      const result = await scan(partial());
      const input = (stage: string) => JSON.parse(lines.find(line => line.startsWith(stage+' '))!.slice(stage.length+1));
      const productInput = input('SCORING_INPUT'), goalInput = input('GOAL_MATCH_INPUT');
      assert.equal(productInput.requestId, goalInput.requestId);
      assert.deepEqual(productInput.nutrition, goalInput.nutrition);
      assert.deepEqual(goalInput.nutrition, result.product.nutrition);
      assert.deepEqual(goalInput.nutritionMetadata, result.product.nutritionMetadata);
      assert.deepEqual(result.score, scoreProduct(result.product));
      assert.deepEqual(result.goalMatch, limitByProductScore(matchGoal(result.product, plan), result.score));
    } finally { Logger.overrideLogger(false); }
  });
  it('a genuinely absent critical value at the Goal Match boundary still returns missing_nutrients', () => {
    const completed = estimateMissingNutrition(partial());
    const missing = { ...completed, nutrition: { ...completed.nutrition!, sugarsG: NOT_DETECTED } };
    const gm = matchGoal(missing, plan);
    assert.equal(gm.value, null); assert.equal(gm.state, 'insufficient_data'); assert.equal(gm.unavailableReason, 'missing_nutrients');
  });
  it('legacy v1 goals receive completed inputs, keeping their existing 0–100 API units', async () => {
    for (const goal of ['lose_weight', 'maintain_weight', 'gain_weight'] as const) {
      const userPlan = eatHealthierPlan({ goal }); const result = await scan(partial(), userPlan);
      assert.equal(result.goalMatch.version, 'goal-match-v1');
      assert.equal(typeof result.goalMatch.value, 'number');
      assert.deepEqual(result.goalMatch, matchGoal(result.product, userPlan));
    }
  });
  for (const sample of [
    { name: 'Картофельное пюре с куриным вкусом', barcode: '4605496000815', category: 'ready_meal', portion: 40, values: [350,6,7.5,65,null,null,null,null] },
    { name: 'Choco Pie', barcode: '4607084351385', category: 'bakery', portion: 30, values: [433,4.5,18,63,null,null,null,null] },
  ] as const) it(`${sample.name}: numeric v3 after the same generic completion`, async () => {
    const product = demoProduct({ id: sample.barcode, name: sample.name, portion: sample.portion, values: sample.values, sugarSource: 'added', processing: 'ultra_processed', productForm: 'food', ingredients: ['мука', 'растительное масло', 'соль'] });
    const result = await scan({ ...product, category: observed(sample.category) });
    assert.equal(result.goalMatch.state, 'goal_match'); assert.equal(typeof result.goalMatch.value, 'number');
    assert.ok(result.goalMatch.value! >= 0 && result.goalMatch.value! <= 10);
    assert.equal(result.goalMatch.unavailableReason, null);
    assert.deepEqual(result.goalMatch, limitByProductScore(matchGoal(result.product, plan), result.score));
    assert.ok(result.goalMatch.factors.some(f=>f.kind === 'salt' && f.points < 0));
  });
});
