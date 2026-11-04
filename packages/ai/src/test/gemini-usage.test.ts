import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import type {GoalMatchAiInput} from '@foodlens/core';
import {GoogleGoalMatchProvider,GoogleProvider,MOCK_GOAL_MATCH_RECORDINGS} from '../index';
import {extractGeminiUsage} from '../providers/google/gemini-usage';
import {metaAnalysis} from './meta-fixtures';

const KEY='unit-usage-key-not-real';
const DATA=Buffer.from('unit image bytes only').toString('base64');
const USAGE={promptTokenCount:1450,candidatesTokenCount:610,thoughtsTokenCount:12,totalTokenCount:2072,cachedContentTokenCount:0,
  promptTokensDetails:[{modality:'TEXT',tokenCount:1192},{modality:'IMAGE',tokenCount:258}],
  candidatesTokensDetails:[{modality:'TEXT',tokenCount:610}]};
const envelope=(value:unknown,usage:unknown=USAGE)=>({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(value)}]}}],
  ...(usage===null?{}:{usageMetadata:usage})});
function recorder(){
  const lines:{message:string;fields:Record<string,unknown>}[]=[];
  return {lines,logger:{log:(message:string,fields:Readonly<Record<string,unknown>>)=>void lines.push({message,fields:{...fields}}),warn:()=>undefined}};
}
const usageLines=(lines:{message:string;fields:Record<string,unknown>}[])=>lines.filter(l=>l.message==='gemini_usage');

describe('extractGeminiUsage',()=>{
  it('copies only numeric counts, incl. prompt modality details',()=>{
    assert.deepEqual(extractGeminiUsage(envelope({})),{prompt:1450,output:610,thoughts:12,cached:0,total:2072,image:258,text:1192});
  });
  it('missing usageMetadata → null; non-numeric or negative counts → null fields',()=>{
    assert.equal(extractGeminiUsage(envelope({},null)),null);
    assert.equal(extractGeminiUsage(null),null);
    assert.deepEqual(extractGeminiUsage({usageMetadata:{promptTokenCount:'1450',candidatesTokenCount:-1,totalTokenCount:9,
      promptTokensDetails:[{modality:'IMAGE',tokenCount:'x'}]}}),
      {prompt:null,output:null,thoughts:null,cached:null,total:9,image:null,text:null});
  });
});

describe('gemini_usage logging (stubbed HTTP, no network)',()=>{
  it('product_analysis: one numeric line, no key / image / prompt / ingredients; request body unchanged',async()=>{
    const {lines,logger}=recorder();let body='';
    const provider=new GoogleProvider({apiKey:KEY,project:'foodlens-513112',logger,createId:()=>'t',
      fetch:(async(_url:unknown,init?:RequestInit)=>(body=String(init!.body),new Response(JSON.stringify(envelope(metaAnalysis()))))) as typeof fetch});
    await provider.analyzeProduct({kind:'image',image:{mimeType:'image/jpeg',base64:DATA}});
    const usage=usageLines(lines);
    assert.equal(usage.length,1);
    assert.deepEqual(usage[0]!.fields,{type:'product_analysis',model:'gemini-3.5-flash-lite',prompt:1450,output:610,thoughts:12,cached:0,total:2072,image:258,text:1192,numberOfImages:1,retries:0});
    const logged=JSON.stringify(lines);
    for(const secret of [KEY,DATA,'молоко','systemInstruction'])assert.ok(!logged.includes(secret),secret);
    assert.equal(JSON.parse(body).generationConfig.maxOutputTokens,4096,'request config untouched');
  });

  it('goal_match: logged also when the response is later rejected, and "missing" without usageMetadata',async()=>{
    const output=MOCK_GOAL_MATCH_RECORDINGS.find(x=>x.id==='greek_yogurt')!.responses[0];
    const input={version:'goal-match-ai-input-v1',goal:'eat_healthier',locale:'en',product:{name:'Greek yogurt',per100:{kcal:66}}} as GoalMatchAiInput;
    const {lines,logger}=recorder();
    const replies=[envelope(output),envelope({bad:true}),envelope(output,null)];
    const provider=new GoogleGoalMatchProvider({apiKey:KEY,project:'foodlens-513112',logger,
      fetch:(async()=>new Response(JSON.stringify(replies.shift())))as typeof fetch});
    await provider.evaluateGoalMatch(input);
    await assert.rejects(provider.evaluateGoalMatch(input));
    await provider.evaluateGoalMatch(input);
    const usage=usageLines(lines).map(l=>l.fields);
    assert.equal(usage.length,3,'every billed HTTP response is counted, valid or not');
    assert.equal(usage[0]!.type,'goal_match');assert.equal(usage[0]!.total,2072);assert.equal(usage[1]!.total,2072);
    assert.deepEqual(usage[2],{type:'goal_match',model:'gemini-3.5-flash-lite',usage:'missing'});
    assert.ok(!JSON.stringify(lines).includes(KEY)&&!JSON.stringify(lines).includes('Greek yogurt'));
  });

  it('HTTP errors produce no usage line (no response body is read)',async()=>{
    const {lines,logger}=recorder();
    const provider=new GoogleGoalMatchProvider({apiKey:KEY,project:'foodlens-513112',logger,fetch:(async()=>new Response('{}',{status:429}))as typeof fetch});
    await assert.rejects(provider.evaluateGoalMatch({version:'goal-match-ai-input-v1'} as GoalMatchAiInput));
    assert.equal(usageLines(lines).length,0);
  });
});
