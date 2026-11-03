import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import {dirname,join} from 'node:path';
import {Logger} from '@nestjs/common';
import {GoogleProvider,GoogleGoalMatchProvider,MockProvider,MOCK_GOAL_MATCH_RECORDINGS} from '@foodlens/ai';
import {loadAppConfig} from '../../../config/app-config';
import {createAIProvider,createGoalMatchAIProvider} from '../../ai/ai-provider.factory';
import {GoalMatchService} from '../../goal-match/goal-match.service';
import {eatHealthierPlan} from '../../goal-match/test/goal-match-v4.fixtures';
import type {NutritionTargetsService} from '../../nutrition-targets/nutrition-targets.service';
import {ScanService} from '../scan.service';
import {ScanError} from '../scan-error';

// Existing static analysis label as test data; all HTTP in this suite is stubbed.
const {MOCK_META_PRODUCT_ANALYSIS}=require(join(dirname(require.resolve('@foodlens/ai')),'providers/mock/mock-product-analysis.js'));
Logger.overrideLogger(false);
const KEY='unit-test-google-scan-key';
const FILE={mimetype:'image/jpeg',buffer:Buffer.from([0xff,0xd8,0xff,0xe0,0,0x10]),size:6};
const plan=eatHealthierPlan();
const plans=(p=plan)=>({findPlanForUser:async()=>p}) as unknown as NutritionTargetsService;
const reply=(value:unknown)=>new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(value)}]}}]}));
const goal={...MOCK_GOAL_MATCH_RECORDINGS.find(r=>r.id==='greek_yogurt')!.responses[0], warnings:[]};
describe('Google Scan: shared Product and two independent AI steps (HTTP stubs)',()=>{
  it('supports independent Scan and Goal Match flags without changing Mock or Meta selection',()=>{
    const config=(scan:string,gm:string)=>loadAppConfig({DATABASE_URL:'test',AI_PROVIDER:scan,GOAL_MATCH_AI:gm,
      GOOGLE_API_KEY:KEY,GOOGLE_CLOUD_PROJECT:'foodlens-513112'});
    const scanOnly=config('google','off');
    assert.ok(createAIProvider(scanOnly) instanceof GoogleProvider);assert.equal(createGoalMatchAIProvider(scanOnly),null);
    const goalOnly=config('mock','google');
    assert.ok(createAIProvider(goalOnly) instanceof MockProvider);
    assert.ok(createGoalMatchAIProvider(goalOnly) instanceof GoogleGoalMatchProvider);
    const both=config('google','google');
    assert.ok(createAIProvider(both) instanceof GoogleProvider);assert.ok(createGoalMatchAIProvider(both) instanceof GoogleGoalMatchProvider);
  });
  it('Scan image -> Google normalization -> unchanged Product Score -> text-only Google Goal Match',async()=>{
    const requests:Record<string,any>[]=[];
    const provider=new GoogleProvider({apiKey:KEY,project:'foodlens-513112',fetch:(async(_,init)=>{
      const body=JSON.parse(String(init!.body));requests.push(body);
      return reply(body.contents[0].parts.some((p:any)=>p.inlineData)?MOCK_META_PRODUCT_ANALYSIS:goal);
    }) as typeof fetch});
    const service=new ScanService(provider,plans(),new GoalMatchService(provider));
    const result=await service.analyze(FILE,'unit-user');
    assert.equal(result.product.source.type,'google_vision');assert.equal(result.score.value,9.4);
    assert.equal(result.product.nutrition?.proteinG.value,9.5);
    assert.equal(result.goalMatch.version,'goal-match-v4');
    if(result.goalMatch.version!=='goal-match-v4')return;
    assert.equal(result.goalMatch.source,'ai');assert.equal(result.goalMatch.value,8.5);
    assert.equal(result.goalMatch.deterministic.value,8.7);assert.equal(requests.length,2);
    assert.equal(requests[0]!.contents[0].parts[1].inlineData.mimeType,'image/jpeg');
    const second=requests[1]!;assert.ok(!JSON.stringify(second).includes('inlineData'));
    assert.ok(!JSON.stringify(second).includes(FILE.buffer.toString('base64')));
    const input=JSON.parse(second.contents[0].parts[0].text);
    assert.equal(input.version,'goal-match-ai-input-v1');
    for(const forbidden of ['score','allergens','dietaryPreferences','avoidedIngredients','age','sex'])
      assert.ok(!JSON.stringify(input).includes('"'+forbidden+'"'));
  });
  it('first-step failure returns existing Scan error and never calls Goal Match',async()=>{
    let calls=0,goalCalls=0;
    const scan=new GoogleProvider({apiKey:KEY,project:'foodlens-513112',fetch:(async()=>{calls++;return new Response(KEY,{status:403});}) as typeof fetch});
    const evaluator={name:'google',evaluateGoalMatch:async()=>{goalCalls++;return goal;}};
    await assert.rejects(new ScanService(scan,plans(),new GoalMatchService(evaluator)).analyze(FILE,'unit-user'),(error:unknown)=>{
      assert.ok(error instanceof ScanError);assert.equal(error.code,'AI_AUTH_FAILED');assert.equal(error.status,502);
      assert.ok(!String(error).includes(KEY));return true;
    });
    assert.equal(calls,1);assert.equal(goalCalls,0);
  });
  it('a failed Goal Match request falls back only after a real normalized Product exists',async()=>{
    let calls=0;
    const provider=new GoogleProvider({apiKey:KEY,project:'foodlens-513112',fetch:(async()=>{
      calls++;return calls===1?reply(MOCK_META_PRODUCT_ANALYSIS):new Response('unavailable',{status:503});
    }) as typeof fetch});
    const result=await new ScanService(provider,plans(),new GoalMatchService(provider)).analyze(FILE,'unit-user');
    assert.equal(result.product.source.type,'google_vision');assert.equal(result.score.value,9.4);
    assert.equal(result.goalMatch.version,'goal-match-v4');
    if(result.goalMatch.version==='goal-match-v4'){assert.equal(result.goalMatch.source,'deterministic');assert.equal(result.goalMatch.value,8.7);}
    assert.equal(calls,2);
  });
  it('other goals keep v1 and never invoke the second evaluator',async()=>{
    let calls=0;
    const provider=new GoogleProvider({apiKey:KEY,project:'foodlens-513112',fetch:(async()=>{calls++;return reply(MOCK_META_PRODUCT_ANALYSIS);}) as typeof fetch});
    const result=await new ScanService(provider,plans({...plan,goal:'lose_weight'}),new GoalMatchService(provider)).analyze(FILE,'unit-user');
    assert.equal(result.goalMatch.version,'goal-match-v1');assert.equal(result.score.value,9.4);assert.equal(calls,1);
  });
  it('completed nutrition yields numeric Goal Match without a second AI call for reference serving',async()=>{
    let calls=0;
    const raw={...MOCK_META_PRODUCT_ANALYSIS,nutrition_table:{...MOCK_META_PRODUCT_ANALYSIS.nutrition_table,visible:false}};
    const provider=new GoogleProvider({apiKey:KEY,project:'foodlens-513112',fetch:(async()=>{calls++;return reply(raw);}) as typeof fetch});
    const result=await new ScanService(provider,plans(),new GoalMatchService(provider)).analyze(FILE,'unit-user');
    assert.equal(typeof result.score.value,'number');assert.equal(result.product.nutritionMetadata!.basis.quality,'estimated');assert.equal(typeof result.goalMatch.value,'number');
    assert.equal(result.goalMatch.unavailableReason,null);assert.equal(calls,1);
  });
});
