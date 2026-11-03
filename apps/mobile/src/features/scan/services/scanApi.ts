import type { GoalMatchV4, MealPhotoScanResult, ProductScanResult } from '@foodlens/core';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';
import { apiClient } from '@/shared/api';
import { scanDebugLog } from '../scanDebug';
import type { ScanPhoto, ScanSlot } from '../types/scan.types';

/** API может вернуть Goal Match v4 (0–10), если на сервере включён GOAL_MATCH_AI. */
export type ScanResponse = Omit<ProductScanResult, 'goalMatch'> & {
  readonly goalMatch: ProductScanResult['goalMatch'] | GoalMatchV4;
  /** По штрихкоду данных мало: фото таблицы поможет. */
  readonly needsPhoto?: boolean;
  readonly status?: 'needs_nutrition_photo';
  /** Штрихкод с камеры или найденный сервером на фото. */
  readonly barcode?: string;
};

/** С запасом на повторы запроса на сервере. */
const SCAN_TIMEOUT_MS = 150_000;
/** Блюдо: один AI-вызов без поиска по источникам. Сервер ждёт AI до 45 с. */
const MEAL_TIMEOUT_MS = 60_000;

export interface ScanRequestOptions {
  /** Штрихкод с камеры, если найден. Необязательная подсказка серверу: без него скан работает как раньше. */
  readonly barcode?: string | null;
}

async function appendPhoto(form: FormData, field: 'image' | 'images', photo: ScanPhoto): Promise<void> {
  if (Platform.OS === 'web') {
    const blob = await (await fetch(photo.uri)).blob();
    form.append(field, blob, 'scan.jpg');
  } else {
    // Глобальный fetch в Expo SDK 58 — это expo/fetch: он не принимает описание { uri, name, type }
    // и падает ещё до отправки запроса. File из expo-file-system реализует Blob (имя *.jpg, тип image/jpeg).
    form.append(field, new File(photo.uri));
  }
}

function appendBarcode(form: FormData, options: ScanRequestOptions, images: number): void {
  if (options.barcode) form.append('barcode', options.barcode);
  scanDebugLog('request_barcode', { barcode: options.barcode ?? null, images });
}

async function photoFormData(photo: ScanPhoto, options: ScanRequestOptions): Promise<FormData> {
  const form = new FormData();
  appendBarcode(form, options, 1);
  // Роль нужна серверу: общий снимок со штрихкодом в AI не идёт.
  form.append('roles', JSON.stringify(['product']));
  await appendPhoto(form, 'image', photo);
  return form;
}

async function photosFormData(slots: readonly ScanSlot[], options: ScanRequestOptions): Promise<FormData> {
  const form = new FormData();
  appendBarcode(form, options, slots.length);
  form.append('roles', JSON.stringify(slots.map((slot) => slot.role)));
  for (const slot of slots) await appendPhoto(form, 'images', slot.photo);
  return form;
}

/** Фото уходит только на backend FoodLens. Ключ AI-сервиса в приложении отсутствует. */
export const scanApi = {
  /** Только штрихкод, без фото: сервер ищет продукт по источникам. */
  analyzeBarcode: async (barcode: string): Promise<ScanResponse> => {
    const form = new FormData();
    appendBarcode(form, { barcode }, 0);
    return apiClient.postForm<ScanResponse>('/scan/analyze', form, { timeoutMs: SCAN_TIMEOUT_MS });
  },
  analyze: async (photo: ScanPhoto, options: ScanRequestOptions = {}): Promise<ScanResponse> =>
    apiClient.postForm<ScanResponse>('/scan/analyze', await photoFormData(photo, options), { timeoutMs: SCAN_TIMEOUT_MS }),
  /** Фото таблицы пищевой ценности: без штрихкода, отдельный сценарий на сервере. */
  analyzeLabel: async (photo: ScanPhoto): Promise<ScanResponse> => {
    const form = new FormData();
    form.append('mode', 'nutrition_label');
    form.append('roles', JSON.stringify(['nutrition']));
    await appendPhoto(form, 'image', photo);
    return apiClient.postForm<ScanResponse>('/scan/analyze', form, { timeoutMs: SCAN_TIMEOUT_MS });
  },
  /** Фото готового блюда: отдельный endpoint, ответ без Product Score. */
  analyzeMeal: async (photo: ScanPhoto): Promise<MealPhotoScanResult> => {
    const form = new FormData();
    await appendPhoto(form, 'image', photo);
    return apiClient.postForm<MealPhotoScanResult>('/scan/meal', form, { timeoutMs: MEAL_TIMEOUT_MS });
  },
  /** 2–3 фото одного продукта: один запрос, все файлы в нём. */
  analyzeMany: async (slots: readonly ScanSlot[], options: ScanRequestOptions = {}): Promise<ScanResponse> =>
    apiClient.postForm<ScanResponse>('/scan/analyze', await photosFormData(slots, options), { timeoutMs: SCAN_TIMEOUT_MS }),
};
