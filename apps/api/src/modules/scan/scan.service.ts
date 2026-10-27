import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AIProviderError, type AIProvider } from '@foodlens/ai';
import type { Product } from '@foodlens/core';
import { AI_PROVIDER } from '../ai/ai.tokens';
import { ScanError, scanErrorFromAI } from './scan-error';
import { validateScanImage, type UploadedImage } from './scan-image.validation';

/**
 * Сценарий сканирования: проверить фото → отдать AI-провайдеру → вернуть нормализованный Product.
 * Фото живёт только в памяти на время запроса: на диск и в БД ничего не пишется.
 */
@Injectable()
export class ScanService {
  private readonly logger = new Logger(ScanService.name);

  constructor(@Inject(AI_PROVIDER) private readonly ai: AIProvider) {}

  async analyze(file: UploadedImage | undefined): Promise<Product> {
    const requestId = randomUUID();
    const startedAt = Date.now();
    try {
      const image = validateScanImage(file);
      const product = await this.ai.analyzeProduct({ kind: 'image', image, requestId });
      this.logger.log(`scan finished ${JSON.stringify({ requestId, status: 200, durationMs: Date.now() - startedAt })}`);
      return product;
    } catch (error) {
      const scanError = toScanError(error).withRequestId(requestId);
      this.logger.warn(
        `scan failed ${JSON.stringify({ requestId, status: scanError.status, code: scanError.code, durationMs: Date.now() - startedAt })}`,
      );
      if (scanError.code === 'SCAN_FAILED') this.logger.error(`unexpected scan error ${requestId}`, (error as Error)?.stack);
      throw scanError;
    }
  }
}

export function toScanError(error: unknown): ScanError {
  if (error instanceof ScanError) return error;
  if (error instanceof AIProviderError) return scanErrorFromAI(error.code);
  return new ScanError('SCAN_FAILED', 500, 'Product analysis failed');
}
