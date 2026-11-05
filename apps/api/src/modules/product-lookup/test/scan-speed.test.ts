import assert from 'node:assert/strict';
import { it } from 'node:test';
import { observed, type Product } from '@foodlens/core';
import { MultiSourceProductLookup } from '../multi-source-product-lookup';
import { mapOpenFoodFactsProduct } from '../open-food-facts.mapper';
import { OFF_REQUEST_FIELDS } from '../open-food-facts.provider';
import { emptyBarcodeProduct } from '../../scan/barcode-product';
import { mergeProductLookup } from '../product-merge';
import { IngredientsDisplayService } from '../../scan/ingredients-display.service';
import { withProductIngredientFacts } from '../../scan/product-ingredient-facts';
import { WebSearchProductLookupProvider } from '../web-search-lookup.provider';
import { CachedProductLookupProvider } from '../cached-product-lookup.provider';
import { BARCODE, offProduct, OFF_NUTRIENTS } from './open-food-facts.fixtures';
const mapped = (extra: Record<string, unknown> = {}) => mapOpenFoodFactsProduct(offProduct(extra), BARCODE)!;
const primary = (extra: Record<string, unknown> = {}) => ({name:'open_food_facts',lookup:async()=>mapped(extra)});
const flush = async () => { for(let i=0;i<30;i++) await Promise.resolve(); };
const noFiber = () => {const {fiber: _fiber,...nutrients}=OFF_NUTRIENTS;return {nutrition:{aggregated_set:{nutrients,per:'100g',preparation:'as_sold'}}};};
const partial = () => {const {sugars:_s,'saturated-fat':_f,salt:_salt,...nutrients}=OFF_NUTRIENTS;return {nutrition:{aggregated_set:{nutrients,per:'100g',preparation:'as_sold'}}};};

it('complete OFF and OFF missing only fiber skip optional web work; missing stays unknown',async()=>{
 for(const extra of [{},noFiber()]) {
  let calls=0;
  const chain=new MultiSourceProductLookup([primary(extra),{name:'web_search',needsBarcode:false,lookup:async()=>{calls++;throw Error('unnecessary');}}]);
  const r=await chain.begin(BARCODE).enrich(emptyBarcodeProduct(BARCODE));
  assert.equal(calls,0);assert.equal(r.steps[1]!.status,'not_needed');
  if('nutrition' in extra){assert.equal(r.product.nutrition!.fiberG.value,null);assert.deepEqual(r.steps[1]!.missingFields,['fiber']);}
 }
});
it('a missing critical field still accepts a fast verified web result',async()=>{
 let calls=0;
 const full={...mapped(),provider:'web_search' as const};
 const r=await new MultiSourceProductLookup([primary(partial()),{name:'web_search',needsBarcode:false,lookup:async()=>{calls++;return full;}}]).begin(BARCODE).enrich(emptyBarcodeProduct(BARCODE));
 assert.equal(calls,1);assert.equal(r.product.nutrition!.sugarsG.value,38);
});
it('web deadline returns original OFF nulls, aborts work, and is shared across both enrichment passes',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});
 let calls=0,signal:AbortSignal|undefined;
 const session=new MultiSourceProductLookup([primary(partial()),{name:'web_search',needsBarcode:false,lookup:async(_b,c)=>{calls++;signal=c!.signal;return new Promise(()=>{});}}]).begin(BARCODE);
 const start=Date.now(),pending=session.enrich(emptyBarcodeProduct(BARCODE));await flush();
 t.mock.timers.tick(5000);const r=await pending;
 assert.equal(Date.now()-start,5000);assert.equal(signal!.aborted,true);assert.equal(r.steps[1]!.status,'error');
 assert.equal(r.product.nutrition!.sugarsG.value,null);assert.equal(r.product.nutrition!.saturatedFatG.value,null);assert.equal(r.product.nutrition!.saltG.value,null);
 await session.enrich(r.product);assert.equal(calls,1);
});
it('late search responses cannot start page reads or AI extraction, or be cached as a successful miss',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});
 let searches=0,reads=0,extractions=0,finish!:(x:any)=>void;
 const web=new WebSearchProductLookupProvider({discoverSources:async()=>{searches++;return new Promise(resolve=>{finish=resolve;});},extractNutrition:async()=>{extractions++;return [];}},{fetchPage:async()=>{reads++;throw Error('late read');}});
 const cached=new CachedProductLookupProvider(web);
 const make=()=>new MultiSourceProductLookup([primary(partial()),cached]).begin(BARCODE).enrich(emptyBarcodeProduct(BARCODE));
 const first=make();await flush();t.mock.timers.tick(5000);await first;await flush();
 finish({sources:[{url:'https://example.com/p',domain:'example.com',title:'Product'}],webSearchQueries:1});await flush();
 assert.equal(reads,0);assert.equal(extractions,0);
 const second=make();await flush();assert.equal(searches,2);t.mock.timers.tick(5000);await second;
});
it('OFF English is checked, aligned and passed to the existing display/cache without replacing original ingredients',async()=>{
 assert.ok(OFF_REQUEST_FIELDS.split(',').includes('ingredients_text_en'));
 const raw='сахар, эмульгатор (E322)';
 const lookup=mapped({ingredients_text_ru:raw,ingredients_text_en:'sugar, emulsifier (E322)'});
 const product:Product={...mergeProductLookup(emptyBarcodeProduct(BARCODE),lookup).product,name:observed('Product'),additives:observed([])};
 const facts=withProductIngredientFacts(product);let calls=0;
 const display=new IngredientsDisplayService({translateIngredients:async()=>{calls++;assert.fail('English OFF needs no translation');}});
 const shown=await display.decorate(facts);await display.decorate(facts);
 assert.equal(calls,0);assert.deepEqual(shown.ingredients,product.ingredients);
 assert.deepEqual(shown.ingredientsDisplay!.items.map(i=>i.name),['sugar','emulsifier (E322)']);
 assert.deepEqual(shown.additivesDisplay,[{code:'E322',name:'emulsifier'}]);
});
it('lang=en cannot bless Russian, foreign Latin, mismatched lists, E-codes or quantities',()=>{
 for(const english of ['сахар, эмульгатор (E322)','şeker, emülgatör (E322)','sugar','sugar, emulsifier (E999)','sugar 20%, emulsifier (E322)']) {
  const r=mapped({lang:'en',ingredients_text_ru:'сахар, эмульгатор (E322)',ingredients_text_en:english});
  assert.equal(r.ingredientsEnglish,undefined,english);assert.equal(r.ingredients![0]!.name,'сахар');
 }
});
it('OFF English projection never overrides visible ingredients from a different label',()=>{
 const lookup=mapped({ingredients_text_ru:'сахар',ingredients_text_en:'sugar'});
 const p={...emptyBarcodeProduct(BARCODE),ingredients:observed([{name:'молоко',percent:null}])};
 const r=mergeProductLookup(p,lookup).product;assert.equal(r.labelTranslations,undefined);assert.equal(r.ingredients.value![0]!.name,'молоко');
});
it('lactic acid alone cannot infer Milk; independent and confirmed dairy allergens remain',()=>{
 const base=mergeProductLookup(emptyBarcodeProduct(BARCODE),mapped({allergens_tags:['en:eggs'],ingredients_text_ru:'молочная кислота'})).product;
 for(const text of ['молочная кислота','регулятор кислотности молочной кислоты','lactic acid']){
  const p={...base,ingredients:observed([{name:text,percent:null}])};
  assert.deepEqual(withProductIngredientFacts(p).allergens.value,base.allergens.value);
 }
 for(const text of ['молочная кислота, сухое молоко','молочная кислота, молочный белок','lactic acid, whey protein']){
  const p={...base,ingredients:observed([{name:text,percent:null}])};assert.ok(withProductIngredientFacts(p).allergens.value!.some(a=>a.code==='milk'));
 }
 const confirmed={...base,allergens:observed([{code:'milk' as const,presence:'contains' as const,provenance:'observed' as const}])};
 assert.deepEqual(withProductIngredientFacts(confirmed).allergens.value,confirmed.allergens.value);
});
