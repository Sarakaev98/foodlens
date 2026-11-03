import assert from 'node:assert/strict';
import { describe,it } from 'node:test';
import { observed, NOT_DETECTED, type NutritionFacts } from '@foodlens/core';
import { checkNutritionSanity } from '../nutrition-sanity';
import { prepareGoalMatchV4 } from '../goal-match-ai-input';
import { HEALTH_FIXTURES,fixtureProduct,healthPlan } from './eat-healthier.fixtures';
import { v4Product } from './goal-match-v4.helpers';

describe('v4 nutrition sanity: complete comparisons only',()=>{
  const n=()=>v4Product().nutrition!;
  it('detects each contradiction independently',()=>{
    for(const [patch,expected] of [
      [{sugarsG:observed(5)},'sugars_exceed_carbs'],
      [{saturatedFatG:observed(3)},'saturated_fat_exceeds_fat'],
      [{proteinG:observed(100),fatG:observed(20)},'macros_exceed_mass'],
      [{caloriesKcal:observed(500),fiberG:observed(0)},'energy_mismatch'],
      [{saltG:observed(31)},'salt_exceeds_limit'],
      [{caloriesKcal:observed(901)},'calories_exceed_limit'],
    ] as const) assert.ok(checkNutritionSanity({...n(),...patch}).includes(expected));
  });
  it('uses strict thresholds, sodium conversion and both energy thresholds',()=>{
    assert.ok(!checkNutritionSanity({...n(),sugarsG:observed(4.1)}).includes('sugars_exceed_carbs'));
    assert.ok(!checkNutritionSanity({...n(),saturatedFatG:observed(2.5)}).includes('saturated_fat_exceeds_fat'));
    assert.ok(checkNutritionSanity({...n(),saltG:NOT_DETECTED,sodiumMg:observed(12400)}).includes('salt_exceeds_limit'));
    const empty={...n(),proteinG:observed(0),carbsG:observed(0),fatG:observed(0),fiberG:observed(0)};
    assert.ok(!checkNutritionSanity({...empty,caloriesKcal:observed(40)}).includes('energy_mismatch'));
    assert.ok(checkNutritionSanity({...empty,caloriesKcal:observed(41)}).includes('energy_mismatch'));
    assert.ok(!checkNutritionSanity({...n(),proteinG:observed(30),fatG:observed(30),carbsG:observed(30),fiberG:observed(0),caloriesKcal:observed(400)}).includes('energy_mismatch'));
  });
  it('does not replace absent operands with zero',()=>{
    assert.ok(!checkNutritionSanity({...n(),carbsG:NOT_DETECTED,sugarsG:observed(50)}).includes('sugars_exceed_carbs'));
    assert.ok(!checkNutritionSanity({...n(),fatG:NOT_DETECTED,saturatedFatG:observed(20)}).includes('saturated_fat_exceeds_fat'));
    for(const key of ['proteinG','fatG','carbsG','saltG'] as const)
      assert.ok(!checkNutritionSanity({...n(),[key]:NOT_DETECTED,proteinG:key==='proteinG'?NOT_DETECTED:observed(120)}).includes('macros_exceed_mass'));
    for(const key of ['proteinG','fatG','carbsG','fiberG','caloriesKcal'] as const)
      assert.ok(!checkNutritionSanity({...n(),fiberG:observed(0),caloriesKcal:observed(500),[key]:NOT_DETECTED}).includes('energy_mismatch'));
  });
  it('normalizes per-serving values only with a known valid serving',()=>{
    const serving={...n(),basis:'per_serving' as const, servingSize:observed({amount:50,unit:'g' as const}),caloriesKcal:observed(460)};
    assert.ok(checkNutritionSanity(serving).includes('calories_exceed_limit'));
    assert.deepEqual(checkNutritionSanity({...serving,servingSize:NOT_DETECTED}),[]);
    assert.deepEqual(checkNutritionSanity(null),[]);
    assert.deepEqual(checkNutritionSanity({...serving,basis:'unknown'}),[]);
  });
  it('does not reject existing normal golden fixtures',()=>{
    for(const f of HEALTH_FIXTURES) assert.deepEqual(checkNutritionSanity(fixtureProduct(f).nutrition),[],f.id);
  });
  it('v4 guards return invalid_nutrition without changing the live v3 route',()=>{
    const p=v4Product(); const prepared=prepareGoalMatchV4({...p,nutrition:{...p.nutrition!,sugarsG:observed(20)}},healthPlan());
    assert.equal(prepared.state,'terminal');
    if(prepared.state==='terminal'){assert.equal(prepared.result.unavailableReason,'invalid_nutrition');assert.equal(prepared.result.value,null);}
  });
  it('hard conflicts and missing-data gates precede sanity',()=>{
    const p=v4Product();const bad={...p,nutrition:{...p.nutrition!,sugarsG:observed(20)}};
    const conflict=prepareGoalMatchV4({...bad,allergens:observed([{code:'milk',presence:'contains',provenance:'observed'}])},{...healthPlan(),allergens:['milk']});
    assert.equal(conflict.state,'terminal');if(conflict.state==='terminal')assert.equal(conflict.result.level,'conflict');
    const missing=prepareGoalMatchV4({...bad,nutrition:{...bad.nutrition,caloriesKcal:NOT_DETECTED}},healthPlan());
    if(missing.state==='terminal')assert.equal(missing.result.unavailableReason,'no_calories');else assert.fail('terminal expected');
  });
});
