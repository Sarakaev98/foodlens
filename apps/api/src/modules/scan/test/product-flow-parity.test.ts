import assert from 'node:assert/strict';
import {it} from 'node:test';
import {dirname,join} from 'node:path';
import {Logger} from '@nestjs/common';
import {GoogleNutritionSearch,FIREWORKS_PRODUCT_MODEL,MOCK_GOAL_MATCH_RECORDINGS} from '@foodlens/ai';
import {loadAppConfig} from '../../../config/app-config';
import {createScanAIProvider,createLabelScanAIProvider} from '../scan-ai-provider.factory';
import {createProductTextAI,createProductGoalMatchAI} from '../../ai/product-ai-support.factory';
import {GoalMatchService} from '../../goal-match/goal-match.service';
import {IngredientsDisplayService} from '../ingredients-display.service';
import {MultiSourceProductLookup} from '../../product-lookup/multi-source-product-lookup';
import {CachedProductLookupProvider} from '../../product-lookup/cached-product-lookup.provider';
import {mapOpenFoodFactsProduct} from '../../product-lookup/open-food-facts.mapper';
import {ScanService} from '../scan.service';
import {eatHealthierPlan} from '../../goal-match/test/goal-match-v4.fixtures';
import type {NutritionTargetsService} from '../../nutrition-targets/nutrition-targets.service';
const {MOCK_META_PRODUCT_ANALYSIS:raw}=require(join(dirname(require.resolve('@foodlens/ai')),'providers/mock/mock-product-analysis.js'));
Logger.overrideLogger(false);
const barcode='4607084351385',file={mimetype:'image/jpeg',buffer:Buffer.from([0xff,0xd8,0xff,0xe0,0,0x10]),size:6};
const goals={...MOCK_GOAL_MATCH_RECORDINGS.find(r=>r.id==='greek_yogurt')!.responses[0],warnings:[]};
const plans={findPlanForUser:async()=>eatHealthierPlan()} as unknown as NutritionTargetsService;
const fact=(value:number,unit='g')=>({value,unit,source:'manufacturer'});
const off=(complete:boolean)=>mapOpenFoodFactsProduct({code:barcode,product_name:'Trusted product',ingredients_text:'Milk',nutrition:{aggregated_set:{per:'100g',preparation:'as_sold',nutrients:{'energy-kcal':fact(66,'kcal'),proteins:fact(9.5),carbohydrates:fact(3.6),fat:fact(2),...(complete?{sugars:fact(3.6),'saturated-fat':fact(1.3),salt:fact(.1),fiber:fact(0)}:{})}}}},barcode);
async function scenario(provider:'google'|'fireworks',kind:'complete'|'partial'|'unknown'|'no_barcode',fail=false,goal=false){
 const original=globalThis.fetch;const calls:{type:string;url:string}[]=[];let offCalls=0;
 globalThis.fetch=(async(url,init)=>{
  const body=JSON.parse(String(init?.body)),meta=String(url).includes('fireworks.ai');
  const schema=meta?body.response_format.json_schema.schema:body.generationConfig.responseSchema;
  const vision=meta?body.response_format.json_schema.name==='product_analysis':body.contents[0].parts.some((p:any)=>p.inlineData);
  const type=vision?'vision':schema.properties?.translations?'translation':'goal';calls.push({type,url:String(url)});
  if(fail&&vision)return new Response(null,{status:403});
  const input=meta?body.messages[1].content:body.contents[0].parts[0].text;
  const output=vision?raw:type==='goal'?goals:{translations:JSON.parse(input).segments.map((s:any)=>({id:s.id,text:'Milk'}))};
  return meta?Response.json({model:FIREWORKS_PRODUCT_MODEL,choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(output),tool_calls:[]}}]}):Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(output)}]}}]});
 }) as typeof fetch;
 try{
  const c=loadAppConfig({DATABASE_URL:'test',PRODUCT_SCAN_AI_PROVIDER:provider,LABEL_SCAN_AI_PROVIDER:'google',AI_PROVIDER:'google',MEAL_PLAN_PROVIDER:'fireworks',FIREWORKS_API_KEY:'fake',GOOGLE_API_KEY:'fake',GOOGLE_CLOUD_PROJECT:'test',GOAL_MATCH_AI:goal?'google':'off'});
  const text=createProductTextAI(c),display=new IngredientsDisplayService(text),gm=new GoalMatchService(createProductGoalMatchAI(c));
  const lookups=new MultiSourceProductLookup([new CachedProductLookupProvider({name:'open_food_facts',lookup:async()=>{offCalls++;return kind==='unknown'?null:off(kind==='complete');}})]);
  const svc=new ScanService(createScanAIProvider(c),plans,undefined,lookups,async()=>null,undefined,createLabelScanAIProvider(c),display,gm);
  const results=[];for(let i=0;i<2;i++)results.push(await svc.analyze(kind==='complete'?undefined:file,'test',kind==='no_barcode'?{}:{barcode,roles:['nutrition']}));
  return {results,calls,offCalls};
 }finally{globalThis.fetch=original;}
}
for(const kind of ['complete','partial','unknown','no_barcode'] as const)it(`original Product flow parity: ${kind}, including repeated requests/caches`,async()=>{
 const g=await scenario('google',kind),m=await scenario('fireworks',kind);
 assert.deepEqual(m.calls.map(c=>c.type),g.calls.map(c=>c.type));assert.equal(m.offCalls,g.offCalls);
 if(kind==='complete')assert.equal(m.calls.filter(c=>c.type==='vision').length,0);
 else assert.equal(m.calls.filter(c=>c.type==='vision').length,2);
 for(const c of m.calls)assert.match(c.url,/fireworks.ai/);
 for(let i=0;i<2;i++){
  const a=m.results[i]!,b=g.results[i]!;assert.deepEqual(a.score,b.score);assert.deepEqual(a.goalMatch,b.goalMatch);
  for(const field of ['nutrition','nutritionMetadata','semantics','ingredients','allergens','additives','nameDisplay','ingredientsDisplay'] as const)assert.deepEqual(a.product[field],b.product[field]);
 }
});
it('original partial-database behavior on vision failure is preserved, without a different model',async()=>{
 const g=await scenario('google','partial',true),m=await scenario('fireworks','partial',true);
 assert.deepEqual(m.calls.map(c=>c.type),g.calls.map(c=>c.type));assert.deepEqual(m.results[0]!.score,g.results[0]!.score);
 assert.equal(m.results[0]!.needsPhoto,g.results[0]!.needsPhoto);for(const c of m.calls)assert.match(c.url,/fireworks.ai/);
});
it('configured second AI step and its cache remain active with Meta rather than being bypassed',async()=>{
 const g=await scenario('google','no_barcode',false,true),m=await scenario('fireworks','no_barcode',false,true);
 assert.deepEqual(m.calls.map(c=>c.type),g.calls.map(c=>c.type));assert.ok(m.calls.some(c=>c.type==='goal'));
 assert.equal(m.calls.filter(c=>c.type==='goal').length,1);assert.equal(m.results[0]!.goalMatch.version,'goal-match-v4');
 assert.equal(m.results[0]!.goalMatch.value,g.results[0]!.goalMatch.value);assert.deepEqual(m.results[0]!.goalMatch.factors,g.results[0]!.goalMatch.factors);
});
it('unsupported native Google grounding is explicit while Tavily keeps the existing search route',()=>{
 const base={DATABASE_URL:'test',PRODUCT_SCAN_AI_PROVIDER:'fireworks',FIREWORKS_API_KEY:'fake'};
 assert.throws(()=>createProductTextAI(loadAppConfig({...base,WEB_SEARCH_LOOKUP:'gemini'})),/Grounding/);
 assert.ok(createProductTextAI(loadAppConfig({...base,WEB_SEARCH_LOOKUP:'tavily'})) instanceof GoogleNutritionSearch);
});
