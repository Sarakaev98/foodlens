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
      ['goal-match-v3', 8.7, '8,7'], ['goal-match-v3', 10, '10,0'],
      ['goal-match-v1', 79, '7,9'], ['goal-match-v1', 100, '10,0'], ['goal-match-v1', 0, '0,0'],
    ]) {
      const input = {...base, version, value};
      assert.equal(labels.formatGoalMatchValue(input), expected);
      const card = GoalMatchCard({goalMatch: input});
      assert.ok(card.props.accessibilityLabel.includes(expected + ' из 10'));
      assert.equal(input.value, value);
      assert.match(text(card), /Соответствие вашей цели/);
      assert.match(card.props.accessibilityLabel, /^Соответствие вашей цели:/);
    }
  });
  it('not_applicable has no numerical badge and says it does not affect the goal', () => {
    const card = GoalMatchCard({goalMatch: {...base, state: 'not_applicable', value: null, level: null}});
    assert.match(text(card), /Соответствие вашей цели/);
    assert.match(text(card), /Цель: питаться здоровее/);
    assert.match(text(card), /Не влияет на вашу цель/); assert.doesNotMatch(text(card), /\/ 10/);
  });
  it('insufficient data uses a specific reason without a score', () => {
    const card = GoalMatchCard({goalMatch: {...base, state: 'insufficient_data', value: null,
      level: null, unavailableReason: 'missing_nutrients'}});
    assert.match(text(card), /Соответствие вашей цели/);
    assert.match(text(card), /не хватает данных/); assert.doesNotMatch(text(card), /\/ 10/);
  });
  it('an estimate without a printed portion is visibly and accessibly approximate', () => {
    const card = GoalMatchCard({goalMatch: {...base, confidence: 'low', portion: {basis: 'per_100', amount: 100, unit: 'g', caloriesKcal: 430}}});
    assert.match(text(card), /Примерная оценка/); assert.match(card.props.accessibilityLabel, /примерно/);
  });
  it('per-100 estimate says so, for g and ml, and shows no portion texts', () => {
    for (const [unit, label] of [['g', '100 г'], ['ml', '100 мл']]) {
      const factors = [{id: 'sugars.high', kind: 'sugars', level: 'high', impact: 'negative', points: -2, value: null, portionShare: null, matches: []},
        {id: 'protein.high', kind: 'protein', level: 'high', impact: 'positive', points: 1, value: null, portionShare: null, matches: []},
        {id: 'fiber.high', kind: 'fiber', level: 'high', impact: 'positive', points: .5, value: null, portionShare: null, matches: []}];
      const content = text(GoalMatchCard({goalMatch: {...base, confidence: 'low', factors,
        portion: {basis: 'per_100', amount: 100, unit, caloriesKcal: 430}}}));
      assert.ok(content.includes(`Примерная оценка. Оценка на ${label}: размер порции не указан.`), content);
      assert.doesNotMatch(content, /в порции|порция —|дневного лимита|дневной цели|дневной нормы|Примерно:/);
      assert.match(content, /Свободные сахара/);
    }
  });
  it('a low-confidence result with a printed serving shows no technical note', () => {
    const content = text(GoalMatchCard({goalMatch: {...base, confidence: 'low', portion: {basis: 'serving', amount: 130, unit: 'g', caloriesKcal: 80}}}));
    assert.doesNotMatch(content, /Примерн|Оценка на 100/);
  });
  it('true unknown_portion keeps its terminal text', () => {
    const message = labels.unavailableMessage({...base, state: 'insufficient_data', value: null, level: null, unavailableReason: 'unknown_portion'});
    assert.equal(message, 'Недостаточно данных для оценки: не удалось определить размер порции.');
  });
  it('v1 per-100 note is unchanged', () => {
    const content = text(GoalMatchCard({goalMatch: {...base, version: 'goal-match-v1', value: 70, level: 'good',
      portion: {basis: 'per_100', amount: 100, unit: 'g', caloriesKcal: 430}}}));
    assert.match(content, /Размер порции не указан, поэтому доля дневной нормы калорий не посчитана/);
  });
  it('v3 negative contribution never gets the legacy neutral override for a small portion share', () => {
    const f = {id: 'saturatedFat.high', kind: 'saturatedFat', level: 'high', impact: 'negative',
      points: -.4, value: 1.69, portionShare: 8.45, matches: []};
    const reason = labels.factorReason(f, 'goal-match-v3');
    assert.equal(reason.impact, undefined);
    assert.equal(reason.text, 'Насыщенные жиры');
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
    assert.match(content, /Белок/); assert.match(content, /Цельный/); assert.match(content, /Соль/);
    assert.doesNotMatch(content, /Источник клетчатки/);
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
      ['proteinG', 'белке'], ['sugarsG', 'сахарах'],
      ['saturatedFatG', 'насыщенных жирах'], ['saltG', 'соли'],
    ]) {
      const product = nutritionProduct({[key]: null});
      const expected = `Для персональной оценки не хватает данных о ${message}.`;
      assert.equal(labels.unavailableMessage(unavailable, product), expected);
      const content = text(GoalMatchCard({goalMatch: unavailable, product}));
      assert.ok(content.includes(expected)); assert.doesNotMatch(content, /\/ 10/);
    }
  });
  it('lists every blocking nutrient, leaves protein out next to them and keeps v1 labels unchanged', () => {
    const product = nutritionProduct({proteinG: null, sugarsG: null});
    assert.equal(labels.unavailableMessage(unavailable, product), 'Для персональной оценки не хватает данных о сахарах.');
    const all = nutritionProduct({proteinG: null, sugarsG: null, saturatedFatG: null, saltG: null});
    assert.equal(labels.unavailableMessage(unavailable, all), 'Для персональной оценки не хватает данных о сахарах, насыщенных жирах и соли.');
    assert.equal(labels.unavailableMessage(unavailable, nutritionProduct()), labels.UNAVAILABLE_MESSAGES.missing_nutrients);
    assert.equal(labels.unavailableMessage({...unavailable, version: 'goal-match-v1'}, product),
      labels.UNAVAILABLE_MESSAGES.missing_nutrients);
  });
  it('does not report salt missing when sodium exists, or inferable sugars/saturated fat missing', () => {
    const product = nutritionProduct({proteinG: null, sugarsG: null, carbsG: .4,
      saturatedFatG: null, fatG: .4, saltG: null, sodiumMg: 50});
    assert.equal(labels.unavailableMessage(unavailable, product), 'Для персональной оценки не хватает данных о белке.');
    product.nutrition.basis = 'per_serving';
    product.nutrition.servingSize.value.amount = 50;
    assert.equal(labels.unavailableMessage(unavailable, product), 'Для персональной оценки не хватает данных о сахарах и насыщенных жирах.');
  });
  it('has specific wording for non-nutrient reasons without changing v1', () => {
    for (const [reason, message] of [
      ['unknown_portion', 'Недостаточно данных для оценки: не удалось определить размер порции.'],
      ['unknown_basis', 'Недостаточно данных для оценки: не удалось определить основу пищевой ценности.'],
      ['ai_context_unavailable', 'Недостаточно данных для оценки продукта.'],
      ['ambiguous', 'Недостаточно данных для надёжной оценки.'],
    ]) {
      assert.equal(labels.unavailableMessage({...unavailable, unavailableReason: reason}), message);
      assert.equal(labels.unavailableMessage({...unavailable, version: 'goal-match-v1', unavailableReason: reason}),
        labels.UNAVAILABLE_MESSAGES[reason]);
    }
  });
  it('mentions the daily salt limit once', () => {
    const reason = labels.factorReason({kind: 'salt', impact: 'negative', points: -1.3, portionShare: 8.4}, 'goal-match-v3');
    assert.equal(reason.text, 'Соль');
    assert.equal(reason.detail, '8% дневного лимита в порции; учтена концентрация');
  });
});


it('numeric missing protein shows its note separately, keeps fiber note and never invents a protein benefit', () => {
  const input = {...base, value: 6.6, confidence: 'medium', uncertainty: ['protein', 'fiber'],
    factors: [{id: 'protein.ok', kind: 'protein', points: 0, impact: 'neutral', value: null, portionShare: null, matches: []}]};
  const card = GoalMatchCard({goalMatch: input});
  const content = text(card);
  assert.ok(content.includes('Белок не указан: его вклад не учтён.'));
  assert.ok(content.includes('Клетчатка не указана: её вклад не учтён.'));
  assert.match(card.props.accessibilityLabel, /6,6 из 10/);
  assert.doesNotMatch(content, /Белок помогает/);
  assert.doesNotMatch(text(GoalMatchCard({goalMatch: base})), /Белок не указан/);
  assert.doesNotMatch(text(GoalMatchCard({goalMatch: {...input, version: 'goal-match-v1'}})), /Белок не указан/);
});
