import assert from 'node:assert/strict';
import { describe,it } from 'node:test';
import { NOT_DETECTED, observed, inferred, type Product, type ProductId, type NutrientKey } from '@foodlens/core';
import { scoreProduct, roundScore } from '../score-product';
import { matchGoal } from '../match-goal';
import { healthPlan } from './eat-healthier.fixtures';

// Logged 8.2/6.7 scan: extracted numbers, estimated fiber and unknown context.
// This fixture does not claim to verify the original photograph or invent a real serving.
const product:Product={id:'buckwheat-label-replay' as ProductId,name:NOT_DETECTED,brand:NOT_DETECTED,category:observed('protein_product'),
 nutrition:{basis:'per_100g',servingSize:NOT_DETECTED,caloriesKcal:observed(354),proteinG:observed(11.6),carbsG:observed(70.84),fatG:observed(2.89),
 sugarsG:observed(1.24),saturatedFatG:observed(.67),fiberG:inferred(2),saltG:observed(0),sodiumMg:inferred(0)},
 semantics:{version:'semantics-v1',sugarSource:{value:'unknown',confidence:'low',evidence:[]},processing:{value:'unknown',confidence:'low',evidence:[]},productForm:{value:'food',confidence:'low'},typicalServing:null},
 ingredients:NOT_DETECTED,allergens:NOT_DETECTED,additives:NOT_DETECTED,confidence:{overall:'low',identity:'low',nutrition:'low',ingredients:'low'},source:{type:'manual'}};
const fields=Object.fromEntries(Object.keys(product.nutrition!).filter(k=>!['basis','servingSize'].includes(k)).map(key=>[key,
 key==='fiberG'?{quality:'estimated',confidence:'low',method:'context_rules',reason:'logged estimate'}:{quality:'verified',confidence:'high',method:'source',reason:'logged'}])) as NonNullable<Product['nutritionMetadata']>['fields'];
const completed:Product={...product,nutritionMetadata:{version:'context-rules-v5',basis:{quality:'verified',confidence:'high',reason:'source'},fields}};
describe('Buckwheat Label 8.2 / 6.7 audit',()=>{
 it('reproduces Product Score and honest positive/negative/unknown factors',()=>{
  const score=scoreProduct(completed);
  assert.equal(score.value,8.2);assert.equal(score.confidence,'low');assert.deepEqual(score.missingFactors,['additives']);assert.equal(score.ceiling,null);
  const f=(kind:string)=>score.factors.find(f=>f.kind===kind)!;
  assert.deepEqual([f('energy').value,f('energy').points,f('energy').impact],[354,-1.28,'negative']);
  assert.deepEqual([f('protein').points,f('protein').impact],[1.5,'positive']);
  assert.deepEqual([f('fiber').points,f('fiber').impact],[0,'neutral']);
  assert.equal(f('sugars').impact,'positive');assert.equal(f('sugars').points,0);
  assert.equal(f('saturatedFat').impact,'positive');assert.equal(f('saturatedFat').points,0);
  assert.equal(f('additives').level,'not_detected');assert.equal(f('processing').level,'not_detected');
  assert.equal(roundScore(8+score.factors.reduce((sum,f)=>sum+f.points,0)),8.2);
 });
 it('reproduces Goal Match without dividing its 0–10 value or claiming a serving',()=>{
  const result=matchGoal(completed,healthPlan(139));assert.ok(result.version==='goal-match-v3');
  assert.equal(result.value,6.7);assert.equal(result.level,'good');assert.equal(result.confidence,'low');
  assert.deepEqual(result.range,{min:6.2,max:7.7});assert.equal(result.portion?.basis,'per_100');
  assert.deepEqual(result.uncertainty,['processing','typicalServing','nutrition']);
  const protein=result.factors.find(f=>f.kind==='protein')!;
  assert.equal(protein.points,.702088);assert.equal(protein.impact,'positive');assert.equal(protein.value,null);assert.equal(protein.portionShare,null);
  assert.equal(result.factors.filter(f=>f.impact==='negative').length,0);
  assert.equal(Math.round((6+result.factors.reduce((sum,f)=>sum+f.points,0))*10)/10,6.7);
 });
 it('unknown category/name cannot change the formula at a fixed completed nutrition/context input',()=>{
  const changed={...completed,name:observed('Buckwheat'),category:NOT_DETECTED};
  assert.deepEqual(scoreProduct(changed),scoreProduct(completed));assert.deepEqual(matchGoal(changed,healthPlan()),matchGoal(completed,healthPlan()));
 });
});
