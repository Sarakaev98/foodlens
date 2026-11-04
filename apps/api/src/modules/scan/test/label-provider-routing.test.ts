import assert from 'node:assert/strict';
import { it } from 'node:test';
import { dirname,join } from 'node:path';
import { Logger } from '@nestjs/common';
import { FireworksProductProvider, GoogleProvider, FIREWORKS_PRODUCT_MODEL } from '@foodlens/ai';
import { loadAppConfig } from '../../../config/app-config';
import { createScanAIProvider,createLabelScanAIProvider } from '../scan-ai-provider.factory';
import { createAIProvider } from '../../ai/ai-provider.factory';
import { ScanService } from '../scan.service';
import { ScanError } from '../scan-error';
import type { NutritionTargetsService } from '../../nutrition-targets/nutrition-targets.service';
const {MOCK_META_PRODUCT_ANALYSIS:raw}=require(join(dirname(require.resolve('@foodlens/ai')),'providers/mock/mock-product-analysis.js'));
Logger.overrideLogger(false);
const base={DATABASE_URL:'test',AI_PROVIDER:'google',SCAN_AI_PROVIDER:'google',MEAL_PLAN_PROVIDER:'fireworks',FIREWORKS_API_KEY:'fake',GOOGLE_API_KEY:'fake',GOOGLE_CLOUD_PROJECT:'test'};
const file={mimetype:'image/jpeg',buffer:Buffer.from([0xff,0xd8,0xff,0xe0,0,0x10]),size:6};
const plans={findPlanForUser:async()=>null} as unknown as NutritionTargetsService;
const response=(url:unknown)=>String(url).includes('fireworks.ai')?Response.json({model:FIREWORKS_PRODUCT_MODEL,choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(raw),tool_calls:[]}}]}):Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(raw)}]}}]});
it('Label defaults to Google and its explicit flag does not alter other provider settings',()=>{
 const previous=loadAppConfig(base), selected=loadAppConfig({...base,LABEL_SCAN_AI_PROVIDER:'fireworks'});
 assert.ok(createLabelScanAIProvider(previous) instanceof GoogleProvider);
 assert.ok(createLabelScanAIProvider(selected) instanceof FireworksProductProvider);
 assert.ok(createScanAIProvider(selected) instanceof GoogleProvider);assert.ok(createAIProvider(selected) instanceof GoogleProvider);
 assert.deepEqual(selected.scanAi,previous.scanAi);assert.deepEqual(selected.mealPlan,previous.mealPlan);assert.deepEqual(selected.goalMatchAi,previous.goalMatchAi);
 assert.throws(()=>loadAppConfig({...base,LABEL_SCAN_AI_PROVIDER:'auto'}),/LABEL_SCAN_AI_PROVIDER/);
});
it('Label calls Fireworks once, Product calls Gemini, and both retain the same normalized facts/scores',async()=>{
 const original=globalThis.fetch,calls:string[]=[];
 globalThis.fetch=(async(url)=>{calls.push(String(url));return response(url);}) as typeof fetch;
 try{
  const config=loadAppConfig({...base,LABEL_SCAN_AI_PROVIDER:'fireworks'});
  const service=new ScanService(createScanAIProvider(config),plans,undefined,undefined,async()=>null,undefined,createLabelScanAIProvider(config));
  const label=await service.analyze(file,'test',{mode:'nutrition_label'});
  assert.equal(calls.length,1);assert.match(calls[0]!,/fireworks.ai/);assert.equal(label.product.source.type,'meta_vision');
  const product=await service.analyze(file,'test');
  assert.equal(calls.length,2);assert.match(calls[1]!,/aiplatform.googleapis.com/);assert.equal(product.product.source.type,'google_vision');
  assert.deepEqual(label.product.nutrition,product.product.nutrition);assert.deepEqual(label.product.semantics,product.product.semantics);
  assert.deepEqual(label.score,product.score);assert.deepEqual(label.goalMatch,product.goalMatch);
 }finally{globalThis.fetch=original;}
});
it('Label Fireworks HTTP failure does not fall back to the available Gemini provider',async()=>{
 const original=globalThis.fetch,calls:string[]=[];
 globalThis.fetch=(async(url)=>{calls.push(String(url));return new Response(null,{status:429});}) as typeof fetch;
 try{
  const config=loadAppConfig({...base,LABEL_SCAN_AI_PROVIDER:'fireworks'});
  const service=new ScanService(createScanAIProvider(config),plans,undefined,undefined,async()=>null,undefined,createLabelScanAIProvider(config));
  await assert.rejects(service.analyze(file,'test',{mode:'nutrition_label'}),(e:unknown)=>e instanceof ScanError&&e.code==='AI_RATE_LIMITED');
  assert.equal(calls.length,1);assert.match(calls[0]!,/fireworks.ai/);
 }finally{globalThis.fetch=original;}
});
it('missing Fireworks key fails Label without a call to either model',async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=(async()=>{calls++;return response('');}) as typeof fetch;
 try{
  const config=loadAppConfig({...base,LABEL_SCAN_AI_PROVIDER:'fireworks',FIREWORKS_API_KEY:''});
  const service=new ScanService(createScanAIProvider(config),plans,undefined,undefined,async()=>null,undefined,createLabelScanAIProvider(config));
  await assert.rejects(service.analyze(file,'test',{mode:'nutrition_label'}),(e:unknown)=>e instanceof ScanError&&e.code==='AI_NOT_CONFIGURED');assert.equal(calls,0);
 }finally{globalThis.fetch=original;}
});
it('Google remains an explicit Label alternative independent of Product selection',()=>{
 const config=loadAppConfig({...base,SCAN_AI_PROVIDER:'fireworks',LABEL_SCAN_AI_PROVIDER:'google'});
 assert.ok(createScanAIProvider(config) instanceof FireworksProductProvider);assert.ok(createLabelScanAIProvider(config) instanceof GoogleProvider);
});
