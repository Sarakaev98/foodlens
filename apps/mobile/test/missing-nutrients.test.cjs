const assert = require('node:assert/strict');
const {describe, it} = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const {NOT_DETECTED, observed} = require('../../../packages/core/dist/index.js');
const {matchGoal, scoreProduct} = require('../../../packages/scoring/dist/index.js');
const {REQUIRED_FACTORS} = require('../../../packages/scoring/dist/product-score-rules.js');

// Real scoring output through the real labels and cards: no copied messages or gates.
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
const profile = load('src/features/profile/profile.labels.ts');
const scoreLabels = load('src/features/product-score/productScoreLabels.ts', {'@/shared/nutrition': nutrition});
const goalLabels = load('src/features/goal-match/goalMatchLabels.ts', {'@/features/profile': profile, '@/shared/nutrition': nutrition});
const theme = load('src/shared/ui/theme.ts');
const jsx = (type, props) => ({type, props});
const ui = {'react/jsx-runtime': {jsx, jsxs: jsx},
  'react-native': {StyleSheet: {create: x => x, hairlineWidth: 1}, Text: 'Text', View: 'View'},
  '@/shared/ui': {...theme, typography: {}}};
const {ProductScoreCard} = load('src/features/product-score/components/ProductScoreCard.tsx',
  {...ui, '../productScoreLabels': scoreLabels});
const {GoalMatchCard} = load('src/features/goal-match/components/GoalMatchCard.tsx',
  {...ui, '@/features/profile': profile, '../goalMatchLabels': goalLabels});
function text(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join(' ');
  if (typeof node.type === 'function') return text(node.type(node.props));
  return text(node.props?.children);
}

const plan = {goal: 'eat_healthier', targets: {caloriesKcal: 2000, proteinG: 139, fatG: 67, carbsG: 225,
  calculation: {version: 'test', bmrKcal: 1400, tdeeKcal: 2000, goalAdjustmentPercent: 0,
    macroSplit: {proteinPercent: 25, fatPercent: 30, carbsPercent: 45}}},
  dietaryPreferences: [], allergens: [], avoidedIngredients: []};
const FIELDS = {sugars: 'sugarsG', saturatedFat: 'saturatedFatG', salt: 'saltG'};
function product(missing = [], overrides = {}) {
  const facts = {basis: 'per_100g', servingSize: observed({amount: 28, unit: 'g'}), caloriesKcal: observed(430),
    proteinG: observed(4.5), carbsG: observed(63), sugarsG: observed(38), fatG: observed(18), saturatedFatG: observed(9),
    fiberG: NOT_DETECTED, saltG: observed(.4), sodiumMg: observed(160), ...overrides};
  for (const kind of missing) facts[FIELDS[kind]] = NOT_DETECTED;
  if (missing.includes('salt')) facts.sodiumMg = NOT_DETECTED;
  return {id: 'p', name: observed('Choco Pie'), brand: NOT_DETECTED, category: NOT_DETECTED, nutrition: facts,
    semantics: {version: 'semantics-v1', sugarSource: {value: 'added', confidence: 'high', evidence: ['sugar']},
      processing: {value: 'ultra_processed', confidence: 'high', evidence: ['emulsifier']},
      productForm: {value: 'food', confidence: 'high'}, typicalServing: null},
    ingredients: NOT_DETECTED, allergens: NOT_DETECTED, additives: NOT_DETECTED,
    confidence: {overall: 'medium', identity: 'high', nutrition: 'medium', ingredients: null}};
}
const COMBINATIONS = [
  [['sugars'], 'сахарах'],
  [['saturatedFat'], 'насыщенных жирах'],
  [['salt'], 'соли'],
  [['sugars', 'saturatedFat'], 'сахарах и насыщенных жирах'],
  [['sugars', 'salt'], 'сахарах и соли'],
  [['saturatedFat', 'salt'], 'насыщенных жирах и соли'],
  [['sugars', 'saturatedFat', 'salt'], 'сахарах, насыщенных жирах и соли'],
];

describe('missing nutrition messages', () => {
  it('both cards name exactly the missing fields, in the same words', () => {
    for (const [missing, fields] of COMBINATIONS) {
      const expected = `Для персональной оценки не хватает данных о ${fields}.`;
      const item = product(missing), score = scoreProduct(item), goalMatch = matchGoal(item, plan);
      assert.equal(typeof score.value, 'number', 'Product Score survives missing nutrients');
      assert.equal(goalMatch.value, null);
      assert.equal(goalMatch.unavailableReason, 'missing_nutrients');
      assert.equal(goalLabels.unavailableMessage(goalMatch, item), expected);
      assert.ok(text(GoalMatchCard({goalMatch, product: item})).includes(expected));
      for (const kind of missing) assert.ok(scoreLabels.partialScoreNote(score).includes(scoreLabels.FACTOR_NAMES[kind]), kind);
      assert.ok(text(ProductScoreCard({score, per: 'g'})).includes(missing.length >= 2 ? 'Предварительная оценка' : 'Не учтено'));
    }
  });
  it('the partial note lists only what is missing and the list follows the server rule', () => {
    assert.deepEqual(COMBINATIONS.at(-1)[0], [...REQUIRED_FACTORS]);
    const message = scoreLabels.partialScoreNote(scoreProduct(product(['sugars'])));
    assert.doesNotMatch(message, /насыщенные|соль/);
  });
  it('fields outside the rule are not listed and a complete label still scores', () => {
    const item = product([], {fiberG: NOT_DETECTED, proteinG: NOT_DETECTED});
    assert.notEqual(scoreProduct(item).value, null);
    assert.doesNotMatch(goalLabels.unavailableMessage(matchGoal(product(['salt'], {proteinG: NOT_DETECTED}), plan),
      product(['salt'], {proteinG: NOT_DETECTED})), /белок/);
  });
  it('low confidence never shows a confident verdict', () => {
    const score = scoreProduct(product(['sugars', 'saturatedFat', 'salt']));
    assert.equal(score.confidence, 'low');
    const card = text(ProductScoreCard({score, per: 'g'}));
    assert.ok(card.includes('Предварительно'));
    assert.ok(card.includes('Данных недостаточно для надёжной оценки'));
    assert.doesNotMatch(card, /Отличный выбор|Хороший выбор/);
  });
  it('other reasons keep their own messages', () => {
    const noTable = {...product(), nutrition: null};
    assert.equal(scoreLabels.unscoredMessage(scoreProduct(noTable)),
      `Недостаточно данных для оценки. ${scoreLabels.UNSCORED_MESSAGES.no_nutrition}`);
    const unknown = product([], {basis: 'unknown'});
    assert.equal(scoreLabels.unscoredMessage(scoreProduct(unknown)),
      `Недостаточно данных для оценки. ${scoreLabels.UNSCORED_MESSAGES.unknown_basis}`);
    assert.equal(goalLabels.unavailableMessage(matchGoal(unknown, plan), unknown),
      'Недостаточно данных для оценки: не удалось определить основу пищевой ценности.');
  });
  it('too_few_factors without a usable factor list falls back without naming fields', () => {
    const message = scoreLabels.unscoredMessage({value: null, unscoredReason: 'too_few_factors', factors: []});
    assert.equal(message, `Недостаточно данных для оценки. ${scoreLabels.UNSCORED_MESSAGES.too_few_factors}`);
    assert.doesNotMatch(message, /сахара|соль/);
  });
});
