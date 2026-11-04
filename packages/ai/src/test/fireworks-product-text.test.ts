import assert from 'node:assert/strict';
import {it} from 'node:test';
import {FireworksProductTextAI,FireworksProductGoalMatch,GoogleNutritionSearch,GoogleGoalMatchProvider,FIREWORKS_PRODUCT_MODEL,MOCK_GOAL_MATCH_RECORDINGS,AIProviderError} from '../index';
const nutrition={pages:[{id:1,kcal:354,protein:11.6,carbs:70.84,fat:2.89,sugars:1.24,saturatedFat:.67,salt:0,sodiumMg:0,fiber:null}]};
const goals={...MOCK_GOAL_MATCH_RECORDINGS.find(r=>r.id==='greek_yogurt')!.responses[0],warnings:[]};
function setup(meta:boolean,output:unknown){
 const calls:{url:string;body:any;headers:Headers}[]=[];
 const fetcher=(async(url,init)=>{calls.push({url:String(url),body:JSON.parse(String(init?.body)),headers:new Headers(init?.headers)});
  return meta?Response.json({model:FIREWORKS_PRODUCT_MODEL,choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(output),tool_calls:[]}}]}):Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(output)}]}}]});
 }) as typeof fetch;
 return {calls,text:meta?new FireworksProductTextAI({apiKey:'fake-fireworks-key',fetch:fetcher}):new GoogleNutritionSearch({apiKey:'fake-google-key',project:'test',fetch:fetcher}),fetcher};
}
it('nutrition extraction reuses the exact old prompt, input, token cap, nullable data and parser',async()=>{
 const g=setup(false,nutrition),m=setup(true,nutrition),pages=[{id:1,text:'printed nutrition only'}];
 assert.deepEqual(await m.text.extractNutrition(pages),await g.text.extractNutrition(pages));
 assert.equal(m.calls.length,1);const a=m.calls[0]!,b=g.calls[0]!;
 assert.match(a.url,/fireworks.ai/);assert.equal(a.body.model,FIREWORKS_PRODUCT_MODEL);
 assert.equal(a.body.messages[0].content,b.body.systemInstruction.parts[0].text);assert.equal(a.body.messages[1].content,b.body.contents[0].parts[0].text);
 assert.equal(a.body.max_tokens,b.body.generationConfig.maxOutputTokens);assert.equal(a.headers.has('x-goog-api-key'),false);
 assert.deepEqual(a.body.response_format.json_schema.schema.properties.pages.items.properties.fiber,{anyOf:[{type:'number'},{type:'null'}]});
});
it('ingredient extraction and translation preserve their original prompts, outputs, ordering and empty-input no-call rule',async()=>{
 for(const kind of ['ingredients','translation']){
  const output=kind==='ingredients'?{ingredients:'Milk, cocoa'}:{translations:[{id:0,text:'Milk'},{id:1,text:'Cocoa'}]};
  const g=setup(false,output),m=setup(true,output);
  const run=(t:GoogleNutritionSearch)=>kind==='ingredients'?t.extractIngredients('printed ingredients'):t.translateIngredients(['молоко','какао']);
  assert.deepEqual(await run(m.text),await run(g.text));assert.equal(m.calls[0]!.body.messages[0].content,g.calls[0]!.body.systemInstruction.parts[0].text);
  assert.equal(m.calls[0]!.body.max_tokens,g.calls[0]!.body.generationConfig.maxOutputTokens);
  await m.text.translateIngredients([]);assert.equal(m.calls.length,1);
 }
});
it('Goal Match retains the same rubric, request, schema checks and output with actual Meta cache identity',async()=>{
 const m=setup(true,goals),g=setup(false,goals);
 const meta=new FireworksProductGoalMatch({apiKey:'fake',fetch:m.fetcher}),google=new GoogleGoalMatchProvider({apiKey:'fake',project:'test',fetch:g.fetcher});
 const input={version:'goal-match-ai-input-v1',product:{name:'fixture'}} as any;
 assert.deepEqual(await meta.evaluateGoalMatch(input),await google.evaluateGoalMatch(input));
 assert.equal(meta.name,'fireworks');assert.equal(meta.model,FIREWORKS_PRODUCT_MODEL);
 assert.equal(m.calls[0]!.body.messages[0].content,g.calls[0]!.body.systemInstruction.parts[0].text);
 assert.equal(m.calls[0]!.body.max_tokens,2048);
});
it('bad semantic outputs, network errors and timeouts are safe and never retry another model',async()=>{
 await assert.rejects(setup(true,{translations:[]}).text.translateIngredients(['secret data']),e=>e instanceof AIProviderError&&e.provider==='fireworks'&&e.code==='invalid_response');
 for(const mode of ['network','timeout']){
  let calls=0;const p=new FireworksProductTextAI({apiKey:'unit-secret',timeoutMs:15,fetch:(async()=>{calls++;if(mode==='network')throw new Error('unit-secret private data');return new Promise<Response>(()=>{});}) as typeof fetch});
  await assert.rejects(p.extractIngredients('text'),e=>e instanceof AIProviderError&&e.provider==='fireworks'&&e.code===(mode==='timeout'?'timeout':'unavailable')&&!String(e).includes('unit-secret'));
  assert.equal(calls,1);
 }
});
it('does not emulate Google Search grounding with invented source URLs',async()=>{
 const m=setup(true,{});await assert.rejects(m.text.discoverSources({barcode:null,brand:null,name:'test',serving:null}),e=>e instanceof AIProviderError&&e.code==='unsupported_input');assert.equal(m.calls.length,0);
});

it('Fireworks translation can finish after 12 seconds, without increasing the extraction deadline',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let calls=0;
 const ai=new FireworksProductTextAI({apiKey:'fake',fetch:(async()=>{
  calls++;return new Promise<Response>(resolve=>setTimeout(()=>resolve(Response.json({model:FIREWORKS_PRODUCT_MODEL,choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({translations:[{id:0,text:'milk'}]})}}]})),13000));
 }) as typeof fetch});
 const translated=ai.translateIngredients(['молоко']);
 t.mock.timers.tick(13001);
 assert.deepEqual(await translated,['milk']);assert.equal(calls,1);
 const extraction=assert.rejects(ai.extractIngredients('source'),e=>e instanceof AIProviderError&&e.code==='timeout');
 t.mock.timers.tick(12001);await extraction;assert.equal(calls,2);
});
it('an explicitly configured Fireworks translation deadline is still honored',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const ai=new FireworksProductTextAI({apiKey:'fake',timeoutMs:10,fetch:(async()=>new Promise<Response>(()=>{})) as typeof fetch});
 const result=assert.rejects(ai.translateIngredients(['молоко']),e=>e instanceof AIProviderError&&e.code==='timeout');
 t.mock.timers.tick(11);await result;
});

it('external web deadline aborts the Fireworks extraction transport with no retry or alternate provider',async()=>{
 const controller=new AbortController();let calls=0,received:AbortSignal|undefined;
 const ai=new FireworksProductTextAI({apiKey:'fake',fetch:(async(_url,init)=>{
  calls++;received=init!.signal!;return new Promise<Response>((_resolve,reject)=>received!.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));
 }) as typeof fetch});
 const pending=assert.rejects(ai.extractNutrition([{id:0,text:'source text'}],controller.signal),e=>e instanceof AIProviderError);
 controller.abort();await pending;assert.equal(calls,1);assert.equal(received!.aborted,true);
 await assert.rejects(ai.extractIngredients('source text',controller.signal));assert.equal(calls,1);
});
