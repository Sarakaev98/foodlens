import { ApiError } from '@/shared/api';

/** Ошибки сценария сканирования: локальные (камера, галерея, сеть) и коды сервера. */
export type ScanFailureCode =
  | 'camera_permission_denied'
  | 'library_permission_denied'
  | 'capture_failed'
  | 'no_image'
  | 'network_unavailable'
  | 'request_timeout'
  | 'backend_unavailable'
  | 'image_rejected'
  | 'ai_not_configured'
  | 'ai_busy'
  | 'ai_timeout'
  | 'ai_unavailable'
  | 'product_not_recognized'
  | 'label_not_readable';

export class ScanFailure extends Error {
  constructor(readonly code: ScanFailureCode) {
    super(code);
    this.name = 'ScanFailure';
  }
}

export interface ScanFailureMessage {
  readonly title: string;
  readonly description: string;
  /** Есть ли смысл повторять анализ того же фото. */
  readonly retryable: boolean;
}

export const SCAN_FAILURE_MESSAGES: Readonly<Record<ScanFailureCode, ScanFailureMessage>> = {
  camera_permission_denied: {
    title: 'Нет доступа к камере',
    description: 'Разрешите FoodLens доступ к камере в настройках или выберите фото из галереи.',
    retryable: false,
  },
  library_permission_denied: {
    title: 'Нет доступа к фото',
    description: 'Разрешите FoodLens доступ к фотографиям в настройках или сделайте снимок камерой.',
    retryable: false,
  },
  capture_failed: { title: 'Не удалось сделать снимок', description: 'Попробуйте ещё раз.', retryable: false },
  no_image: { title: 'Фото не выбрано', description: 'Сделайте снимок или выберите фото из галереи.', retryable: false },
  network_unavailable: {
    title: 'Нет связи с сервером',
    description: 'Проверьте подключение к интернету и попробуйте ещё раз.',
    retryable: true,
  },
  request_timeout: {
    title: 'Сервер долго не отвечает',
    description: 'Анализ занял слишком много времени. Попробуйте ещё раз.',
    retryable: true,
  },
  backend_unavailable: {
    title: 'Сервис временно недоступен',
    description: 'Попробуйте ещё раз чуть позже.',
    retryable: true,
  },
  image_rejected: {
    title: 'Фото не подошло',
    description: 'Не удалось прочитать изображение. Сделайте новый снимок.',
    retryable: false,
  },
  ai_not_configured: {
    title: 'Анализ временно недоступен',
    description: 'Попробуйте ещё раз чуть позже.',
    retryable: true,
  },
  ai_busy: {
    title: 'Слишком много запросов',
    description: 'Подождите немного и попробуйте ещё раз.',
    retryable: true,
  },
  ai_timeout: {
    title: 'Анализ занял слишком много времени',
    description: 'Попробуйте ещё раз.',
    retryable: true,
  },
  ai_unavailable: {
    title: 'Анализ временно недоступен',
    description: 'Не удалось получить результат. Попробуйте позже.',
    retryable: true,
  },
  product_not_recognized: {
    title: 'Продукт не распознан',
    description: 'Сфотографируйте упаковку ближе, ровно и при хорошем освещении, чтобы текст был читаемым.',
    retryable: false,
  },
  label_not_readable: {
    title: 'Таблица не читается',
    description: 'Сфотографируйте таблицу пищевой ценности ближе, ровно и при хорошем освещении.',
    retryable: false,
  },
};

const SERVER_CODES: Readonly<Record<string, ScanFailureCode>> = {
  IMAGE_MISSING: 'image_rejected',
  TOO_MANY_IMAGES: 'image_rejected',
  IMAGE_UNSUPPORTED_TYPE: 'image_rejected',
  IMAGE_TOO_LARGE: 'image_rejected',
  IMAGE_INVALID: 'image_rejected',
  AI_NOT_CONFIGURED: 'ai_not_configured',
  AI_RATE_LIMITED: 'ai_busy',
  AI_TIMEOUT: 'ai_timeout',
  AI_AUTH_FAILED: 'ai_unavailable',
  AI_QUOTA_EXCEEDED: 'ai_unavailable',
  AI_UNAVAILABLE: 'ai_unavailable',
  AI_BAD_RESPONSE: 'ai_unavailable',
  PRODUCT_NOT_RECOGNIZED: 'product_not_recognized',
  NUTRITION_TABLE_NOT_FOUND: 'label_not_readable',
};

/** Переводит ответ API в ошибку сценария. Технические детали пользователю не показываются. */
export function toScanFailure(error: unknown): ScanFailure {
  if (error instanceof ScanFailure) return error;
  if (error instanceof ApiError) {
    if (error.status === 0) return new ScanFailure(error.timedOut ? 'request_timeout' : 'network_unavailable');
    const code = (error.body as { code?: unknown } | null)?.code;
    if (typeof code === 'string' && SERVER_CODES[code]) return new ScanFailure(SERVER_CODES[code]);
  }
  return new ScanFailure('backend_unavailable');
}
