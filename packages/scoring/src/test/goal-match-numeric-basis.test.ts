import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import type {GoalMatchAiFactorCode,GoalMatchAiInput} from '@foodlens/core';
import {validateGoalMatchAiOutput} from '../goal-match-ai-validate';
import {aiOutput,v4Input} from './goal-match-v4.helpers';

function input(){
  const x=v4Input();x.product.per100.saltG=1.4;x.facts.levels.salt='moderate';return x;
}
function response(text:string,refs:readonly string[]=['product.per100.saltG'],code:GoalMatchAiFactorCode='high_salt'){
  return {...aiOutput(3.5,[{code,direction:'negative' as const,impact:'high' as const,facts:refs,text}]),
    dimensions:{...aiOutput().dimensions,processing:'strong_negative' as const}};
}
const valid=(text:string,refs?:readonly string[],x:GoalMatchAiInput=input(),code?:GoalMatchAiFactorCode)=>
  validateGoalMatchAiOutput(response(text,refs,code),x).valid;

describe('numeric facts: contextual per-100 basis, not a numeric whitelist',()=>{
  it('allows 1.4 g per 100 g only with a numeric product.per100 reference',()=>{
    const result=validateGoalMatchAiOutput(response('Salt: 1.4 g per 100 g'),input());
    assert.equal(result.valid,true);if(result.valid){assert.equal(result.removedFactors,0);assert.equal(result.adjusted,false);}
  });
  it('allows the actual beverage sugar value 10.6 per 100 ml',()=>{
    assert.equal(valid('Sugars: 10.6 g per 100 ml',['product.per100.sugarsG'],v4Input('cola'),'high_sugar'),true);
  });
  it('still rejects invented 2.4 when the referenced fact is 1.4',()=>{
    assert.equal(valid('Salt: 2.4 g per 100 g'),false);
  });
  it('does not authorize standalone 100 g sugar or unrelated 100 elsewhere',()=>{
    assert.equal(valid('The product has 100 g of sugar'),false);
    assert.equal(valid('Salt: 1.4 g per 100 g, sugars: 100 g'),false);
    assert.equal(valid('100 g per serving'),false);
  });
  it('does not authorize basis constants with only perServing references',()=>{
    const x=input();
    assert.equal(valid('Salt: '+x.facts.perServing.saltG+' g per 100 g',['facts.perServing.saltG'],x),false);
  });
  it('supports RU decimal comma, NBSP whitespace, case and adjoining unit formatting',()=>{
    for(const text of ['Salt: 1,4 g per 100 g','Salt: 1.4 g PER 100 ml','Salt: 1,4 g per\u00a0100\u00a0g','Salt: 1.4 g per 100g'])
      assert.equal(valid(text),true,text);
  });
  it('does not recognize arbitrary words, larger numbers, different bases or unrelated units',()=>{
    for(const text of ['Salt: 1.4 g per 1000 g','Salt: 1.4 g per 200 g','Salt: 1.4 g per 100 kcal',
      'Salt: 1.4 g per 100 gramfake','Length 100 g and salt 1.4 g','Salt: 1.4 g per -100 g'])
      assert.equal(valid(text),false,text);
  });
  it('does not exempt measurements, missing facts or unknown numeric references',()=>{
    assert.equal(valid('Salt: 100 g per 100 g'),false);
    const missing=input();missing.missing.push('saltG');
    assert.equal(valid('Salt: 1.4 g per 100 g',undefined,missing),false);
    assert.equal(valid('Salt: 1.4 g per 100 g',['product.per100.unknown']),false);
  });
  it('applies the same basis rule to a summary backed by validated per100 factors',()=>{
    const output=response('Salt: 1,4 g per 100 g');
    const result=validateGoalMatchAiOutput({...output,summary:'Salt: 1,4 g per 100 g.'},input());
    assert.equal(result.valid,true);if(result.valid){assert.equal(result.output.factors.length,1);assert.equal(result.summaryReplaced,false);}
  });
  it('summary still rejects fabricated measurements and unrelated 100',()=>{
    const output=response('Salt: 1,4 g per 100 g');
    for(const summary of ['Salt: 2,4 g per 100 g.','The product has 100 g of sugar.'])
      assert.equal(validateGoalMatchAiOutput({...output,summary},input()).valid,false);
    const perServing=response('Salt: 0,1 g',['facts.perServing.saltG']);
    assert.equal(validateGoalMatchAiOutput({...perServing,summary:'Salt: 0,1 g per 100 g.'},input()).valid,false);
  });
});
