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

const v3 = {...base, factors: [
  {id: 'protein.high', kind: 'protein', level: 'high', impact: 'positive', points: 1.2, value: 12.4, portionShare: 8.9, matches: []},
  {id: 'whole.ok', kind: 'whole', level: 'ok', impact: 'positive', points: 1, value: 1, portionShare: null, matches: []},
]};
const ai = {version: 'goal-match-ai-v1', band: 'good_fit', score: 8, confidence: 'high',
  dimensions: {}, warnings: [], summary: 'Хороший выбор: много белка и простой состав.',
  factors: [
    {code: 'high_protein', direction: 'positive', impact: 'high', facts: [], text: 'Много белка на порцию.'},
    {code: 'whole_food', direction: 'positive', impact: 'medium', facts: [], text: 'Простой состав.'},
    {code: 'low_salt', direction: 'positive', impact: 'low', facts: [], text: 'Почти нет соли.'},
    {code: 'fits_portion', direction: 'positive', impact: 'low', facts: [], text: 'Порция небольшая.'},
  ],
  inputVersion: 'goal-match-ai-input-v1', promptVersion: 'eat-healthier-rubric-v2', model: 'gemini', cacheHit: false};
const v4ai = {...v3, version: 'goal-match-v4', value: 8, level: 'great', range: null, factors: [], source: 'ai', ai,
  deterministic: v3, adjusted: false, ai_disagreement: false};
const v4det = {...v3, version: 'goal-match-v4', source: 'deterministic', ai: null, deterministic: v3, adjusted: false, ai_disagreement: true};

describe('GoalMatchCard v4 presentation', () => {
  it('v4 is already 0–10: 8.0 stays 8,0 and is not divided by 10', () => {
    assert.equal(labels.formatGoalMatchValue(v4ai), '8,0');
    assert.equal(labels.formatGoalMatchValue({...v4ai, value: 5.7}), '5,7');
    assert.ok(GoalMatchCard({goalMatch: v4ai}).props.accessibilityLabel.includes('8,0 из 10'));
  });
  it('source=ai shows the AI label, summary and at most 3 AI reasons', () => {
    const shown = text(GoalMatchCard({goalMatch: v4ai}));
    assert.match(shown, /AI-анализ/);
    assert.match(shown, /Хороший выбор: много белка и простой состав\./);
    assert.match(shown, /Много белка на порцию/); assert.match(shown, /Почти нет соли/);
    assert.doesNotMatch(shown, /Порция небольшая/);
    assert.doesNotMatch(shown, /Белок помогает выполнить дневную цель/);
  });
  it('profile restrictions come before AI reasons', () => {
    const restriction = {id: 'allergens.may_contain', kind: 'allergens', level: 'may_contain', impact: 'negative', points: -0.3,
      value: null, portionShare: null, matches: ['milk']};
    const shown = text(GoalMatchCard({goalMatch: {...v4ai, factors: [restriction]}}));
    assert.match(shown, /Может содержать следы/);
    assert.doesNotMatch(shown, /Почти нет соли/);
  });
  it('source=deterministic shows the calculated label and v3 reasons, no technical flags', () => {
    const shown = text(GoalMatchCard({goalMatch: v4det}));
    assert.match(shown, /Расчётная оценка/);
    assert.match(shown, /Белок помогает выполнить дневную цель/);
    assert.doesNotMatch(shown, /AI-анализ|disagreement|adjusted|Хороший выбор/);
  });
  it('v4 terminal states keep the existing messages, without a source label', () => {
    const terminal = {...v4det, state: 'insufficient_data', value: null, level: null, unavailableReason: 'no_calories', factors: []};
    const shown = text(GoalMatchCard({goalMatch: terminal}));
    assert.match(shown, /Калорийность не прочитана/);
    assert.doesNotMatch(shown, /Расчётная оценка|AI-анализ/);
    const invalid = {...terminal, unavailableReason: 'invalid_nutrition'};
    assert.match(text(GoalMatchCard({goalMatch: invalid})), /противоречат друг другу/);
    assert.match(text(GoalMatchCard({goalMatch: {...v4det, state: 'not_applicable', value: null, level: null}})), /Не влияет на вашу цель/);
  });
  it('v4 without a printed portion is shown as approximate; v1 and v3 are unchanged', () => {
    assert.match(text(GoalMatchCard({goalMatch: {...v4ai, confidence: 'low', portion: {basis: 'per_100', amount: 100, unit: 'g', caloriesKcal: 430}}})), /Примерная оценка/);
    assert.equal(labels.formatGoalMatchValue({...base, version: 'goal-match-v1', value: 79}), '7,9');
    assert.equal(labels.formatGoalMatchValue(base), '8,7');
    assert.equal(labels.goalMatchSourceLabel(base), null);
  });
});
