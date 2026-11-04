import { randomUUID } from 'node:crypto';
import type { GoalMatchAiInput, GoalMatchAiOutput } from '@foodlens/core';
import { AIProviderError } from '../../errors';
import { SILENT_AI_LOGGER, type AILogger } from '../../ai-logger';
import { GoogleNutritionSearch, type ExtractionPage, type ExtractedPage } from '../google/google-nutrition-search';
import { GoogleGoalMatchProvider } from '../google/google-goal-match-provider';
import type { GoalMatchEvaluator } from '../../goal-match-provider';
import { FIREWORKS_PRODUCT_MODEL } from './fireworks-product-provider';
import { FIREWORKS_MEAL_PLAN_ENDPOINT } from './fireworks-meal-plan-provider';

// Translation uses the same model as vision, rather than the 12-second search deadline.
const FIREWORKS_TRANSLATION_TIMEOUT_MS = 60_000;

export interface FireworksProductTextConfig { readonly apiKey: string; readonly fetch?: typeof fetch; readonly logger?: AILogger; readonly timeoutMs?: number }
const record=(x:unknown):x is Record<string,any>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const fail=(code:ConstructorParameters<typeof AIProviderError>[1])=>new AIProviderError('fireworks',code,`Fireworks product text: ${code}`);
const count=(x:unknown):number|null=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=0?x:null;

/** Adapt schema syntax only. Existing prompts, parsers, limits and caller orchestration are reused. */
export function productJsonSchema(schema:Record<string,any>):Record<string,unknown>{
 const out:Record<string,unknown>={};
 if(schema.type)out.type=String(schema.type).toLowerCase();
 for(const k of ['enum','description','required','minimum','maximum','minItems','maxItems'])if(schema[k]!==undefined)out[k]=schema[k];
 if(schema.properties){out.properties=Object.fromEntries(Object.entries(schema.properties).map(([k,v])=>[k,productJsonSchema(v as Record<string,any>)]));out.additionalProperties=false;}
 if(schema.items)out.items=productJsonSchema(schema.items);
 if(schema.anyOf)out.anyOf=schema.anyOf.map(productJsonSchema);
 return schema.nullable?{anyOf:[out,{type:'null'}]}:out;
}

/** Accepts the existing internal text-request format; it NEVER sends a request to the supplied Google URL. */
export function createFireworksProductTextTransport(config:FireworksProductTextConfig):typeof fetch{
 const transport=config.fetch??globalThis.fetch,logger=config.logger??SILENT_AI_LOGGER;
 return (async(_url,init)=>{
  if(!config.apiKey.trim())throw fail('not_configured');
  const b=JSON.parse(String(init?.body));
  if(b.tools)throw fail('unsupported_input'); // Google Search grounding cannot be emulated by invented URLs.
  if(!b.generationConfig?.responseSchema)throw fail('unsupported_input');
  const parts=b.contents?.[0]?.parts;
  if(!Array.isArray(parts)||parts.some((p:unknown)=>!record(p)||typeof p.text!=='string'))throw fail('unsupported_input');
  const schema=b.generationConfig.responseSchema;
  const type=schema.properties?.pages?'nutrition_extraction':schema.properties?.translations?'ingredients_translation':schema.properties?.ingredients?'ingredients_extraction':'goal_match';
  const requestId=randomUUID(),started=Date.now();
  const fields={requestId,provider:'fireworks',model:FIREWORKS_PRODUCT_MODEL,type,retries:0};
  let status:number|null=null;
  try{
   const response=await transport(FIREWORKS_MEAL_PLAN_ENDPOINT,{method:'POST',redirect:'error',signal:init?.signal,
    headers:{Authorization:`Bearer ${config.apiKey.trim()}`,'Content-Type':'application/json'},
    body:JSON.stringify({model:FIREWORKS_PRODUCT_MODEL,stream:false,reasoning_effort:'low',max_tokens:b.generationConfig.maxOutputTokens,
     ...(b.generationConfig.temperature===undefined?{}:{temperature:b.generationConfig.temperature}),
     messages:[{role:'system',content:(b.systemInstruction?.parts??[]).map((p:{text:string})=>p.text).join('')},{role:'user',content:parts.map((p:{text:string})=>p.text).join('')}],
     response_format:{type:'json_schema',json_schema:{name:type,schema:productJsonSchema(schema),strict:true}},
    })});
   status=response.status;
   if(init?.signal?.aborted){void response.body?.cancel().catch(()=>undefined);throw fail('timeout');}
   if(!response.ok){void response.body?.cancel().catch(()=>undefined);return new Response(null,{status:response.status});}
   const data:unknown=await response.json();
   if(init?.signal?.aborted)throw fail('timeout');
   if(!record(data)||data.model!==FIREWORKS_PRODUCT_MODEL||!Array.isArray(data.choices)||data.choices.length!==1)throw fail('invalid_response');
   const c=data.choices[0],m=c?.message;
   if(!record(m)||m.role!=='assistant'||typeof m.content!=='string'||m.refusal||c.finish_reason!=='stop'||(m.tool_calls!=null&&(!Array.isArray(m.tool_calls)||m.tool_calls.length)))throw fail('invalid_response');
   const u=record(data.usage)?data.usage:{},prompt=count(u.prompt_tokens),output=count(u.completion_tokens),total=count(u.total_tokens);
   const cached=record(u.prompt_tokens_details)?count(u.prompt_tokens_details.cached_tokens):null;
   const cache=cached!==null&&prompt!==null&&cached<=prompt?cached:0;
   logger.log('fireworks_usage',{...fields,httpStatus:status,prompt,output,total,cached,estimatedCostUsd:prompt!==null&&output!==null?((prompt-cache)*1.25+cache*.15+output*4.25)/1e6:null,priceVersion:'2026-11-04'});
   logger.log('fireworks_product_text',{...fields,httpStatus:status,success:true,latencyMs:Date.now()-started});
   return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:m.content}]}}]});
  }catch(error){
   const code=error instanceof AIProviderError?error.code:init?.signal?.aborted?'timeout':'unavailable';
   logger.warn('fireworks_product_text',{...fields,httpStatus:status,success:false,code,latencyMs:Date.now()-started});throw fail(code);
  }
 }) as typeof fetch;
}
const safeLogger=(logger:AILogger):AILogger=>({log:(m,f)=>{if(m!=='gemini_usage')logger.log(m,{...f,provider:'fireworks',model:FIREWORKS_PRODUCT_MODEL});},warn:(m,f)=>logger.warn(m,{...f,provider:'fireworks',model:FIREWORKS_PRODUCT_MODEL})});
async function safe<T>(work:()=>Promise<T>):Promise<T>{try{return await work();}catch(e){throw fail(e instanceof AIProviderError?e.code:'unavailable');}}

/** Keeps the established text extraction/translation prompts and validation implementation. */
export class FireworksProductTextAI extends GoogleNutritionSearch{
 constructor(config:FireworksProductTextConfig){const logger=config.logger??SILENT_AI_LOGGER;super({apiKey:config.apiKey,project:'fireworks-adapter',model:'gemini-3.5-flash-lite',timeoutMs:config.timeoutMs,translationTimeoutMs:config.timeoutMs??FIREWORKS_TRANSLATION_TIMEOUT_MS,
  fetch:createFireworksProductTextTransport(config),logger:safeLogger(logger)});}
 override extractNutrition(p:readonly ExtractionPage[],signal?:AbortSignal):Promise<readonly ExtractedPage[]>{return safe(()=>super.extractNutrition(p,signal));}
 override extractIngredients(t:string,signal?:AbortSignal):Promise<string|null>{return safe(()=>super.extractIngredients(t,signal));}
 override translateIngredients(t:readonly string[]):Promise<readonly string[]>{return safe(()=>super.translateIngredients(t));}
 override async discoverSources():Promise<never>{throw fail('unsupported_input');}
}
export class FireworksProductGoalMatch implements GoalMatchEvaluator{
 readonly name='fireworks';readonly model=FIREWORKS_PRODUCT_MODEL;
 private readonly delegate:GoogleGoalMatchProvider;
 constructor(config:FireworksProductTextConfig){this.delegate=new GoogleGoalMatchProvider({apiKey:config.apiKey,project:'fireworks-adapter',model:'gemini-3.5-flash-lite',timeoutMs:config.timeoutMs,
  fetch:createFireworksProductTextTransport(config),logger:safeLogger(config.logger??SILENT_AI_LOGGER)});}
 evaluateGoalMatch(input:GoalMatchAiInput):Promise<GoalMatchAiOutput>{return safe(()=>this.delegate.evaluateGoalMatch(input));}
}
