/* global __dirname */
const assert=require('node:assert/strict');
const {describe,it}=require('node:test');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const jsx=(type,props)=>({type,props});
const source=fs.readFileSync(path.join(__dirname,'../src/features/scan/screens/ProductResultScreen.tsx'),'utf8');
const moduleCode=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const moduleValue={exports:{}};
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
 '../productLabels':{additiveLabel:()=>'',ALLERGEN_LABELS:{},BASIS_LABELS:{},CATEGORY_LABELS:{},isForeignText:()=>false,NOT_DETECTED_LABEL:'Не обнаружено',ORIGINAL_TEXT_LABEL:'как на упаковке, без перевода',usesFatSecret:()=>false,usesOpenFoodFacts:()=>false},
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
  const shown=show(product),section=find(shown,n=>n.type==='ProductSection'&&n.props.title==='Состав')[0];
  assert.equal(text(section),'Tomatoes (98%), salt');assert.equal(section.props.subtitle,undefined);
  assert.ok(!text(shown).includes('без перевода'));assert.equal(product.ingredients,original);assert.equal(goalProduct.ingredients,original);
 });
 it('failed translation shows the original and preserves the result screen',()=>{
  const product={...base,ingredientsDisplay:{sourceHash:'test',language:'original',status:'fallback',items:original.value}};
  const section=find(show(product),n=>n.type==='ProductSection'&&n.props.title==='Состав')[0];assert.equal(text(section),'томаты (98%), соль');
 });
 it('legacy cached results without display metadata remain readable',()=>{
  const section=find(show(base),n=>n.type==='ProductSection'&&n.props.title==='Состав')[0];assert.equal(text(section),'томаты (98%), соль');
 });
});
