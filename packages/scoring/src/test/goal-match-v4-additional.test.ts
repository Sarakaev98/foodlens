import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import {observed,NOT_DETECTED} from '@foodlens/core';
import {v4Product,v4Input,aiOutput,numericV3} from './goal-match-v4.helpers';
import {HEALTH_FIXTURES,fixtureProduct,healthPlan} from './eat-healthier.fixtures';
import {buildGoalMatchAiInput,prepareGoalMatchV4} from '../goal-match-ai-input';
import {matchGoal} from '../match-goal';
import {extractEatHealthierContext} from '../goal-match-v3';
import {validateGoalMatchAiOutput,resolveGoalMatchFact} from '../goal-match-ai-validate';
import {reconcileGoalMatch} from '../goal-match-reconcile';

describe('v4 additional invariants',()=>{
  it('exporting context never changes v3, missing-protein handling or restrictions',()=>{
    for(const fixture of HEALTH_FIXTURES){
      const product=fixtureProduct(fixture),plan=healthPlan();
      const before=matchGoal(product,plan);
      const context=extractEatHealthierContext(product,plan);
      assert.ok(context);assert.deepEqual(context.deterministicBase,before);
      assert.deepEqual(matchGoal(product,plan),before);
    }
  });
  it('uses real restriction-free ranges rather than adding penalties back to a clipped v3 result',()=>{
    const p=v4Product('cola');
    const product={...p,ingredients:observed([{name:'сахар',percent:null}]),allergens:observed([{code:'milk' as const,presence:'may_contain' as const,provenance:'observed' as const}])};
    const prepared=prepareGoalMatchV4(product,{...healthPlan(),allergens:['milk'],avoidedIngredients:['сахар']});
    assert.equal(prepared.state,'ready');if(prepared.state!=='ready')return;
    assert.equal(prepared.deterministic.value,0);assert.equal(prepared.deterministicBase.value,2.5);
    assert.deepEqual(prepared.deterministicBase.range,{min:2.5,max:2.5});
    const result=reconcileGoalMatch({...prepared,ai:aiOutput(3)});
    assert.equal(result.source,'ai');assert.equal(result.value,0);
  });
  it('sanity normalizes per-serving equivalents; AI typicalServing never reaches the AI input',()=>{
    const p=v4Product();const converted={...p.nutrition!,basis:'per_serving' as const};
    for(const key of ['caloriesKcal','proteinG','fatG','carbsG','sugarsG','saturatedFatG','saltG','fiberG'] as const){
      const value=converted[key].value;converted[key]=value===null?NOT_DETECTED:observed(value*1.3);
    }
    assert.deepEqual(buildGoalMatchAiInput({...p,nutrition:converted},healthPlan())!.facts,buildGoalMatchAiInput(p,healthPlan())!.facts);
    const aiServing=prepareGoalMatchV4({...p,nutrition:{...p.nutrition!,servingSize:NOT_DETECTED},
      semantics:{...p.semantics!,typicalServing:{amount:130,unit:'g',confidence:'high',evidence:['package']}}},healthPlan());
    assert.equal(aiServing.state,'terminal');if(aiServing.state!=='terminal')return;
    assert.equal(aiServing.result.source,'deterministic');assert.equal(aiServing.result.ai,null);
    assert.equal(aiServing.result.portion!.basis,'per_100');assert.equal(aiServing.result.confidence,'low');
    assert.notEqual(aiServing.result.value,null);
  });
  it('per-100 without a printed serving never prepares AI input, and a printed serving still does',()=>{
    const p=v4Product(),noServing={...p,nutrition:{...p.nutrition!,servingSize:NOT_DETECTED}};
    assert.equal(prepareGoalMatchV4(noServing,healthPlan()).state,'terminal');
    assert.equal(buildGoalMatchAiInput(noServing,healthPlan()),null);
    const ready=buildGoalMatchAiInput(p,healthPlan())!;
    assert.equal(ready.product.serving.source,'label');assert.equal(ready.product.serving.amount,p.nutrition!.servingSize.value!.amount);
  });
  it('per-100 estimate keeps restriction conflicts and the sanity guard',()=>{
    const p=v4Product(),n={...p.nutrition!,servingSize:NOT_DETECTED};
    const invalid=prepareGoalMatchV4({...p,nutrition:{...n,sugarsG:observed(90),carbsG:observed(10)}},healthPlan());
    assert.equal(invalid.state,'terminal');if(invalid.state!=='terminal')return;
    assert.equal(invalid.result.unavailableReason,'invalid_nutrition');assert.equal(invalid.result.value,null);
  });
  it('v4 adds the documented low cap for both missing bonuses without changing v3',()=>{
    const p=v4Product();const product={...p,nutrition:{...p.nutrition!,proteinG:NOT_DETECTED}};
    const prepared=prepareGoalMatchV4(product,healthPlan());assert.equal(prepared.state,'ready');if(prepared.state!=='ready')return;
    assert.equal(prepared.deterministic.confidence,'medium');assert.equal(prepared.dataConfidence,'low');
    assert.equal(reconcileGoalMatch({...prepared,ai:aiOutput(6.5)}).confidence,'low');
    assert.equal(reconcileGoalMatch({...prepared,ai:null}).confidence,'medium');
  });
  it('leaf missing paths also prohibit derived aliases',()=>{
    const input=v4Input();input.missing.push('product.per100.proteinG');
    assert.equal(resolveGoalMatchFact(input,'facts.perServing.proteinG'),null);
    assert.equal(resolveGoalMatchFact(input,'facts.share.proteinTargetPct'),null);
    assert.equal(validateGoalMatchAiOutput(aiOutput(),input).valid,false);
  });
  it('validates every warning precondition',()=>{
    for(const warning of ['fiber_unknown','serving_estimated','ingredients_missing','sweeteners','contains_alcohol','caffeine'] as const){
      const input=v4Input();
      if(warning==='serving_estimated')input.product.serving.source='ai';
      if(warning==='ingredients_missing'){input.product.ingredientsStatus='unknown';input.product.ingredients=null;}
      if(warning==='sweeteners')input.product.ingredients=['аспартам'];
      if(warning==='contains_alcohol')input.product.ingredients=['этиловый спирт'];
      if(warning==='caffeine')input.product.ingredients=['кофеин'];
      assert.equal(validateGoalMatchAiOutput({...aiOutput(),warnings:[warning]},input).valid,true,warning);
      if(warning==='fiber_unknown')input.missing=[];
      else if(warning==='serving_estimated')input.product.serving.source='label';
      else if(warning==='ingredients_missing')input.product.ingredientsStatus='observed';
      else input.product.ingredients=[];
      assert.equal(validateGoalMatchAiOutput({...aiOutput(),warnings:[warning]},input).valid,false,warning);
    }
  });
  it('does not require inferred-zero sugars/saturated fat as missing facts',()=>{
    const p=v4Product('chicken');
    const input=buildGoalMatchAiInput({...p,nutrition:{...p.nutrition!,carbsG:observed(.5),fatG:observed(.5),sugarsG:NOT_DETECTED,saturatedFatG:NOT_DETECTED}},healthPlan())!;
    assert.equal(input.product.per100.sugarsG,0);assert.equal(input.product.per100.saturatedFatG,0);
    assert.ok(!input.missing.includes('sugarsG'));assert.ok(!input.missing.includes('saturatedFatG'));
  });
  it('range, ceilings and confidence stay finite across all golden products and score grid',()=>{
    for(const fixture of HEALTH_FIXTURES){
      const prepared=prepareGoalMatchV4(fixtureProduct(fixture),healthPlan());
      if(prepared.state!=='ready')continue;
      for(let score=0;score<=10;score+=.5){
        const result=reconcileGoalMatch({...prepared,ai:aiOutput(score)});
        assert.ok(result.value!==null && Number.isFinite(result.value) && result.value>=0 && result.value<=10);
        if(result.source==='deterministic')assert.equal(result.ai,null);
        else assert.equal(result.range,null);
      }
    }
  });
});


it('profile_unavailable remains terminal and invalid plan targets never produce non-finite AI input',()=>{
  const failed=prepareGoalMatchV4(v4Product(),'unavailable');
  assert.equal(failed.state,'terminal');if(failed.state==='terminal')assert.equal(failed.result.unavailableReason,'profile_unavailable');
  for(const caloriesKcal of [0,Infinity,NaN]){
    const result=prepareGoalMatchV4(v4Product(),{...healthPlan(),targets:{...healthPlan().targets,caloriesKcal}});
    assert.equal(result.state,'terminal');if(result.state==='terminal')assert.equal(result.result.state,'insufficient_data');
  }
});
it('canonical ingredient indices are JSON leaf paths, length and objects are not',()=>{
  const input=v4Input();
  assert.equal(resolveGoalMatchFact(input,'product.ingredients.0'),'fixture ingredient');
  assert.equal(resolveGoalMatchFact(input,'product.ingredients.length'),null);
  assert.equal(resolveGoalMatchFact(input,'product.ingredients.__proto__'),null);
  const product=v4Product();
  const inferred={...product,ingredients:{value:[{name:'unverified',percent:null}],provenance:'inferred' as const}};
  const built=buildGoalMatchAiInput(inferred,healthPlan())!;
  assert.equal(built.product.ingredientsStatus,'unknown');assert.equal(built.product.ingredients,null);
  assert.ok(built.missing.includes('product.ingredients'));
});
