import { Controller, HttpCode, Post, UploadedFiles, UseFilters, UseInterceptors } from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import type { MealPhotoScanResult } from '@foodlens/core';
import { MealPhotoService } from './meal-photo.service';
import { ScanExceptionFilter } from './scan-exception.filter';
import { SCAN_IMAGE_FIELD, SCAN_MAX_IMAGE_BYTES, type UploadedImage } from './scan-image.validation';

/** Отдельно от ScanController: скан упаковки и его ответ не меняются. Те же коды ошибок скана. */
@Controller('scan')
@UseFilters(ScanExceptionFilter)
export class MealPhotoController {
  constructor(private readonly mealPhotos: MealPhotoService) {}

  /**
   * Фото готового блюда: multipart/form-data, одно поле "image" (JPEG, PNG или WebP).
   * Один запрос к AI. Возвращает { estimate }: приблизительные калории и БЖУ блюда и его компонентов.
   * Product Score и Goal Match не считаются, штрихкод и базы продуктов не участвуют.
   */
  @Post('meal')
  @HttpCode(200)
  // Без storage multer держит файл только в памяти: на диск фото не попадает.
  @UseInterceptors(AnyFilesInterceptor({ limits: { fileSize: SCAN_MAX_IMAGE_BYTES, files: 1, fields: 2 } }))
  analyze(@UploadedFiles() uploads: UploadedImage[] | undefined): Promise<MealPhotoScanResult> {
    return this.mealPhotos.analyze(uploads?.find((file) => file.fieldname === SCAN_IMAGE_FIELD));
  }
}
