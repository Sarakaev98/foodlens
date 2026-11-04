import assert from 'node:assert/strict';
import { describe,it } from 'node:test';
import { dirname,join } from 'node:path';
import { Logger } from '@nestjs/common';
import { FireworksProductProvider, FIREWORKS_PRODUCT_MODEL, GoogleProvider, MOCK_GOAL_MATCH_RECORDINGS } from '@foodlens/ai';
import { loadAppConfig } from '../../../config/app-config';
import { createScanAIProvider } from '../scan-ai-provider.factory';
import { createAIProvider, createGoalMatchAIProvider } from '../../ai/ai-provider.factory';
import { GoalMatchService } from '../../goal-match/goal-match.service';
import { eatHealthierPlan } from '../../goal-match/test/goal-match-v4.fixtures';
import type { NutritionTargetsService } from '../../nutrition-targets/nutrition-targets.service';
import { ScanService } from '../scan.service';
import { ScanError } from '../scan-error';
import { mapOpenFoodFactsProduct } from '../../product-lookup/open-food-facts.mapper';
const {MOCK_META_PRODUCT_ANALYSIS:raw}=require(join(dirname(require.resolve('@foodlens/ai')),'providers/mock/mock-product-analysis.js'));
Logger.overrideLogger(false);
const FILE={mimetype:'image/jpeg',buffer:Buffer.from([0xff,0xd8,0xff,0xe0,0,0x10]),size:6};
const plans={findPlanForUser:async()=>eatHealthierPlan()} as unknown as NutritionTargetsService;
const goal={...MOCK_GOAL_MATCH_RECORDINGS.find(r=>r.id==='greek_yogurt')!.responses[0],warnings:[]};
const evaluator=()=>new GoalMatchService({name:'recorded',evaluateGoalMatch:async()=>goal});
const response=()=>Response.json({model:FIREWORKS_PRODUCT_MODEL,choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(raw)}}]});
describe('Fireworks Scan integration (offline)',()=>{
 it('defaults to Gemini, isolates Scan flag from Meal Plan, meal photo and Goal Match',()=>{
  const base={DATABASE_URL:'test',AI_PROVIDER:'google',GOAL_MATCH_AI:'off',MEAL_PLAN_PROVIDER:'fireworks',FIREWORKS_API_KEY:'fake'};
  const c=loadAppConfig(base);assert.ok(createScanAIProvider(c) instanceof GoogleProvider);
  const f=loadAppConfig({...base,SCAN_AI_PROVIDER:'fireworks'});
  assert.ok(createScanAIProvider(f) instanceof FireworksProductProvider);assert.ok(createAIProvider(f) instanceof GoogleProvider);
  assert.equal(createGoalMatchAIProvider(f),null);assert.equal(f.mealPlan.provider,c.mealPlan.provider);assert.equal(f.goalMatchAi.mode,c.goalMatchAi.mode);
  assert.throws(()=>loadAppConfig({...base,SCAN_AI_PROVIDER:'automatic'}),/SCAN_AI_PROVIDER/);
  assert.throws(()=>loadAppConfig({...base,FIREWORKS_SCAN_TIMEOUT_MS:'-1'}),/TIMEOUT/);
 });
 it('identical extraction retains exact Product Score and Goal Match outputs',async()=>{
  let calls=0;
  const f=new FireworksProductProvider({apiKey:'fake',createId:()=> 'fixed',now:()=>new Date('2026-11-04T00:00:00Z'),fetch:(async()=>{calls++;return response();}) as typeof fetch});
  const g=new GoogleProvider({apiKey:'fake',project:'test',createId:()=> 'fixed',now:()=>new Date('2026-11-04T00:00:00Z'),fetch:(async()=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(raw)}]}}]})) as typeof fetch});
  const a=await new ScanService(f,plans,evaluator(),undefined,async()=>null).analyze(FILE,'test');
  const b=await new ScanService(g,plans,evaluator(),undefined,async()=>null).analyze(FILE,'test');
  assert.deepEqual(a.score,b.score);assert.deepEqual(a.goalMatch,b.goalMatch);
  assert.deepEqual(a.product.nutrition,b.product.nutrition);assert.deepEqual(a.product.semantics,b.product.semantics);
  assert.deepEqual(a.product.ingredients,b.product.ingredients);assert.deepEqual(a.product.allergens,b.product.allergens);
  assert.equal(a.product.source.type,'meta_vision');assert.equal(calls,1);
 });
 it('complete Open Food Facts barcode does not invoke Fireworks',async()=>{
  let calls=0;const f=new FireworksProductProvider({apiKey:'fake',fetch:(async()=>{calls++;return response();}) as typeof fetch});
  const off=mapOpenFoodFactsProduct({code:'4607084351385',product_name:'Test product',ingredients_text:'Milk',nutriments:{'energy-kcal_100g':100,proteins_100g:10,carbohydrates_100g:5,fat_100g:4,sugars_100g:5,'saturated-fat_100g':2,salt_100g:0.1,fiber_100g:0}},'4607084351385');
  const service=new ScanService(f,plans,undefined,{name:'open_food_facts',lookup:async()=>off},async()=>null);
  const result=await service.analyze(undefined,'test',{barcode:'4607084351385'});
  assert.equal(calls,0);assert.equal(result.barcode,'4607084351385');assert.equal(result.product.source.type,'barcode');
 });
 it('explicit nutrition-label mode bypasses barcode lookup and still uses Fireworks once',async()=>{
  let calls=0,lookups=0;const f=new FireworksProductProvider({apiKey:'fake',fetch:(async()=>{calls++;return response();}) as typeof fetch});
  const service=new ScanService(f,plans,undefined,{name:'open_food_facts',lookup:async()=>{lookups++;return null;}},async()=>null);
  const result=await service.analyze(FILE,'test',{mode:'nutrition_label',barcode:'4607084351385'});
  assert.equal(calls,1);assert.equal(lookups,0);assert.ok(result.product.nutrition);
 });
 it('Fireworks failure uses existing safe Scan error and never calls another model',async()=>{
  let calls=0,goalCalls=0;const f=new FireworksProductProvider({apiKey:'fake',fetch:(async()=>{calls++;return new Response('sensitive body',{status:403});}) as typeof fetch});
  const gm=new GoalMatchService({name:'recorded',evaluateGoalMatch:async()=>{goalCalls++;return goal;}});
  await assert.rejects(new ScanService(f,plans,gm,undefined,async()=>null).analyze(FILE,'test'),(e:unknown)=>e instanceof ScanError&&e.code==='AI_AUTH_FAILED'&&!String(e).includes('sensitive body'));
  assert.equal(calls,1);assert.equal(goalCalls,0);
 });
});


it('Scan summary identifies the actual vision provider/model independently of legacy aliases',async()=>{
 const original=Logger.prototype.log;const lines:string[]=[];
 Logger.prototype.log=function(message:unknown){if(typeof message==='string')lines.push(message);};
 try{
  const f=new FireworksProductProvider({apiKey:'fake',fetch:(async()=>response()) as typeof fetch});
  await new ScanService(f,plans,undefined,undefined,async()=>null).analyze(FILE,'test',{mode:'nutrition_label'});
  const line=lines.find(l=>l.startsWith('scan_flow '))!;
  const summary=JSON.parse(line.slice('scan_flow '.length));
  assert.equal(summary.aiProvider,'fireworks');assert.equal(summary.aiModel,FIREWORKS_PRODUCT_MODEL);assert.equal(summary.aiCalled,true);
  assert.equal(summary.aiReason,'nutrition_label');assert.equal(summary.aiImages,1);
 }finally{Logger.prototype.log=original;}
});
