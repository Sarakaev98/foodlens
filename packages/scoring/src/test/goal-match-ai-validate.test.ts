import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import {GOAL_MATCH_AI_FACTOR_CODES,type GoalMatchAiFactorCode,type GoalMatchAiFactor} from '@foodlens/core';
import {validateGoalMatchAiOutput,resolveGoalMatchFact,factorCodeAllowed} from '../goal-match-ai-validate';
import {v4Input,aiOutput,type Mutable} from './goal-match-v4.helpers';

function allowedInput(code:GoalMatchAiFactorCode) {
  const x=v4Input();
  switch(code){
    case 'fiber_source': x.product.per100.fiberG=3;x.facts.levels.fiber='high';x.missing=[];break;
    case 'good_fat_profile':x.product.per100.fatG=10;x.product.per100.saturatedFatG=1;break;
    case 'ultra_processed':x.semantics.processing.value='ultra_processed';break;
    case 'added_sugar':x.semantics.sugarSource.value='added';x.facts.perServing.freeSugarsG=4;break;
    case 'high_sugar':x.facts.levels.freeSugar='high';break;
    case 'high_saturated_fat':x.facts.levels.saturatedFat='high';break;
    case 'high_salt':x.facts.levels.salt='high';break;
    case 'sweeteners':x.product.ingredients=['сукралоза'];break;
    case 'fried_or_refined_oil':x.product.ingredients=['картофель обжаренный','масло растительное'];break;
    case 'refined_starch':x.product.ingredients=['мука пшеничная высшего сорта'];break;
    case 'low_nutrient_density':x.facts.levels.protein='low';x.facts.levels.freeSugar='moderate';break;
    case 'energy_dense':x.facts.share.dailyKcalPct=25;break;
  }
  return x;
}
const positives=['high_protein','fiber_source','whole_food','intrinsic_sugar','low_sugar','good_fat_profile','low_salt','fits_portion'];
const codeRef:Record<GoalMatchAiFactorCode,string>={
  high_protein:'facts.perServing.proteinG',fiber_source:'product.per100.fiberG',whole_food:'semantics.processing.value',
  intrinsic_sugar:'semantics.sugarSource.value',low_sugar:'product.per100.sugarsG',good_fat_profile:'product.per100.fatG',
  low_salt:'product.per100.saltG',fits_portion:'facts.share.dailyKcalPct',ultra_processed:'semantics.processing.value',
  added_sugar:'facts.perServing.freeSugarsG',high_sugar:'facts.levels.freeSugar',high_saturated_fat:'facts.levels.saturatedFat',
  high_salt:'facts.levels.salt',sweeteners:'product.ingredients',fried_or_refined_oil:'product.ingredients',
  refined_starch:'product.ingredients',low_nutrient_density:'facts.levels.protein',energy_dense:'facts.share.dailyKcalPct',
};
describe('v4 AI validation: every factor code',()=>{
  for(const code of GOAL_MATCH_AI_FACTOR_CODES){
    it(code+' accepts its documented precondition and rejects absent evidence',()=>{
      const input=allowedInput(code);
      const factor:GoalMatchAiFactor={code,direction:positives.includes(code)?'positive':'negative',impact:'high',facts:[codeRef[code]],text:'Учтены данные продукта.'};
      assert.equal(factorCodeAllowed(code,input),true);
      assert.equal(validateGoalMatchAiOutput(aiOutput(8.5,[factor]),input).valid,true);
      // Missing canonical leaf paths override even otherwise populated input values.
      input.missing.push(codeRef[code]);
      assert.equal(validateGoalMatchAiOutput(aiOutput(8.5,[factor]),input).valid,false);
    });
  }
  it('rejects false preconditions even when a referenced fact exists',()=>{
    for(const code of GOAL_MATCH_AI_FACTOR_CODES){
      const x=allowedInput(code);
      switch(code){
        case 'high_protein':x.facts.levels.protein='low';break;
        case 'fiber_source':x.facts.levels.fiber='low';break;
        case 'whole_food':x.semantics.processing.confidence='low';break;
        case 'intrinsic_sugar':x.semantics.sugarSource.confidence='low';break;
        case 'low_sugar':x.product.per100.sugarsG=20;break;
        case 'good_fat_profile':x.product.per100.saturatedFatG=8;break;
        case 'low_salt':x.product.per100.saltG=1;break;
        case 'fits_portion':x.facts.share.dailyKcalPct=16;break;
        case 'ultra_processed':x.semantics.processing.value='processed';break;
        case 'added_sugar':x.facts.perServing.freeSugarsG=0;break;
        case 'high_sugar':x.facts.levels.freeSugar='low';break;
        case 'high_saturated_fat':x.facts.levels.saturatedFat='low';break;
        case 'high_salt':x.facts.levels.salt='low';break;
        case 'sweeteners':case 'fried_or_refined_oil':case 'refined_starch':x.product.ingredientsStatus='unknown';break;
        case 'low_nutrient_density':x.facts.levels.protein='moderate';break;
        case 'energy_dense':x.facts.share.dailyKcalPct=19;break;
      }
      assert.equal(factorCodeAllowed(code,x),false,code);
    }
  });
});
describe('v4 AI validation: hallucinations, schema and rubric',()=>{
  it('accepts the yogurt response and whole percent rounding',()=>{
    assert.equal(validateGoalMatchAiOutput(aiOutput(),v4Input()).valid,true);
    const x=aiOutput();assert.equal(validateGoalMatchAiOutput(JSON.stringify(x),v4Input()).valid,true);
  });
  it('rejects malformed JSON, extra keys, enums, bounds, score steps, lengths and impact order',()=>{
    const base=aiOutput();
    for(const bad of [
      '{',null,{}, {...base,extra:true},{...base,score:8.7},{...base,score:11},{...base,score:NaN},
      {...base,band:'unknown'},{...base,version:'v1'},{...base,factors:[]},{...base,factors:Array(5).fill(base.factors[0])},
      {...base,summary:'я'.repeat(141)},{...base,summary:'Первая фраза. Вторая фраза.'},
      {...base,confidence:'maybe'},{...base,dimensions:{}},{...base,warnings:['unknown']},
      {...base,factors:[{...base.factors[0],text:'я'.repeat(91)}]},
      {...base,factors:[{...base.factors[0],facts:[]}]},
      {...base,factors:[{...base.factors[0],code:'unknown'}]},
      {...base,factors:[{...base.factors[0],impact:'low'},{...base.factors[0],code:'low_salt',impact:'high'}]},
    ]) assert.equal(validateGoalMatchAiOutput(bad,v4Input()).valid,false,JSON.stringify(bad));
  });
  it('checks all five band/dimensions rules',()=>{
    const input=v4Input('cola');
    const neutral={nutrientDensity:'neutral',processing:'neutral',sugar:'neutral',fatQuality:'neutral',sodium:'neutral',portion:'neutral'} as const;
    const whole=aiOutput(8.5,[{code:'high_sugar',direction:'negative',impact:'high',facts:['facts.levels.freeSugar'],text:'Высокая доля свободных сахаров.'}]);
    const cases=[
      [9,{...neutral,nutrientDensity:'positive',processing:'strong_positive'},true],
      [9,neutral,false],[8,neutral,true],[8,{...neutral,sugar:'strong_negative'},false],
      [6,{...neutral,sugar:'strong_negative'},true],[6,{...neutral,sugar:'strong_negative',sodium:'strong_negative'},false],
      [4,{...neutral,sugar:'strong_negative',sodium:'strong_negative'},true],
      [4,{...neutral,sugar:'strong_negative',processing:'negative'},true],[4,neutral,false],
      [2,neutral,true],
    ] as const;
    for(const [score,dimensions,valid]of cases)
      assert.equal(validateGoalMatchAiOutput({...aiOutput(score,whole.factors),dimensions},input).valid,valid,score+JSON.stringify(dimensions));
    assert.equal(validateGoalMatchAiOutput({...whole,score:9,band:'good_fit'},input).valid,false);
    const yogurt=v4Input();assert.equal(validateGoalMatchAiOutput({...aiOutput(2),dimensions:neutral},yogurt).valid,false);
  });
  it('rejects object references, unknown/missing facts, prototypes and numbers without supporting references',()=>{
    for(const facts of [
      ['semantics.processing'],['facts.doesNotExist'],['facts.perServing.fiberG'],['facts.__proto__.x'],
      ['product.name'],['user.dailyKcal'],['facts.perServing.kcal'],
    ]) assert.equal(validateGoalMatchAiOutput(aiOutput(8.5,[{...aiOutput().factors[0]!,facts}]),v4Input()).valid,false);
    assert.equal(resolveGoalMatchFact(v4Input(),'semantics.processing.value'),'whole_or_minimal');
    const missing=v4Input();missing.missing.push('proteinG');
    assert.equal(resolveGoalMatchFact(missing,'facts.share.proteinTargetPct'),null);
    assert.equal(validateGoalMatchAiOutput(aiOutput(),missing).valid,false);
  });
  it('removes one non-high invalid factor and requests rejection for high or multiple invalid factors',()=>{
    const extra:GoalMatchAiFactor={code:'low_salt',direction:'positive',impact:'low',facts:['facts.noSuch'],text:'Мало соли.'};
    const x=validateGoalMatchAiOutput({...aiOutput(),factors:[...aiOutput().factors,extra]},v4Input());
    assert.equal(x.valid,true);if(x.valid){assert.equal(x.removedFactors,1);assert.equal(x.adjusted,true);assert.equal(x.output.factors.length,1);}
    assert.equal(validateGoalMatchAiOutput({...aiOutput(),factors:[...aiOutput().factors,{...extra,impact:'high'}]},v4Input()).valid,false);
    assert.equal(validateGoalMatchAiOutput({...aiOutput(),factors:[...aiOutput().factors,extra,{...extra,code:'low_sugar'}]},v4Input()).valid,false);
  });
  it('rejects medical language and exposes a safe fallback summary for rejected summaries',()=>{
    for(const text of ['Лечит диабет.','Снижает риск болезней.','Детокс и сжигает жир.','Рекомендую при гипертонии.','Принимать 10 мг.']){
      assert.equal(validateGoalMatchAiOutput(aiOutput(8.5,[{...aiOutput().factors[0]!,text}]),v4Input()).valid,false);
      const result=validateGoalMatchAiOutput({...aiOutput(),summary:text},v4Input());
      assert.equal(result.valid,false);if(!result.valid)assert.match(result.fallbackSummary,/белка/);
    }
    const result=validateGoalMatchAiOutput({...aiOutput(),summary:'В порции 99 г белка.'},v4Input());
    assert.equal(result.valid,false);if(!result.valid)assert.ok(!result.fallbackSummary.includes('99'));
  });
  it('checks unsupported absence claims and factor direction',()=>{
    for(const text of ['Без сахара.','Без добавленного сахара.','Без добавок.','Натуральный продукт.'])
      assert.equal(validateGoalMatchAiOutput(aiOutput(8.5,[{...aiOutput().factors[0]!,text}]),v4Input()).valid,false);
    assert.equal(validateGoalMatchAiOutput(aiOutput(8.5,[{...aiOutput().factors[0]!,direction:'negative'}]),v4Input()).valid,false);
    const whole:GoalMatchAiFactor={code:'whole_food',direction:'positive',impact:'high',facts:['semantics.processing.value'],text:'Без добавок.'};
    assert.equal(validateGoalMatchAiOutput(aiOutput(8.5,[whole]),v4Input()).valid,true);
    const x=v4Input();x.product.additives=null;
    assert.equal(validateGoalMatchAiOutput(aiOutput(8.5,[whole]),x).valid,false);
    const intrinsic:GoalMatchAiFactor={code:'intrinsic_sugar',direction:'positive',impact:'high',facts:['semantics.sugarSource.value'],text:'Без добавленного сахара.'};
    assert.equal(validateGoalMatchAiOutput(aiOutput(8.5,[intrinsic]),v4Input()).valid,true);
  });
  it('requires actual ingredient signals for all ingredient codes and warnings',()=>{
    const x=v4Input();x.product.ingredients=['первый','второй','мальтодекстрин'];
    assert.equal(factorCodeAllowed('refined_starch',x),false);
    for(const word of ['сукралоза','аспартам','ацесульфам','стевиол','эритрит','мальтит','сорбит','ксилит','E950','E968','Е950','E960a']){
      x.product.ingredients=[word];assert.equal(factorCodeAllowed('sweeteners',x),true,word);
    }
    x.product.ingredients=['E969'];assert.equal(factorCodeAllowed('sweeteners',x),false);
    assert.equal(validateGoalMatchAiOutput({...aiOutput(),warnings:['sweeteners']},v4Input()).valid,false);
    assert.equal(validateGoalMatchAiOutput({...aiOutput(),warnings:['fiber_unknown']},v4Input()).valid,true);
  });
});
