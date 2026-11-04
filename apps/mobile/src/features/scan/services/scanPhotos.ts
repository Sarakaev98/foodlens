import type { ScanPhoto, ScanPhotoRole, ScanSlot } from '../types/scan.types';

/** Фото одного продукта на один анализ. Сервер проверяет то же ограничение. */
export const MAX_SCAN_PHOTOS = 3;

export const SCAN_PHOTO_LABELS: Readonly<Record<ScanPhotoRole, string>> = {
  product: 'Product photo',
  nutrition: 'Nutrition label',
  ingredients: 'Ingredients',
};

/** Что можно доснять к первому фото. */
export const EXTRA_PHOTO_OPTIONS: readonly { readonly role: ScanPhotoRole; readonly label: string }[] = [
  { role: 'nutrition', label: 'Nutrition Label' },
  { role: 'ingredients', label: 'Ingredients' },
];

export function addScanPhoto(slots: readonly ScanSlot[], photo: ScanPhoto, role: ScanPhotoRole): readonly ScanSlot[] {
  return slots.length >= MAX_SCAN_PHOTOS ? slots : [...slots, { photo, role }];
}

/** Пересъёмка: новое фото встаёт на место старого с той же подписью. */
export function replaceScanPhoto(slots: readonly ScanSlot[], index: number, photo: ScanPhoto): readonly ScanSlot[] {
  return slots.map((slot, i) => (i === index ? { ...slot, photo } : slot));
}

export function removeScanPhoto(slots: readonly ScanSlot[], index: number): readonly ScanSlot[] {
  return slots.filter((_, i) => i !== index);
}

/** Временные файлы, которые больше не нужны после изменения набора. */
export function removedPhotoUris(before: readonly ScanSlot[], after: readonly ScanSlot[]): readonly string[] {
  const kept = new Set(after.map((slot) => slot.photo.uri));
  return before.map((slot) => slot.photo.uri).filter((uri) => !kept.has(uri));
}
