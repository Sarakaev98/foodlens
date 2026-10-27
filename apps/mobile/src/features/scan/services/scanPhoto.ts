import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Platform } from 'react-native';
import type { ScanPhoto } from '../types/scan.types';

/** Длинная сторона после уменьшения: мелкий текст этикетки остаётся читаемым, файл ~0.3–1 МБ. */
const MAX_SIDE_PX = 1600;
const JPEG_QUALITY = 0.8;

/**
 * Уменьшает снимок и пересохраняет в JPEG. Заодно убираются EXIF (в том числе геолокация)
 * и HEIC из галереи iPhone становится JPEG, который принимает сервер.
 */
export async function preparePhoto(source: { uri: string; width: number; height: number }): Promise<ScanPhoto> {
  const context = ImageManipulator.manipulate(source.uri);
  const longSide = Math.max(source.width, source.height);
  if (longSide > MAX_SIDE_PX) {
    context.resize(source.width >= source.height ? { width: MAX_SIDE_PX } : { height: MAX_SIDE_PX });
  }
  const image = await context.renderAsync();
  const result = await image.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY });
  return { uri: result.uri, width: result.width, height: result.height };
}

/** Фото не хранятся: временные файлы удаляются, как только они больше не нужны. */
export function deleteTemporaryPhoto(uri: string | undefined): void {
  if (!uri || Platform.OS === 'web') return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Файл в кэше приложения: если удалить не вышло, его всё равно уберёт система.
  }
}
