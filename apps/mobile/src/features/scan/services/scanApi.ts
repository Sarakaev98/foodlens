import type { Product } from '@foodlens/core';
import { Platform } from 'react-native';
import { apiClient } from '@/shared/api';
import type { ScanPhoto } from '../types/scan.types';

/** С запасом на повторы запроса к Meta на сервере. */
const SCAN_TIMEOUT_MS = 150_000;

async function photoFormData(photo: ScanPhoto): Promise<FormData> {
  const form = new FormData();
  if (Platform.OS === 'web') {
    const blob = await (await fetch(photo.uri)).blob();
    form.append('image', blob, 'scan.jpg');
  } else {
    // В React Native файл передаётся описанием { uri, name, type }, а не Blob.
    form.append('image', { uri: photo.uri, name: 'scan.jpg', type: 'image/jpeg' } as unknown as Blob);
  }
  return form;
}

/** Фото уходит только на backend FoodLens. Ключ AI-сервиса в приложении отсутствует. */
export const scanApi = {
  analyze: async (photo: ScanPhoto): Promise<Product> =>
    apiClient.postForm<Product>('/scan/analyze', await photoFormData(photo), { timeoutMs: SCAN_TIMEOUT_MS }),
};
