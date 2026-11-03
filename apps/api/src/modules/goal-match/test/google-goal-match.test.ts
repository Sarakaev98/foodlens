import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import {Logger} from '@nestjs/common';
import {GoogleGoalMatchProvider,MockProvider,MOCK_GOAL_MATCH_RECORDINGS} from '@foodlens/ai';
import {prepareGoalMatchV4} from '@foodlens/scoring';
import {loadAppConfig} from '../../../config/app-config';
import {createGoalMatchAIProvider} from '../../ai/ai-provider.factory';
import {GoalMatchService} from '../goal-match.service';
import {goalMatchAiCacheKey} from '../goal-match-ai-cache';
import {CHIPS,eatHealthierPlan} from './goal-match-v4.fixtures';
Logger.overrideLogger(false);
const KEY='stub-google-key-not-real';
const recorded=(id:string)=>MOCK_GOAL_MATCH_RECORDINGS.find(x=>x.id===id)!.responses[0];
const reply=(o:unknown)=>new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(o)}]}}]}));
const google=(fetch:typeof globalThis.fetch)=>new GoogleGoalMatchProvider({apiKey:KEY,project:'foodlens-513112',fetch});
const yogurt=()=>new MockProvider().analyzeProduct({kind:'image',image:{mimeType:'image/jpeg',base64:'AA=='}});
describe('google evaluator config / unchanged validation and cache',()=>{
  it('google config selects a dedicated evaluator without changing the Scan provider',()=>{
    const c=loadAppConfig({DATABASE_URL:'test',AI_PROVIDER:'mock',GOAL_MATCH_AI:'google',GOOGLE_API_KEY:KEY,GOOGLE_CLOUD_PROJECT:'foodlens-513112'});
    assert.equal(c.ai.provider,'mock');assert.equal(c.goalMatchAi.google.model,'gemini-3.5-flash-lite');
    const p=createGoalMatchAIProvider(c);assert.ok(p instanceof GoogleGoalMatchProvider);
    assert.equal(p.location,'global');assert.equal(p.project,'foodlens-513112');
  });
  it('yogurt and chips pass the existing validator and reconcile through GoalMatchService',async()=>{
    for(const [product,id,expected]of [[await yogurt(),'greek_yogurt',8.5],[CHIPS,'chips',3]] as const){
      const service=new GoalMatchService(google((async()=>reply(recorded(id))) as typeof fetch));
      const r=await service.evaluate(product,eatHealthierPlan());
      assert.equal(r.goalMatch.source,'ai');assert.equal(r.goalMatch.value,expected);
      assert.equal(r.goalMatch.ai?.model,'gemini-3.5-flash-lite');assert.equal(r.cacheHit,false);
    }
  });
  it('first request misses, second identical request hits and sends no further HTTP',async()=>{
    let calls=0;const provider=google((async()=>{calls++;return reply(recorded('greek_yogurt'));}) as typeof fetch);
    const service=new GoalMatchService(provider);const product=await yogurt();
    const a=await service.evaluate(product,eatHealthierPlan()),b=await service.evaluate(product,eatHealthierPlan());
    assert.equal(a.cacheHit,false);assert.equal(b.cacheHit,true);assert.equal(b.aiCalls,0);assert.equal(calls,1);
    assert.equal(b.goalMatch.ai?.cacheHit,true);
    const prepared=prepareGoalMatchV4(product,eatHealthierPlan());assert.equal(prepared.state,'ready');if(prepared.state!=='ready')return;
    const key=goalMatchAiCacheKey(prepared.input,{name:'google',model:'gemini-3.5-flash-lite'});
    assert.notEqual(key,goalMatchAiCacheKey(prepared.input,{name:'mock',model:'gemini-3.5-flash-lite'}));
    assert.notEqual(key,goalMatchAiCacheKey(prepared.input,{name:'google',model:'other-model'}));
  });
  it('semantic invalidity still reaches the existing validator, retries, and falls back',async()=>{
    let calls=0;
    const service=new GoalMatchService(google((async()=>{calls++;return reply({...recorded('greek_yogurt'),band:'excellent_fit'});}) as typeof fetch));
    const result=await service.evaluate(await yogurt(),eatHealthierPlan());
    assert.equal(result.outcome,'ai_invalid');assert.equal(result.goalMatch.source,'deterministic');
    assert.equal(result.goalMatch.value,8.7);assert.equal(calls,2);assert.equal(result.goalMatch.ai,null);
  });
  it('403 and missing configuration cannot break evaluation or expose upstream text',async()=>{
    for(const provider of [
      google((async()=>new Response(KEY,{status:403})) as typeof fetch),
      new GoogleGoalMatchProvider({apiKey:'',project:'foodlens-513112'}),
    ]){
      const r=await new GoalMatchService(provider).evaluate(await yogurt(),eatHealthierPlan());
      assert.equal(r.goalMatch.source,'deterministic');assert.equal(r.goalMatch.value,8.7);
      assert.ok(!JSON.stringify(r).includes(KEY));assert.equal(r.goalMatch.ai,null);
    }
  });
});
