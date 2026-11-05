/* global __dirname */
const assert=require('node:assert/strict');
const {describe,it}=require('node:test');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const jsx=(type,props)=>({type,props});
const source=fs.readFileSync(path.join(__dirname,'../src/features/scan/screens/ProductResultScreen.tsx'),'utf8');
const moduleCode=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const moduleValue={exports:{}};
const labelsModule={exports:{}};
const labelsSource=fs.readFileSync(path.join(__dirname,'../src/features/scan/productLabels.ts'),'utf8');
vm.runInNewContext(ts.transpileModule(labelsSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:labelsModule,exports:labelsModule.exports,require});
let goalProduct;
const propsByImport={
 'react/jsx-runtime':{jsx,jsxs:jsx},
 'react-native':{Image:'Image',Linking:{},ScrollView:'ScrollView',StyleSheet:{create:x=>x},Text:'Text',View:'View'},
 'react-native-safe-area-context':{SafeAreaView:'SafeAreaView'},
 '@/features/goal-match':{GoalMatchCard:({product})=>{goalProduct=product;return null;}},
 '@/features/product-score':{ProductScoreCard:()=>null},
 '@/shared/ui':{Button:()=>null,colors:{},radius:{},spacing:{},typography:{}},
 '../components/NutritionTable':{NutritionTable:()=>null},
 '../components/ProductSection':{ProductSection:'ProductSection',NotDetected:({text})=>jsx('Text',{children:text})},
 '../productLabels':labelsModule.exports,
};
vm.runInNewContext(moduleCode,{module:moduleValue,exports:moduleValue.exports,require:id=>{assert.ok(id in propsByImport,id);return propsByImport[id];}});
const {ProductResultScreen}=moduleValue.exports;
const missing={value:null,provenance:'not_detected'};
const original={value:[{name:'томаты',percent:98},{name:'соль',percent:null}],provenance:'open_food_facts'};
const base={id:'product',name:{value:'Food'},brand:missing,category:missing,nutrition:null,ingredients:original,allergens:missing,additives:missing,source:{provider:'product_lookup'},confidence:{}};
function render(n){if(Array.isArray(n))return n.map(render);if(!n||typeof n!=='object')return n;if(typeof n.type==='function')return render(n.type(n.props));return {...n,props:{...n.props,children:render(n.props?.children)}};}
function find(n,p){if(Array.isArray(n))return n.flatMap(x=>find(x,p));if(!n||typeof n!=='object')return [];return [...(p(n)?[n]:[]),...find(n.props?.children,p)];}
function text(n){if(Array.isArray(n))return n.map(text).join('');if(!n||typeof n==='boolean')return '';if(typeof n!=='object')return String(n);return text(n.props?.children);}
function show(product){return render(ProductResultScreen({product,score:{value:4},goalMatch:{value:4},photo:null,onScanAnother:()=>{}}));}
describe('Product Result uses English composition only for display',()=>{
 it('ingredients section shows translated names/percentages and has no false untranslated caption',()=>{
  const product={...base,ingredientsDisplay:{sourceHash:'test',language:'en',status:'translated',items:[{name:'Tomatoes',percent:98},{name:'salt',percent:null}]}};
  const shown=show(product),section=find(shown,n=>n.type==='ProductSection'&&n.props.title==='Ingredients')[0];
  assert.equal(text(section),'Tomatoes (98%), salt');assert.equal(section.props.subtitle,undefined);
  assert.ok(!text(shown).includes('not translated'));assert.equal(product.ingredients,original);assert.equal(goalProduct.ingredients,original);
 });
 it('failed translation shows the original and preserves the result screen',()=>{
  const product={...base,ingredientsDisplay:{sourceHash:'test',language:'original',status:'fallback',items:original.value}};
  const section=find(show(product),n=>n.type==='ProductSection'&&n.props.title==='Ingredients')[0];assert.equal(text(section),'томаты (98%), соль');assert.equal(section.props.subtitle,labelsModule.exports.TRANSLATION_UNAVAILABLE_LABEL);
 });
 it('English product name and additive names are shown when the API sends them, originals stay for logic',()=>{
  const additives={value:[{code:'E330',name:'лимонная кислота'},{code:null,name:'краситель'}],provenance:'observed'};
  const product={...base,name:{value:'Сгущённое молоко'},nameDisplay:'Condensed Milk',additives,additivesDisplay:[{code:'E330',name:'citric acid'},{code:null,name:'colouring'}]};
  const shown=text(show(product));
  assert.ok(shown.includes('Condensed Milk'));assert.ok(!shown.includes('Сгущённое'));
  const section=find(show(product),n=>n.type==='ProductSection'&&n.props.title==='Additives')[0];
  assert.equal(text(section),'E330 · citric acidcolouring');assert.equal(product.additives,additives);assert.equal(goalProduct.name.value,'Сгущённое молоко');
 });
 it('legacy cached results without display metadata remain readable',()=>{
  const section=find(show(base),n=>n.type==='ProductSection'&&n.props.title==='Ingredients')[0];assert.equal(text(section),'томаты (98%), соль');assert.equal(section.props.subtitle,labelsModule.exports.TRANSLATION_UNAVAILABLE_LABEL);
 });
});

it('an untranslated name-only additive shows an honest failure caption, with E-codes preserved',()=>{
 const product={...base,additives:{value:[{code:null,name:'ароматизатор'},{code:'E322',name:'лецитин'}],provenance:'inferred'}};
 const section=find(show(product),n=>n.type==='ProductSection'&&n.props.title==='Additives')[0];
 assert.equal(section.props.subtitle,'English translation unavailable. Showing original text.');
 assert.equal(text(section),'ароматизаторE322');
 assert.ok(!section.props.subtitle.includes('not translated'));
});
