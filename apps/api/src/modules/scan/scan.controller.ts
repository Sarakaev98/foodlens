import { Controller, HttpCode, Post, UploadedFile, UseFilters, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Product } from '@foodlens/core';
import { ScanExceptionFilter } from './scan-exception.filter';
import { SCAN_IMAGE_FIELD, SCAN_MAX_IMAGE_BYTES, type UploadedImage } from './scan-image.validation';
import { ScanService } from './scan.service';

@Controller('scan')
@UseFilters(ScanExceptionFilter)
export class ScanController {
  constructor(private readonly scanService: ScanService) {}

  /** multipart/form-data, поле "image": одно фото JPEG, PNG или WebP. Возвращает нормализованный Product. */
  @Post('analyze')
  @HttpCode(200)
  @UseInterceptors(
    FileInterceptor(SCAN_IMAGE_FIELD, {
      // Без storage и dest multer держит файл только в памяти: на диск фото не попадает.
      limits: { fileSize: SCAN_MAX_IMAGE_BYTES, files: 1, fields: 5 },
    }),
  )
  analyze(@UploadedFile() file: UploadedImage | undefined): Promise<Product> {
    return this.scanService.analyze(file);
  }
}
