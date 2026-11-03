const assert = require('node:assert/strict');
const {describe, it} = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const {NOT_DETECTED, observed} = require('../../../packages/core/dist/index.js');
const {scoreProduct} = require('../../../packages/scoring/dist/index.js');

// Real table and score card with a stubbed React Native: estimates reach the screen as the user sees them.
function load(file, imports = {}) {
  const module = {exports: {}};
  const absolute = path.join(__dirname, '..', file);
  const js = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  }}).outputText;
  vm.runInNewContext(js, {module, exports: module.exports, require: id => {
    assert.ok(id in imports, 'Unexpected import ' + id); return imports[id];
  }}, {filename: absolute});
  return module.exports;
}
const nutrition = load('src/shared/nutrition/missingNutrients.ts');
const scoreLabels = load('src/features/product-score/productScoreLabels.ts', {'@/shared/nutrition': nutrition});
const theme = load('src/shared/ui/theme.ts');
const jsx = (type, props) => ({type, props});
const ui = {'react/jsx-runtime': {jsx, jsxs: jsx},
  'react-native': {StyleSheet: {create: x => x, hairlineWidth: 1}, Text: 'Text', View: 'View'},
  '@/shared/ui': {...theme, typography: {}}};
const {NutritionTable} = load('src/features/scan/components/NutritionTable.tsx',
  {...ui, '../productLabels': {NOT_DETECTED_LABEL: 'Not detected'}});
const {ProductScoreCard} = load('src/features/product-score/components/ProductScoreCard.tsx',
  {...ui, '../productScoreLabels': scoreLabels});
function text(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join('');
  if (typeof node.type === 'function') return text(node.type(node.props));
  return text(node.props?.children);
}

const facts = {basis: 'per_100g', servingSize: NOT_DETECTED, caloriesKcal: observed(433), proteinG: observed(4.5),
  carbsG: observed(63), sugarsG: observed(37.1), fatG: observed(18), saturatedFatG: observed(11), fiberG: NOT_DETECTED,
  saltG: observed(.2), sodiumMg: NOT_DETECTED};

const item = nutritionFacts => ({id: 'p', name: observed('Товар'), brand: NOT_DETECTED, category: NOT_DETECTED, nutrition: nutritionFacts,
  semantics: {version: 'semantics-v1', sugarSource: {value: 'added', confidence: 'high', evidence: ['sugar']},
    processing: {value: 'ultra_processed', confidence: 'high', evidence: ['emulsifier']},
    productForm: {value: 'food', confidence: 'high'}, typicalServing: null},
  ingredients: NOT_DETECTED, allergens: NOT_DETECTED, additives: NOT_DETECTED,
  confidence: {overall: 'low', identity: 'high', nutrition: 'low', ingredients: null}});

describe('Estimated nutrients on the screen', () => {
  it('an estimated field shows ≈ and one note, an unestimated one stays plain', () => {
    const shown = text(NutritionTable({nutrition: facts, estimated: ['sugarsG', 'saturatedFatG', 'saltG']}));
    assert.match(shown, /≈37.1 g/); assert.match(shown, /≈11 g/); assert.match(shown, /≈0.2 g/);
    assert.ok(!shown.includes('≈433'));
    assert.equal(shown.split('Some nutrition values were estimated automatically.').length, 2);
  });
  it('without estimates there is no note', () => {
    assert.ok(!text(NutritionTable({nutrition: facts})).includes('estimated'));
  });
  it('a score with estimated inputs is an ordinary score, without any confidence wording', () => {
    const shown = text(ProductScoreCard({score: scoreProduct(item(facts)), per: 'g', estimated: true}));
    assert.ok(!shown.includes('Preliminary')); assert.ok(!shown.includes('Confidence'));
    assert.match(shown, /Overall product quality/);
    assert.match(shown, /Some nutrition values were estimated automatically/);
  });
  it('preliminary stays only when the main factors are really missing', () => {
    const shown = text(ProductScoreCard({score: scoreProduct(item({...facts, sugarsG: NOT_DETECTED, saturatedFatG: NOT_DETECTED})), per: 'g'}));
    assert.match(shown, /Preliminary/);
  });
  it('the result screen has no confidence labels', () => {
    const screen = fs.readFileSync(path.join(__dirname, '..', 'src/features/scan/screens/ProductResultScreen.tsx'), 'utf8');
    assert.ok(!/Confidence|confidence|Уверенность|уверенность/.test(screen));
  });
});
