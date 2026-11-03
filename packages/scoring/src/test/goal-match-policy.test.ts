import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { inferred, NUTRIENT_KEYS, NOT_DETECTED, observed, type GoalMatchV3, type Product } from '@foodlens/core';
import { matchGoal } from '../match-goal';
import { calculateEatHealthier } from '../goal-match-v3-calculation';
import { checkNutritionSanity } from '../nutrition-sanity';
import { HEALTH_FIXTURES, fixtureFeatures, fixtureProduct, healthPlan } from './eat-healthier.fixtures';
const fixture = HEALTH_FIXTURES.find(f=>f.id==='cola')!;
function uncertain(): Product {
 const p=fixtureProduct(fixture);
 return {...p,semantics:{...p.semantics!,sugarSource:{value:'unknown',confidence:'low',evidence:[]},processing:{value:'unknown',confidence:'low',evidence:[]}}};
}
const evaluate=(p:Product):GoalMatchV3=>{
 const result=matchGoal(p,healthPlan());assert.equal(result.version,'goal-match-v3');return result as GoalMatchV3;
};
describe('Goal Match availability: uncertainty is not contradictory nutrition',()=>{
 it('keeps the existing central formula and wide range, with low confidence and reasons',()=>{
  const p=uncertain(),r=evaluate(p);
  assert.equal(checkNutritionSanity(p.nutrition).length,0);
  assert.ok(r.range!.max-r.range!.min>3);
  assert.equal(r.state,'goal_match');assert.equal(r.unavailableReason,null);assert.equal(r.confidence,'low');
  const expected=calculateEatHealthier({...fixtureFeatures(fixture),sugarSource:'unknown',processing:'unknown'});
  assert.equal(r.value,Math.round(expected.score*10)/10);
  assert.ok(r.factors.length>0);assert.ok(r.uncertainty.includes('sugarSource'));assert.ok(r.uncertainty.includes('processing'));
 });
 for(const quality of ['verified','estimated','ai_estimated'] as const) it(`${quality} data is numeric with unchanged nutrient values`,()=>{
  const p=uncertain(),n={...p.nutrition!};
  if(quality!=='verified')for(const key of NUTRIENT_KEYS)if(n[key].value!==null)n[key]=inferred(n[key].value!);
  const product:Product={...p,nutrition:n,nutritionMetadata:{version:'generic-policy-regression',basis:{quality:'verified',confidence:'high',reason:'source'},fields:Object.fromEntries(NUTRIENT_KEYS.map(key=>[key,{quality,confidence:quality==='verified'?'medium':'low',method:quality==='verified'?'source':'context_rules',reason:'test'}])) as NonNullable<Product['nutritionMetadata']>['fields']}};
  const r=evaluate(product);assert.equal(r.value,evaluate(p).value);assert.equal(r.state,'goal_match');assert.equal(r.confidence,'low');
  assert.deepEqual(product.nutrition,n);if(quality!=='verified')assert.ok(r.uncertainty.includes('nutrition'));
 });
 it('missing serving uses the existing per-100 basis and stays numeric',()=>{
  const p=uncertain();const r=evaluate({...p,nutrition:{...p.nutrition!,servingSize:NOT_DETECTED}});
  assert.equal(r.state,'goal_match');assert.equal(typeof r.value,'number');assert.equal(r.portion!.basis,'per_100');assert.ok(r.uncertainty.includes('typicalServing'));
 });
 it('genuinely missing critical nutrients still block the result',()=>{
  const p=uncertain();const r=evaluate({...p,nutrition:{...p.nutrition!,sugarsG:NOT_DETECTED,carbsG:NOT_DETECTED}});
  assert.equal(r.state,'insufficient_data');assert.equal(r.unavailableReason,'missing_nutrients');assert.equal(r.value,null);
 });
 it('unknown energy or basis still returns its objective missing-data reason',()=>{
  const p=uncertain();assert.equal(evaluate({...p,nutrition:{...p.nutrition!,caloriesKcal:NOT_DETECTED}}).unavailableReason,'no_calories');
  assert.equal(evaluate({...p,nutrition:{...p.nutrition!,basis:'unknown'}}).unavailableReason,'unknown_basis');
 });
 it('a wide range with a physical sugar/carbohydrate contradiction remains ambiguous',()=>{
  const p=uncertain();const bad={...p,nutrition:{...p.nutrition!,carbsG:observed(0)}};
  assert.ok(checkNutritionSanity(bad.nutrition).includes('sugars_exceed_carbs'));
  const r=evaluate(bad);assert.equal(r.unavailableReason,'ambiguous');assert.equal(r.state,'insufficient_data');assert.equal(r.value,null);assert.ok(r.uncertainty.includes('nutrition'));
 });
 it('inferred provenance does not excuse a physically contradictory input',()=>{
  const p=uncertain();const bad={...p,nutrition:{...p.nutrition!,carbsG:inferred(0)}};
  assert.equal(evaluate(bad).unavailableReason,'ambiguous');
 });
 it('per-serving representation applies sanity on the same normalized quantities',()=>{
  const p=uncertain(),n={...p.nutrition!,basis:'per_serving' as const};const scale=n.servingSize.value!.amount/100;
  for(const key of NUTRIENT_KEYS)if(n[key].value!==null)n[key]=observed(n[key].value!*scale);
  const r=evaluate({...p,nutrition:n});assert.equal(r.value,evaluate(p).value);assert.equal(r.state,'goal_match');
  assert.equal(evaluate({...p,nutrition:{...n,carbsG:observed(0)}}).unavailableReason,'ambiguous');
 });
});
