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
  vm.runInNewContext(js, {module, exports: module.exports, setTimeout, clearTimeout, ...globals, require: id => {
    assert.ok(id in imports, 'Unexpected import ' + id); return imports[id];
  }}, {filename: absolute});
  return module.exports;
}
const jsx = (type, props) => ({type, props});
const jsxRuntime = {jsx, jsxs: jsx, Fragment: 'Fragment'};
const theme = load('src/shared/ui/theme.ts');
const rn = {StyleSheet: {create: x => x, hairlineWidth: 1}, Text: 'Text', View: 'View', Pressable: 'Pressable', Image: 'Image'};
const scanPhotos = load('src/features/scan/services/scanPhotos.ts');
const photo = name => ({uri: `file:///${name}.jpg`, width: 1600, height: 1200});
const slot = (name, role) => ({photo: photo(name), role});

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
  if (Array.isArray(node)) return node.map(text).join(' ');
  return text(node.props?.children);
}

describe('photo set state', () => {
  const {addScanPhoto, replaceScanPhoto, removeScanPhoto, removedPhotoUris, MAX_SCAN_PHOTOS} = scanPhotos;
  const roles = slots => [...slots].map(s => s.role);
  it('adds up to 3 and then ignores more', () => {
    let slots = [slot('a', 'product')];
    slots = addScanPhoto(slots, photo('b'), 'nutrition');
    slots = addScanPhoto(slots, photo('c'), 'nutrition');
    assert.deepEqual(roles(slots), ['product', 'nutrition', 'nutrition'], 'a duplicate role is allowed');
    assert.equal(addScanPhoto(slots, photo('d'), 'ingredients').length, MAX_SCAN_PHOTOS);
    assert.equal(MAX_SCAN_PHOTOS, 3);
  });
  it('remove keeps the others in order, replace keeps the label and position', () => {
    const slots = [slot('a', 'product'), slot('b', 'nutrition'), slot('c', 'ingredients')];
    assert.deepEqual(roles(removeScanPhoto(slots, 1)), ['product', 'ingredients']);
    const replaced = replaceScanPhoto(slots, 1, photo('new'));
    assert.deepEqual(roles(replaced), ['product', 'nutrition', 'ingredients']);
    assert.equal(replaced[1].photo.uri, 'file:///new.jpg');
  });
  it('reports only the temporary files that left the set', () => {
    const before = [slot('a', 'product'), slot('b', 'nutrition')];
    assert.deepEqual([...removedPhotoUris(before, before)], []);
    assert.deepEqual([...removedPhotoUris(before, removeScanPhoto(before, 1))], ['file:///b.jpg']);
    assert.deepEqual([...removedPhotoUris(before, replaceScanPhoto(before, 0, photo('n')))], ['file:///a.jpg']);
  });
});

describe('useProductScan with several photos', () => {
  function setup({prepareFails = false, apiFails = false} = {}) {
    let slots = [], i = 0;
    const react = {
      useState: init => { const k = i++; if (!(k in slots)) slots[k] = typeof init === 'function' ? init() : init;
        return [slots[k], v => { slots[k] = typeof v === 'function' ? v(slots[k]) : v; }]; },
      useRef: init => { const k = i++; if (!(k in slots)) slots[k] = {current: init}; return slots[k]; },
      useCallback: fn => fn, useEffect: () => {},
    };
    const api = {single: [], many: []}, deleted = [];
    const ok = {product: {}, score: {}, goalMatch: {}};
    const {useProductScan} = load('src/features/scan/hooks/useProductScan.ts', {
      react,
      'expo-image-picker': {requestMediaLibraryPermissionsAsync: async () => ({granted: false})},
      '../scanErrors': {toScanFailure: () => ({code: 'backend_unavailable'}),
        SCAN_FAILURE_MESSAGES: {capture_failed: {title: 'Не удалось сделать снимок'}, library_permission_denied: {title: 'Нет доступа к фото'}}},
      '../services/scanApi': {scanApi: {
        analyze: async (p, o) => { api.single.push({p, o}); if (apiFails) throw new Error('x'); return ok; },
        analyzeMany: async (s, o) => { api.many.push({s, o}); if (apiFails) throw new Error('x'); return ok; },
      }},
      '../services/scanPhoto': {preparePhoto: async p => { if (prepareFails) throw new Error('x'); return {...p, uri: p.uri + '.prepared'}; },
        deleteTemporaryPhoto: uri => deleted.push(uri)},
      '../services/scanPhotos': scanPhotos,
      '../scanDebug': {scanDebugLog: () => {}},
    });
    const run = () => { i = 0; return useProductScan(); };
    return {run, api, deleted, flush: async () => { await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r)); }};
  }
  const twoPhotos = () => {
    const t = setup();
    t.run().onPhotoCaptured(photo('a'), '4607001771234');
    t.run().addPhoto('nutrition');
    t.run().onPhotoCaptured(photo('b'), null);
    return t;
  };

  it('one photo: analyze sends the old single request, exactly once', async () => {
    const t = setup();
    t.run().onPhotoCaptured(photo('a'), null);
    t.run().analyze(); await t.flush();
    assert.equal(t.api.single.length, 1); assert.equal(t.api.many.length, 0);
    assert.equal(t.run().state.status, 'result');
  });
  it('nothing is sent while photos are added; analyze sends all of them in one request', async () => {
    const t = twoPhotos();
    const scan = t.run();
    assert.equal(scan.state.status, 'preview');
    assert.deepEqual([...scan.state.photos].map(s => s.role), ['product', 'nutrition']);
    assert.equal(t.api.single.length + t.api.many.length, 0);
    scan.analyze(); await t.flush();
    assert.equal(t.api.many.length, 1); assert.equal(t.api.single.length, 0);
    assert.deepEqual([...t.api.many[0].s].map(s => s.photo.uri), ['file:///a.jpg.prepared', 'file:///b.jpg.prepared']);
    assert.equal(t.api.many[0].o.barcode, '4607001771234', 'the barcode from the first photo stays');
    assert.ok(t.deleted.includes('file:///a.jpg.prepared') && t.deleted.includes('file:///b.jpg.prepared'), 'prepared copies are removed');
  });
  it('removing an extra photo keeps the rest and deletes only its file', () => {
    const t = twoPhotos();
    t.run().removePhoto(1);
    const {state} = t.run();
    assert.equal(state.status, 'preview'); assert.equal(state.photos.length, 1);
    assert.equal(state.photos[0].photo.uri, 'file:///a.jpg');
    assert.deepEqual(t.deleted, ['file:///b.jpg']);
  });
  it('removing the first photo promotes the next one', () => {
    const t = twoPhotos();
    t.run().removePhoto(0);
    assert.equal(t.run().state.photo.uri, 'file:///b.jpg');
  });
  it('retake replaces one photo; a single photo restarts the scan as before', () => {
    const t = twoPhotos();
    t.run().retakePhoto(1);
    assert.equal(t.run().state.target.kind, 'replace'); assert.equal(t.run().state.target.index, 1);
    t.run().onPhotoCaptured(photo('c'), null);
    assert.deepEqual([...t.run().state.photos].map(s => s.photo.uri), ['file:///a.jpg', 'file:///c.jpg']);
    const one = setup();
    one.run().onPhotoCaptured(photo('a'), null);
    one.run().retakePhoto(0);
    assert.equal(one.run().state.status, 'capturing'); assert.equal(one.run().state.target, null);
  });
  it('cancelling an extra shot returns to the set', () => {
    const t = twoPhotos();
    t.run().addPhoto('ingredients');
    assert.equal(t.run().state.status, 'capturing');
    t.run().backToPhotos();
    const {state} = t.run();
    assert.equal(state.status, 'preview'); assert.equal(state.photos.length, 2);
  });
  it('a failed extra capture or denied gallery keeps the set and shows a notice', async () => {
    const t = twoPhotos();
    t.run().addPhoto('ingredients');
    t.run().onCaptureFailed();
    let {state} = t.run();
    assert.equal(state.status, 'preview'); assert.equal(state.photos.length, 2);
    assert.equal(state.notice, 'Не удалось сделать снимок');
    t.run().addPhoto('ingredients');
    t.run().pickFromGallery(); await t.flush();
    ({state} = t.run());
    assert.equal(state.status, 'preview'); assert.equal(state.notice, 'Нет доступа к фото');
  });
  it('a failed first capture still opens the error screen', () => {
    const t = setup();
    t.run().onCaptureFailed();
    assert.equal(t.run().state.status, 'error');
    assert.equal(t.run().state.canEditPhotos, false);
  });
  it('after a failed analysis the photos can be edited without resetting the scan', async () => {
    const t = setup({apiFails: true});
    t.run().onPhotoCaptured(photo('a'), null);
    t.run().addPhoto('nutrition');
    t.run().onPhotoCaptured(photo('b'), null);
    t.run().analyze(); await t.flush();
    assert.equal(t.run().state.status, 'error'); assert.equal(t.run().state.canEditPhotos, true);
    t.run().backToPhotos();
    assert.equal(t.run().state.photos.length, 2);
    t.run().removePhoto(1);
    t.run().analyze(); await t.flush();
    assert.equal(t.api.single.length, 1, 'retry with one photo uses the single request');
  });
  it('one photo that fails still has no photo editor', async () => {
    const t = setup({apiFails: true});
    t.run().onPhotoCaptured(photo('a'), null);
    t.run().analyze(); await t.flush();
    assert.equal(t.run().state.canEditPhotos, false);
  });
  it('a fourth photo is not offered', () => {
    const t = twoPhotos();
    t.run().addPhoto('ingredients');
    t.run().onPhotoCaptured(photo('c'), null);
    t.run().addPhoto('ingredients');
    assert.equal(t.run().state.status, 'preview'); assert.equal(t.run().state.photos.length, 3);
  });
  it('reset removes every temporary photo', () => {
    const t = twoPhotos();
    t.run().reset();
    assert.deepEqual(t.deleted, ['file:///a.jpg', 'file:///b.jpg']);
    assert.equal(t.run().state.status, 'capturing'); assert.equal(t.run().state.target, null);
  });
});

describe('scanApi.analyzeMany', () => {
  class FakeFormData { constructor() { this.entries = []; } append(name, value) { this.entries.push([name, value]); } }
  class FakeFile { constructor(uri) { this.uri = uri; } }
  const sent = [];
  const {scanApi} = load('src/features/scan/services/scanApi.ts', {
    'expo-file-system': {File: FakeFile},
    'react-native': {Platform: {OS: 'ios'}},
    '../scanDebug': {scanDebugLog: () => {}},
    '@/shared/api': {apiClient: {postForm: async (url, form, options) => (sent.push({url, form, options}), {})}},
  }, {FormData: FakeFormData});
  it('one request with every file in "images" as File objects and the roles as JSON', async () => {
    await scanApi.analyzeMany([slot('a', 'product'), slot('b', 'nutrition')], {barcode: '4607001771234'});
    assert.equal(sent.length, 1); assert.equal(sent[0].url, '/scan/analyze');
    const entries = sent[0].form.entries;
    assert.deepEqual(entries.filter(([n]) => n === 'images').map(([, v]) => v.uri), ['file:///a.jpg', 'file:///b.jpg']);
    assert.ok(entries.filter(([n]) => n === 'images').every(([, v]) => v instanceof FakeFile), 'never a { uri } object');
    assert.equal(entries.find(([n]) => n === 'roles')[1], '["product","nutrition"]');
    assert.equal(entries.find(([n]) => n === 'barcode')[1], '4607001771234');
    assert.equal(entries.some(([n]) => n === 'image'), false);
  });
});

describe('PhotoPreview', () => {
  function preview(props) {
    const states = new Map();
    let i = 0;
    const react = {useState: init => { const k = i++; if (!states.has(k)) states.set(k, init); return [states.get(k), v => states.set(k, v)]; }};
    const {PhotoPreview} = load('src/features/scan/components/PhotoPreview.tsx', {
      react, 'react/jsx-runtime': jsxRuntime, 'react-native': rn,
      'react-native-safe-area-context': {SafeAreaView: 'SafeAreaView'},
      '@/shared/ui': {...theme, typography: {caption: {}, subtitle: {}},
        Button: ({label, onPress}) => jsx('Pressable', {accessibilityRole: 'button', accessibilityLabel: label, onPress, children: jsx('Text', {children: label})})},
      '../services/scanPhotos': scanPhotos,
      '../scanDebug': {scanDebugLog: () => {}},
    });
    const events = [];
    const handlers = {onAnalyze: () => events.push(['analyze']), onAddPhoto: r => events.push(['add', r]),
      onRetake: i2 => events.push(['retake', i2]), onRemove: i2 => events.push(['remove', i2])};
    const draw = () => { i = 0; return render(jsx(PhotoPreview, {barcode: null, notice: null, ...handlers, ...props})); };
    const press = (tree, label) => all(tree, n => n.props?.accessibilityLabel === label)[0].props.onPress();
    return {draw, press, events};
  }
  it('one photo: Анализировать and Добавить фото, label, retake, no remove', () => {
    const {draw} = preview({photos: [slot('a', 'product')]});
    const tree = draw(), content = text(tree);
    for (const label of ['Анализировать', 'Добавить фото', 'Фото продукта', 'Переснять']) assert.ok(content.includes(label), label);
    assert.equal(all(tree, n => n.props?.accessibilityLabel === 'Убрать: Фото продукта').length, 0);
  });
  it('Добавить фото asks what to shoot and offers only the two options', () => {
    const p = preview({photos: [slot('a', 'product')]});
    p.press(p.draw(), 'Добавить фото');
    const tree = p.draw();
    assert.ok(text(tree).includes('Что сфотографировать дополнительно?'));
    assert.equal(text(tree).includes('Анализировать'), false);
    p.press(tree, 'Таблицу питания');
    assert.deepEqual(p.events, [['add', 'nutrition']]);
    assert.ok(text(p.draw()).includes('Анализировать'), 'the question closes');
  });
  it('the question can be cancelled, and Состав maps to the ingredients role', () => {
    const p = preview({photos: [slot('a', 'product')]});
    p.press(p.draw(), 'Добавить фото');
    p.press(p.draw(), 'Отмена');
    assert.ok(text(p.draw()).includes('Анализировать'));
    p.press(p.draw(), 'Добавить фото');
    p.press(p.draw(), 'Состав');
    assert.deepEqual(p.events, [['add', 'ingredients']]);
  });
  it('each thumbnail has a label and accessible retake and remove', () => {
    const p = preview({photos: [slot('a', 'product'), slot('b', 'nutrition'), slot('c', 'ingredients')]});
    const tree = p.draw(), content = text(tree);
    for (const label of ['Фото продукта', 'Таблица питания', 'Состав']) {
      assert.ok(content.includes(label));
      for (const action of ['Показать', 'Переснять', 'Убрать'])
        assert.equal(all(tree, n => n.props?.accessibilityLabel === `${action}: ${label}`).length, 1, `${action}: ${label}`);
    }
    p.press(tree, 'Убрать: Таблица питания');
    p.press(tree, 'Переснять: Состав');
    assert.deepEqual(p.events, [['remove', 1], ['retake', 2]]);
  });
  it('three photos: no Добавить фото, the limit is stated', () => {
    const {draw} = preview({photos: [slot('a', 'product'), slot('b', 'nutrition'), slot('c', 'ingredients')]});
    const content = text(draw());
    assert.equal(content.includes('Добавить фото'), false);
    assert.match(content, /Максимум\s+3\s+фото/);
  });
  it('tapping a thumbnail shows that photo large, and a removed selection falls back to the first', () => {
    const photos = [slot('a', 'product'), slot('b', 'nutrition')];
    const p = preview({photos});
    p.press(p.draw(), 'Показать: Таблица питания');
    const large = all(p.draw(), n => n.type === 'Image' && n.props.resizeMode === 'contain')[0];
    assert.equal(large.props.source.uri, 'file:///b.jpg');
    assert.equal(large.props.accessibilityLabel, 'Снимок: Таблица питания');
  });
  it('shows the notice', () => {
    assert.ok(text(preview({photos: [slot('a', 'product')], notice: 'Не удалось сделать снимок'}).draw()).includes('Не удалось сделать снимок'));
  });
});

describe('ScanErrorView photo editing', () => {
  const {ScanErrorView} = load('src/features/scan/components/ScanErrorView.tsx', {
    'react/jsx-runtime': jsxRuntime, 'react-native': {...rn, Linking: {}},
    'react-native-safe-area-context': {SafeAreaView: 'SafeAreaView'},
    '@/shared/ui': {...theme, typography: {title: {}, subtitle: {}}, Button: ({label}) => jsx('Text', {children: label})},
    '../scanErrors': {SCAN_FAILURE_MESSAGES: {image_rejected: {title: 'Фото не подошло', description: 'x', retryable: false}}},
  });
  const draw = props => text(render(jsx(ScanErrorView, {code: 'image_rejected', canRetry: true, onRetry: () => {}, onScanAgain: () => {}, ...props})));
  it('offers Изменить фото only when there are photos to edit', () => {
    assert.ok(draw({onEditPhotos: () => {}}).includes('Изменить фото'));
    assert.equal(draw({}).includes('Изменить фото'), false);
  });
});

describe('text from the package', () => {
  const profile = load('src/features/profile/profile.labels.ts');
  const core = require('../../../packages/core/dist/index.js');
  const labels = load('src/features/scan/productLabels.ts', {'@/features/profile': profile, '@foodlens/core': core});
  it('detects non-Russian text and does not flag Russian with digits or E-numbers', () => {
    for (const foreign of ['سكر', 'wheat flour', 'lecithin', '大豆', 'Zucker']) assert.equal(labels.isForeignText(foreign), true, foreign);
    for (const russian of ['сахар', 'Пшеничная мука 45%', 'лецитин (E322)', '']) assert.equal(labels.isForeignText(russian), false, russian);
  });
  it('attribution appears only when the database supplied something', () => {
    const {NOT_DETECTED, observed, fromOpenFoodFacts} = core;
    const facts = {basis: 'per_100g', servingSize: NOT_DETECTED, caloriesKcal: observed(430), proteinG: observed(4.5), carbsG: observed(63), sugarsG: NOT_DETECTED,
      fatG: observed(18), saturatedFatG: NOT_DETECTED, fiberG: NOT_DETECTED, saltG: NOT_DETECTED, sodiumMg: NOT_DETECTED};
    const product = {name: observed('x'), brand: NOT_DETECTED, nutrition: facts, ingredients: NOT_DETECTED, allergens: NOT_DETECTED, additives: NOT_DETECTED};
    assert.equal(labels.usesOpenFoodFacts(product), false);
    assert.equal(labels.usesOpenFoodFacts({...product, nutrition: {...facts, sugarsG: fromOpenFoodFacts(38)}}), true);
    assert.equal(labels.usesOpenFoodFacts({...product, nutrition: {...facts, servingSize: fromOpenFoodFacts({amount: 28, unit: 'g'})}}), true);
    assert.equal(labels.usesOpenFoodFacts({...product, nutrition: null, ingredients: fromOpenFoodFacts([])}), true);
    assert.equal(labels.usesOpenFoodFacts({...product, additives: observed([{code: 'E476', name: null, provenance: 'open_food_facts'}])}), true);
    assert.equal(labels.usesOpenFoodFacts({...product, allergens: observed([{code: 'milk', presence: 'contains', provenance: 'open_food_facts'}])}), true);
  });
  it('additives: a foreign name next to an E-number is dropped, nothing is invented', () => {
    assert.equal(labels.additiveLabel({code: 'E322', name: 'ليسيثين'}), 'E322');
    assert.equal(labels.additiveLabel({code: 'E322', name: 'лецитин'}), 'E322 · лецитин');
    assert.equal(labels.additiveLabel({code: null, name: 'ليسيثين'}), 'ليسيثين');
    assert.equal(labels.additiveLabel({code: 'E330', name: null}), 'E330');
  });
});
