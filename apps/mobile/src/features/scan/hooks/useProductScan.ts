import type { Product } from '@foodlens/core';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toScanFailure, type ScanFailureCode } from '../scanErrors';
import { scanApi } from '../services/scanApi';
import { deleteTemporaryPhoto, preparePhoto } from '../services/scanPhoto';
import type { ScanPhoto } from '../types/scan.types';

export type AnalyzingStage = 'preparing' | 'analyzing';

export type ProductScanState =
  | { readonly status: 'capturing' }
  | { readonly status: 'preview'; readonly photo: ScanPhoto }
  | { readonly status: 'analyzing'; readonly photo: ScanPhoto; readonly stage: AnalyzingStage }
  | { readonly status: 'result'; readonly photo: ScanPhoto; readonly product: Product }
  | { readonly status: 'error'; readonly code: ScanFailureCode; readonly photo: ScanPhoto | null };

/**
 * Сценарий сканирования: снимок или фото из галереи → предпросмотр → анализ на сервере → результат.
 * Экран только отображает состояние и вызывает действия.
 */
export function useProductScan() {
  const [state, setState] = useState<ProductScanState>({ status: 'capturing' });
  // Номер текущего анализа: ответ на отменённый запрос (пользователь нажал «Переснять») игнорируется.
  const runId = useRef(0);
  const photoRef = useRef<ScanPhoto | null>(null);

  const showPhoto = useCallback((photo: ScanPhoto) => {
    deleteTemporaryPhoto(photoRef.current?.uri);
    photoRef.current = photo;
    setState({ status: 'preview', photo });
  }, []);

  const fail = useCallback((code: ScanFailureCode) => {
    setState({ status: 'error', code, photo: photoRef.current });
  }, []);

  const pickFromGallery = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return fail('library_permission_denied');

    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, exif: false });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset) return fail('no_image');
    showPhoto({ uri: asset.uri, width: asset.width, height: asset.height });
  }, [fail, showPhoto]);

  const analyze = useCallback(async () => {
    const photo = photoRef.current;
    if (!photo) return fail('no_image');
    const id = ++runId.current;
    const isCurrent = () => id === runId.current;

    let prepared: ScanPhoto | null = null;
    try {
      setState({ status: 'analyzing', photo, stage: 'preparing' });
      prepared = await preparePhoto(photo);
      if (!isCurrent()) return;
      setState({ status: 'analyzing', photo, stage: 'analyzing' });
      const product = await scanApi.analyze(prepared);
      if (isCurrent()) setState({ status: 'result', photo, product });
    } catch (error) {
      if (isCurrent()) fail(toScanFailure(error).code);
    } finally {
      deleteTemporaryPhoto(prepared?.uri);
    }
  }, [fail]);

  const reset = useCallback(() => {
    runId.current++;
    deleteTemporaryPhoto(photoRef.current?.uri);
    photoRef.current = null;
    setState({ status: 'capturing' });
  }, []);

  // Уход со страницы: временное фото не должно остаться в кэше.
  useEffect(() => () => deleteTemporaryPhoto(photoRef.current?.uri), []);

  return {
    state,
    onPhotoCaptured: showPhoto,
    onCaptureFailed: () => fail('capture_failed'),
    pickFromGallery: () => void pickFromGallery().catch(() => fail('no_image')),
    analyze: () => void analyze(),
    reset,
  };
}
