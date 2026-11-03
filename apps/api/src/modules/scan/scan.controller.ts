import { Body, Controller, HttpCode, Post, UploadedFiles, UseFilters, UseInterceptors } from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { CurrentUserId } from '../../common/current-user-id.decorator';
import { SCAN_BARCODE_FIELD } from './scan-barcode';
import { ScanExceptionFilter } from './scan-exception.filter';
import { collectScanUploads, SCAN_MAX_IMAGE_BYTES, SCAN_MAX_IMAGES, SCAN_ROLES_FIELD, type UploadedImage } from './scan-image.validation';
import { SCAN_MODE_FIELD, ScanService, type ScanResult } from './scan.service';

@Controller('scan')
@UseFilters(ScanExceptionFilter)
export class ScanController {
  constructor(private readonly scanService: ScanService) {}

  /**
   * multipart/form-data: поле "image" (одно фото) или "images" (1–3 фото одного продукта) JPEG, PNG или WebP;
   * необязательные "roles" (product | nutrition | ingredients, JSON-массив или значение на фото), "barcode" (8–14 цифр)
   * и "mode": nutrition_label означает одно фото таблицы, без штрихкода и поиска по базам.
   * Один скан — один запрос к AI. Возвращает { product, score, goalMatch }: нормализованный Product,
   * его объективный Product Score и персональный Goal Match.
   */
  @Post('analyze')
  @HttpCode(200)
  @UseInterceptors(
    AnyFilesInterceptor({
      // Без storage и dest multer держит файлы только в памяти: на диск фото не попадает.
      limits: { fileSize: SCAN_MAX_IMAGE_BYTES, files: SCAN_MAX_IMAGES, fields: 5 },
    }),
  )
  analyze(
    @UploadedFiles() uploads: UploadedImage[] | undefined,
    @CurrentUserId() userId: string,
    @Body() body: Record<string, unknown> | undefined,
  ): Promise<ScanResult> {
    const { files, roles } = collectScanUploads(uploads, body?.[SCAN_ROLES_FIELD]);
    return this.scanService.analyze(files, userId, { barcode: body?.[SCAN_BARCODE_FIELD], roles, mode: body?.[SCAN_MODE_FIELD] });
  }
}
