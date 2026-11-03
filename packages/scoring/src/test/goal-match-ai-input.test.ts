import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import {NOT_DETECTED,observed} from '@foodlens/core';
import {buildGoalMatchAiInput,prepareGoalMatchV4} from '../goal-match-ai-input';
import {healthPlan} from './eat-healthier.fixtures';
import {v4Product} from './goal-match-v4.helpers';

describe('v4 AI input: deterministic facts without scores or restrictions',()=>{
  it('Greek yogurt matches the document example at a 2230 kcal / 139 g protein plan',()=>{
    const p=v4Product();
    const product={...p,name:observed('Греческий йогурт 2%'),category:observed('dairy' as const),
      ingredients:observed([{name:'молоко нормализованное',percent:null},{name:'закваска',percent:null}])};
    const plan={...healthPlan(),targets:{...healthPlan().targets,caloriesKcal:2230,fatG:74,carbsG:251}};
    const input=buildGoalMatchAiInput(product,plan)!;
    assert.deepEqual(input,{
      version:'goal-match-ai-input-v1',goal:'eat_healthier',locale:'en',
      product:{name:'Греческий йогурт 2%',brand:null,category:'dairy',ingredients:['молоко нормализованное','закваска'],
        ingredientsStatus:'observed',additives:[],basis:'per_100g',
        per100:{kcal:66,proteinG:9.5,fatG:2,saturatedFatG:1.3,carbsG:3.6,sugarsG:3.6,fiberG:null,saltG:.1},
        serving:{amount:130,unit:'g',source:'label'}},
      semantics:{sugarSource:{value:'intrinsic',confidence:'high'},processing:{value:'whole_or_minimal',confidence:'high'},productForm:{value:'food',confidence:'high'}},
      facts:{perServing:{kcal:85.8,proteinG:12.4,sugarsG:4.7,freeSugarsG:0,saturatedFatG:1.7,saltG:.1,fiberG:null},
        share:{dailyKcalPct:3.8,proteinTargetPct:8.9,freeSugarLimitPct:0,saturatedFatLimitPct:8.5,saltLimitPct:2.6},
        density:{proteinKcalPct:57.6,fiberPer100kcal:null,saturatedFatPer100kcal:2},
        levels:{protein:'high',fiber:'unknown',freeSugar:'low',saturatedFat:'low',salt:'low'}},
      user:{dailyKcal:2230,proteinTargetG:139,fatTargetG:74,carbsTargetG:251},missing:['fiberG'],
    });
    const serialized=JSON.stringify(input);
    for(const field of ['score','allergens','dietaryPreferences','avoidedIngredients','age','sex'])
      assert.ok(!serialized.includes('"'+field+'"'));
  });
  it('missing protein builds unknown fields without modifying Product or expanding the range',()=>{
    const p=v4Product();const missing={...p,nutrition:{...p.nutrition!,proteinG:NOT_DETECTED}};
    const before=JSON.stringify(missing);const r=prepareGoalMatchV4(missing,healthPlan());
    assert.equal(r.state,'ready');if(r.state!=='ready')return;
    assert.equal(r.input.product.per100.proteinG,null);assert.equal(r.input.facts.perServing.proteinG,null);
    assert.equal(r.input.facts.share.proteinTargetPct,null);assert.equal(r.input.facts.density.proteinKcalPct,null);
    assert.equal(r.input.facts.levels.protein,'unknown');assert.ok(r.input.missing.includes('proteinG'));
    assert.equal(r.deterministic.value,6.6);assert.deepEqual(r.deterministic.range,{min:6.6,max:6.6});
    assert.equal(r.deterministic.confidence,'medium');assert.equal(JSON.stringify(missing),before);
  });
  it('keeps terminal states terminal and does not infer not_applicable from unknown protein',()=>{
    assert.equal(prepareGoalMatchV4(v4Product(),null).state,'terminal');
    const p=v4Product('trace_water');const whole={...p,semantics:{...p.semantics!,processing:{value:'whole_or_minimal' as const,confidence:'high' as const,evidence:['water']}}};
    assert.equal(prepareGoalMatchV4(whole,healthPlan()).state,'terminal');
    assert.equal(prepareGoalMatchV4({...whole,nutrition:{...whole.nutrition!,proteinG:NOT_DETECTED}},healthPlan()).state,'ready');
  });
  it('uses conservative semantic values and reports missing ingredients',()=>{
    const p=v4Product();const input=buildGoalMatchAiInput({...p,ingredients:NOT_DETECTED,additives:NOT_DETECTED,
      semantics:{...p.semantics!,processing:{value:'whole_or_minimal',confidence:'low',evidence:['uncertain']}}},healthPlan());
    assert.equal(input!.semantics.processing.value,'unknown');assert.equal(input!.product.ingredients,null);
    assert.ok(input!.missing.includes('product.ingredients'));
  });
});
