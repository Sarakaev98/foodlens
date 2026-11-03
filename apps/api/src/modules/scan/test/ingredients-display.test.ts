import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Logger } from '@nestjs/common';
import type { AIProvider } from '@foodlens/ai';
import { observed, NOT_DETECTED, type Product } from '@foodlens/core';
import { estimateMissingNutrition } from '../nutrition-estimator';
import { IngredientsDisplayService } from '../ingredients-display.service';
import { ingredientTranslationPlan, isEnglishIngredientText } from '../ingredients-display-text';
import { ScanService } from '../scan.service';
import { demoProduct, eatHealthierPlan } from '../../goal-match/test/goal-match-v4.fixtures';
import type { NutritionTargetsService } from '../../nutrition-targets/nutrition-targets.service';
import { MultiSourceProductLookup } from '../../product-lookup/multi-source-product-lookup';
import type { ProductLookupResult } from '../../product-lookup/product-lookup.provider';
Logger.overrideLogger(false);
const product=(names:string[]):Product=>demoProduct({id:'generic-ingredients',name:'Обычный пищевой продукт',portion:100,values:[350,6,7.5,65,12,4,2,3],sugarSource:'added',processing:'ultra_processed',productForm:'food',ingredients:names});
const words:Record<string,string>={'томаты':'tomatoes','сахар':'sugar','соль':'salt','уксус':'vinegar',domates:'tomatoes','şeker':'sugar',tuz:'salt',sirke:'vinegar','загуститель':'thickener','гуаровая камедь':'guar gum','лимонная кислота':'citric acid','мука':'flour','растительное масло':'vegetable oil'};
function translator(){const calls:readonly string[][]=[];return {calls,translateIngredients:async(texts:readonly string[])=>{(calls as string[][]).push([...texts]);return texts.map(text=>{assert.ok(words[text],text);return words[text]!;});}};}
describe('English ingredients are a separate presentation projection',()=>{
 for(const text of ['Tomatoes, sugar, salt, vinegar','guar gum (E412), sugar 3%, citric acid','maltodextrin','natural flavourings','vitamin B12 (E300)','xanthan gum, monosodium glutamate (E621)','Grade a pasteurized skimmed milk, live active yogurt cultures (l. bulgaricus, s. thermophilus)'])it(`English is unchanged without AI: ${text}`,async()=>{
  assert.equal(isEnglishIngredientText(text),true);
  const ai=translator(),p=product([text]),result=await new IngredientsDisplayService(ai).decorate(p);
  assert.equal(ai.calls.length,0);assert.equal(result.ingredientsDisplay!.status,'unchanged');assert.deepEqual(result.ingredientsDisplay!.items,p.ingredients.value);
 });
 for(const names of [['томаты','сахар','соль','уксус'],['domates','şeker','tuz','sirke']])it(`${names[0]} translates in one batch preserving original fields/order`,async()=>{
  const ai=translator(),p=product(names),snapshot=structuredClone(p),result=await new IngredientsDisplayService(ai).decorate(p);
  assert.equal(ai.calls.length,1);assert.equal(result.ingredientsDisplay!.status,'translated');assert.equal(result.ingredientsDisplay!.language,'en');
  assert.deepEqual(result.ingredientsDisplay!.items.map(i=>i.name),['tomatoes','sugar','salt','vinegar']);
  assert.deepEqual(p,snapshot);assert.equal(result.ingredients,p.ingredients);assert.equal(result.nutrition,p.nutrition);assert.equal(result.semantics,p.semantics);
 });
 it('preserves nested brackets, separators, E numbers, percentages and percent properties byte-for-byte',async()=>{
  const ai=translator(),p={...product(['загуститель (гуаровая камедь [E412]), сахар 3%, лимонная кислота']),ingredients:observed([{name:'загуститель (гуаровая камедь [E412]), сахар 3%, лимонная кислота',percent:12.5}])};
  const r=await new IngredientsDisplayService(ai).decorate(p);
  assert.equal(r.ingredientsDisplay!.items[0]!.name,'thickener (guar gum [E412]), sugar 3%, citric acid');
  assert.equal(r.ingredientsDisplay!.items[0]!.percent,12.5);
  assert.ok(!JSON.stringify(ai.calls).includes('E412'));assert.ok(!JSON.stringify(ai.calls).includes('3%'));
 });
 it('English technical translations are validated in list context and allow lexical hyphens',async()=>{
  const p=product(['лапша','агент антислеживающий']);
  const r=await new IngredientsDisplayService({translateIngredients:async()=>['Noodles','anti-caking agent']}).decorate(p);
  assert.equal(r.ingredientsDisplay!.status,'translated');
  assert.deepEqual(r.ingredientsDisplay!.items!.map(item=>item.name),['Noodles','anti-caking agent']);
 });
 it('rejects added/deleted ingredients, E numbers, numbers, delimiters or untranslated output',async()=>{
  for(const answer of [[],['sugar','salt'],['sugar, milk'],['sugar and milk'],['sugar E412'],['sugar 30%'],['(sugar)'],['сахар'],['domates']]){
   const p=product(['сахар']),r=await new IngredientsDisplayService({translateIngredients:async()=>answer}).decorate(p);
   assert.equal(r.ingredientsDisplay!.status,'fallback',JSON.stringify(answer));assert.deepEqual(r.ingredientsDisplay!.items,p.ingredients.value);
  }
 });
 it('translation error falls back and is cached briefly without retrying the same result',async()=>{
  let calls=0;const service=new IngredientsDisplayService({translateIngredients:async()=>{calls++;throw Error('unavailable');}}),p=product(['сахар']);
  const r=await service.decorate(p);assert.equal(r.ingredientsDisplay!.status,'fallback');assert.equal(r.ingredientsDisplay!.language,'original');
  await service.decorate(p);await service.decorate(r);assert.equal(calls,1);assert.equal(r.ingredients,p.ingredients);
 });
 it('deduplicates concurrent requests and cached results; changed source invalidates display',async()=>{
  const ai=translator(),service=new IngredientsDisplayService(ai),p=product(['сахар']);
  const [a,b]=await Promise.all([service.decorate(p),service.decorate(structuredClone(p))]);
  assert.equal(ai.calls.length,1);assert.deepEqual(a.ingredientsDisplay,b.ingredientsDisplay);
  await service.decorate(a);await service.decorate(p);assert.equal(ai.calls.length,1);
  const changed=await service.decorate({...a,ingredients:observed([{name:'соль',percent:null}])});
  assert.equal(ai.calls.length,2);assert.equal(changed.ingredientsDisplay!.items[0]!.name,'salt');
 });
 it('deduplicates identical fragments while retaining all occurrences',()=>{
  const plan=ingredientTranslationPlan([{name:'сахар (сахар), E-412; 2,5%',percent:null}]);
  assert.deepEqual(plan.texts,['сахар']);assert.equal(plan.assemble(['sugar'])[0]!.name,'sugar (sugar), E-412; 2,5%');
 });
 it('missing ingredients needs neither AI nor a display placeholder',async()=>{
  const ai=translator(),p={...product([]),ingredients:NOT_DETECTED};assert.equal(await new IngredientsDisplayService(ai).decorate(p),p);assert.equal(ai.calls.length,0);
 });
});

describe('Scan pipeline translation happens after nutrition, scoring and Goal Match',()=>{
 const file=()=>({mimetype:'image/jpeg',buffer:Buffer.from([0xff,0xd8,0xff,0xe0,0,0x10,0x4a,0x46]),size:8});
 const p=()=>({...product(['мука','сахар','растительное масло','соль']),nutrition:{...product([]).nutrition!,sugarsG:NOT_DETECTED,saturatedFatG:NOT_DETECTED,fiberG:NOT_DETECTED,saltG:NOT_DETECTED,sodiumMg:NOT_DETECTED}});
 async function run(mode:'photo'|'label'|'barcode',translated:boolean,sourceName='open_food_facts'){
  const source=p();const ai=translator();
  const display=translated?new IngredientsDisplayService(ai):undefined;
  const vision={name:'stub',analyzeProduct:async()=>source} as unknown as AIProvider;
  const plans={findPlanForUser:async()=>eatHealthierPlan()} as unknown as NutritionTargetsService;
  const full=estimateMissingNutrition(source);
  const result:ProductLookupResult={provider:sourceName as ProductLookupResult['provider'],match:'exact_barcode',barcode:'1234567890128',name:'Обычный пищевой продукт',brand:null,category:null,
   nutrition:{basis:'per_100g',values:Object.fromEntries(Object.entries(full.nutrition!).filter(([k])=>k!=='basis'&&k!=='servingSize').map(([k,v])=>[k,(v as {value:number}).value])) as NonNullable<ProductLookupResult['nutrition']>['values'],derived:[]},servingSize:{amount:100,unit:'g'},ingredients:source.ingredients.value,allergens:null,additives:null};
  const lookup=new MultiSourceProductLookup([{name:sourceName,lookup:async()=>result}]);
  const service=new ScanService(vision,plans,undefined,mode==='barcode'?lookup:undefined,async()=>null,display);
  const response=await service.analyze(mode==='barcode'?undefined:file(),'test',mode==='label'?{mode:'nutrition_label'}:mode==='barcode'?{barcode:'1234567890128'}:{});
  return {response,ai};
 }
 for(const mode of ['photo','label','barcode'] as const)it(`${mode}: scores, estimator, original nutrition/ingredients/allergens/processing unchanged`,async()=>{
  const a=await run(mode,false),b=await run(mode,true);
  assert.deepEqual(b.response.score,a.response.score);assert.deepEqual(b.response.goalMatch,a.response.goalMatch);
  for(const key of ['ingredients','nutrition','nutritionMetadata','allergens','additives','semantics'] as const)assert.deepEqual(b.response.product[key],a.response.product[key],key);
  assert.equal(b.response.product.ingredientsDisplay!.status,'translated');assert.equal(b.ai.calls.length,1);
 });
 it('enrichment/web fallback composition is decorated through the same barcode path',async()=>{
  const r=await run('barcode',true,'web_search');assert.equal(r.response.product.ingredientsDisplay!.status,'translated');assert.equal(r.response.product.ingredients.value![0]!.name,'мука');
 });
});
