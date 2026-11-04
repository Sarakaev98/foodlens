import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import type {GoalMatchFactor,GoalMatchAiOutput} from '@foodlens/core';
import {reconcileGoalMatch,goalMatchRiskCeiling,type GoalMatchReconciliationInput} from '../goal-match-reconcile';
import {prepareGoalMatchV4} from '../goal-match-ai-input';
import {validateGoalMatchAiOutput} from '../goal-match-ai-validate';
import {fixtureProduct,healthPlan,type HealthFixture} from './eat-healthier.fixtures';
import {v4Product,numericV3,aiOutput} from './goal-match-v4.helpers';
const risks={sugars:0,saturatedFat:0,salt:0};
function args(value:number,score:number|null):GoalMatchReconciliationInput{
  return {ai:score===null?null:aiOutput(score),deterministic:numericV3(value),deterministicBase:numericV3(value),riskRamps:risks,restrictions:[]};
}
describe('v4 reconciliation: asymmetric corridor, no averaging',()=>{
  it('chips 4.2 -> AI 3.0 is accepted; 6.5 is clamped to 5.7',()=>{
    const lower=reconcileGoalMatch(args(4.2,3));
    assert.equal(lower.source,'ai');assert.equal(lower.value,3);assert.equal(lower.adjusted,false);
    const higher=reconcileGoalMatch(args(4.2,6.5));
    assert.equal(higher.source,'ai');assert.equal(higher.value,5.7);assert.equal(higher.adjusted,true);
    assert.equal(higher.confidence,'medium');assert.equal(higher.ai_disagreement,false);
  });
  it('protein bar 8.9 -> 5.5 is accepted; cola hallucination 9.0 falls back to 2.5',()=>{
    assert.equal(reconcileGoalMatch(args(8.9,5.5)).value,5.5);
    const cola=reconcileGoalMatch({...args(2.5,9),riskRamps:{...risks,sugars:1}});
    assert.equal(cola.value,2.5);assert.equal(cola.source,'deterministic');assert.equal(cola.ai,null);
    assert.equal(cola.ai_disagreement,true);assert.equal(cola.confidence,'medium');
  });
  it('tests lower/upper boundaries, exactly one point and over one point',()=>{
    for(const [score,value,source,adjusted]of [
      [5,5,'ai',false],[10,10,'ai',false],[4,5,'ai',true],[3.5,8.5,'deterministic',false],
    ] as const){const r=reconcileGoalMatch(args(8.5,score));assert.equal(r.value,value);assert.equal(r.source,source);assert.equal(r.adjusted,adjusted);}
    const exact=reconcileGoalMatch(args(4,6.5));assert.equal(exact.value,5.5);assert.equal(exact.source,'ai');
    const over=reconcileGoalMatch(args(4,7));assert.equal(over.value,4);assert.equal(over.source,'deterministic');
  });
  it('clamps corridor to 0–10 before comparison',()=>{
    assert.equal(reconcileGoalMatch(args(.5,0)).value,0);
    assert.equal(reconcileGoalMatch(args(9.5,10)).value,10);
    assert.throws(()=>reconcileGoalMatch(args(9.5,10.5)),/0–10/);
  });
  it('uses base range instead of an already restricted score, with penalties applied once',()=>{
    const restrictions:GoalMatchFactor[]=[
      {id:'allergens.may_contain',kind:'allergens',level:'may_contain',impact:'negative',points:-3,value:null,portionShare:null,matches:['milk']},
      {id:'avoidedIngredients.conflict',kind:'avoidedIngredients',level:'conflict',impact:'negative',points:-4,value:null,portionShare:null,matches:['test']},
    ];
    const d={...numericV3(2),range:{min:2,max:2},factors:restrictions};
    const input={...args(9,9),deterministic:d,restrictions};
    assert.equal(reconcileGoalMatch(input).value,2);
    assert.equal(reconcileGoalMatch({...input,ai:null}).value,2);
    // Ceiling first, restrictions second: 4.5 - 3 - 4 => 0.
    assert.equal(reconcileGoalMatch({...input,riskRamps:{...risks,sugars:1}}).value,0);
  });
  it('all ceiling rules, exact .8 boundaries and combination minima',()=>{
    assert.equal(goalMatchRiskCeiling({sugars:.8,saturatedFat:0,salt:0}),4.5);
    assert.equal(goalMatchRiskCeiling({sugars:0,saturatedFat:.8,salt:0}),5);
    assert.equal(goalMatchRiskCeiling({sugars:0,saturatedFat:0,salt:.8}),5.5);
    assert.equal(goalMatchRiskCeiling({sugars:.8,saturatedFat:.8,salt:0}),3.5);
    assert.equal(goalMatchRiskCeiling({sugars:0,saturatedFat:.8,salt:.8}),3.5);
    assert.equal(goalMatchRiskCeiling({sugars:.799,saturatedFat:.799,salt:.799}),10);
    for(const riskRamps of [{sugars:1,saturatedFat:0,salt:0},{sugars:0,saturatedFat:1,salt:0},{sugars:0,saturatedFat:0,salt:1},{sugars:1,saturatedFat:1,salt:0}]){
      assert.equal(reconcileGoalMatch({...args(8,8),riskRamps}).value,goalMatchRiskCeiling(riskRamps));
    }
  });
  it('preserves unavailable/invalid/conflict handling and minimum confidence',()=>{
    const unavailable=reconcileGoalMatch({...args(8,null),deterministic:{...numericV3(8),confidence:'high'}});
    assert.equal(unavailable.confidence,'high');assert.equal(unavailable.ai_disagreement,false);
    assert.equal(reconcileGoalMatch({...args(8,null),aiStatus:'invalid'}).confidence,'medium');
    assert.equal(reconcileGoalMatch({...args(8,8),ai:{...aiOutput(8),confidence:'low'}}).confidence,'low');
    assert.equal(reconcileGoalMatch({...args(8,8),deterministic:{...numericV3(8),confidence:'low'}}).confidence,'low');
    assert.equal(reconcileGoalMatch({...args(8,8),validationAdjusted:true}).confidence,'medium');
    const conflict={...numericV3(0),level:'conflict' as const};
    assert.equal(reconcileGoalMatch({...args(0,10),deterministic:conflict}).value,0);
    const noData={...numericV3(0),value:null,level:null,state:'insufficient_data' as const};
    assert.equal(reconcileGoalMatch({...args(0,10),deterministic:noData}).value,null);
  });
});
describe('v4 pure end-to-end fixtures: preparation -> validation -> reconciliation',()=>{
  it('apple accepts 8.5 without any Product Score input',()=>{
    const prepared=prepareGoalMatchV4(v4Product('apple'),healthPlan());assert.equal(prepared.state,'ready');if(prepared.state!=='ready')return;
    const output=aiOutput(8.5,[{code:'whole_food',direction:'positive',impact:'high',facts:['semantics.processing.value'],text:'Whole food.'}]);
    const validation=validateGoalMatchAiOutput(output,prepared.input);assert.equal(validation.valid,true);if(!validation.valid)return;
    const result=reconcileGoalMatch({...prepared,ai:validation.output,validationAdjusted:validation.adjusted});
    assert.equal(result.value,8.5);assert.equal(result.source,'ai');assert.equal(result.version,'goal-match-v4');
  });
  it('protein bar with declared nutrients has v3 8.9 and accepts AI 5.5',()=>{
    const fixture:HealthFixture={id:'protein_bar',label:'Protein bar',portion:60,values:[350,30,12,25,2,2,.2,8],
      sugarSource:'added',processing:'ultra_processed',productForm:'food',sanity:null,expected:8.9};
    const original=fixtureProduct(fixture);
    const product={...original,ingredients:{value:[{name:'сукралоза',percent:null}],provenance:'observed' as const}};
    const prepared=prepareGoalMatchV4(product,healthPlan());assert.equal(prepared.state,'ready');if(prepared.state!=='ready')return;
    assert.equal(prepared.deterministic.value,8.9);
    const output=aiOutput(5.5,[{code:'sweeteners',direction:'negative',impact:'high',facts:['product.ingredients'],text:'Contains a sweetener.'}]);
    const valid=validateGoalMatchAiOutput(output,prepared.input);assert.equal(valid.valid,true);if(!valid.valid)return;
    const result=reconcileGoalMatch({...prepared,ai:valid.output});
    assert.equal(result.value,5.5);assert.equal(result.source,'ai');
  });
  it('chips and cola stress scenarios use real v3 base and risk ramps',()=>{
    for(const [id,score,expected,source]of [['chips',3,3,'ai'],['chips',6.5,5.7,'ai'],['cola',9,2.5,'deterministic']] as const){
      const prepared=prepareGoalMatchV4(v4Product(id),healthPlan());assert.equal(prepared.state,'ready');if(prepared.state!=='ready')continue;
      const result=reconcileGoalMatch({...prepared,ai:aiOutput(score)});
      assert.equal(result.value,expected);assert.equal(result.source,source);
    }
  });
});
