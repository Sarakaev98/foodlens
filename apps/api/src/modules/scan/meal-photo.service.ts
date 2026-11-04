import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { MealPhotoScanResult } from '@foodlens/core';
import { normalizeMealPhotoEstimate } from '@foodlens/nutrition';
import { MEAL_SCAN_AI_PROVIDER, type MealScanAnalyzer } from './meal-scan-ai-provider.factory';
import { ScanError } from './scan-error';
import { validateScanImage, type UploadedImage } from './scan-image.validation';
import { toScanError } from './scan.service';

/**
 * Фото готового блюда → один AI-вызов → проверка и нормализация чисел → приблизительная оценка.
 * Отдельно от скана упаковки: ни штрихкода, ни баз, ни Product Score. Фото живёт только в памяти на время запроса.
 * Usage пишется выбранным провайдером (gemini_usage / fireworks_usage, type meal_photo).
 */
@Injectable()
export class MealPhotoService {
  private readonly logger = new Logger(MealPhotoService.name);

  constructor(@Inject(MEAL_SCAN_AI_PROVIDER) private readonly ai: MealScanAnalyzer) {}

  async analyze(file: UploadedImage | undefined): Promise<MealPhotoScanResult> {
    const requestId = randomUUID();
    const startedAt = Date.now();
    try {
      const image = validateScanImage(file);
      this.logger.log(`meal_scan_provider ${JSON.stringify({ requestId, provider: this.ai.name, model: this.ai.model ?? null })}`);
      const raw = await this.ai.analyzeMealPhoto({ image, requestId });
      const normalized = normalizeMealPhotoEstimate(raw);
      if (normalized.kind === 'no_food') throw new ScanError('MEAL_NOT_RECOGNIZED', 422, 'No food could be recognized in the photo');
      if (normalized.kind === 'invalid') throw new ScanError('AI_BAD_RESPONSE', 502, 'The AI service returned an invalid result');
      const { estimate, report } = normalized;
      this.logger.log(
        `meal photo finished ${JSON.stringify({ requestId, provider: this.ai.name, model: this.ai.model ?? null, status: 200, items: estimate.items.length, kcal: estimate.total.caloriesKcal, confidence: estimate.confidence, ...report, durationMs: Date.now() - startedAt })}`,
      );
      return { estimate };
    } catch (error) {
      const scanError = toScanError(error).withRequestId(requestId);
      this.logger.warn(`meal photo failed ${JSON.stringify({ requestId, provider: this.ai.name, model: this.ai.model ?? null, status: scanError.status, code: scanError.code, durationMs: Date.now() - startedAt })}`);
      if (scanError.code === 'SCAN_FAILED') this.logger.error(`unexpected meal photo error ${requestId}`, (error as Error)?.stack);
      throw scanError;
    }
  }
}
