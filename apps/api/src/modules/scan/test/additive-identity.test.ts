import assert from 'node:assert/strict';
import { it } from 'node:test';
import { canonicalizeAdditives, observed, type Additive, type Product } from '@foodlens/core';
import { scoreProduct } from '@foodlens/scoring';
import { withProductIngredientFacts } from '../product-ingredient-facts';
import { IngredientsDisplayService } from '../ingredients-display.service';
import { demoProduct } from '../../goal-match/test/goal-match-v4.fixtures';
import { emptyBarcodeProduct } from '../barcode-product';
import { mergeProductLookup } from '../../product-lookup/product-merge';
const base=():Product=>demoProduct({id:'additive-identity',name:'Product',portion:100,values:[470,0.7,50,5,2.5,6,0,1.2],sugarSource:'added',processing:'ultra_processed',productForm:'food',ingredients:[]});
const coded=(code:string):Additive=>({code,name:null,provenance:'open_food_facts'});
const names:readonly (readonly [string,string,string])[]=[['E270','регулятор кислотности молочная кислота','lactic acid'],['E160a','краситель каротины','carotenes'],['E330','регулятор кислотности лимонная кислота','citric acid'],['E322','эмульгатор лецитин','lecithin'],['E202','консервант сорбат калия','potassium sorbate']];
for(const [code,ru,en] of names)it(`${code} and exact source aliases are one identity with originals preserved`,()=>{
 for(const input of [[coded(code),{code:null,name:ru},{code:null,name:en}],[{code:null,name:en},coded(code)]]){
  const snapshot=structuredClone(input),r=canonicalizeAdditives(input);
  assert.equal(r.length,1);assert.equal(r[0]!.code,code);assert.equal(r[0]!.provenance,'open_food_facts');
  for(const item of input)assert.ok(r[0]!.sourceMentions!.some(m=>m.code===item.code&&m.name===item.name));
  assert.deepEqual(input,snapshot);assert.equal(canonicalizeAdditives(r),r);
 }
});
it('unknown names, mixtures, distinct codes and E-number subtypes cannot be merged by similarity',()=>{
 const input:readonly Additive[]=[{code:null,name:'ароматизатор'},{code:null,name:'эмульгатор'},{code:null,name:'lactic acid and citric acid'},coded('E270'),coded('E330'),coded('E160a(i)'),coded('E160a(ii)')];
 assert.equal(canonicalizeAdditives(input),input);
 const namesOnly=canonicalizeAdditives([{code:null,name:'lactic acid'},{code:null,name:'молочная кислота'}]);
 assert.equal(namesOnly.length,1);assert.equal(namesOnly[0]!.code,null);
});
it('normalizes printed E-codes and preserves the original spelling',()=>{
 const r=canonicalizeAdditives([coded('е - 270'),coded('E270')]);assert.equal(r.length,1);assert.equal(r[0]!.code,'E270');assert.equal(r[0]!.sourceMentions![0]!.code,'е - 270');
});
it('Calve becomes five declared positions, retains original ingredients/allergens, and keeps the same score',async()=>{
 const ingredients=observed(['загуститель E1422','регулятор кислотности молочная кислота','ароматизатор','антиокислитель Е385','краситель каротины'].map(name=>({name,percent:null})));
 const raw:Product={...base(),ingredients,additives:observed(['E1422','E160a','E270','E385'].map(coded)),allergens:observed([{code:'eggs',presence:'contains',provenance:'observed'}])};
 const snapshot=structuredClone(raw),r=withProductIngredientFacts(raw);
 assert.equal(r.additives.value!.length,5);assert.equal(r.ingredients,ingredients);assert.deepEqual(raw,snapshot);
 assert.deepEqual(r.allergens.value,raw.allergens.value);
 const seven={...r,additives:observed([...raw.additives.value!,{code:null,name:'регулятор кислотности молочная кислота'},{code:null,name:'ароматизатор'},{code:null,name:'краситель каротины'}])};
 assert.equal(scoreProduct(r).value,scoreProduct(seven).value);assert.equal(scoreProduct(r).factors.find(f=>f.kind==='additives')!.value,5);
 const translator={translateIngredients:async (texts:readonly string[])=>texts.map(()=> 'sugar')};
 let calls=0;const display=new IngredientsDisplayService({translateIngredients:async texts=>{calls++;return translator.translateIngredients(texts);}});
 const shown=await display.decorate(r);await display.decorate(r);assert.equal(calls,1);assert.equal(shown.additivesDisplay!.length,5);
 assert.deepEqual(shown.additives,r.additives);assert.equal(r.additives.value!.find(a=>a.code==='E270')!.sourceMentions!.length,2);
});
it('lookup merge retains distinct name-only additives and deduplicates repeated codes',()=>{
 const p={...emptyBarcodeProduct('1234567890128'),additives:observed([{code:null,name:'ароматизатор'}])};
 const result=mergeProductLookup(p,{provider:'open_food_facts',match:'exact_barcode',barcode:'1234567890128',name:null,brand:null,nutrition:null,servingSize:null,ingredients:null,allergens:null,additives:[{code:null,name:'эмульгатор'},coded('E270'),coded('E270'),{code:null,name:'lactic acid'}]}).product;
 assert.equal(result.additives.value!.length,3);assert.deepEqual(result.additives.value!.slice(0,2).map(a=>a.name),['ароматизатор','эмульгатор']);
});
