import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import type {GoalMatchAiInput} from '@foodlens/core';
import {GoogleGoalMatchProvider,AIProviderError,GOOGLE_GOAL_MATCH_MODEL,MOCK_GOAL_MATCH_RECORDINGS} from '../index';

const KEY='unit-test-secret-never-a-real-key';
const output=MOCK_GOAL_MATCH_RECORDINGS.find(x=>x.id==='greek_yogurt')!.responses[0];
const input={version:'goal-match-ai-input-v1',goal:'eat_healthier',locale:'en',product:{name:'Greek yogurt',per100:{kcal:66}}} as GoalMatchAiInput;
const response=(value:unknown=output)=>new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(value)}]}}]}),{status:200});
function provider(transport:typeof fetch,extra:Partial<ConstructorParameters<typeof GoogleGoalMatchProvider>[0]>={}){
  return new GoogleGoalMatchProvider({apiKey:KEY,project:'foodlens-513112',fetch:transport,...extra});
}
async function fails(action:()=>Promise<unknown>,code:string){
  await assert.rejects(action,(error:unknown)=>{
    assert.ok(error instanceof AIProviderError);
    assert.equal(error.code,code);
    assert.ok(![String(error),JSON.stringify(error),error.stack??''].some(x=>x.includes(KEY)));
    assert.equal(error.cause,undefined);return true;
  });
}
describe('GoogleGoalMatchProvider (stubbed HTTP only)',()=>{
  it('uses the exact project endpoint, header authentication and existing structured output',async()=>{
    let count=0;
    const p=provider((async(url,init)=>{
      count++;assert.equal(String(url),'https://aiplatform.googleapis.com/v1/projects/foodlens-513112/locations/global/publishers/google/models/gemini-3.5-flash-lite:generateContent');
      assert.ok(!String(url).includes(KEY));assert.ok(!String(url).includes('?'));
      const headers=new Headers(init!.headers);assert.equal(headers.get('x-goog-api-key'),KEY);
      assert.equal(headers.get('Content-Type'),'application/json');
      const body=JSON.parse(String(init!.body));
      assert.equal(body.generationConfig.temperature,undefined);assert.equal(body.generationConfig.responseMimeType,'application/json');
      assert.equal(body.generationConfig.thinkingConfig.thinkingLevel,'MINIMAL');
      assert.equal(body.generationConfig.responseSchema.type,'OBJECT');
      assert.equal(body.generationConfig.responseSchema.properties.version.enum[0],'goal-match-ai-v1');
      assert.deepEqual(JSON.parse(body.contents[0].parts[0].text),input);
      assert.ok(!String(init!.body).includes(KEY));assert.ok(!String(init!.body).includes('additionalProperties'));
      assert.ok(!String(init!.body).includes('inlineData'));
      return response();
    }) as typeof fetch);
    assert.equal(p.name,'google');assert.equal(p.model,GOOGLE_GOAL_MATCH_MODEL);
    assert.deepEqual(await p.evaluateGoalMatch(input),output);assert.equal(count,1);
    assert.ok(!('analyzeProduct' in p));
    assert.ok(!JSON.stringify(p).includes(KEY));
  });
  it('403 / 401 become sanitized authentication errors; quota and server failures are safe',async()=>{
    for(const [status,code]of [[403,'authentication_failed'],[401,'authentication_failed'],[429,'rate_limited'],[500,'unavailable'],[400,'bad_request'],[404,'bad_request']] as const){
      const p=provider((async()=>new Response(KEY,{status})) as typeof fetch);
      await fails(()=>p.evaluateGoalMatch(input),code);
    }
  });
  it('enforces timeout even when the transport ignores cancellation',async()=>{
    let signal:AbortSignal|undefined|null;
    const p=provider((async(_,init)=>{signal=init?.signal;return new Promise<Response>(()=>{});}) as typeof fetch,{timeoutMs:5});
    await fails(()=>p.evaluateGoalMatch(input),'timeout');assert.equal(signal?.aborted,true);
  });
  it('sanitizes network errors and does not retain their causes',async()=>{
    const p=provider((async()=>{throw new Error('network '+KEY);}) as typeof fetch);
    await fails(()=>p.evaluateGoalMatch(input),'unavailable');
  });
  it('rejects malformed outer JSON, generated JSON and invalid output shape',async()=>{
    for(const transport of [
      async()=>new Response('{'),
      async()=>new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:'{'}]}}]})),
      async()=>response({bad:KEY}),
      async()=>response({...output,version:'wrong'}),
      async()=>new Response(JSON.stringify({candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:'{}'}]}}]})),
    ]) await fails(()=>provider(transport as typeof fetch).evaluateGoalMatch(input),'invalid_response');
  });
  it('missing key / project never sends an HTTP request',async()=>{
    let count=0;const transport=(async()=>{count++;return response();}) as typeof fetch;
    await fails(()=>provider(transport,{apiKey:''}).evaluateGoalMatch(input),'not_configured');
    await fails(()=>provider(transport,{project:''}).evaluateGoalMatch(input),'not_configured');
    assert.equal(count,0);
  });
  it('honors explicit model/location configuration, and rejects unsafe resource paths',async()=>{
    const p=provider((async url=>{assert.ok(String(url).includes('/locations/europe-west4/'));assert.ok(String(url).includes('/models/test-model:'));return response();}) as typeof fetch,
      {model:'test-model',location:'europe-west4'});
    assert.equal(p.model,'test-model');await p.evaluateGoalMatch(input);
    await fails(()=>provider((async()=>response()) as typeof fetch,{model:'../unsafe'}).evaluateGoalMatch(input),'not_configured');
  });
  it('ignores thought parts and rejects blocked output',async()=>{
    const p=provider((async()=>new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[
      {thought:true,text:'not JSON'},{text:JSON.stringify(output)}]}}]}))) as typeof fetch);
    assert.deepEqual(await p.evaluateGoalMatch(input),output);
    const blocked=provider((async()=>new Response(JSON.stringify({candidates:[{finishReason:'SAFETY'}]}))) as typeof fetch);
    await fails(()=>blocked.evaluateGoalMatch(input),'refused');
  });
});
