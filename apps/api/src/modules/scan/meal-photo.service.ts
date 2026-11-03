import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AIProvider } from '@foodlens/ai';
import type { MealPhotoScanResult } from '@foodlens/core';
import { normalizeMealPhotoEstimate } from '@foodlens/nutrition';
import { AI_PROVIDER } from '../ai/ai.tokens';
import { ScanError } from './scan-error';
import { validateScanImage, type UploadedImage } from './scan-image.validation';
import { toScanError } from './scan.service';

/**
 * Фото готового блюда → один AI-вызов → проверка и нормализация чисел → приблизительная оценка.
 * Отдельно от скана упаковки: ни штрихкода, ни баз, ни Product Score. Фото живёт только в памяти на время запроса.
 * usageMetadata Gemini пишется в лог провайдером (gemini_usage, type meal_photo).
 */
@Injectable()
export class MealPhotoService {
  private readonly logger = new Logger(MealPhotoService.name);

  constructor(@Inject(AI_PROVIDER) private readonly ai: AIProvider) {}

  async analyze(file: UploadedImage | undefined): Promise<MealPhotoScanResult> {
    const requestId = randomUUID();
    const startedAt = Date.now();
    try {
      const image = validateScanImage(file);
      const raw = await this.ai.analyzeMealPhoto({ image, requestId });
      const normalized = normalizeMealPhotoEstimate(raw);
      if (normalized.kind === 'no_food') throw new ScanError('MEAL_NOT_RECOGNIZED', 422, 'No food could be recognized in the photo');
      if (normalized.kind === 'invalid') throw new ScanError('AI_BAD_RESPONSE', 502, 'The AI service returned an invalid result');
      const { estimate, report } = normalized;
      this.logger.log(
        `meal photo finished ${JSON.stringify({ requestId, status: 200, items: estimate.items.length, kcal: estimate.total.caloriesKcal, confidence: estimate.confidence, ...report, durationMs: Date.now() - startedAt })}`,
      );
      return { estimate };
    } catch (error) {
      const scanError = toScanError(error).withRequestId(requestId);
      this.logger.warn(`meal photo failed ${JSON.stringify({ requestId, status: scanError.status, code: scanError.code, durationMs: Date.now() - startedAt })}`);
      if (scanError.code === 'SCAN_FAILED') this.logger.error(`unexpected meal photo error ${requestId}`, (error as Error)?.stack);
      throw scanError;
    }
  }
}
