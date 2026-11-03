import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {describe,it} from 'node:test';
import {Logger} from '@nestjs/common';
import {MockProvider} from '@foodlens/ai';
import {prepareGoalMatchV4,validateGoalMatchAiOutput} from '@foodlens/scoring';
import {GOAL_MATCH_AI_PROMPT_VERSION,goalMatchAiCacheKey} from '../goal-match-ai-cache';
import {GoalMatchService} from '../goal-match.service';
import {CHIPS,eatHealthierPlan} from './goal-match-v4.fixtures';
import {CHIPS_PRE_PROMPT_V2_RESPONSES} from './google-chips-band-regression.fixtures';
Logger.overrideLogger(false);
const ready=()=>{
  const p=prepareGoalMatchV4(CHIPS,eatHealthierPlan());
  assert.equal(p.state,'ready');if(p.state!=='ready')throw Error('fixture not ready');return p;
};
describe('prompt v2 metadata and unchanged validator contract',()=>{
  it('both genuine saved responses satisfy the corrected ordinal band rule',()=>{
    for(const output of CHIPS_PRE_PROMPT_V2_RESPONSES){
      const result=validateGoalMatchAiOutput(output,ready().input);
      assert.equal(result.valid,true);
      // Both genuine salt explanations now recognize their referenced per-100 basis.
      if(result.valid)assert.equal(result.removedFactors,0);
      assert.equal(Object.values(output.dimensions).filter(v=>v==='strong_negative').length,1);
      assert.equal(output.dimensions.processing,'strong_negative');
    }
  });
  it('poor_fit keeps the exact SN count and accepts processing negative or worse',()=>{
    const output=CHIPS_PRE_PROMPT_V2_RESPONSES[0]!;
    assert.equal(validateGoalMatchAiOutput({...output,dimensions:{...output.dimensions,nutrientDensity:'strong_negative'}},ready().input).valid,true);
    assert.equal(validateGoalMatchAiOutput({...output,dimensions:{...output.dimensions,processing:'negative',nutrientDensity:'strong_negative'}},ready().input).valid,true);
    assert.equal(validateGoalMatchAiOutput({...output,dimensions:{...output.dimensions,nutrientDensity:'strong_negative',sodium:'strong_negative'}},ready().input).valid,false);
  });
  it('cache key includes v2 and differs from the old v1 key for identical input/provider/model',()=>{
    const input=ready().input,provider={name:'google',model:'gemini-3.5-flash-lite'};
    const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
      ? Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>[k,canonical(v)])):value;
    const old=createHash('sha256').update(JSON.stringify(canonical({inputVersion:input.version,
      promptVersion:'eat-healthier-rubric-v1',provider:provider.name,model:provider.model,input}))).digest('hex');
    assert.equal(GOAL_MATCH_AI_PROMPT_VERSION,'eat-healthier-rubric-v2');
    assert.notEqual(goalMatchAiCacheKey(input,provider),old);
  });
  it('unchanged Mock v4 still works and reports the current prompt metadata version',async()=>{
    const result=await new GoalMatchService(new MockProvider()).evaluate(CHIPS,eatHealthierPlan());
    assert.equal(result.goalMatch.value,3);assert.equal(result.goalMatch.source,'ai');
    assert.equal(result.goalMatch.ai?.promptVersion,'eat-healthier-rubric-v2');
  });
});
