import { MAX_PRODUCT_IMAGES, PRODUCT_IMAGE_ROLES, type ImageInput, type ProductImageInput, type ProductImageRole } from '@foodlens/ai';
import { ScanError } from './scan-error';

export const SCAN_IMAGE_FIELD = 'image';
export const SCAN_IMAGES_FIELD = 'images';
export const SCAN_ROLES_FIELD = 'roles';
export const SCAN_MAX_IMAGES = MAX_PRODUCT_IMAGES;
/** С запасом для фото с iPhone; mobile уменьшает снимок до ~1600 px, это обычно 0.3–1 МБ. */
export const SCAN_MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** На все фото запроса: в base64 это около 18.7 МБ, запрос к Gemini с inline-данными ограничен 20 МБ. */
export const SCAN_MAX_TOTAL_IMAGE_BYTES = 14 * 1000 * 1000;

export const SCAN_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const satisfies readonly ImageInput['mimeType'][];

/** Только поля загруженного файла, которые нужны проверке (подмножество Express.Multer.File). */
export interface UploadedImage {
  readonly mimetype: string;
  readonly size: number;
  readonly buffer: Buffer;
  /** Поле multipart. Есть у файлов, пришедших через multer. */
  readonly fieldname?: string;
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

/** Проверяет весь набор. Каждый файл проходит те же проверки, что и одиночное фото. */
export function validateScanImages(files: readonly UploadedImage[], roles: readonly (ProductImageRole | undefined)[] = []): ProductImageInput[] {
  if (files.length > SCAN_MAX_IMAGES) throw new ScanError('TOO_MANY_IMAGES', 400, `Send at most ${SCAN_MAX_IMAGES} photos`);
  if (files.length === 0) return [validateScanImage(undefined)];
  if (files.reduce((sum, file) => sum + file.size, 0) > SCAN_MAX_TOTAL_IMAGE_BYTES) {
    throw new ScanError('IMAGE_TOO_LARGE', 413, `All photos together must be smaller than ${SCAN_MAX_TOTAL_IMAGE_BYTES / 1000 / 1000} MB`);
  }
  return files.map((file, index) => {
    const role = roles[index];
    return role ? { ...validateScanImage(file), role } : validateScanImage(file);
  });
}

/** Поле roles: один JSON-массив или по значению на фото. Неизвестная роль становится undefined и скан не роняет. */
export function parseScanRoles(raw: unknown, count: number): (ProductImageRole | undefined)[] {
  const list = rolesList(raw);
  return Array.from({ length: count }, (_, index) => {
    const role = list[index];
    return (PRODUCT_IMAGE_ROLES as readonly unknown[]).includes(role) ? (role as ProductImageRole) : undefined;
  });
}

function rolesList(raw: unknown): readonly unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return [];
  if (!raw.trim().startsWith('[')) return [raw];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Файлы из полей image и images (сначала image) и роли к ним. Без поля images роли относятся к image, иначе только к images. */
export function collectScanUploads(files: readonly UploadedImage[] | undefined, rawRoles: unknown) {
  const legacy = (files ?? []).filter((file) => file.fieldname === SCAN_IMAGE_FIELD);
  const images = (files ?? []).filter((file) => file.fieldname === SCAN_IMAGES_FIELD);
  if (images.length === 0) return { files: legacy, roles: parseScanRoles(rawRoles, legacy.length) };
  return { files: [...legacy, ...images], roles: [...legacy.map(() => undefined), ...parseScanRoles(rawRoles, images.length)] };
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
