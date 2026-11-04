import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FireworksProductProvider, FIREWORKS_PRODUCT_MODEL, FIREWORKS_PRODUCT_RESPONSE_SCHEMA, GoogleProvider, AIProviderError } from '../index';
import type { AnalyzeProductInput } from '../ai-provider.types';
import { metaAnalysis } from './meta-fixtures';
import { GOOGLE_PRODUCT_SYSTEM_PROMPT, GOOGLE_PRODUCT_LABEL_PROMPT, GOOGLE_PRODUCT_MULTI_IMAGE_PROMPT, GOOGLE_PRODUCT_USER_PROMPT } from '../providers/google/google-product-prompt';
const KEY='fake-fireworks-scan-key', DATA=Buffer.from('synthetic image, no real photo').toString('base64');
const IMAGE: AnalyzeProductInput={kind:'image',image:{mimeType:'image/jpeg',base64:DATA},requestId:'scan-test'};
const reply=(raw:unknown=metaAnalysis(), finish='stop')=>Response.json({model:FIREWORKS_PRODUCT_MODEL,choices:[{finish_reason:finish,message:{role:'assistant',content:JSON.stringify(raw)}}],usage:{prompt_tokens:647,completion_tokens:1157,total_tokens:1804,prompt_tokens_details:{cached_tokens:448}}});
function setup(respond:()=>Response|Promise<Response>=()=>reply(),timeoutMs=1000){
 const calls:{url:unknown;init:RequestInit}[]=[], logs:{event:string;data:Record<string,unknown>}[]=[];
 const provider=new FireworksProductProvider({apiKey:KEY,timeoutMs,now:()=>new Date('2026-11-04T00:00:00Z'),createId:()=> 'test',
 fetch:(async(url,init)=>{calls.push({url,init:init!});return respond();}) as typeof fetch,
 logger:{log:(event,data)=>logs.push({event,data}),warn:(event,data)=>logs.push({event,data})}});
 return {provider,calls,logs};
}
const code=(expected:string)=>(e:unknown)=>e instanceof AIProviderError&&e.provider==='fireworks'&&e.code===expected&&!String(e).includes(KEY)&&!String(e).includes(DATA)&&e.cause===undefined;
describe('Fireworks product photographs (all transports stubbed)',()=>{
 it('normalizes exactly as Gemini including all scoring/Goal Match fields',async()=>{
  for(const raw of [metaAnalysis(),metaAnalysis({nutrition_table:{protein_g:null,sugars_g:null},semantics:{...metaAnalysis().semantics!,typicalServing:{amount:125,unit:'g',confidence:'medium',evidence:['125 g']}}}),metaAnalysis({ingredients:{visible:false,items:[]},allergens:{statement_visible:false,items:[]}})]){
   const f=await setup(()=>reply(raw)).provider.analyzeProduct(IMAGE);
   const g=await new GoogleProvider({apiKey:'fake',project:'test',createId:()=> 'test',now:()=>new Date('2026-11-04T00:00:00Z'),fetch:(async()=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(raw)}]}}]})) as typeof fetch}).analyzeProduct(IMAGE);
   const {source:fs,...fp}=f,{source:gs,...gp}=g;assert.deepEqual(fp,gp);
   assert.equal(fs.type,'meta_vision');if(fs.type==='meta_vision'){assert.equal(fs.provider,'meta');assert.match(fs.analysisVersion,/fireworks/);}
   assert.equal(gs.type,'google_vision');
  }
 });
 it('sends original JPEG, PNG and WebP via image_url data URLs, fixed model and unchanged prompts',async()=>{
  for(const mimeType of ['image/jpeg','image/png','image/webp'] as const){
   const t=setup();await t.provider.analyzeProduct({kind:'image',image:{mimeType,base64:DATA}});
   assert.equal(t.calls.length,1);assert.equal(t.calls[0]!.url,'https://api.fireworks.ai/inference/v1/chat/completions');
   const init=t.calls[0]!.init,b=JSON.parse(String(init.body));
   assert.equal(init.redirect,'error');assert.equal(new Headers(init.headers).get('Authorization'),'Bearer '+KEY);
   assert.equal(b.model,FIREWORKS_PRODUCT_MODEL);assert.equal(b.reasoning_effort,'low');assert.equal(b.max_tokens,4096);assert.equal(b.stream,false);
   assert.equal(b.messages[0].content,GOOGLE_PRODUCT_SYSTEM_PROMPT);
   assert.deepEqual(b.messages[1].content,[{type:'text',text:GOOGLE_PRODUCT_USER_PROMPT},{type:'image_url',image_url:{url:`data:${mimeType};base64,${DATA}`}}]);
   assert.deepEqual(b.response_format.json_schema.schema,FIREWORKS_PRODUCT_RESPONSE_SCHEMA);
   assert.ok(b.response_format.json_schema.schema.properties.semantics);
   assert.ok(b.response_format.json_schema.schema.properties.nutrition_status);
  }
 });
 it('all three images and role hints stay in order in ONE call; label prompt stays intact',async()=>{
  const t=setup();await t.provider.analyzeProduct({kind:'image',images:['product','nutrition','ingredients'].map((role,i)=>({role:role as 'product',mimeType:'image/jpeg',base64:DATA+i}))});
  assert.equal(t.calls.length,1);const b=JSON.parse(String(t.calls[0]!.init.body));
  assert.equal(b.messages[0].content,GOOGLE_PRODUCT_SYSTEM_PROMPT+GOOGLE_PRODUCT_MULTI_IMAGE_PROMPT);
  assert.deepEqual(b.messages[1].content.slice(1).map((p:any)=>p.text??p.image_url.url),['Role hint: product',`data:image/jpeg;base64,${DATA}0`,'Role hint: nutrition',`data:image/jpeg;base64,${DATA}1`,'Role hint: ingredients',`data:image/jpeg;base64,${DATA}2`]);
  const label=setup();await label.provider.analyzeProduct({kind:'image',images:[{role:'nutrition',mimeType:'image/png',base64:DATA}]});
  assert.equal(JSON.parse(String(label.calls[0]!.init.body)).messages[0].content,GOOGLE_PRODUCT_SYSTEM_PROMPT+GOOGLE_PRODUCT_LABEL_PROMPT);
 });
 it('safe usage, cost and stage logs never contain image bytes, key or generated data',async()=>{
  const t=setup(()=>reply({...metaAnalysis(),nutrition_status:{sugars:'observed',salt:'not_listed',saturated_fat:'unreadable'}}));await t.provider.analyzeProduct(IMAGE);
  const u=t.logs.find(l=>l.event==='fireworks_usage')!.data;assert.equal(u.estimatedCostUsd,0.0052331999999999995);assert.equal(u.numberOfImages,1);
  assert.deepEqual(t.logs.filter(l=>l.event==='fireworks_scan_http').map(l=>l.data.event),['request_started','headers_received','body_read_started','body_read_completed']);
  assert.equal(t.logs.find(l=>l.event==='nutrition_status')!.data.salt,'not_listed');
  for(const secret of [KEY,DATA,GOOGLE_PRODUCT_SYSTEM_PROMPT,metaAnalysis().identity.name.value!])assert.ok(!JSON.stringify(t.logs).includes(secret));
 });
 it('retains unknown nutrients as null; omitted nullable fields use existing repair',async()=>{
  const raw=metaAnalysis();const {protein_g,sugars_g,sodium,serving_size,...nutrition_table}=raw.nutrition_table;
  const p=await setup(()=>reply({...raw,nutrition_table})).provider.analyzeProduct(IMAGE);
  assert.equal(p.nutrition!.proteinG.value,null);assert.equal(p.nutrition!.sugarsG.value,null);assert.equal(p.nutrition!.servingSize.value,null);
 });
 for(const [status,expected]of [[401,'authentication_failed'],[403,'authentication_failed'],[429,'rate_limited'],[500,'unavailable'],[400,'bad_request']] as const)it(`HTTP ${status}: safe error, no retry`,async()=>{
  const t=setup(()=>new Response(KEY+DATA,{status}));await assert.rejects(t.provider.analyzeProduct(IMAGE),code(expected));assert.equal(t.calls.length,1);assert.ok(!JSON.stringify(t.logs).includes(KEY));
 });
 it('rejects invalid JSON, schema, model, truncation and refusals',async()=>{
  for(const respond of [()=>new Response('{'),()=>reply({bad:KEY}),()=>reply(metaAnalysis(),'length'),()=>Response.json({model:'wrong',choices:[]}),()=>Response.json({model:FIREWORKS_PRODUCT_MODEL,choices:[{finish_reason:'stop',message:{role:'assistant',content:'```json {} ```'}}]})])await assert.rejects(setup(respond).provider.analyzeProduct(IMAGE),code('invalid_response'));
  await assert.rejects(setup(()=>reply({},'content_filter')).provider.analyzeProduct(IMAGE),code('refused'));
 });
 it('accepts omitted, null and empty optional tool_calls for a valid Label analysis',async()=>{
  const label:AnalyzeProductInput={kind:'image',images:[{role:'nutrition',mimeType:'image/jpeg',base64:DATA}]};
  let expected:unknown;
  for(const toolCalls of [undefined,null,[]]){
   const t=setup(()=>Response.json({model:FIREWORKS_PRODUCT_MODEL,choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(metaAnalysis()),...(toolCalls===undefined?{}:{tool_calls:toolCalls})}}]}));
   const product=await t.provider.analyzeProduct(label);
   if(expected===undefined)expected=product;else assert.deepEqual(product,expected);
   assert.equal(t.calls.length,1);
   assert.equal(JSON.parse(String(t.calls[0]!.init.body)).messages[0].content,GOOGLE_PRODUCT_SYSTEM_PROMPT+GOOGLE_PRODUCT_LABEL_PROMPT);
  }
 });
 it('still rejects real or malformed tool_calls and does not bypass JSON validation',async()=>{
  for(const toolCalls of [[{id:'tool-1',type:'function',function:{name:'unexpected',arguments:'{}'}}],{},'invalid',false,0]){
   const t=setup(()=>Response.json({model:FIREWORKS_PRODUCT_MODEL,choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(metaAnalysis()),tool_calls:toolCalls}}]}));
   await assert.rejects(t.provider.analyzeProduct(IMAGE),code('invalid_response'));assert.equal(t.calls.length,1);
  }
  const invalid=setup(()=>Response.json({model:FIREWORKS_PRODUCT_MODEL,choices:[{finish_reason:'stop',message:{role:'assistant',content:'{}',tool_calls:[]}}]}));
  await assert.rejects(invalid.provider.analyzeProduct(IMAGE),code('invalid_response'));
 });
 it('rejects impossible quantities and unreadable evidence; never fabricates non-food',async()=>{
  for(const raw of [metaAnalysis({nutrition_table:{protein_g:-1}}),metaAnalysis({nutrition_table:{energy_kcal:901}}),metaAnalysis({image:{quality:'unreadable'}})])await assert.rejects(setup(()=>reply(raw)).provider.analyzeProduct(IMAGE),code('invalid_response'));
  await assert.rejects(setup(()=>reply(metaAnalysis({image:{is_food_product:false}}))).provider.analyzeProduct(IMAGE),code('product_not_recognized'));
 });
 it('missing key, invalid inputs or excessive image count make no request',async()=>{
  let calls=0;const p=new FireworksProductProvider({apiKey:' ',fetch:(async()=>{calls++;return reply();}) as typeof fetch});
  await assert.rejects(p.analyzeProduct(IMAGE),code('not_configured'));
  const t=setup();for(const invalid of [{kind:'text',text:'hi'},{kind:'image',images:[]},{kind:'image',images:Array(4).fill({mimeType:'image/jpeg',base64:DATA})},{kind:'image',image:{mimeType:'image/gif',base64:DATA}}])await assert.rejects(t.provider.analyzeProduct(invalid as AnalyzeProductInput),code('unsupported_input'));
  assert.equal(calls+t.calls.length,0);
 });
 it('timeout identifies headers/body stage; late response produces no success',async()=>{
  let complete!:(response:Response)=>void;const first=setup(()=>new Promise<Response>(resolve=>{complete=resolve;}),15);
  await assert.rejects(first.provider.analyzeProduct(IMAGE),code('timeout'));assert.equal(first.logs.at(-1)!.data.stage,'waiting_headers');
  const count=first.logs.length;complete(reply());await new Promise(resolve=>setImmediate(resolve));assert.equal(first.logs.length,count);
  const second=setup(()=>new Response(new ReadableStream({start(){}})),15);await assert.rejects(second.provider.analyzeProduct(IMAGE),code('timeout'));
  assert.equal(second.logs.at(-1)!.data.stage,'reading_body');assert.equal(second.logs.at(-1)!.data.httpStatus,200);assert.equal(second.calls.length,1);
 });
 it('network failures never carry raw cause or secrets',async()=>{
  const t=setup(()=>{throw new Error(KEY+DATA);});await assert.rejects(t.provider.analyzeProduct(IMAGE),code('unavailable'));assert.equal(t.calls.length,1);assert.ok(!JSON.stringify(t.logs).includes(KEY));
 });
});


it('Scan rejection logs a fixed diagnostic code without raw response fields',async()=>{
 const cases:[()=>Response,string][]=[
  [()=>reply(metaAnalysis(),'length'),'truncated'],
  [()=>Response.json({model:FIREWORKS_PRODUCT_MODEL,choices:[{finish_reason:'stop',message:{role:'assistant',content:'not-json '+KEY}}]}),'content_json'],
  [()=>reply({...metaAnalysis(),[KEY]:DATA}),'schema_violation'],
  [()=>reply(metaAnalysis({nutrition_table:{protein_g:-1}})),'quantity_bounds'],
 ];
 for(const [respond,reason]of cases){
  const t=setup(respond);await assert.rejects(t.provider.analyzeProduct(IMAGE),code('invalid_response'));
  const last=t.logs.find(l=>l.event==='fireworks_scan')!.data;
  assert.equal(last.validationIssue,reason);assert.ok(!JSON.stringify(t.logs).includes(KEY));assert.ok(!JSON.stringify(t.logs).includes(DATA));
 }
});
