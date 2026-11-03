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
    const result=validateGoalMatchAiOutput(response('Соль — 1.4 г на 100 г'),input());
    assert.equal(result.valid,true);if(result.valid){assert.equal(result.removedFactors,0);assert.equal(result.adjusted,false);}
  });
  it('allows the actual beverage sugar value 10.6 per 100 ml',()=>{
    assert.equal(valid('Сахара — 10.6 г на 100 мл',['product.per100.sugarsG'],v4Input('cola'),'high_sugar'),true);
  });
  it('still rejects invented 2.4 when the referenced fact is 1.4',()=>{
    assert.equal(valid('Соль — 2.4 г на 100 г'),false);
  });
  it('does not authorize standalone 100 g sugar or unrelated 100 elsewhere',()=>{
    assert.equal(valid('В продукте 100 г сахара'),false);
    assert.equal(valid('Соль — 1.4 г на 100 г, сахара — 100 г'),false);
    assert.equal(valid('В порции 100 г'),false);
  });
  it('does not authorize basis constants with only perServing references',()=>{
    const x=input();
    assert.equal(valid('Соль — '+x.facts.perServing.saltG+' г на 100 г',['facts.perServing.saltG'],x),false);
  });
  it('supports RU decimal comma, NBSP whitespace, case and adjoining unit formatting',()=>{
    for(const text of ['Соль — 1,4 г на 100 г','Соль — 1.4 г НА 100 мл','Соль — 1,4 г на\u00a0100\u00a0г','Соль — 1.4 г на 100г'])
      assert.equal(valid(text),true,text);
  });
  it('does not recognize arbitrary words, larger numbers, different bases or unrelated units',()=>{
    for(const text of ['Соль — 1.4 г на 1000 г','Соль — 1.4 г на 200 г','Соль — 1.4 г на 100 ккал',
      'Соль — 1.4 г на 100 граммфальш','Длина 100 г и соль 1.4 г','Соль — 1.4 г на -100 г'])
      assert.equal(valid(text),false,text);
  });
  it('does not exempt measurements, missing facts or unknown numeric references',()=>{
    assert.equal(valid('Соль — 100 г на 100 г'),false);
    const missing=input();missing.missing.push('saltG');
    assert.equal(valid('Соль — 1.4 г на 100 г',undefined,missing),false);
    assert.equal(valid('Соль — 1.4 г на 100 г',['product.per100.unknown']),false);
  });
  it('applies the same basis rule to a summary backed by validated per100 factors',()=>{
    const output=response('Соль — 1,4 г на 100 г');
    const result=validateGoalMatchAiOutput({...output,summary:'Соль — 1,4 г на 100 г.'},input());
    assert.equal(result.valid,true);if(result.valid){assert.equal(result.output.factors.length,1);assert.equal(result.summaryReplaced,false);}
  });
  it('summary still rejects fabricated measurements and unrelated 100',()=>{
    const output=response('Соль — 1,4 г на 100 г');
    for(const summary of ['Соль — 2,4 г на 100 г.','В продукте 100 г сахара.'])
      assert.equal(validateGoalMatchAiOutput({...output,summary},input()).valid,false);
    const perServing=response('Соль — 0,1 г',['facts.perServing.saltG']);
    assert.equal(validateGoalMatchAiOutput({...perServing,summary:'Соль — 0,1 г на 100 г.'},input()).valid,false);
  });
});
