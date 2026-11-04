import assert from 'node:assert/strict';
import {it} from 'node:test';
import {dirname,join} from 'node:path';
import {Logger} from '@nestjs/common';
import {FireworksProductProvider,GoogleProvider,FIREWORKS_PRODUCT_MODEL} from '@foodlens/ai';
import {loadAppConfig} from '../../../config/app-config';
import {createScanAIProvider,createLabelScanAIProvider} from '../scan-ai-provider.factory';
import {createAIProvider} from '../../ai/ai-provider.factory';
import {ScanService} from '../scan.service';
import {ScanError} from '../scan-error';
import type {NutritionTargetsService} from '../../nutrition-targets/nutrition-targets.service';
import {mapOpenFoodFactsProduct} from '../../product-lookup/open-food-facts.mapper';
import type {ProductLookupProvider} from '../../product-lookup/product-lookup.provider';
const {MOCK_META_PRODUCT_ANALYSIS:raw}=require(join(dirname(require.resolve('@foodlens/ai')),'providers/mock/mock-product-analysis.js'));
Logger.overrideLogger(false);
const base={DATABASE_URL:'test',AI_PROVIDER:'google',SCAN_AI_PROVIDER:'google',LABEL_SCAN_AI_PROVIDER:'google',MEAL_PLAN_PROVIDER:'fireworks',GOAL_MATCH_AI:'off',FIREWORKS_API_KEY:'fake',GOOGLE_API_KEY:'fake',GOOGLE_CLOUD_PROJECT:'test'};
const file={mimetype:'image/jpeg',buffer:Buffer.from([0xff,0xd8,0xff,0xe0,0,0x10]),size:6};
const plans={findPlanForUser:async()=>null} as unknown as NutritionTargetsService;
const barcode='4607084351385';
const response=()=>Response.json({model:FIREWORKS_PRODUCT_MODEL,choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(raw),tool_calls:[]}}]});
function service(config:ReturnType<typeof loadAppConfig>,lookup?:ProductLookupProvider){return new ScanService(createScanAIProvider(config),plans,undefined,lookup,async()=>null,undefined,createLabelScanAIProvider(config));}
const config=(extra:Record<string,string>={})=>loadAppConfig({...base,PRODUCT_SCAN_AI_PROVIDER:'fireworks',...extra});
const off=(complete:boolean)=>mapOpenFoodFactsProduct({code:barcode,product_name:'Test grain',ingredients_text:'Buckwheat',nutriments:{'energy-kcal_100g':350,proteins_100g:10,carbohydrates_100g:70,fat_100g:3,...(complete?{sugars_100g:1,'saturated-fat_100g':.5,salt_100g:0,fiber_100g:4}:{})}},barcode);
it('explicit Product setting selects the existing adapter without changing Label, Meal, Meal Plan or Goal Match',()=>{
 const before=loadAppConfig(base),c=config();
 assert.ok(createScanAIProvider(c) instanceof FireworksProductProvider);assert.ok(createScanAIProvider(before) instanceof GoogleProvider);
 assert.ok(createLabelScanAIProvider(c) instanceof GoogleProvider);assert.ok(createAIProvider(c) instanceof GoogleProvider);
 assert.deepEqual(c.labelAi,before.labelAi);assert.deepEqual(c.mealPlan,before.mealPlan);assert.deepEqual(c.goalMatchAi,before.goalMatchAi);assert.deepEqual(c.ai,before.ai);
});
it('new Product flag wins over legacy alias; explicit Gemini and default/legacy choices remain available',()=>{
 assert.equal(config().scanAi.provider,'fireworks');
 assert.equal(config({PRODUCT_SCAN_AI_PROVIDER:'google',SCAN_AI_PROVIDER:'fireworks'}).scanAi.provider,'google');
 assert.equal(loadAppConfig({...base,SCAN_AI_PROVIDER:'fireworks'}).scanAi.provider,'fireworks');
 assert.equal(loadAppConfig({...base,SCAN_AI_PROVIDER:undefined}).scanAi.provider,'google');
 assert.throws(()=>config({PRODUCT_SCAN_AI_PROVIDER:'auto'}),/PRODUCT_SCAN_AI_PROVIDER/);
});
it('Product packaging plus nutrition and ingredients photos use one Fireworks request in original order',async()=>{
 const original=globalThis.fetch,calls:{url:string;body:any}[]=[];
 globalThis.fetch=(async(url,init)=>{calls.push({url:String(url),body:JSON.parse(String(init?.body))});return response();}) as typeof fetch;
 try{
  const result=await service(config()).analyze([file,file,file],'test',{roles:['product','nutrition','ingredients']});
  assert.equal(calls.length,1);assert.match(calls[0]!.url,/fireworks.ai/);assert.equal(calls[0]!.body.model,FIREWORKS_PRODUCT_MODEL);
  const content=calls[0]!.body.messages[1].content;
  assert.equal(content.filter((p:any)=>p.type==='image_url').length,3);
  assert.deepEqual(content.filter((p:any)=>p.text?.startsWith('Role hint:')).map((p:any)=>p.text),['Role hint: product','Role hint: nutrition','Role hint: ingredients']);
  assert.equal(result.product.source.type,'meta_vision');assert.equal(result.product.nutrition?.proteinG.value,raw.nutrition_table.protein_g);assert.ok(result.score.value!==null);
 }finally{globalThis.fetch=original;}
});
it('complete Open Food Facts barcode avoids a paid vision request under the new flag',async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=(async()=>{calls++;return response();}) as typeof fetch;
 try{
  const result=await service(config(),{name:'open_food_facts',lookup:async()=>off(true)}).analyze(undefined,'test',{barcode});
  assert.equal(calls,0);assert.equal(result.barcode,barcode);assert.equal(result.product.source.type,'barcode');assert.ok(result.score.value!==null);
 }finally{globalThis.fetch=original;}
});
it('partial barcode data is supplemented by the nutrition photograph without replacing printed nutrients',async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=(async(url)=>{calls++;assert.match(String(url),/fireworks.ai/);return response();}) as typeof fetch;
 try{
  const result=await service(config(),{name:'open_food_facts',lookup:async()=>off(false)}).analyze(file,'test',{barcode,roles:['nutrition']});
  assert.equal(calls,1);assert.equal(result.barcode,barcode);
  assert.equal(result.product.nutrition?.sugarsG.value,raw.nutrition_table.sugars_g);
  assert.equal(result.product.nutrition?.sugarsG.provenance,'observed');assert.equal(result.product.nutrition?.proteinG.value,raw.nutrition_table.protein_g);
 }finally{globalThis.fetch=original;}
});
it('Product API failure, malformed JSON, timeout and missing key never switch to Gemini',async()=>{
 const original=globalThis.fetch;
 try{
  for(const [mode,expected]of [['http','AI_RATE_LIMITED'],['json','AI_BAD_RESPONSE'],['timeout','AI_TIMEOUT'],['key','AI_NOT_CONFIGURED']] as const){
   const calls:string[]=[];
   globalThis.fetch=(async(url)=>{calls.push(String(url));if(mode==='timeout')return new Promise<Response>(()=>{});return mode==='http'?new Response(null,{status:429}):new Response('not json');}) as typeof fetch;
   const c=config(mode==='key'?{FIREWORKS_API_KEY:''}:mode==='timeout'?{FIREWORKS_SCAN_TIMEOUT_MS:'15'}:{});
   await assert.rejects(service(c).analyze(file,'test'),(e:unknown)=>e instanceof ScanError&&e.code===expected);
   assert.equal(calls.length,mode==='key'?0:1);for(const url of calls)assert.match(url,/fireworks.ai/);
  }
 }finally{globalThis.fetch=original;}
});
