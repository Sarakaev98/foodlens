/* global __dirname */
const assert=require('node:assert/strict');
const {describe,it}=require('node:test');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const core=require('@foodlens/core');
const jsx=(type,props)=>({type,props});
function load(file,imports={}){
 const module={exports:{}};
 const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(code,{module,exports:module.exports,require:id=>{
  if(id==='@foodlens/core')return core;
  if(id==='react/jsx-runtime')return {jsx,jsxs:jsx,Fragment:'Fragment'};
  assert.ok(id in imports,'unexpected import '+id);return imports[id];
 }});
 return module.exports;
}
function render(n){if(Array.isArray(n))return n.map(render);if(!n||typeof n!=='object')return n;if(typeof n.type==='function')return render(n.type(n.props));return {...n,props:{...n.props,children:render(n.props?.children)}};}
function find(n,p,out=[]){if(Array.isArray(n))n.forEach(c=>find(c,p,out));else if(n&&typeof n==='object'){if(p(n))out.push(n);find(n.props?.children,p,out);}return out;}
const labels=load('src/features/profile/profile.labels.ts');
const theme={colors:{},spacing:{},radius:{},typography:{body:{}}};
const rn={StyleSheet:{create:x=>x},View:'View',Text:'Text',Pressable:'Pressable'};
const {ChoiceList}=load('src/shared/ui/ChoiceList.tsx',{'react-native':rn,'./theme':theme,'./typography':theme});
const {FoodPreferencesFields}=load('src/features/profile/components/FoodPreferencesFields.tsx',{
 '@/shared/ui':{ChoiceList,ChipGroup:'ChipGroup',FormField:'FormField',TagInput:'TagInput'},
 '@/shared/validation':{findIssueMessage:()=>null},'../profile.labels':labels,
});
const draft=load('src/features/profile/profileDraft.ts');
const profile={id:'test',goal:'eat_healthier',age:30,sex:'male',heightCm:175,weightKg:75,activityLevel:'moderate',dietaryPreferences:['none'],allergens:[],avoidedIngredients:[],createdAt:'2026-01-01',updatedAt:'2026-01-01'};
describe('Profile dietary selection and legacy mobile responses',()=>{
 it('renders exactly four radio choices with one selection',()=>{
  let change;
  const draw=value=>render(FoodPreferencesFields({draft:{...profile,dietaryPreferences:value},issues:[],onChange:v=>{change=v;}}));
  const radio=find(draw(['none']),n=>n.type==='Pressable'&&n.props.accessibilityRole==='radio');
  assert.equal(radio.length,4);
  assert.deepEqual(radio.map(n=>find(n,c=>c.type==='Text')[0].props.children),['Без ограничений','Вегетарианство','Веганство','Пескетарианство']);
  assert.equal(radio.filter(n=>n.props.accessibilityState.selected).length,1);
  radio[2].props.onPress();assert.deepEqual(Array.from(change.dietaryPreferences),['vegan']);
  const selected=find(draw(change.dietaryPreferences),n=>n.type==='Pressable'&&n.props.accessibilityRole==='radio');
  assert.equal(selected.filter(n=>n.props.accessibilityState.selected).length,1);
  selected[2].props.onPress();assert.deepEqual(Array.from(change.dietaryPreferences),['vegan']);
 });
 for(const value of ['halal','other'])it(`legacy ${value} opens selected as neutral and saves through the shared onboarding/edit validation`,()=>{
  const input=draft.draftFromProfile({...profile,dietaryPreferences:[value]});
  assert.deepEqual(Array.from(input.dietaryPreferences),['none']);
  const valid=draft.completeDraft(input);assert.equal(valid.ok,true);assert.deepEqual(Array.from(valid.value.dietaryPreferences),['none']);
  const radios=find(render(FoodPreferencesFields({draft:input,issues:[],onChange:()=>{}})),n=>n.type==='Pressable');
  assert.equal(radios.filter(n=>n.props.accessibilityState.selected).length,1);assert.equal(radios[0].props.accessibilityState.selected,true);
 });
 it('profile API normalizes both old read responses and legacy save responses',async()=>{
  let sent;
  const {profileApi}=load('src/features/profile/services/profileApi.ts',{'@/shared/api':{ApiError:class extends Error{},apiClient:{get:async()=>({...profile,dietaryPreferences:['halal']}),put:async(_url,input)=>{sent=input;return {...profile,dietaryPreferences:['other']};}}}});
  assert.deepEqual(Array.from((await profileApi.get()).dietaryPreferences),['none']);
  assert.deepEqual(Array.from((await profileApi.save({...profile,dietaryPreferences:['halal']})).dietaryPreferences),['none']);
  assert.deepEqual(Array.from(sent.dietaryPreferences),['none']);
 });
 it('onboarding restrictions field accepts one option and rejects multiple choices',()=>{
  for(const value of core.DIETARY_PREFERENCES)assert.deepEqual(core.validateUserNutritionProfileFields({...profile,dietaryPreferences:[value]},['dietaryPreferences','allergens','avoidedIngredients']),[]);
  assert.equal(core.validateUserNutritionProfileFields({...profile,dietaryPreferences:['vegan','vegetarian']},['dietaryPreferences']).length,1);
 });
 it('summary of a legacy profile shows the neutral label instead of undefined',()=>{
  const {ProfileSummary}=load('src/features/profile/components/ProfileSummary.tsx',{'react-native':rn,'@/shared/ui':theme,'../profile.labels':labels});
  const node=render(ProfileSummary({profile:{...profile,dietaryPreferences:['halal']}}));
  const text=find(node,n=>n.type==='Text').map(n=>n.props.children).join(' ');
  assert.ok(text.includes('Без ограничений'));assert.ok(!text.includes('Халяль'));
 });
});
