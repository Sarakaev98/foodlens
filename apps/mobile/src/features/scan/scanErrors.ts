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
  | 'label_not_readable'
  | 'meal_not_recognized';

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
    title: 'No Camera Access',
    description: 'Allow FoodLens to access the camera in Settings, or choose a photo from your library.',
    retryable: false,
  },
  library_permission_denied: {
    title: 'No Photo Access',
    description: 'Allow FoodLens to access your photos in Settings, or take a photo with the camera.',
    retryable: false,
  },
  capture_failed: { title: 'Couldn’t Take Photo', description: 'Please try again.', retryable: false },
  no_image: { title: 'No Photo Selected', description: 'Take a photo or choose one from your library.', retryable: false },
  network_unavailable: {
    title: 'Can’t Reach Server',
    description: 'Check your internet connection and try again.',
    retryable: true,
  },
  request_timeout: {
    title: 'Server Is Taking Too Long',
    description: 'The analysis took too long. Please try again.',
    retryable: true,
  },
  backend_unavailable: {
    title: 'Service Temporarily Unavailable',
    description: 'Please try again a bit later.',
    retryable: true,
  },
  image_rejected: {
    title: 'Photo Can’t Be Used',
    description: 'We couldn’t read the image. Please take a new photo.',
    retryable: false,
  },
  ai_not_configured: {
    title: 'Analysis Temporarily Unavailable',
    description: 'Please try again a bit later.',
    retryable: true,
  },
  ai_busy: {
    title: 'Too Many Requests',
    description: 'Wait a moment and try again.',
    retryable: true,
  },
  ai_timeout: {
    title: 'Analysis Took Too Long',
    description: 'Please try again.',
    retryable: true,
  },
  ai_unavailable: {
    title: 'Analysis Temporarily Unavailable',
    description: 'We couldn’t get a result. Please try again later.',
    retryable: true,
  },
  product_not_recognized: {
    title: 'Product Not Recognized',
    description: 'Photograph the package closer, straight on and in good light so the text is readable.',
    retryable: false,
  },
  label_not_readable: {
    title: 'Label Isn’t Readable',
    description: 'Photograph the nutrition label closer, straight on and in good light.',
    retryable: false,
  },
  meal_not_recognized: {
    title: 'Couldn’t Recognize the Meal',
    description: 'Photograph the whole plate from above or at an angle, in good light.',
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
  MEAL_NOT_RECOGNIZED: 'meal_not_recognized',
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
