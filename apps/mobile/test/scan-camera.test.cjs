const assert = require('node:assert/strict');
const {describe, it} = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Same approach as goal-match-v4.test.cjs: transpile the real TS/TSX and run it with stubbed imports.
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
const rn = {StyleSheet: {create: x => x, hairlineWidth: 1, absoluteFill: {}}, Text: 'Text', View: 'View', Pressable: 'Pressable',
  ActivityIndicator: 'ActivityIndicator', Linking: {openSettings: () => {}}, useWindowDimensions: () => ({width: 375, height: 667})};

/** Expands function components into plain host nodes. */
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

const detectorModule = load('src/features/scan/barcode/barcodeDetector.ts');
const debugLines = [];
const scanDebug = {scanDebugLog: (event, fields) => debugLines.push({event, fields})};
const guide = load('src/features/scan/scanGuide.ts');

describe('barcodeDetector', () => {
  const {createBarcodeDetector, normalizeProductBarcode, PRODUCT_BARCODE_TYPES} = detectorModule;
  const clock = () => { const c = {t: 1000, now: () => c.t}; return c; };

  it('product 1D types only, no QR', () => {
    assert.deepEqual([...PRODUCT_BARCODE_TYPES], ['ean13', 'ean8', 'upc_a', 'upc_e']);
    assert.equal(PRODUCT_BARCODE_TYPES.includes('qr'), false);
  });

  it('normalizes digits and rejects QR, non-digits and wrong lengths', () => {
    assert.equal(normalizeProductBarcode({type: 'ean13', data: ' 4607001771234 '}), '4607001771234');
    assert.equal(normalizeProductBarcode({type: 'ean8', data: '12345670'}), '12345670');
    assert.equal(normalizeProductBarcode({type: 'upc_a', data: '012345678905'}), '012345678905');
    assert.equal(normalizeProductBarcode({type: 'qr', data: '4607001771234'}), null);
    assert.equal(normalizeProductBarcode({type: 'ean13', data: 'https://example.com'}), null);
    assert.equal(normalizeProductBarcode({type: 'ean13', data: '460700177123'.slice(0, 10)}), null);
    assert.equal(normalizeProductBarcode({type: 'ean13', data: '46070017712345'}), null);
  });

  it('stores the value and ignores the same code for ~3 s', () => {
    const c = clock();
    const d = createBarcodeDetector(c.now);
    assert.equal(d.latest(), null);
    assert.equal(d.accept({type: 'ean13', data: '4607001771234'}), '4607001771234');
    assert.equal(d.latest(), '4607001771234');
    for (let i = 0; i < 50; i++) { c.t += 50; assert.equal(d.accept({type: 'ean13', data: '4607001771234'}), null); }
    c.t += 600;
    assert.equal(d.accept({type: 'ean13', data: '4607001771234'}), '4607001771234', 'reported again after the window');
  });

  it('accepts a different code, but not dozens of times per second', () => {
    const c = clock();
    const d = createBarcodeDetector(c.now);
    d.accept({type: 'ean13', data: '4607001771234'});
    c.t += 100;
    assert.equal(d.accept({type: 'ean8', data: '12345670'}), null, 'throttled');
    c.t += 500;
    assert.equal(d.accept({type: 'ean8', data: '12345670'}), '12345670');
    assert.equal(d.latest(), '12345670');
  });

  it('invalid events do not replace the stored code; stale codes and reset clear it', () => {
    const c = clock();
    const d = createBarcodeDetector(c.now);
    d.accept({type: 'ean13', data: '4607001771234'});
    assert.equal(d.accept({type: 'qr', data: 'hello'}), null);
    assert.equal(d.latest(), '4607001771234');
    c.t += 119_000;
    assert.equal(d.latest(), '4607001771234', 'time to turn the package to the label');
    c.t += 2_000;
    assert.equal(d.latest(), null, 'a code seen long ago is not attached to the photo');
    d.accept({type: 'ean13', data: '4607001771234'});
    d.reset();
    assert.equal(d.latest(), null);
  });
});

describe('barcodeDetector: freshness counts from the last sighting', () => {
  it('a code the camera keeps seeing stays fresh, without new reports', () => {
    const {createBarcodeDetector, MAX_CAPTURE_AGE_MS} = detectorModule;
    let time = 0;
    const detector = createBarcodeDetector(() => time);
    detector.accept({type: 'ean13', data: '4607001771234'});
    time = 2900;
    assert.equal(detector.accept({type: 'ean13', data: '4607001771234'}), null);
    time = 2900 + MAX_CAPTURE_AGE_MS;
    assert.equal(detector.latest(), '4607001771234');
  });
});

describe('barcodeDetector: one code stays one event while the camera keeps seeing it', () => {
  it('dozens of camera frames of the same code report once, and never start a request', () => {
    const {createBarcodeDetector} = detectorModule;
    let time = 0;
    const detector = createBarcodeDetector(() => time);
    const reported = [];
    for (let frame = 0; frame < 60; frame++) {
      const code = detector.accept({type: 'ean13', data: '4607001771234'});
      if (code) reported.push(code);
      time += 30;
    }
    assert.deepEqual(reported, ['4607001771234']);
  });
});

describe('scanApi request builder', () => {
  class FakeFormData { constructor() { this.entries = []; } append(name, value) { this.entries.push([name, value]); } }
  class FakeFile { constructor(uri) { this.uri = uri; } }
  const sent = [];
  const {scanApi} = load('src/features/scan/services/scanApi.ts', {
    'expo-file-system': {File: FakeFile},
    'react-native': {Platform: {OS: 'ios'}},
    '@/shared/api': {apiClient: {postForm: async (url, form, options) => (sent.push({url, form, options}), {})}},
    '../scanDebug': scanDebug,
  }, {FormData: FakeFormData});
  const photo = {uri: 'file:///scan.jpg', width: 1600, height: 1200};
  const fields = () => sent.at(-1).form.entries.map(([name]) => name);

  it('without barcode the image goes with its role', async () => {
    await scanApi.analyze(photo);
    assert.equal(sent.at(-1).url, '/scan/analyze');
    assert.deepEqual(fields(), ['roles', 'image']);
    await scanApi.analyze(photo, {barcode: null});
    assert.deepEqual(fields(), ['roles', 'image']);
    assert.deepEqual(sent.at(-1).form.entries.find(([name]) => name === 'roles'), ['roles', '["product"]']);
  });

  it('with barcode the optional field is added next to the image', async () => {
    await scanApi.analyze(photo, {barcode: '4607001771234'});
    assert.deepEqual(sent.at(-1).form.entries.find(([n]) => n === 'barcode'), ['barcode', '4607001771234']);
    assert.ok(fields().includes('image'));
    assert.deepEqual(JSON.parse(JSON.stringify(debugLines.at(-1))), {event: 'request_barcode', fields: {barcode: '4607001771234', images: 1}});
  });

  it('the label scan sends the mode, the nutrition role and the photo, never a barcode', async () => {
    await scanApi.analyzeLabel(photo);
    assert.deepEqual(fields(), ['mode', 'roles', 'image']);
    assert.deepEqual(sent.at(-1).form.entries.slice(0, 2), [['mode', 'nutrition_label'], ['roles', '["nutrition"]']]);
  });

  it('a scan by barcode alone sends only the barcode', async () => {
    await scanApi.analyzeBarcode('4607001771234');
    assert.deepEqual(fields(), ['barcode']);
    assert.equal(sent.at(-1).url, '/scan/analyze');
  });
});

describe('scanDebugLog', () => {
  const lines = [];
  const logger = {log: (...args) => lines.push(args)};
  it('prints only in development', () => {
    load('src/features/scan/scanDebug.ts', {}, {__DEV__: true, console: logger}).scanDebugLog('preview_barcode', {barcode: '123'});
    assert.deepEqual(lines, [['preview_barcode', '{"barcode":"123"}']]);
    load('src/features/scan/scanDebug.ts', {}, {__DEV__: false, console: logger}).scanDebugLog('preview_barcode', {barcode: '123'});
    load('src/features/scan/scanDebug.ts', {}, {console: logger}).scanDebugLog('preview_barcode', {barcode: '123'});
    assert.equal(lines.length, 1);
  });
});

describe('useProductScan: camera vs gallery barcode', () => {
  // Minimal hook runtime: state slots survive "re-renders" (calls of the hook).
  function harness(hookFile, imports) {
    let slots = [], i = 0;
    const react = {
      useState: init => { const k = i++; if (!(k in slots)) slots[k] = typeof init === 'function' ? init() : init;
        return [slots[k], v => { slots[k] = typeof v === 'function' ? v(slots[k]) : v; }]; },
      useRef: init => { const k = i++; if (!(k in slots)) slots[k] = {current: init}; return slots[k]; },
      useCallback: fn => fn, useEffect: () => {},
    };
    const {useProductScan} = load(hookFile, {react, ...imports});
    return () => { i = 0; return useProductScan(); };
  }
  const calls = [];
  let needsPhotoNext = false;
  const galleryAsset = {uri: 'file:///gallery.jpg', width: 3000, height: 4000};
  const run = harness('src/features/scan/hooks/useProductScan.ts', {
    'expo-image-picker': {
      requestMediaLibraryPermissionsAsync: async () => ({granted: true}),
      launchImageLibraryAsync: async () => ({canceled: false, assets: [galleryAsset]}),
    },
    '../scanDebug': scanDebug,
    '../scanErrors': {toScanFailure: () => ({code: 'backend_unavailable'}), SCAN_FAILURE_MESSAGES: {}},
    '../services/scanApi': {scanApi: {analyze: async (photo, options) => (calls.push({photo, options}),
      needsPhotoNext ? {product: {}, score: {}, goalMatch: {}, needsPhoto: true, barcode: '4011100000000'} : {product: {}, score: {}, goalMatch: {}}),
      analyzeMany: async (many, options) => (calls.push({many, options}), {product: {}, score: {}, goalMatch: {}}), analyzeBarcode: async barcode => (calls.push({barcode}),
      {product: {}, score: {}, goalMatch: {}, needsPhoto: barcode === '4011100000000'})}},
    '../services/scanPhoto': {preparePhoto: async p => p, deleteTemporaryPhoto: () => {}},
    '../services/scanPhotos': load('src/features/scan/services/scanPhotos.ts'),
  });
  const flush = () => new Promise(r => setImmediate(r));
  const photo = {uri: 'file:///camera.jpg', width: 1600, height: 1200};

  it('camera capture with a detected barcode keeps it in the preview state and sends it', async () => {
    let scan = run();
    scan.onPhotoCaptured(photo, '4607001771234');
    scan = run();
    assert.equal(scan.state.status, 'preview');
    assert.equal(scan.state.barcode, '4607001771234');
    scan.analyze(); await flush(); await flush();
    assert.equal(calls.at(-1).options.barcode, '4607001771234');
    assert.equal(run().state.status, 'result');
  });

  it('camera capture without a barcode sends none', async () => {
    let scan = run();
    scan.reset();
    run().onPhotoCaptured(photo, null);
    scan = run();
    assert.equal(scan.state.barcode, null);
    scan.analyze(); await flush(); await flush();
    assert.equal(calls.at(-1).options.barcode, null);
  });

  it('gallery never carries a camera barcode, even right after one was detected', async () => {
    run().reset();
    run().onPhotoCaptured(photo, '4607001771234');
    run().pickFromGallery(); await flush(); await flush();
    const scan = run();
    assert.equal(scan.state.status, 'preview');
    assert.equal(scan.state.photo.uri, galleryAsset.uri);
    assert.equal(scan.state.barcode, null);
    scan.analyze(); await flush(); await flush();
    assert.equal(calls.at(-1).options.barcode, null);
  });

  it('retake of the only photo starts over: the old code is gone, a new one replaces it', async () => {
    run().reset();
    run().onPhotoCaptured(photo, '4607001771234');
    run().retakePhoto(0);
    let scan = run();
    assert.equal(scan.state.status, 'capturing');
    scan.onPhotoCaptured(photo, null);
    assert.equal(run().state.barcode, null);
    run().retakePhoto(0);
    run().onPhotoCaptured(photo, '4011100000000');
    scan = run();
    assert.equal(scan.state.barcode, '4011100000000');
    scan.analyze(); await flush(); await flush();
    assert.equal(calls.at(-1).options.barcode, '4011100000000');
  });

  it('a code seen while adding a photo is kept, even if the shot is cancelled', () => {
    run().reset();
    run().onPhotoCaptured(photo, null);
    run().addPhoto('nutrition');
    assert.equal(run().state.status, 'capturing');
    run().onBarcodeDetected('4607001771234');
    run().backToPhotos();
    assert.equal(run().state.barcode, '4607001771234');
  });

  it('the first shot keeps its code against a later one', () => {
    run().reset();
    run().onPhotoCaptured(photo, '4607001771234');
    run().addPhoto('nutrition');
    run().onBarcodeDetected('4011100000000');
    run().onPhotoCaptured({...photo, uri: 'file:///two.jpg'}, '4011100000000');
    assert.equal(run().state.barcode, '4607001771234');
  });

  it('the first camera does not attach a code before the shot, so the gallery stays clean', async () => {
    run().reset();
    run().onBarcodeDetected('4607001771234');
    run().pickFromGallery(); await flush(); await flush();
    assert.equal(run().state.barcode, null);
  });

  it('barcode only: no photo in the request, the result comes straight back', async () => {
    run().reset();
    run().analyzeBarcode('4607001771234');
    assert.equal(run().state.status, 'analyzing');
    assert.equal(run().state.photo, null);
    await flush(); await flush();
    const {state} = run();
    assert.equal(state.status, 'result');
    assert.equal(state.photo, null); assert.equal(state.needsPhoto, false);
    assert.deepEqual({...calls.at(-1)}, {barcode: '4607001771234'});
  });

  it('barcode-only photo: the result asks for the table, the next photo goes as nutrition with the found code', async () => {
    run().reset();
    needsPhotoNext = true;
    run().onPhotoCaptured(photo, null);
    run().analyze(); await flush(); await flush();
    assert.equal(run().state.needsPhoto, true);
    assert.equal(run().state.barcode, '4011100000000');
    needsPhotoNext = false;
    run().takeNutritionPhoto();
    run().onPhotoCaptured({...photo, uri: 'file:///table.jpg'}, null);
    const scan = run();
    assert.equal(scan.state.barcode, '4011100000000');
    assert.equal(scan.state.photos[0].role, 'nutrition');
    scan.analyze(); await flush(); await flush();
    assert.equal(calls.at(-1).many[0].role, 'nutrition');
    assert.equal(calls.at(-1).options.barcode, '4011100000000');
    assert.equal(run().state.needsPhoto, false);
  });

  it('too little data: the table photo keeps the barcode', async () => {
    run().reset();
    run().analyzeBarcode('4011100000000');
    await flush(); await flush();
    assert.equal(run().state.needsPhoto, true);
    run().takeNutritionPhoto();
    assert.equal(run().state.status, 'capturing');
    run().onPhotoCaptured(photo, null);
    const scan = run();
    assert.equal(scan.state.barcode, '4011100000000');
    scan.analyze(); await flush(); await flush();
    assert.equal(calls.at(-1).options.barcode, '4011100000000');
    assert.equal(run().state.needsPhoto, false);
  });

  it('dev logs follow the code from camera to preview', () => {
    run().reset();
    debugLines.length = 0;
    run().onBarcodeDetected('4607001771234');
    run().onPhotoCaptured(photo, '4607001771234');
    assert.deepEqual(JSON.parse(JSON.stringify(debugLines)), [
      {event: 'camera_barcode_detected', fields: {barcode: '4607001771234', target: 'first'}},
      {event: 'preview_barcode', fields: {barcode: '4607001771234', photos: 1}},
    ]);
  });
});

describe('CameraGuide', () => {
  const {CameraGuide} = load('src/features/scan/components/CameraGuide.tsx', {
    'react/jsx-runtime': jsxRuntime, 'react-native': rn, '@/shared/ui': theme, '../scanGuide': guide,
  });

  it('texts and accessibility labels', () => {
    const {product: productText, label: labelText} = guide.SCAN_GUIDE_TEXT;
    assert.equal(productText.title, 'Наведите на штрихкод');
    assert.equal(labelText.title, 'Наведите на таблицу пищевой ценности');
    assert.equal(guide.SCAN_GUIDE_TEXT.barcodeFound, 'Штрихкод найден');
    const tree = render(jsx(CameraGuide, {screenWidth: 375, screenHeight: 667, barcodeFound: false, mode: 'product'}));
    assert.equal(tree.props.pointerEvents, 'none', 'touches pass through to the camera and buttons');
    const content = text(tree);
    assert.ok(content.includes(productText.title));
    assert.ok(content.includes(productText.hint));
    const frame = all(tree, n => n.props?.accessibilityLabel === productText.frameAccessibilityLabel);
    assert.equal(frame.length, 1);
    assert.equal(all(frame[0], n => n.type === 'View').length, 5, 'frame + 4 corner marks');
  });

  it('the found state hides the hint so the frame stays clean', () => {
    const tree = render(jsx(CameraGuide, {screenWidth: 375, screenHeight: 667, barcodeFound: true, mode: 'product'}));
    assert.equal(text(tree).includes(guide.SCAN_GUIDE_TEXT.product.hint), false);
  });

  it('frame is ~80% wide and fits small iPhones (SE 1st gen and SE 2/3)', () => {
    for (const [w, h] of [[320, 568], [375, 667], [430, 932]]) {
      const size = guide.guideFrameSize(w, h, 'label');
      assert.equal(size.width, Math.round(w * 0.8));
      assert.ok(guide.guideFrameSize(w, h, 'product').height < size.height, 'a barcode frame is wider than tall');
      assert.ok(size.height <= h * 0.42 + 1 && size.height <= size.width, `${w}x${h}: ${JSON.stringify(size)}`);
      assert.ok(size.height >= 180, 'still tall enough for a nutrition table');
    }
  });
});

describe('CameraCapture permission states and camera settings', () => {
  const guideModule = load('src/features/scan/components/CameraGuide.tsx', {
    'react/jsx-runtime': jsxRuntime, 'react-native': rn, '@/shared/ui': theme, '../scanGuide': guide,
  });
  /** Slots keep state between renders, so one instance can be re-rendered after an event. */
  function mount(permission, props = {}) {
    const slots = [];
    let index = 0;
    const react = {
      useState: init => { const k = index++; if (!(k in slots)) slots[k] = typeof init === 'function' ? init() : init;
        return [slots[k], v => { slots[k] = typeof v === 'function' ? v(slots[k]) : v; }]; },
      useRef: init => { const k = index++; if (!(k in slots)) slots[k] = {current: init}; return slots[k]; },
      useEffect: () => {},
    };
    const {CameraCapture} = load('src/features/scan/components/CameraCapture.tsx', {
      'react/jsx-runtime': jsxRuntime, react, 'react-native': rn,
      '@expo/vector-icons/Ionicons': 'Ionicons',
      'expo-camera': {CameraView: 'CameraView', useCameraPermissions: () => [permission, async () => {}]},
      'react-native-safe-area-context': {SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({top: 47, bottom: 34, left: 0, right: 0})},
      '@/shared/ui': {...theme, typography: {}, Button: 'Button', CenteredMessage: 'CenteredMessage'},
      '../barcode/barcodeDetector': detectorModule,
      '../scanErrors': {SCAN_FAILURE_MESSAGES: {camera_permission_denied: {description: 'Доступ к камере запрещён'}}},
      '../scanGuide': guide, './CameraGuide': guideModule, './FocusIndicator': {FocusIndicator: 'FocusIndicator'},
    });
    return () => { index = 0; return render(jsx(CameraCapture, {mode: 'product', onModeChange: () => {}, onCaptured: () => {}, onCaptureFailed: () => {}, onPickFromGallery: () => {}, ...props})); };
  }
  const camera = (permission, props) => mount(permission, props)();
  const granted = {granted: true, canAskAgain: true};
  const cameraView = tree => all(tree, n => n.type === 'CameraView')[0];
  const buttons = tree => all(tree, n => n.type === 'Button').map(n => n.props.label);

  it('permission not resolved yet → loading', () => {
    assert.equal(camera(null).type, 'CenteredMessage');
  });

  it('not granted, can ask → request button and gallery fallback; no camera', () => {
    const tree = camera({granted: false, canAskAgain: true});
    assert.deepEqual(buttons(tree), ['Разрешить доступ к камере', 'Выбрать из галереи']);
    assert.equal(all(tree, n => n.type === 'CameraView').length, 0);
  });

  it('permanently denied → settings button and gallery fallback', () => {
    const tree = camera({granted: false, canAskAgain: false});
    assert.deepEqual(buttons(tree), ['Открыть настройки', 'Выбрать из галереи']);
    assert.ok(text(tree).includes('Доступ к камере запрещён'));
  });

  it('granted → back camera, continuous autofocus, no zoom, product barcodes only, guide overlay', () => {
    const tree = camera({granted: true, canAskAgain: true});
    const [view] = all(tree, n => n.type === 'CameraView');
    assert.equal(view.props.facing, 'back');
    assert.equal(view.props.autofocus, 'off', 'on iOS "off" = continuousAutoFocus; "on" would lock focus once');
    assert.equal(view.props.zoom, 0);
    assert.deepEqual([...view.props.barcodeScannerSettings.barcodeTypes], ['ean13', 'ean8', 'upc_a', 'upc_e']);
    assert.equal(typeof view.props.onBarcodeScanned, 'function');
    assert.ok(text(tree).includes('Наведите на штрихкод'));
    assert.ok(all(tree, n => n.props?.accessibilityLabel === 'Сделать снимок').length === 1);
    assert.ok(all(tree, n => n.props?.accessibilityLabel === 'Выбрать из галереи').length === 1);
  });

  it('all modes are offered and the label mode does not scan barcodes', () => {
    const product = camera(granted);
    assert.deepEqual(all(product, n => n.props?.accessibilityRole === 'tab').map(text), ['Продукт', 'Таблица', 'Еда']);
    assert.deepEqual(all(camera(granted, {modes: ['product', 'label']}), n => n.props?.accessibilityRole === 'tab').map(text), ['Продукт', 'Таблица'], 'mealPhoto flag off');
    const meal = camera(granted, {mode: 'meal'});
    assert.equal(cameraView(meal).props.onBarcodeScanned, undefined, 'the meal mode does not scan barcodes');
    assert.ok(text(meal).includes('Сфотографируйте тарелку'));
    const label = camera(granted, {mode: 'label'});
    assert.equal(cameraView(label).props.onBarcodeScanned, undefined);
    assert.ok(text(label).includes('Наведите на таблицу пищевой ценности'));
    assert.equal(all(camera(granted, {onModeChange: undefined}), n => n.props?.accessibilityRole === 'tab').length, 0, 'extra photo keeps the chosen mode');
  });

  it('a found barcode stops the scanner, shows the state and can be cleared', () => {
    const found = [];
    const render = mount(granted, {onBarcodeDetected: code => found.push(code), onAnalyzeBarcode: () => {}});
    cameraView(render()).props.onBarcodeScanned({type: 'ean13', data: '4607001771234'});
    const tree = render();
    assert.deepEqual(found, ['4607001771234']);
    assert.equal(cameraView(tree).props.onBarcodeScanned, undefined, 'no more scans after a success');
    assert.ok(text(tree).includes('Штрихкод найден'));
    assert.ok(all(tree, n => n.type === 'Button').some(n => n.props.label === 'Анализировать продукт'));
    all(tree, n => text(n) === 'Другой штрихкод' && n.type === 'Pressable')[0].props.onPress();
    assert.equal(typeof cameraView(render()).props.onBarcodeScanned, 'function');
  });

  it('torch is a real camera prop; a tap runs a one-shot focus and returns to continuous autofocus', () => {
    const render = mount(granted);
    all(render(), n => n.props?.accessibilityLabel === 'Фонарик')[0].props.onPress();
    assert.equal(cameraView(render()).props.enableTorch, true);
    const tap = all(render(), n => n.props?.accessibilityLabel === guide.SCAN_GUIDE_TEXT.focusHint)[0];
    tap.props.onPress();
    assert.equal(cameraView(render()).props.autofocus, 'on');
  });
});

describe('useProductScan: label mode', () => {
  const calls = [];
  let slots = [], i = 0;
  const react = {
    useState: init => { const k = i++; if (!(k in slots)) slots[k] = typeof init === 'function' ? init() : init;
      return [slots[k], v => { slots[k] = typeof v === 'function' ? v(slots[k]) : v; }]; },
    useRef: init => { const k = i++; if (!(k in slots)) slots[k] = {current: init}; return slots[k]; },
    useCallback: fn => fn, useEffect: () => {},
  };
  const answer = {product: {}, score: {}, goalMatch: {}};
  const {useProductScan} = load('src/features/scan/hooks/useProductScan.ts', {react,
    'expo-image-picker': {},
    '../scanDebug': scanDebug,
    '../scanErrors': {toScanFailure: () => ({code: 'backend_unavailable'}), SCAN_FAILURE_MESSAGES: {}},
    '../services/scanApi': {scanApi: {analyzeLabel: async photo => (calls.push({label: photo}), answer), analyze: async () => (calls.push({product: true}), answer)}},
    '../services/scanPhoto': {preparePhoto: async p => p, deleteTemporaryPhoto: () => {}},
    '../services/scanPhotos': load('src/features/scan/services/scanPhotos.ts'),
  });
  const run = () => { i = 0; return useProductScan(); };
  const flush = () => new Promise(r => setImmediate(r));
  const photo = {uri: 'file:///table.jpg', width: 1600, height: 1200};

  it('the photo gets the nutrition role, no barcode, and goes through analyzeLabel', async () => {
    run().setMode('label');
    assert.equal(run().mode, 'label');
    run().onPhotoCaptured(photo, '4607001771234');
    const scan = run();
    assert.equal(scan.state.photos[0].role, 'nutrition');
    assert.equal(scan.state.barcode, null);
    scan.analyze(); await flush(); await flush();
    assert.deepEqual(calls, [{label: photo}]);
    assert.equal(run().state.status, 'result');
  });

  it('after a reset the chosen mode stays', () => {
    run().reset();
    assert.equal(run().mode, 'label');
    assert.equal(run().state.status, 'capturing');
  });
});

describe('AnalyzingView stages', () => {
  const {ANALYZING_STAGES, currentStage, STAGE_MS} = load('src/features/scan/components/AnalyzingView.tsx', {
    'react/jsx-runtime': jsxRuntime, react: {}, 'react-native': {...rn, Image: 'Image'}, 'react-native-safe-area-context': {SafeAreaView: 'SafeAreaView'},
    '@/shared/ui': {...theme, typography: {}, Button: 'Button'},
  });

  it('the agreed texts, without technical names', () => {
    assert.deepEqual([...ANALYZING_STAGES.product], ['Распознаём продукт', 'Ищем данные', 'Анализируем состав', 'Рассчитываем оценку']);
    assert.doesNotMatch(Object.values(ANALYZING_STAGES).flat().join(' '), /Gemini|Tavily|Open Food|OFF|AI/);
  });

  it('stages advance by time and the last one waits for the result', () => {
    assert.equal(currentStage(0, 4), 0);
    assert.equal(currentStage(STAGE_MS, 4), 1);
    assert.equal(currentStage(STAGE_MS * 100, 4), 3);
  });
});
