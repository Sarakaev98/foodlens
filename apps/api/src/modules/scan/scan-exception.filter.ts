import { ArgumentsHost, Catch, HttpException, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { ScanError } from './scan-error';
import { SCAN_IMAGE_FIELD, SCAN_MAX_IMAGE_BYTES } from './scan-image.validation';

/**
 * Единый формат ошибок сканирования: { statusCode, code, message, requestId }.
 * Стек и тексты внешних сервисов клиенту не отправляются.
 */
@Catch()
export class ScanExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const error = toClientError(exception);
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(error.status)
      .json({ statusCode: error.status, code: error.code, message: error.message, requestId: error.requestId ?? null });
  }
}

/** Ошибки multer приходят раньше сервиса как HttpException: переводим их в коды сканирования. */
function toClientError(exception: unknown): ScanError {
  if (exception instanceof ScanError) return exception;
  if (exception instanceof HttpException) {
    if (exception.getStatus() === 413) {
      return new ScanError('IMAGE_TOO_LARGE', 413, `The image must be smaller than ${SCAN_MAX_IMAGE_BYTES / 1024 / 1024} MB`);
    }
    if (exception.getStatus() === 400) {
      return new ScanError('IMAGE_MISSING', 400, `Send one photo as multipart/form-data in the "${SCAN_IMAGE_FIELD}" field`);
    }
  }
  return new ScanError('SCAN_FAILED', 500, 'Product analysis failed');
}
