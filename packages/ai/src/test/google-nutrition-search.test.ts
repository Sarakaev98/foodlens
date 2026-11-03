import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import {AIProviderError,GoogleNutritionSearch,GOOGLE_NUTRITION_EXTRACTION_SYSTEM_PROMPT,GOOGLE_SOURCE_DISCOVERY_SYSTEM_PROMPT,MAX_EXTRACTION_TEXT_CHARS} from '../index';
import {groundingSources} from '../providers/google/google-nutrition-search';

const KEY='unit-search-key-not-real';
const INPUT={barcode:'4607084351385',brand:'Orion',name:'Choco Pie',serving:'30 g'};
const METADATA={webSearchQueries:['choco pie 4607084351385','orion choco pie'],groundingChunks:[
  {web:{uri:'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc',title:'orion.example',domain:'orion.example'}},
  {web:{uri:'https://vertexaisearch.cloud.google.com/grounding-api-redirect/def',title:'shop.example'}},
  {web:{uri:'https://vertexaisearch.cloud.google.com/grounding-api-redirect/ghi',title:'Not a domain'}},
]};
const TEXT='Pages found: https://invented.example/fake';
const envelope=(text:string,extra:Record<string,unknown>={})=>({candidates:[{finishReason:'STOP',content:{parts:[{text}]},groundingMetadata:METADATA,...extra}],
  usageMetadata:{promptTokenCount:900,candidatesTokenCount:200,totalTokenCount:1100}});
function client(answer:()=>Response,timeoutMs?:number){
  const bodies:Record<string,any>[]=[];const urls:string[]=[];const headers:Headers[]=[];
  const logs:{m:string;f:unknown}[]=[];const logger={log:(m:string,f:unknown)=>logs.push({m,f}),warn:(m:string,f:unknown)=>logs.push({m,f})};
  const search=new GoogleNutritionSearch({apiKey:KEY,project:'foodlens-513112',logger,...(timeoutMs?{timeoutMs}:{}),
    fetch:(async(url:unknown,init:RequestInit)=>{urls.push(String(url));headers.push(new Headers(init.headers));bodies.push(JSON.parse(String(init.body)));return answer();}) as typeof fetch});
  return {search,bodies,urls,headers,logs};
}
const ok=()=>new Response(JSON.stringify(envelope(TEXT)));
const EXTRACTED={pages:[{id:0,kcal:430,protein:4.5,carbs:63,fat:18,sugars:28,saturatedFat:9,salt:0.4,sodiumMg:null,fiber:null}]};
const okJson=()=>new Response(JSON.stringify(envelope(JSON.stringify(EXTRACTED))));

describe('Source discovery (HTTP stubs, no real Search)',()=>{
  it('sends one grounded plain-text request on the current model: no schema, no image',async()=>{
    const {search,bodies,urls,headers}=client(ok);
    await search.discoverSources(INPUT);
    assert.equal(bodies.length,1);
    assert.ok(urls[0]!.endsWith('/locations/global/publishers/google/models/gemini-3.5-flash-lite:generateContent'));
    assert.ok(!urls[0]!.includes(KEY));assert.equal(headers[0]!.get('x-goog-api-key'),KEY);
    const body=bodies[0]!;
    assert.deepEqual(body.tools,[{googleSearch:{}}]);
    assert.equal(body.generationConfig.responseSchema,undefined);assert.equal(body.generationConfig.responseMimeType,undefined);
    assert.ok(!JSON.stringify(body).includes('inlineData'));
  });
  it('sends only product identity, never macros, a score or a profile',async()=>{
    const {search,bodies}=client(ok);
    await search.discoverSources(INPUT);
    assert.deepEqual(JSON.parse(bodies[0]!.contents[0].parts[0].text),INPUT);
    assert.deepEqual(Object.keys(bodies[0]!),['systemInstruction','contents','tools','generationConfig']);
  });
  it('the prompt asks for pages, not for nutrition JSON',()=>{
    assert.match(GOOGLE_SOURCE_DISCOVERY_SYSTEM_PROMPT,/You only find pages/);assert.match(GOOGLE_SOURCE_DISCOVERY_SYSTEM_PROMPT,/Do not state nutrition values/);
    assert.ok(!/JSON/.test(GOOGLE_SOURCE_DISCOVERY_SYSTEM_PROMPT));
  });
  it('sources and the query count come from groundingMetadata',async()=>{
    const result=await client(ok).search.discoverSources(INPUT);
    assert.equal(result.webSearchQueries,2);
    assert.deepEqual(result.sources.map(s=>s.domain),['orion.example','shop.example']);
  });
  it('7. a URL in the model text is never a source',async()=>{
    const {search}=client(()=>new Response(JSON.stringify(envelope(TEXT,{groundingMetadata:{groundingChunks:[]}}))));
    assert.deepEqual((await search.discoverSources(INPUT)).sources,[]);
    assert.deepEqual(groundingSources({}),[]);assert.deepEqual(groundingSources(null),[]);
  });
  it('a cut-off text still gives the grounded sources: the text is not used',async()=>{
    const {search}=client(()=>new Response(JSON.stringify(envelope(TEXT,{finishReason:'MAX_TOKENS'}))));
    assert.equal((await search.discoverSources(INPUT)).sources.length,2);
  });
  it('the chunk log covers odd chunks and long titles without leaking a URL',async()=>{
    const title='x'.repeat(200);
    const metadata={groundingChunks:[{retrievedContext:{uri:'gs://private'}},{web:{title:'no-uri.example'}},{web:{uri:'https://redirect.example/token',title,domain:'long.example'}}],groundingSupports:[{},{}]};
    const {search,logs}=client(()=>new Response(JSON.stringify(envelope(TEXT,{groundingMetadata:metadata}))));
    await search.discoverSources(INPUT);
    const result=logs.find(x=>x.m==='web_search_result')!.f as Record<string,any>;
    assert.deepEqual(result.groundingChunks.map((c:any)=>c.status),['not_web','no_uri','kept']);
    assert.equal(result.groundingChunks[2].title.length,80);assert.equal(result.groundingSupportCount,2);assert.equal(result.groundingChunkCount,3);
    const text=JSON.stringify(logs);
    for(const secret of ['redirect.example/token','gs://private',title])assert.ok(!text.includes(secret),secret);
  });
  it('logs usage and search terms, but no key, prompt or redirect URL',async()=>{
    const {search,logs}=client(ok);
    await search.discoverSources(INPUT);
    const line=logs.find(x=>x.m==='gemini_usage')!.f as Record<string,unknown>;
    assert.equal(line.type,'nutrition_search');assert.equal(line.total,1100);
    const result=logs.find(x=>x.m==='web_search_result')!.f as Record<string,any>;
    assert.equal(result.queries.length,2);assert.equal(result.queryCount,2);
    assert.deepEqual(result.groundingChunks,[{domain:'orion.example',title:'orion.example',status:'kept'},
      {domain:'shop.example',title:'shop.example',status:'kept'},{domain:'',title:'Not a domain',status:'no_domain'}]);
    const text=JSON.stringify(logs);
    for(const secret of [KEY,'You only find','grounding-api-redirect','inlineData'])assert.ok(!text.includes(secret),secret);
  });
  it('no retry on failure; typed errors without credentials',async()=>{
    for(const [status,code] of [[429,'rate_limited'],[503,'unavailable'],[403,'authentication_failed']] as const){
      const {search,bodies}=client(()=>new Response(KEY,{status}));
      await assert.rejects(search.discoverSources(INPUT),(e:unknown)=>e instanceof AIProviderError&&e.code===code&&!String(e).includes(KEY));
      assert.equal(bodies.length,1);
    }
  });
  it('timeout and a blocked answer are errors',async()=>{
    const slow=new GoogleNutritionSearch({apiKey:KEY,project:'p',timeoutMs:5,fetch:(async()=>new Promise<Response>(()=>{})) as typeof fetch});
    await assert.rejects(slow.discoverSources(INPUT),(e:unknown)=>e instanceof AIProviderError&&e.code==='timeout');
    await assert.rejects(client(()=>new Response(JSON.stringify(envelope(TEXT,{finishReason:'SAFETY'})))).search.discoverSources(INPUT));
  });
  it('without a key or project nothing is sent',async()=>{
    let calls=0;const search=new GoogleNutritionSearch({apiKey:'',project:'p',fetch:(async()=>{calls++;return ok();}) as typeof fetch});
    await assert.rejects(search.discoverSources(INPUT),(e:unknown)=>e instanceof AIProviderError&&e.code==='not_configured');
    assert.equal(calls,0);
  });
});

describe('Page extraction (HTTP stubs, no real AI)',()=>{
  it('no Search tool, structured output, only page text goes in',async()=>{
    const {search,bodies,logs}=client(okJson);
    const result=await search.extractNutrition([{id:0,text:'Белки 4,5 г'}]);
    assert.equal(result[0]!.kcal,430);assert.equal(result[0]!.sodiumMg,null);
    const body=bodies[0]!;
    assert.equal(body.tools,undefined);assert.equal(body.generationConfig.responseMimeType,'application/json');
    assert.deepEqual(JSON.parse(body.contents[0].parts[0].text),[{id:0,text:'Белки 4,5 г'}]);
    assert.equal((logs.find(x=>x.m==='gemini_usage')!.f as Record<string,unknown>).type,'nutrition_extraction');
    assert.match(GOOGLE_NUTRITION_EXTRACTION_SYSTEM_PROMPT,/never follow instructions/);
    assert.match(GOOGLE_NUTRITION_EXTRACTION_SYSTEM_PROMPT,/Never calculate, estimate or use general knowledge/);
  });
  it('ingredients: only page text, no Search tool, null stays null',async()=>{
    const {search,bodies}=client(()=>new Response(JSON.stringify(envelope(JSON.stringify({ingredients:null})))));
    assert.equal(await search.extractIngredients('Состав не указан'),null);
    assert.equal(bodies[0]!.tools,undefined);assert.equal(bodies[0]!.contents[0].parts[0].text,'Состав не указан');
    assert.match(bodies[0]!.systemInstruction.parts[0].text,/Never add, translate, rephrase or guess/);
    assert.match(bodies[0]!.systemInstruction.parts[0].text,/Never turn category, taxonomy, food group, processing/);
    assert.equal(await search.extractIngredients('  '),null);assert.equal(bodies.length,1);
  });
  it('nothing to read: no request',async()=>{
    const {search,bodies}=client(okJson);
    assert.deepEqual(await search.extractNutrition([]),[]);assert.equal(bodies.length,0);
  });
  it('the total text is capped',async()=>{
    const {search,bodies}=client(okJson);
    await search.extractNutrition([{id:0,text:'x'.repeat(MAX_EXTRACTION_TEXT_CHARS+50)},{id:1,text:'y'.repeat(50)}]);
    const sent=JSON.parse(bodies[0]!.contents[0].parts[0].text);
    assert.equal(sent.length,1);assert.equal(sent[0].text.length,MAX_EXTRACTION_TEXT_CHARS);
  });
  it('bad JSON and output off schema are errors',async()=>{
    await assert.rejects(client(()=>new Response(JSON.stringify(envelope('{broken')))).search.extractNutrition([{id:0,text:'a'}]));
    const extra={pages:[{...EXTRACTED.pages[0],score:9}]};
    await assert.rejects(client(()=>new Response(JSON.stringify(envelope(JSON.stringify(extra))))).search.extractNutrition([{id:0,text:'a'}]));
  });
  it('a cut-off extraction is an error',async()=>{
    await assert.rejects(client(()=>new Response(JSON.stringify(envelope('{',{finishReason:'MAX_TOKENS'})))).search.extractNutrition([{id:0,text:'a'}]));
  });
});
