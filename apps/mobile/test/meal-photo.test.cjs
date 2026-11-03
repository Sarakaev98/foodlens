/* global __dirname */
const assert = require('node:assert/strict');
const {describe, it} = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Same approach as scan-camera.test.cjs: transpile the real TS/TSX and run it with stubbed imports.
function load(file, imports = {}, globals = {}) {
  const module = {exports: {}};
  const absolute = path.join(__dirname, '..', file);
  const js = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  }}).outputText;
  vm.runInNewContext(js, {module, exports: module.exports, setTimeout, clearTimeout, Date, Math, ...globals, require: id => {
    assert.ok(id in imports, 'Unexpected import ' + id); return imports[id];
  }}, {filename: absolute});
  return module.exports;
}

const jsx = (type, props) => ({type, props});
const jsxRuntime = {jsx, jsxs: jsx, Fragment: 'Fragment'};
const theme = load('src/shared/ui/theme.ts');
const ui = {...theme, typography: {}, Button: 'Button'};
const rn = {StyleSheet: {create: x => x, hairlineWidth: 1}, Text: 'Text', View: 'View', Pressable: 'Pressable', Image: 'Image', ScrollView: 'ScrollView',
  ActivityIndicator: 'ActivityIndicator'};
const safeArea = {SafeAreaView: 'SafeAreaView'};
const flush = () => new Promise(r => setImmediate(r));

function render(node) {
  if (node === null || node === undefined || typeof node === 'boolean' || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(render);
  if (typeof node.type === 'function') return render(node.type(node.props));
  return {type: node.type, props: {...node.props, children: render(node.props?.children)}};
}
function all(node, pred, out = []) {
  if (Array.isArray(node)) node.forEach(n => all(n, pred, out));
  else if (node && typeof node === 'object') { if (pred(node)) out.push(node); all(node.props?.children, pred, out); }
  return out;
}
function text(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join('');
  return text(node.props?.children);
}

/** Hook slots survive re-renders, so one component instance can be pressed and rendered again. */
function hooks() {
  const slots = [];
  let index = 0;
  return {
    reset: () => { index = 0; },
    react: {
      useState: init => { const k = index++; if (!(k in slots)) slots[k] = typeof init === 'function' ? init() : init;
        return [slots[k], v => { slots[k] = typeof v === 'function' ? v(slots[k]) : v; }]; },
      useRef: init => { const k = index++; if (!(k in slots)) slots[k] = {current: init}; return slots[k]; },
      useCallback: fn => fn, useEffect: () => {},
    },
  };
}

const formatNumber = load('src/features/today/formatNumber.ts');
const ESTIMATE = {
  mealName: 'Курица с рисом и овощами',
  items: [
    {name: 'Курица', estimatedGrams: 150, caloriesKcal: 248, proteinG: 46, carbsG: 0, fatG: 6, confidence: 'medium'},
    {name: 'Рис', estimatedGrams: 180, caloriesKcal: 234, proteinG: 5, carbsG: 51, fatG: 1, confidence: 'medium'},
    {name: 'Овощи', estimatedGrams: 100, caloriesKcal: 35, proteinG: 2, carbsG: 7, fatG: 0, confidence: 'high'},
    {name: 'Соус', estimatedGrams: 30, caloriesKcal: 90, proteinG: 0, carbsG: 4, fatG: 8, confidence: 'low'},
  ],
  total: {caloriesKcal: 607, proteinG: 53, carbsG: 62, fatG: 15},
  calorieRange: {min: 500, max: 720},
  confidence: 'medium',
  assumptions: ['Возможно, использовано масло'],
};
const PHOTO = {uri: 'file:///meal.jpg', width: 1600, height: 1200};

describe('useProductScan: meal mode', () => {
  function scanHook(analyzeMeal) {
    const h = hooks();
    const calls = [];
    const {useProductScan} = load('src/features/scan/hooks/useProductScan.ts', {react: h.react,
      'expo-image-picker': {},
      '../scanDebug': {scanDebugLog: () => {}},
      '../scanErrors': {toScanFailure: error => ({code: error.code ?? 'backend_unavailable'}), SCAN_FAILURE_MESSAGES: {}},
      '../services/scanApi': {scanApi: {
        analyzeMeal: async photo => (calls.push({meal: photo}), analyzeMeal()),
        analyze: async () => assert.fail('the product scan is not called in the meal mode'),
        analyzeMany: async () => assert.fail('the product scan is not called in the meal mode'),
        analyzeLabel: async () => assert.fail('the label scan is not called in the meal mode'),
      }},
      '../services/scanPhoto': {preparePhoto: async p => ({...p, uri: p.uri + '.small'}), deleteTemporaryPhoto: () => {}},
      '../services/scanPhotos': load('src/features/scan/services/scanPhotos.ts'),
    });
    // eslint-disable-next-line react-hooks/rules-of-hooks -- This harness invokes the hook against fake React slots, not a React render.
    return {calls, run: () => { h.reset(); return useProductScan(); }};
  }

  it('2. preview: one photo, no barcode even if the camera saw one', () => {
    const {run} = scanHook(async () => ({estimate: ESTIMATE}));
    run().setMode('meal');
    run().onPhotoCaptured(PHOTO, '4607001771234');
    const {state} = run();
    assert.equal(state.status, 'preview');
    assert.equal(state.photos.length, 1);
    assert.equal(state.barcode, null);
  });

  it('3–4. analyze: loading, one resized photo to /scan/meal, then the meal result', async () => {
    const {run, calls} = scanHook(async () => ({estimate: ESTIMATE}));
    run().setMode('meal');
    run().onPhotoCaptured(PHOTO, null);
    run().analyze();
    assert.equal(run().state.status, 'analyzing');
    await flush(); await flush();
    assert.deepEqual(calls, [{meal: {...PHOTO, uri: 'file:///meal.jpg.small'}}]);
    const {state} = run();
    assert.equal(state.status, 'meal_result');
    assert.equal(state.estimate, ESTIMATE);
    assert.equal(state.photo, PHOTO);
  });

  it('8. error: an understandable code, the same photo can be retried', async () => {
    let fail = true;
    const {run} = scanHook(async () => { if (fail) throw {code: 'meal_not_recognized'}; return {estimate: ESTIMATE}; });
    run().setMode('meal');
    run().onPhotoCaptured(PHOTO, null);
    run().analyze();
    await flush(); await flush();
    assert.deepEqual({status: run().state.status, code: run().state.code}, {status: 'error', code: 'meal_not_recognized'});
    fail = false;
    run().analyze();
    await flush(); await flush();
    assert.equal(run().state.status, 'meal_result');
  });
});

describe('scanErrors: meal photo', () => {
  class ApiError extends Error { constructor(status, body, timedOut = false) { super('api'); this.status = status; this.body = body; this.timedOut = timedOut; } }
  const {toScanFailure, SCAN_FAILURE_MESSAGES} = load('src/features/scan/scanErrors.ts', {'@/shared/api': {ApiError}});

  it('no food, Gemini errors and timeouts become Russian messages without raw backend text', () => {
    assert.equal(toScanFailure(new ApiError(422, {code: 'MEAL_NOT_RECOGNIZED', message: 'No food could be recognized'})).code, 'meal_not_recognized');
    assert.equal(toScanFailure(new ApiError(502, {code: 'AI_BAD_RESPONSE'})).code, 'ai_unavailable');
    assert.equal(toScanFailure(new ApiError(504, {code: 'AI_TIMEOUT'})).code, 'ai_timeout');
    assert.equal(toScanFailure(new ApiError(0, null, true)).code, 'request_timeout');
    assert.equal(toScanFailure(new ApiError(0, null)).code, 'network_unavailable');
    assert.equal(SCAN_FAILURE_MESSAGES.meal_not_recognized.title, 'Не удалось распознать еду');
    assert.doesNotMatch(SCAN_FAILURE_MESSAGES.meal_not_recognized.description, /AI|Gemini|food/);
  });
});

describe('AnalyzingView: meal stages', () => {
  const {ANALYZING_STAGES} = load('src/features/scan/components/AnalyzingView.tsx', {
    'react/jsx-runtime': jsxRuntime, react: {}, 'react-native': rn, 'react-native-safe-area-context': safeArea, '@/shared/ui': ui,
  });

  it('3. loading texts for the meal', () => {
    assert.deepEqual([...ANALYZING_STAGES.meal], ['Распознаём блюдо', 'Оцениваем порции', 'Считаем калории']);
  });
});

describe('PhotoPreview: meal photo', () => {
  const {PhotoPreview} = load('src/features/scan/components/PhotoPreview.tsx', {
    'react/jsx-runtime': jsxRuntime, react: hooks().react, 'react-native': rn, 'react-native-safe-area-context': safeArea, '@/shared/ui': ui,
    '../services/scanPhotos': load('src/features/scan/services/scanPhotos.ts'),
  });

  it('2. one photo labelled as a meal, «Анализировать», no extra photos', () => {
    const tree = render(jsx(PhotoPreview, {photos: [{photo: PHOTO, role: 'product'}], allowExtraPhotos: false, photoLabel: 'Фото блюда',
      onAnalyze: () => {}, onAddPhoto: () => {}, onRetake: () => {}, onRemove: () => {}}));
    assert.ok(text(tree).includes('Фото блюда'));
    assert.equal(text(tree).includes('Фото продукта'), false);
    const buttons = all(tree, n => n.type === 'Button').map(n => n.props.label);
    assert.deepEqual(buttons, ['Анализировать']);
  });
});

describe('MealResultScreen', () => {
  function mount(estimate, addToToday) {
    const h = hooks();
    const today = {formatInteger: formatNumber.formatInteger, addMealEstimateToToday: async () => assert.fail('stubbed per test'), newTodayEntryId: () => 'meal_fixed'};
    const {MealResultScreen, MEAL_ESTIMATE_DISCLAIMER, calorieRangeText} = load('src/features/scan/screens/MealResultScreen.tsx', {
      'react/jsx-runtime': jsxRuntime, react: h.react, 'react-native': rn, 'react-native-safe-area-context': safeArea, '@/shared/ui': ui,
      '@/features/today': today,
    });
    const view = () => { h.reset(); return render(jsx(MealResultScreen, {estimate, photo: PHOTO, onScanAnother: () => {}, addToToday})); };
    return {view, MEAL_ESTIMATE_DISCLAIMER, calorieRangeText};
  }
  const button = (tree, label) => all(tree, n => n.type === 'Button' && n.props.label === label)[0];

  it('4. calories and macros are approximate', () => {
    const tree = mount(ESTIMATE, async () => {}).view();
    const content = text(tree);
    assert.ok(content.includes('≈607 ккал'));
    assert.ok(content.includes('Белки≈53 г'));
    assert.ok(content.includes('Жиры≈15 г'));
    assert.ok(content.includes('Углеводы≈62 г'));
    assert.ok(content.includes('≈ 500–720 ккал'), 'medium confidence shows the range');
    assert.ok(content.includes('Курица с рисом и овощами'));
  });

  it('confident estimate shows one number, no range', () => {
    const {calorieRangeText} = mount(ESTIMATE, async () => {});
    assert.equal(calorieRangeText({...ESTIMATE, confidence: 'high'}), null);
    assert.equal(calorieRangeText(ESTIMATE), '≈ 500–720 ккал');
  });

  it('5. the recognized items with grams', () => {
    const content = text(mount(ESTIMATE, async () => {}).view());
    assert.ok(content.includes('Что распознано'));
    for (const [name, grams] of [['Курица', 150], ['Рис', 180], ['Овощи', 100], ['Соус', 30]]) assert.ok(content.includes(`${name}≈${grams} г`), name);
  });

  it('6. the approximation disclaimer is shown', () => {
    const {view, MEAL_ESTIMATE_DISCLAIMER} = mount(ESTIMATE, async () => {});
    const content = text(view());
    assert.ok(content.includes('Примерная оценка по фотографии'));
    assert.ok(content.includes(MEAL_ESTIMATE_DISCLAIMER));
    assert.match(MEAL_ESTIMATE_DISCLAIMER, /зависят от порции и способа приготовления/);
  });

  it('7, 10. «Добавить в Сегодня» adds once; a double tap does not send a duplicate', async () => {
    const calls = [];
    let resolve;
    const {view} = mount(ESTIMATE, (id, estimate) => { calls.push({id, estimate}); return new Promise(r => { resolve = r; }); });
    button(view(), 'Добавить в Сегодня').props.onPress();
    const adding = all(view(), n => n.type === 'Button' && n.props.loading === true);
    assert.equal(adding.length, 1, 'loading while adding');
    adding[0].props.onPress();
    assert.equal(calls.length, 1);
    resolve();
    await flush();
    const tree = view();
    assert.ok(text(tree).includes('✓ Добавлено в Сегодня'));
    assert.equal(button(tree, 'Добавить в Сегодня'), undefined);
    assert.deepEqual(calls, [{id: 'meal_fixed', estimate: ESTIMATE}]);
  });

  it('8. a failed add can be retried with the same entry id (the server ignores a repeated id)', async () => {
    const ids = [];
    let fail = true;
    const {view} = mount(ESTIMATE, async id => { ids.push(id); if (fail) throw new Error('offline'); });
    button(view(), 'Добавить в Сегодня').props.onPress();
    await flush();
    assert.ok(text(view()).includes('Не удалось добавить'));
    fail = false;
    button(view(), 'Повторить добавление').props.onPress();
    await flush();
    assert.ok(text(view()).includes('✓ Добавлено в Сегодня'));
    assert.deepEqual(ids, ['meal_fixed', 'meal_fixed']);
  });
});

describe('Today: adding a meal estimate', () => {
  const store = load('src/features/today/state/todayLogStore.ts');
  const posted = [];
  const LOG = {date: '2026-11-03', entries: [], totals: {caloriesKcal: 0, proteinG: 0, carbsG: 0, fatG: 0}};
  const api = {
    localDate: () => '2026-11-03',
    todayLogApi: {add: async entry => {
      posted.push(entry);
      const {date, ...item} = entry;
      const entries = [...LOG.entries, {...item, addedAt: 'now'}];
      return {date, entries, totals: {caloriesKcal: 607, proteinG: 53, carbsG: 62, fatG: 15}};
    }},
  };
  const {addMealEstimateToToday} = load('src/features/today/addToToday.ts', {'./services/todayLogApi': api, './state/todayLogStore': store});

  it('9. the entry goes to the shared Today log with source meal_photo_estimate, and Today sees the new totals', async () => {
    const seen = [];
    const unsubscribe = store.todayLogStore.subscribe(log => seen.push(log.totals.caloriesKcal));
    await addMealEstimateToToday('meal_1', ESTIMATE);
    unsubscribe();
    assert.deepEqual(JSON.parse(JSON.stringify(posted)), [{id: 'meal_1', date: '2026-11-03', name: 'Курица с рисом и овощами', source: 'meal_photo_estimate',
      caloriesKcal: 607, proteinG: 53, carbsG: 62, fatG: 15}]);
    assert.deepEqual(seen, [607]);
    assert.equal(store.todayLogStore.get().entries.length, 1);
  });

  it('9. Today cards show eaten of target', () => {
    const today = {'react/jsx-runtime': jsxRuntime, 'react-native': rn, '@/shared/ui': ui, '../formatNumber': formatNumber};
    const {CaloriesCard} = load('src/features/today/components/CaloriesCard.tsx', today);
    const {MacroCard} = load('src/features/today/components/MacroCard.tsx', today);
    const calories = render(jsx(CaloriesCard, {caloriesKcal: 2490, consumedKcal: 607}));
    assert.ok(text(calories).includes('Съедено сегодня'));
    assert.ok(text(calories).includes(`607из ${formatNumber.formatInteger(2490)} ккал`));
    assert.equal(all(calories, n => n.props?.accessibilityRole === 'progressbar')[0].props.accessibilityValue.now, 607);
    assert.ok(text(render(jsx(MacroCard, {label: 'Белки', grams: 150, consumedG: 53}))).includes('53 / 150 г'));
    assert.ok(text(render(jsx(CaloriesCard, {caloriesKcal: 2490}))).includes('Дневная цель'), 'without a log only the target');
  });

  it('local date is the phone day in YYYY-MM-DD', () => {
    const {localDate} = load('src/features/today/services/todayLogApi.ts', {'@/shared/api': {apiClient: {}}});
    assert.equal(localDate(new Date(2026, 10, 3, 23, 59)), '2026-11-03');
    assert.equal(localDate(new Date(2026, 0, 5, 0, 1)), '2026-01-05');
  });
});
