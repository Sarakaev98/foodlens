import assert from 'node:assert/strict';
import { it } from 'node:test';
import { observed, type Product } from '@foodlens/core';
import { demoProduct } from '../../goal-match/test/goal-match-v4.fixtures';
import { IngredientsDisplayService } from '../ingredients-display.service';
import { withProductIngredientFacts } from '../product-ingredient-facts';

const product = (): Product => demoProduct({id:'english-cache',name:'Food',portion:100,values:[350,6,7.5,65,12,4,2,3],sugarSource:'added',processing:'ultra_processed',productForm:'food',ingredients:['сахар']});
it('uses translations from the existing analysis for ingredients and derived additives without another AI call', async () => {
 const p=withProductIngredientFacts({...product(),name:observed('Продукт'),ingredients:observed([{name:'молоко',percent:20},{name:'эмульгатор (E322)',percent:null}]),additives:observed([]),labelTranslations:[{original:'Продукт',english:'Food'},{original:'молоко',english:'milk'},{original:'эмульгатор (E322)',english:'emulsifier (E322)'}]});
 const snapshot=structuredClone(p);
 const service=new IngredientsDisplayService({translateIngredients:async()=>{assert.fail('No additional translation request');}});
 const r=await service.decorate(p);
 assert.deepEqual(r.ingredientsDisplay?.items,[{name:'milk',percent:20},{name:'emulsifier (E322)',percent:null}]);
 assert.equal(r.nameDisplay,'Food');assert.deepEqual(r.additivesDisplay,[{code:'E322',name:'emulsifier'}]);
 assert.deepEqual(p,snapshot);assert.equal(r.ingredients,p.ingredients);assert.equal(r.allergens,p.allergens);assert.equal(r.additives,p.additives);
});
it('a cached fallback becomes retryable after the short failure TTL',async()=>{
 const now=Date.now;let time=now(),calls=0;Date.now=()=>time;
 try {
  const service=new IngredientsDisplayService({translateIngredients:async()=>{if(++calls===1)throw Error('offline');return ['sugar'];}});
  const failed=await service.decorate(product());assert.equal(failed.ingredientsDisplay?.status,'fallback');
  await service.decorate(failed);assert.equal(calls,1);
  time+=30001;const recovered=await service.decorate(failed);
  assert.equal(calls,2);assert.equal(recovered.ingredientsDisplay?.language,'en');
 }finally{Date.now=now;}
});
it('cache entries cannot replace another product E-codes or provenance',async()=>{
 const service=new IngredientsDisplayService({translateIngredients:async texts=>texts.map(()=> 'emulsifier')});
 for(const code of ['E322','E471']) {
  const p={...product(),ingredients:observed([{name:'sugar',percent:null}]),additives:observed([{code,name:'эмульгатор',provenance:'open_food_facts' as const}])};
  const r=await service.decorate(p);assert.equal(r.additivesDisplay?.[0]?.code,code);assert.equal(r.additives,p.additives);
 }
});
it('Latin-script foreign additive names are translated too',async()=>{
 const service=new IngredientsDisplayService({translateIngredients:async texts=>{assert.deepEqual(texts,['koruyucu']);return ['preservative'];}});
 const r=await service.decorate({...product(),ingredients:observed([{name:'sugar',percent:null}]),additives:observed([{code:null,name:'koruyucu'}])});
 assert.equal(r.additivesDisplay?.[0]?.name,'preservative');
});
