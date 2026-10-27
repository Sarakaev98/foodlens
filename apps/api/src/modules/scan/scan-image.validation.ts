import type { ImageInput } from '@foodlens/ai';
import { ScanError } from './scan-error';

export const SCAN_IMAGE_FIELD = 'image';
/** С запасом для фото с iPhone; mobile уменьшает снимок до ~1600 px, это обычно 0.3–1 МБ. */
export const SCAN_MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export const SCAN_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const satisfies readonly ImageInput['mimeType'][];

/** Только поля загруженного файла, которые нужны проверке (подмножество Express.Multer.File). */
export interface UploadedImage {
  readonly mimetype: string;
  readonly size: number;
  readonly buffer: Buffer;
}

/**
 * Проверяет загруженный файл и возвращает его в формате провайдера.
 * Тип определяется по сигнатуре файла: заявленному клиентом MIME одному не доверяем.
 */
export function validateScanImage(file: UploadedImage | undefined, maxBytes = SCAN_MAX_IMAGE_BYTES): ImageInput {
  if (!file || file.size === 0) {
    throw new ScanError('IMAGE_MISSING', 400, `Attach a photo in the "${SCAN_IMAGE_FIELD}" field`);
  }
  const declared = file.mimetype.toLowerCase();
  if (!isSupportedMimeType(declared)) {
    throw new ScanError('IMAGE_UNSUPPORTED_TYPE', 415, 'Only JPEG, PNG and WebP images are supported');
  }
  if (file.size > maxBytes) {
    throw new ScanError('IMAGE_TOO_LARGE', 413, `The image must be smaller than ${Math.round(maxBytes / 1024 / 1024)} MB`);
  }
  if (detectImageType(file.buffer) !== declared) {
    throw new ScanError('IMAGE_INVALID', 400, 'The file is not a valid image');
  }
  return { mimeType: declared, base64: file.buffer.toString('base64') };
}

function isSupportedMimeType(value: string): value is ImageInput['mimeType'] {
  return (SCAN_IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

export function detectImageType(buffer: Buffer): ImageInput['mimeType'] | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}
