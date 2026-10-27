import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Logger } from '@nestjs/common';
import { AIProviderError, type AIProvider, type AIProviderErrorCode } from '@foodlens/ai';
import { ScanError } from '../scan-error';
import { validateScanImage, SCAN_MAX_IMAGE_BYTES, type UploadedImage } from '../scan-image.validation';
import { ScanService } from '../scan.service';

Logger.overrideLogger(false);

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

const file = (overrides: Partial<UploadedImage> = {}): UploadedImage => ({
  mimetype: 'image/jpeg',
  buffer: JPEG,
  size: JPEG.length,
  ...overrides,
});

function expectScanError(action: () => unknown, code: string, status: number): void {
  assert.throws(action, (error: unknown) => error instanceof ScanError && error.code === code && error.status === status);
}

describe('validateScanImage', () => {
  it('принимает JPEG и PNG и отдаёт base64', () => {
    assert.deepEqual(validateScanImage(file()), { mimeType: 'image/jpeg', base64: JPEG.toString('base64') });
    assert.equal(validateScanImage(file({ mimetype: 'image/png', buffer: PNG, size: PNG.length })).mimeType, 'image/png');
  });

  it('11. файла нет или он пустой → IMAGE_MISSING 400', () => {
    expectScanError(() => validateScanImage(undefined), 'IMAGE_MISSING', 400);
    expectScanError(() => validateScanImage(file({ size: 0, buffer: Buffer.alloc(0) })), 'IMAGE_MISSING', 400);
  });

  it('12. неподдерживаемый MIME → IMAGE_UNSUPPORTED_TYPE 415', () => {
    expectScanError(() => validateScanImage(file({ mimetype: 'image/heic' })), 'IMAGE_UNSUPPORTED_TYPE', 415);
    expectScanError(() => validateScanImage(file({ mimetype: 'application/pdf' })), 'IMAGE_UNSUPPORTED_TYPE', 415);
  });

  it('13. слишком большой файл → IMAGE_TOO_LARGE 413', () => {
    expectScanError(() => validateScanImage(file({ size: SCAN_MAX_IMAGE_BYTES + 1 })), 'IMAGE_TOO_LARGE', 413);
  });

  it('13b. содержимое не совпадает с типом → IMAGE_INVALID 400', () => {
    expectScanError(() => validateScanImage(file({ buffer: Buffer.from('not an image') })), 'IMAGE_INVALID', 400);
    expectScanError(() => validateScanImage(file({ buffer: PNG })), 'IMAGE_INVALID', 400);
  });
});

describe('ScanService', () => {
  const failingProvider = (code: AIProviderErrorCode): AIProvider =>
    ({
      name: 'test',
      analyzeProduct: async () => {
        throw new AIProviderError('test', code, 'secret details from provider');
      },
    }) as unknown as AIProvider;

  async function expectServiceError(code: AIProviderErrorCode, scanCode: string, status: number): Promise<void> {
    await assert.rejects(new ScanService(failingProvider(code)).analyze(file()), (error: unknown) => {
      assert.ok(error instanceof ScanError);
      assert.equal(error.code, scanCode);
      assert.equal(error.status, status);
      assert.ok(error.requestId, 'у ошибки есть requestId');
      assert.ok(!error.message.includes('secret'), 'текст провайдера не уходит клиенту');
      return true;
    });
  }

  it('14. нет MODEL_API_KEY → AI_NOT_CONFIGURED 503', () => expectServiceError('not_configured', 'AI_NOT_CONFIGURED', 503));

  it('15. ошибки Meta → понятные коды', async () => {
    await expectServiceError('authentication_failed', 'AI_AUTH_FAILED', 502);
    await expectServiceError('rate_limited', 'AI_RATE_LIMITED', 429);
    await expectServiceError('unavailable', 'AI_UNAVAILABLE', 502);
    await expectServiceError('invalid_response', 'AI_BAD_RESPONSE', 502);
    await expectServiceError('normalization_failed', 'AI_BAD_RESPONSE', 502);
    await expectServiceError('product_not_recognized', 'PRODUCT_NOT_RECOGNIZED', 422);
  });

  it('16. таймаут → AI_TIMEOUT 504, неожиданная ошибка → SCAN_FAILED 500', async () => {
    await expectServiceError('timeout', 'AI_TIMEOUT', 504);
    const crashing = { analyzeProduct: async () => { throw new TypeError('boom'); } } as unknown as AIProvider;
    await assert.rejects(new ScanService(crashing).analyze(file()), (error: unknown) => error instanceof ScanError && error.code === 'SCAN_FAILED');
  });

  it('невалидный файл не доходит до провайдера', async () => {
    let called = false;
    const provider = { analyzeProduct: async () => { called = true; } } as unknown as AIProvider;
    await assert.rejects(new ScanService(provider).analyze(undefined), (error: unknown) => error instanceof ScanError);
    assert.equal(called, false);
  });
});
