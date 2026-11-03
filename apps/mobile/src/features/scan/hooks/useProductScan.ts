import type { MealPhotoEstimate, Product, ProductScore } from '@foodlens/core';
import type { AnyGoalMatch } from '@/features/goal-match';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useRef, useState } from 'react';
import { scanDebugLog } from '../scanDebug';
import { SCAN_FAILURE_MESSAGES, toScanFailure, type ScanFailureCode } from '../scanErrors';
import { scanApi } from '../services/scanApi';
import { deleteTemporaryPhoto, preparePhoto } from '../services/scanPhoto';
import { addScanPhoto, MAX_SCAN_PHOTOS, removedPhotoUris, removeScanPhoto, replaceScanPhoto } from '../services/scanPhotos';
import type { ScanMode, ScanPhoto, ScanPhotoRole, ScanSlot } from '../types/scan.types';

/** Куда попадёт следующий снимок: новое дополнительное фото или замена существующего. */
export type ScanCaptureTarget = { readonly kind: 'add'; readonly role: ScanPhotoRole } | { readonly kind: 'replace'; readonly index: number };

export type ProductScanState =
  /** target: null на первом снимке. */
  | { readonly status: 'capturing'; readonly target: ScanCaptureTarget | null }
  /**
   * photo: первое фото набора. barcode: штрихкод, замеченный камерой (у фото из галереи всегда null).
   * notice: короткое сообщение, если дополнительный снимок не получился, а набор сохранён.
   */
  | {
      readonly status: 'preview';
      readonly photo: ScanPhoto;
      readonly photos: readonly ScanSlot[];
      readonly barcode: string | null;
      readonly notice: string | null;
    }
  /** photo: null при анализе только по штрихкоду. */
  | { readonly status: 'analyzing'; readonly photo: ScanPhoto | null }
  | {
      readonly status: 'result';
      readonly photo: ScanPhoto | null;
      readonly product: Product;
      readonly score: ProductScore;
      readonly goalMatch: AnyGoalMatch;
      /** По штрихкоду данных мало: стоит предложить снять таблицу. */
      readonly needsPhoto: boolean;
      readonly barcode: string | null;
    }
  /** Фото блюда: приблизительные калории и БЖУ, без Product Score. */
  | { readonly status: 'meal_result'; readonly photo: ScanPhoto; readonly estimate: MealPhotoEstimate }
  /** canEditPhotos: фото несколько, можно убрать неудачное и повторить, не начиная заново. */
  | { readonly status: 'error'; readonly code: ScanFailureCode; readonly photo: ScanPhoto | null; readonly canEditPhotos: boolean };

/**
 * Сценарий сканирования: снимок или фото из галереи → предпросмотр (можно доснять ещё два) → анализ на сервере → результат.
 * До «Анализировать» ничего не отправляется, затем весь набор уходит одним запросом.
 * Экран только отображает состояние и вызывает действия.
 */
export function useProductScan() {
  const [state, setState] = useState<ProductScanState>({ status: 'capturing', target: null });
  const [mode, setModeState] = useState<ScanMode>('product');
  const modeRef = useRef<ScanMode>('product');
  // Номер текущего анализа: ответ на отменённый запрос (пользователь нажал «Переснять») игнорируется.
  const runId = useRef(0);
  const photosRef = useRef<readonly ScanSlot[]>([]);
  const targetRef = useRef<ScanCaptureTarget | null>(null);
  const barcodeRef = useRef<string | null>(null);
  // Код уже отправленного скана: фото снимается для того же продукта, а новая камера кода ещё не видела.
  const keptBarcodeRef = useRef<string | null>(null);
  // Снимок по просьбе сервера: это таблица, а не общий снимок.
  const nextRoleRef = useRef<ScanPhotoRole>('product');

  const showPhotos = useCallback((next: readonly ScanSlot[], notice: string | null = null) => {
    removedPhotoUris(photosRef.current, next).forEach(deleteTemporaryPhoto);
    photosRef.current = next;
    targetRef.current = null;
    scanDebugLog('preview_barcode', { barcode: barcodeRef.current, photos: next.length });
    setState({ status: 'preview', photo: next[0]!.photo, photos: next, barcode: barcodeRef.current, notice });
  }, []);

  const showPhoto = useCallback(
    (photo: ScanPhoto, barcode: string | null) => {
      const target = targetRef.current;
      if (!target) {
        if (modeRef.current === 'label') return showPhotos([{ photo, role: 'nutrition' }]);
        if (modeRef.current === 'meal') {
          barcodeRef.current = null;
          return showPhotos([{ photo, role: 'product' }]);
        }
        barcodeRef.current = barcode ?? keptBarcodeRef.current;
        const role = nextRoleRef.current;
        nextRoleRef.current = 'product';
        return showPhotos([{ photo, role }]);
      }
      barcodeRef.current = barcodeRef.current ?? barcode;
      showPhotos(target.kind === 'add' ? addScanPhoto(photosRef.current, photo, target.role) : replaceScanPhoto(photosRef.current, target.index, photo));
    },
    [showPhotos],
  );

  /** Съёмка доп. фото: камера открыта заново, поэтому код сохраняется сразу и переживает «Отмену». Код из набора главнее. */
  const onBarcodeDetected = useCallback((code: string) => {
    scanDebugLog('camera_barcode_detected', { barcode: code, target: targetRef.current?.kind ?? 'first' });
    if (targetRef.current) barcodeRef.current = barcodeRef.current ?? code;
  }, []);

  const fail = useCallback((code: ScanFailureCode) => {
    const photos = photosRef.current;
    setState({ status: 'error', code, photo: photos[0]?.photo ?? null, canEditPhotos: photos.length > 1 });
  }, []);

  /** Неудачный дополнительный снимок не должен сбрасывать уже снятые фото. */
  const failPicking = useCallback(
    (code: ScanFailureCode) => {
      if (targetRef.current && photosRef.current.length > 0) showPhotos(photosRef.current, SCAN_FAILURE_MESSAGES[code].title);
      else fail(code);
    },
    [fail, showPhotos],
  );

  const pickFromGallery = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return failPicking('library_permission_denied');

    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, exif: false });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset) return failPicking('no_image');
    showPhoto({ uri: asset.uri, width: asset.width, height: asset.height }, null);
  }, [failPicking, showPhoto]);

  const analyze = useCallback(async () => {
    const photos = photosRef.current;
    const photo = photos[0]?.photo;
    if (!photo) return fail('no_image');
    const id = ++runId.current;
    const isCurrent = () => id === runId.current;

    const prepared: ScanSlot[] = [];
    try {
      setState({ status: 'analyzing', photo });
      for (const slot of photos) {
        prepared.push({ ...slot, photo: await preparePhoto(slot.photo) });
        if (!isCurrent()) return;
      }
      if (modeRef.current === 'meal') {
        const { estimate } = await scanApi.analyzeMeal(prepared[0]!.photo);
        if (isCurrent()) setState({ status: 'meal_result', photo, estimate });
        return;
      }
      const options = { barcode: barcodeRef.current };
      const { product, score, goalMatch, barcode, needsPhoto } = modeRef.current === 'label'
        ? await scanApi.analyzeLabel(prepared[0]!.photo)
        : prepared.length === 1 && prepared[0]!.role === 'product'
          ? await scanApi.analyze(prepared[0]!.photo, options)
          : await scanApi.analyzeMany(prepared, options);
      keptBarcodeRef.current = barcode ?? keptBarcodeRef.current;
      if (isCurrent()) setState({ status: 'result', photo, product, score, goalMatch, needsPhoto: needsPhoto === true, barcode: barcode ?? null });
    } catch (error) {
      if (isCurrent()) fail(toScanFailure(error).code);
    } finally {
      prepared.forEach((slot) => deleteTemporaryPhoto(slot.photo.uri));
    }
  }, [fail]);

  /** Скан без фото. Если данных мало, результат предложит снять таблицу, штрихкод сохраняется. */
  const analyzeBarcode = useCallback(async (barcode: string) => {
    const id = ++runId.current;
    keptBarcodeRef.current = barcode;
    setState({ status: 'analyzing', photo: null });
    try {
      const { product, score, goalMatch, needsPhoto } = await scanApi.analyzeBarcode(barcode);
      if (id === runId.current) setState({ status: 'result', photo: null, product, score, goalMatch, needsPhoto: needsPhoto === true, barcode });
    } catch (error) {
      if (id === runId.current) fail(toScanFailure(error).code);
    }
  }, [fail]);

  const takeNutritionPhoto = useCallback(() => {
    runId.current++;
    targetRef.current = null;
    nextRoleRef.current = 'nutrition';
    setState({ status: 'capturing', target: null });
  }, []);

  const reset = useCallback(() => {
    runId.current++;
    photosRef.current.forEach((slot) => deleteTemporaryPhoto(slot.photo.uri));
    photosRef.current = [];
    targetRef.current = null;
    barcodeRef.current = null;
    keptBarcodeRef.current = null;
    nextRoleRef.current = 'product';
    setState({ status: 'capturing', target: null });
  }, []);

  /** Переключатель режима на камере. Режим сохраняется и для следующего скана. */
  const setMode = useCallback((next: ScanMode) => {
    modeRef.current = next;
    setModeState(next);
  }, []);

  const capture = useCallback((target: ScanCaptureTarget) => {
    targetRef.current = target;
    setState({ status: 'capturing', target });
  }, []);

  const addPhoto = useCallback(
    (role: ScanPhotoRole) => {
      if (photosRef.current.length < MAX_SCAN_PHOTOS) capture({ kind: 'add', role });
    },
    [capture],
  );

  /** Единственное фото пересъёмка заменяет целиком, как начало нового скана. */
  const retakePhoto = useCallback(
    (index: number) => {
      if (photosRef.current.length === 1) reset();
      else capture({ kind: 'replace', index });
    },
    [capture, reset],
  );

  const removePhoto = useCallback(
    (index: number) => {
      const next = removeScanPhoto(photosRef.current, index);
      if (next.length === 0) reset();
      else showPhotos(next);
    },
    [reset, showPhotos],
  );

  // Уход со страницы: временные фото не должны остаться в кэше.
  useEffect(() => () => photosRef.current.forEach((slot) => deleteTemporaryPhoto(slot.photo.uri)), []);

  return {
    state,
    mode,
    setMode,
    onPhotoCaptured: showPhoto,
    onBarcodeDetected,
    onCaptureFailed: () => failPicking('capture_failed'),
    pickFromGallery: () => void pickFromGallery().catch(() => failPicking('no_image')),
    analyze: () => void analyze(),
    analyzeBarcode: (barcode: string) => void analyzeBarcode(barcode),
    takeNutritionPhoto,
    addPhoto,
    retakePhoto,
    removePhoto,
    /** Назад к набору: с камеры без снимка или с экрана ошибки. */
    backToPhotos: () => showPhotos(photosRef.current),
    reset,
  };
}
