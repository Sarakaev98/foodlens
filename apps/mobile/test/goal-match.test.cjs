const assert = require('node:assert/strict');
const {describe, it} = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Execute the actual pure TS labels and JSX component with lightweight native host elements.
// No Expo runtime, new dependency, or copied formatting implementation is used.
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
const profile = load('src/features/profile/profile.labels.ts');
const nutrition = load('src/shared/nutrition/missingNutrients.ts');
const labels = load('src/features/goal-match/goalMatchLabels.ts', {'@/features/profile': profile, '@/shared/nutrition': nutrition});
const theme = load('src/shared/ui/theme.ts');
const jsx = (type, props) => ({type, props});
const {GoalMatchCard} = load('src/features/goal-match/components/GoalMatchCard.tsx', {
  'react/jsx-runtime': {jsx, jsxs: jsx},
  'react-native': {StyleSheet: {create: x => x, hairlineWidth: 1}, Text: 'Text', View: 'View'},
  '@/features/profile': profile, '@/shared/ui': {...theme, typography: {}},
  '../goalMatchLabels': labels,
});
const base = {version: 'goal-match-v3', state: 'goal_match', goal: 'eat_healthier', value: 8.7,
  level: 'great', unavailableReason: null, portion: null, factors: [], confidence: 'high',
  range: {min: 8.7, max: 8.7}, uncertainty: []};
function text(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join(' ');
  if (typeof node.type === 'function') return text(node.type(node.props));
  return text(node.props?.children);
}

describe('GoalMatchCard v3 / v1 presentation', () => {
  it('v3 8.7 stays 8.7; v1 79 is divided once; all values have one decimal', () => {
    for (const [version, value, expected] of [
      ['goal-match-v3', 8.7, '8.7'], ['goal-match-v3', 10, '10.0'],
      ['goal-match-v1', 79, '7.9'], ['goal-match-v1', 100, '10.0'], ['goal-match-v1', 0, '0.0'],
    ]) {
      const input = {...base, version, value};
      assert.equal(labels.formatGoalMatchValue(input), expected);
      const card = GoalMatchCard({goalMatch: input});
      assert.ok(card.props.accessibilityLabel.includes(expected + ' out of 10'));
      assert.equal(input.value, value);
      assert.match(text(card), /Goal Match/);
      assert.match(card.props.accessibilityLabel, /^Goal Match:/);
    }
  });
  it('not_applicable has no numerical badge and says it does not affect the goal', () => {
    const card = GoalMatchCard({goalMatch: {...base, state: 'not_applicable', value: null, level: null}});
    assert.match(text(card), /Goal Match/);
    assert.match(text(card), /Goal: Eat healthier/);
    assert.match(text(card), /Doesn’t affect your goal/); assert.doesNotMatch(text(card), /\/ 10/);
  });
  it('insufficient data uses a specific reason without a score', () => {
    const card = GoalMatchCard({goalMatch: {...base, state: 'insufficient_data', value: null,
      level: null, unavailableReason: 'missing_nutrients'}});
    assert.match(text(card), /Goal Match/);
    assert.match(text(card), /Not enough nutrition data/); assert.doesNotMatch(text(card), /\/ 10/);
  });
  it('an estimate without a printed portion is visibly and accessibly approximate', () => {
    const card = GoalMatchCard({goalMatch: {...base, confidence: 'low', portion: {basis: 'per_100', amount: 100, unit: 'g', caloriesKcal: 430}}});
    assert.match(text(card), /Approximate rating/); assert.match(card.props.accessibilityLabel, /about/);
  });
  it('per-100 estimate says so, for g and ml, and shows no portion texts', () => {
    for (const [unit, label] of [['g', '100 g'], ['ml', '100 ml']]) {
      const factors = [{id: 'sugars.high', kind: 'sugars', level: 'high', impact: 'negative', points: -2, value: null, portionShare: null, matches: []},
        {id: 'protein.high', kind: 'protein', level: 'high', impact: 'positive', points: 1, value: null, portionShare: null, matches: []},
        {id: 'fiber.high', kind: 'fiber', level: 'high', impact: 'positive', points: .5, value: null, portionShare: null, matches: []}];
      const content = text(GoalMatchCard({goalMatch: {...base, confidence: 'low', factors,
        portion: {basis: 'per_100', amount: 100, unit, caloriesKcal: 430}}}));
      assert.ok(content.includes(`Approximate rating per ${label}: serving size not listed.`), content);
      assert.doesNotMatch(content, /per serving|serving:|of daily|daily protein goal|daily calories|About:/);
      assert.match(content, /Free sugars/);
    }
  });
  it('a low-confidence result with a printed serving shows no technical note', () => {
    const content = text(GoalMatchCard({goalMatch: {...base, confidence: 'low', portion: {basis: 'serving', amount: 130, unit: 'g', caloriesKcal: 80}}}));
    assert.doesNotMatch(content, /Approximate|rating per 100/);
  });
  it('true unknown_portion keeps its terminal text', () => {
    const message = labels.unavailableMessage({...base, state: 'insufficient_data', value: null, level: null, unavailableReason: 'unknown_portion'});
    assert.equal(message, 'Not enough data to rate: couldn’t determine the serving size.');
  });
  it('v1 per-100 note is unchanged', () => {
    const content = text(GoalMatchCard({goalMatch: {...base, version: 'goal-match-v1', value: 70, level: 'good',
      portion: {basis: 'per_100', amount: 100, unit: 'g', caloriesKcal: 430}}}));
    assert.match(content, /Serving size isn’t listed, so the share of daily calories wasn’t calculated/);
  });
  it('v3 negative contribution never gets the legacy neutral override for a small portion share', () => {
    const f = {id: 'saturatedFat.high', kind: 'saturatedFat', level: 'high', impact: 'negative',
      points: -.4, value: 1.69, portionShare: 8.45, matches: []};
    const reason = labels.factorReason(f, 'goal-match-v3');
    assert.equal(reason.impact, undefined);
    assert.equal(reason.text, 'Saturated fat');
    const card = GoalMatchCard({goalMatch: {...base, factors: [f]}});
    assert.match(text(card), /−/);
  });
  it('top three explanations come from real nonzero contributions', () => {
    const factors = [
      {kind: 'protein', value: 12, points: 2, impact: 'positive'},
      {kind: 'whole', value: 1, points: 1, impact: 'positive'},
      {kind: 'salt', value: .4, points: -.8, impact: 'negative'},
      {kind: 'fiber', value: 2, points: .1, impact: 'positive'},
    ].map(f => ({...f, id: f.kind + '.high', level: 'high', portionShare: 10, matches: []}));
    const content = text(GoalMatchCard({goalMatch: {...base, factors}}));
    assert.match(content, /Protein/); assert.match(content, /Whole/); assert.match(content, /Salt/);
    assert.doesNotMatch(content, /Source of fiber/);
  });
});

const unavailable = {...base, state: 'insufficient_data', value: null, level: null,
  unavailableReason: 'missing_nutrients'};
function nutritionProduct(overrides = {}) {
  const values = {proteinG: 9.5, carbsG: 3.6, sugarsG: 3.6, fatG: 2,
    saturatedFatG: 1.3, saltG: .1, sodiumMg: null, ...overrides};
  return {nutrition: {basis: 'per_100g', servingSize: {value: {amount: 130, unit: 'g'}},
    ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, {value}]))}};
}
describe('v3 unavailable presentation, without changing gates', () => {
  it('names each missing critical nutrient and renders it on the card', () => {
    for (const [key, message] of [
      ['proteinG', 'protein'], ['sugarsG', 'sugars'],
      ['saturatedFatG', 'saturated fat'], ['saltG', 'salt'],
    ]) {
      const product = nutritionProduct({[key]: null});
      const expected = `Not enough data on ${message} for a personal rating.`;
      assert.equal(labels.unavailableMessage(unavailable, product), expected);
      const content = text(GoalMatchCard({goalMatch: unavailable, product}));
      assert.ok(content.includes(expected)); assert.doesNotMatch(content, /\/ 10/);
    }
  });
  it('lists every blocking nutrient, leaves protein out next to them and keeps v1 labels unchanged', () => {
    const product = nutritionProduct({proteinG: null, sugarsG: null});
    assert.equal(labels.unavailableMessage(unavailable, product), 'Not enough data on sugars for a personal rating.');
    const all = nutritionProduct({proteinG: null, sugarsG: null, saturatedFatG: null, saltG: null});
    assert.equal(labels.unavailableMessage(unavailable, all), 'Not enough data on sugars, saturated fat and salt for a personal rating.');
    assert.equal(labels.unavailableMessage(unavailable, nutritionProduct()), labels.UNAVAILABLE_MESSAGES.missing_nutrients);
    assert.equal(labels.unavailableMessage({...unavailable, version: 'goal-match-v1'}, product),
      labels.UNAVAILABLE_MESSAGES.missing_nutrients);
  });
  it('does not report salt missing when sodium exists, or inferable sugars/saturated fat missing', () => {
    const product = nutritionProduct({proteinG: null, sugarsG: null, carbsG: .4,
      saturatedFatG: null, fatG: .4, saltG: null, sodiumMg: 50});
    assert.equal(labels.unavailableMessage(unavailable, product), 'Not enough data on protein for a personal rating.');
    product.nutrition.basis = 'per_serving';
    product.nutrition.servingSize.value.amount = 50;
    assert.equal(labels.unavailableMessage(unavailable, product), 'Not enough data on sugars and saturated fat for a personal rating.');
  });
  it('has specific wording for non-nutrient reasons without changing v1', () => {
    for (const [reason, message] of [
      ['unknown_portion', 'Not enough data to rate: couldn’t determine the serving size.'],
      ['unknown_basis', 'Not enough data to rate: couldn’t tell what amount the nutrition values refer to.'],
      ['ai_context_unavailable', 'Not enough data to rate this product.'],
      ['ambiguous', 'Not enough data for a reliable rating.'],
    ]) {
      assert.equal(labels.unavailableMessage({...unavailable, unavailableReason: reason}), message);
      assert.equal(labels.unavailableMessage({...unavailable, version: 'goal-match-v1', unavailableReason: reason}),
        labels.UNAVAILABLE_MESSAGES[reason]);
    }
  });
  it('mentions the daily salt limit once', () => {
    const reason = labels.factorReason({kind: 'salt', impact: 'negative', points: -1.3, portionShare: 8.4}, 'goal-match-v3');
    assert.equal(reason.text, 'Salt');
    assert.equal(reason.detail, '8% of daily limit per serving; concentration considered');
  });
});


it('numeric missing protein shows its note separately, keeps fiber note and never invents a protein benefit', () => {
  const input = {...base, value: 6.6, confidence: 'medium', uncertainty: ['protein', 'fiber'],
    factors: [{id: 'protein.ok', kind: 'protein', points: 0, impact: 'neutral', value: null, portionShare: null, matches: []}]};
  const card = GoalMatchCard({goalMatch: input});
  const content = text(card);
  assert.ok(content.includes('Protein isn’t listed, so it wasn’t counted.'));
  assert.ok(content.includes('Fiber isn’t listed, so it wasn’t counted.'));
  assert.match(card.props.accessibilityLabel, /6.6 out of 10/);
  assert.doesNotMatch(content, /Protein helps/);
  assert.doesNotMatch(text(GoalMatchCard({goalMatch: base})), /Protein isn’t listed/);
  assert.doesNotMatch(text(GoalMatchCard({goalMatch: {...input, version: 'goal-match-v1'}})), /Protein isn’t listed/);
});
