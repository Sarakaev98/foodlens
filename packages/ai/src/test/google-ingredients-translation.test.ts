import assert from 'node:assert/strict';
import { describe,it } from 'node:test';
import { GoogleNutritionSearch } from '../providers/google/google-nutrition-search';
import { readIngredientTranslations } from '../ingredients/ingredients-translation';
const envelope=(value:unknown)=>({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(value)}]}}],usageMetadata:{promptTokenCount:50,candidatesTokenCount:20,totalTokenCount:70}});
describe('Ingredient display translation reuses the existing Google text transport',()=>{
 it('one schema-constrained text request, no image/search/profile; usage is separately labelled',async()=>{
  const bodies:Record<string,unknown>[]=[],logs:unknown[]=[];
  const ai=new GoogleNutritionSearch({apiKey:'test-not-real',project:'test-project',logger:{log:(_m,f)=>logs.push(f),warn:()=>{}},fetch:(async(_url,init)=>{
   bodies.push(JSON.parse(String(init!.body)));return new Response(JSON.stringify(envelope({translations:[{id:1,text:'salt'},{id:0,text:'sugar'}]})));
  }) as typeof fetch});
  assert.deepEqual(await ai.translateIngredients(['сахар','соль']),['sugar','salt']);assert.equal(bodies.length,1);
  assert.equal(bodies[0]!.tools,undefined);assert.ok(!JSON.stringify(bodies[0]).includes('inlineData'));assert.ok(!JSON.stringify(bodies[0]).includes('score'));
  assert.ok(logs.some(l=>(l as {type?:string}).type==='ingredients_translation'));
 });
 it('empty input never calls the transport',async()=>{
  const ai=new GoogleNutritionSearch({apiKey:'',project:'',fetch:async()=>{assert.fail('must not call');}});assert.deepEqual(await ai.translateIngredients([]),[]);
 });
 it('missing/duplicate/unknown ids and empty strings fail closed',()=>{
  for(const rows of [[],[{id:0,text:'a'},{id:0,text:'b'}],[{id:3,text:'a'},{id:1,text:'b'}],[{id:0,text:''},{id:1,text:'b'}]])assert.equal(readIngredientTranslations({translations:rows},2),null);
 });
 it('provider errors and malformed JSON reject for the display fallback, without retries',async()=>{
  for(const response of [new Response('unavailable',{status:503}),new Response(JSON.stringify(envelope({translations:[]})))]){
   let count=0;const ai=new GoogleNutritionSearch({apiKey:'test',project:'test',fetch:async()=>{count++;return response;}});
   await assert.rejects(()=>ai.translateIngredients(['сахар']));assert.equal(count,1);
  }
 });
});
