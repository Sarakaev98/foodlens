import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import {GOAL_MATCH_AI_DIMENSION_VALUES,type GoalMatchAiDimensionValue} from '@foodlens/core';
import {validateGoalMatchAiOutput} from '../goal-match-ai-validate';
import {aiOutput,v4Input} from './goal-match-v4.helpers';
const neutral={nutrientDensity:'neutral',processing:'neutral',sugar:'neutral',fatQuality:'neutral',sodium:'neutral',portion:'neutral'} as const;
describe('band ordinal semantics without changing band-count rules',()=>{
  it('Chips pattern: poor_fit accepts processing strong_negative with SN=1',()=>{
    const output={...aiOutput(3),dimensions:{...neutral,nutrientDensity:'negative' as const,
      processing:'strong_negative' as const,sodium:'negative' as const}};
    assert.equal(validateGoalMatchAiOutput(output,v4Input()).valid,true);
  });
  it('poor_fit continues to accept processing negative with one strong negative elsewhere',()=>{
    assert.equal(validateGoalMatchAiOutput({...aiOutput(3),dimensions:{...neutral,
      processing:'negative',nutrientDensity:'strong_negative'}},v4Input()).valid,true);
  });
  it('poor_fit rejects processing neutral with just one strong negative',()=>{
    assert.equal(validateGoalMatchAiOutput({...aiOutput(3),dimensions:{...neutral,
      processing:'neutral',nutrientDensity:'strong_negative'}},v4Input()).valid,false);
  });
  it('all processing enums preserve exact strong-negative counts and not_assessed remains non-negative',()=>{
    for(const processing of GOAL_MATCH_AI_DIMENSION_VALUES){
      for(let others=0;others<=3;others++){
        const dimensions:{-readonly [K in keyof typeof neutral]:GoalMatchAiDimensionValue}={...neutral,processing};
        for(const key of (['nutrientDensity','sodium','sugar'] as const).slice(0,others))dimensions[key]='strong_negative';
        const sn=others+(processing==='strong_negative'?1:0);
        const expected=sn===2 || sn===1 && (processing==='negative'||processing==='strong_negative');
        assert.equal(validateGoalMatchAiOutput({...aiOutput(3),dimensions},v4Input()).valid,expected,processing+'/'+others);
      }
    }
  });
  it('excellent_fit counts strong_positive as positive or better',()=>{
    for(const processing of ['positive','strong_positive'] as const){
      assert.equal(validateGoalMatchAiOutput({...aiOutput(9),dimensions:{...neutral,
        nutrientDensity:'strong_positive',processing}},v4Input()).valid,true);
    }
  });
  it('good_fit rejects negative or worse where prohibited; mixed_fit keeps its explicit SN limit',()=>{
    for(const processing of ['negative','strong_negative'] as const){
      assert.equal(validateGoalMatchAiOutput({...aiOutput(8),dimensions:{...neutral,processing,sodium:'negative'}},v4Input()).valid,false);
    }
    assert.equal(validateGoalMatchAiOutput({...aiOutput(6),dimensions:{...neutral,processing:'strong_negative'}},v4Input()).valid,true);
    assert.equal(validateGoalMatchAiOutput({...aiOutput(6),dimensions:{...neutral,processing:'strong_negative',sodium:'strong_negative'}},v4Input()).valid,false);
  });
});
