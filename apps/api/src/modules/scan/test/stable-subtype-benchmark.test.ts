import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { NUTRIENT_KEYS, NOT_DETECTED, observed, type NutrientKey, type NutritionFacts, type Product, type ProductCategory } from '@foodlens/core';
import { scoreProduct } from '@foodlens/scoring';
import { emptyBarcodeProduct } from '../barcode-product';
import { estimateMissingNutrition, nutritionEstimationProfile } from '../nutrition-estimator';
const label = (v: Partial<Record<NutrientKey,number>>): NutritionFacts => ({basis:'per_100g',servingSize:NOT_DETECTED,...Object.fromEntries(NUTRIENT_KEYS.map(k=>[k,v[k]===undefined?NOT_DETECTED:observed(v[k]!)]))}) as NutritionFacts;
const food = (name: string, category: ProductCategory | null = null, v: Partial<Record<NutrientKey,number>> = {}, ingredients: string[] = []): Product => ({...emptyBarcodeProduct('1234567890128'),name:observed(name),category:category?observed(category):NOT_DETECTED,nutrition:Object.keys(v).length?label(v):null,ingredients:ingredients.length?observed(ingredients.map(name=>({name,percent:null}))):NOT_DETECTED});
type Case = {name:string;category?:ProductCategory;subtype:string;values?:Partial<Record<NutrientKey,number>>;ingredients?:string[];range:Partial<Record<NutrientKey,readonly[number,number]>>};
const cases: Case[] = [
 ...[250,299,300].map(k=>({name:`Cooked casserole ${k}`,category:'ready_meal' as const,subtype:'cooked_meal',values:{caloriesKcal:k},range:{saltG:[0,2] as const}})),
 {name:'Cooked lasagna',category:'ready_meal',subtype:'cooked_meal',values:{caloriesKcal:350},range:{saltG:[0,2]}},
 {name:'Instant dry noodles',subtype:'instant_noodles',ingredients:['noodles (flour, vegetable oil)','seasoning (salt, dried vegetables)'],range:{caloriesKcal:[350,550],saltG:[1,5],saturatedFatG:[0,10]}},
 {name:'Dry soup mix',subtype:'dry_mix',ingredients:['powder','salt'],range:{caloriesKcal:[250,500],saltG:[0,2]}},
 {name:'Cooked pasta',subtype:'cooked_pasta',range:{caloriesKcal:[80,190],saltG:[0,2]}},
 {name:'Frozen pizza',category:'ready_meal',subtype:'cooked_meal',values:{caloriesKcal:330},range:{saltG:[0,2]}},
 {name:'Passata rustica',subtype:'passata',range:{fatG:[0,2],proteinG:[0,3],caloriesKcal:[10,60]}},
 {name:'Tomato ketchup',subtype:'ketchup',range:{proteinG:[0,3],fatG:[0,5],sugarsG:[10,35]}},
 {name:'Mayonnaise',subtype:'mayonnaise',range:{fatG:[40,85]}},
 {name:'Mustard',subtype:'mustard',range:{fatG:[0,15],saltG:[0.5,5]}},
 {name:'Soy sauce',subtype:'soy_sauce',range:{saltG:[3,5],fatG:[0,1]}},
 {name:'BBQ sauce',subtype:'bbq',range:{sugarsG:[15,40],fatG:[0,5]}},
 {name:'Plain Greek yogurt',subtype:'greek_yogurt',range:{sugarsG:[0,8],proteinG:[7,15]}},
 {name:'Sweet yogurt',subtype:'sweet_yogurt',range:{sugarsG:[7,20]}},
 {name:'Cola',subtype:'soda',range:{fatG:[0,0.5],sugarsG:[8,15]}},
 {name:'Zero cola',subtype:'zero_soda',range:{fatG:[0,0.5],sugarsG:[0,1]}},
 {name:'Orange juice',subtype:'juice',range:{fatG:[0,1],sugarsG:[5,15]}},
 {name:'Milk chocolate',subtype:'chocolate',range:{sugarsG:[25,65],fatG:[20,45]}},
 {name:'Cake',subtype:'cake',range:{sugarsG:[15,50],caloriesKcal:[300,500]}},
 {name:'Cookies',subtype:'cookies',range:{sugarsG:[15,45],caloriesKcal:[350,550]}},
];
describe('Boundary/adversarial subtype benchmark',()=>{
 for(const c of cases) it(`${c.name}: ${c.subtype}, confidence and ranges`,()=>{
  const p=food(c.name,c.category??null,c.values,c.ingredients), selection=nutritionEstimationProfile(p), result=estimateMissingNutrition(p);
  assert.equal(selection.subtype,c.subtype); assert.ok(['medium','high'].includes(selection.confidence));
  assert.equal(result.nutritionMetadata!.selection!.subtype,c.subtype);
  assert.ok(selection.evidence.length>0);
  for(const [key,[min,max]] of Object.entries(c.range) as [NutrientKey,readonly[number,number]][]) assert.ok(result.nutrition![key].value!>=min&&result.nutrition![key].value!<=max,`${key}=${result.nutrition![key].value}`);
  assert.equal(typeof scoreProduct(result).value,'number');
 });
 it('299/300 kcal changes continuously, with no salt/saturated profile switch',()=>{
  for(const name of ['Cooked casserole','Лапша','Готовое блюдо']) {
   const a=estimateMissingNutrition(food(name,'ready_meal',{caloriesKcal:299}));
   const b=estimateMissingNutrition(food(name,'ready_meal',{caloriesKcal:300}));
   assert.deepEqual(a.nutritionMetadata!.selection,b.nutritionMetadata!.selection);
   assert.equal(a.nutrition!.saltG.value,b.nutrition!.saltG.value);
   assert.ok(Math.abs(a.nutrition!.saturatedFatG.value!-b.nutrition!.saturatedFatG.value!)<0.1);
  }
 });
 it('energy and protein numbers alone never select dry mix or high-protein subtype',()=>{
  for(const kcal of [250,299,300,350,500]) for(const protein of [5,20,30]) {
   const selected=nutritionEstimationProfile(food('Готовое блюдо','ready_meal',{caloriesKcal:kcal,proteinG:protein}));
   assert.equal(selected.subtype,'ready_meal');
  }
 });
 it('cooked form defeats dry ingredient mentions; whole-token dry avoids driveway/сухарь collisions',()=>{
  for(const name of ['Cooked noodles','Лапша приготовленная']) assert.notEqual(nutritionEstimationProfile(food(name,'ready_meal',{caloriesKcal:400},['noodles, seasoning, salt, dried vegetables'])).subtype,'dry_mix');
  for(const name of ['Noodles driveway','Лапша сухарик']) assert.equal(nutritionEstimationProfile(food(name,'ready_meal',{caloriesKcal:400})).subtype,'ready_meal');
 });
 it('independent name and composition confirm dry form; salt and fat remain independent',()=>{
  const p=food('Лапша с овощами','ready_meal',{caloriesKcal:400,proteinG:6.5,carbsG:56,fatG:17},['лапша (мука)','приправа (соль, овощи сушеные)']);
  const r=estimateMissingNutrition(p),selection=r.nutritionMetadata!.selection!;
  assert.equal(selection.subtype,'dry_mix');assert.equal(selection.confidence,'high');
  assert.ok(selection.evidence.includes('ingredients:dry_components_and_seasoning'));
  assert.equal(r.nutrition!.saltG.value,3);assert.equal(r.nutrition!.saturatedFatG.value,5.1);
  const noSalt=estimateMissingNutrition(food('Instant dry noodles',null,{fatG:17},['noodles (flour, oil)']));
  assert.equal(noSalt.nutrition!.saltG.value,1.5);assert.equal(noSalt.nutrition!.saturatedFatG.value,5.1);
 });
 it('zero/sweet modifiers require a food identity and conflicts use a parent profile',()=>{
  assert.equal(nutritionEstimationProfile(food('Zero mystery')).subtype,'other');
  assert.equal(nutritionEstimationProfile(food('Greek salad')).subtype,'other');
  const zero=nutritionEstimationProfile(food('Zero cola',null,{},['sugar','water']));
  assert.equal(zero.subtype,'soda');assert.equal(zero.confidence,'low');
  const light=nutritionEstimationProfile(food('Cola Max'));
  assert.equal(light.subtype,'soda');assert.equal(light.confidence,'low');
  assert.equal(nutritionEstimationProfile(food('Yogurt strawberry unsweetened')).subtype,'yogurt');
 });
 it('existing exact data outside plausibility ranges is flagged, never overwritten',()=>{
  for(const [name,values] of [['Passata',{fatG:15}],['Ketchup',{proteinG:8}],['Cola',{fatG:8}],['Plain Greek yogurt',{sugarsG:30,carbsG:35}],['Soy sauce',{saltG:0.01}],['Mayonnaise',{fatG:0.1}],['Готовое блюдо',{carbsG:60,sugarsG:55}]] as [string,Partial<Record<NutrientKey,number>>][]) {
   const p=food(name,name==='Готовое блюдо'?'ready_meal':null,values),r=estimateMissingNutrition(p);
   for(const [key,value] of Object.entries(values)) assert.equal(r.nutrition![key as NutrientKey].value,value);
   assert.ok(r.nutritionMetadata!.constraints!.some(c=>c.startsWith('plausibility_source_conflict')),name);
   assert.equal(r.nutritionMetadata!.selection!.confidence,'low');
  }
 });
 it('estimated profile is bounded, with contradictory source energy disclosed',()=>{
  const p=food('Plain yogurt',null,{carbsG:50});
  const r=estimateMissingNutrition(p); assert.ok(r.nutrition!.sugarsG.value!<=8);
  assert.match(r.nutritionMetadata!.fields.sugarsG.reason,/plausibility/);
  assert.deepEqual(estimateMissingNutrition(r),r);
  const mayo=estimateMissingNutrition(food('Mayonnaise',null,{caloriesKcal:20}));
  assert.equal(mayo.nutrition!.caloriesKcal.value,20);
  assert.ok(mayo.nutritionMetadata!.constraints!.some(c=>c.includes('plausibility_unresolved')));
 });
 it('known sugar/saturated minima outrank subtype maximums',()=>{
  const p=food('Passata',null,{sugarsG:25,saturatedFatG:15});
  const r=estimateMissingNutrition(p);assert.ok(r.nutrition!.carbsG.value!>=25);assert.ok(r.nutrition!.fatG.value!>=15);
 });
 it('display-only composition cannot corroborate a subtype or affect fields',()=>{
  const p=food('Лапша',null,{caloriesKcal:400});
  const display:Product={...p,ingredients:observed([{name:'лапша, приправа, соль, сушеные овощи',percent:null}]),fieldEvidence:[{field:'ingredients',source:'web_search',url:'https://example.test',domain:'example.test',tier:4,confidence:'low',identityMatch:'exact_name',retrievedAt:'2026-01-01',ingredientsOnly:true}]};
  assert.deepEqual(nutritionEstimationProfile(display),nutritionEstimationProfile(p));
  assert.deepEqual(estimateMissingNutrition(display).nutrition,estimateMissingNutrition(p).nutrition);
 });
 it('unknown fallback stays numeric with low confidence and wide uncertainty',()=>{
  const r=estimateMissingNutrition(food('Пищевой продукт Альфа'));
  assert.equal(r.nutritionMetadata!.selection!.confidence,'low');assert.ok(r.nutritionMetadata!.selection!.uncertainty.includes('wide_nutrition_uncertainty'));
  assert.ok(r.nutrition!.proteinG.value!<=8);assert.equal(typeof scoreProduct(r).value,'number');
 });
 it('no-added-sugar does not remove intrinsic lactose or switch unrelated fields',()=>{
  const plain=estimateMissingNutrition(food('Milk'));
  const claim=estimateMissingNutrition(food('Milk no sugar added'));
  assert.deepEqual(claim.nutrition,plain.nutrition);
  const granola=estimateMissingNutrition(food('Granola'));
  const free=estimateMissingNutrition(food('Granola sugar free'));
  for(const key of ['proteinG','carbsG','fatG','saturatedFatG','saltG'] as const) assert.equal(free.nutrition![key].value,granola.nutrition![key].value);
  assert.ok(free.nutrition!.sugarsG.value!<granola.nutrition!.sugarsG.value!);
 });
 it('water-first prepared soup cannot be classified as dry by an instant name',()=>{
  const profile=nutritionEstimationProfile(food('Instant soup',null,{},['water','vegetables','salt']));
  assert.equal(profile.subtype,'ready_meal');
  assert.ok(profile.evidence.includes('ingredients:water_first_prepared_form'));
 });
 it('selection and plausibility contain no regression product identifiers',()=>{
  const code=['nutrition-profiles.js','nutrition-estimator.js','nutrition-plausibility.js'].map(p=>readFileSync(join(__dirname,'..',p),'utf8')).join('\n');
  for(const codeValue of ['4605496016700','8691573091087','8696362804671','0689544080008','7622202395697','Rollton','Burcu','Heinz','FAGE','Alpen Gold']) assert.ok(!code.includes(codeValue),codeValue);
 });
});
