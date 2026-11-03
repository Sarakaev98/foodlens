import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Logger, Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AIProviderError, MockProvider, MOCK_MEAL_PHOTO_OUTPUT, type AIProvider, type MealPhotoAiOutput } from '@foodlens/ai';
import { MealPhotoController } from '../meal-photo.controller';
import { MealPhotoService } from '../meal-photo.service';
import { ScanError } from '../scan-error';
import type { UploadedImage } from '../scan-image.validation';

Logger.overrideLogger(false);

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const photo: UploadedImage = { mimetype: 'image/jpeg', buffer: JPEG, size: JPEG.length, fieldname: 'image' };

const answering = (output: MealPhotoAiOutput | (() => Promise<MealPhotoAiOutput>)) =>
  ({ name: 'stub', analyzeMealPhoto: typeof output === 'function' ? output : async () => output }) as unknown as AIProvider;

async function rejectsWith(promise: Promise<unknown>, code: string, status: number): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof ScanError && error.code === code && error.status === status && typeof error.requestId === 'string');
}

describe('MealPhotoService', () => {
  it('фото → оценка: итог равен сумме компонентов, диапазон содержит итог', async () => {
    const { estimate } = await new MealPhotoService(new MockProvider()).analyze(photo);
    assert.equal(estimate.mealName, 'Курица с рисом и овощами');
    assert.deepEqual(estimate.items.map((item) => [item.name, item.estimatedGrams]), [
      ['Куриная грудка на гриле', 150], ['Рис отварной', 180], ['Овощи', 100], ['Соус', 30],
    ]);
    assert.deepEqual(estimate.total, { caloriesKcal: 607, proteinG: 53, carbsG: 62, fatG: 15 });
    assert.ok(estimate.calorieRange.min <= 607 && 607 <= estimate.calorieRange.max);
    assert.equal(estimate.confidence, 'medium');
  });

  it('в AI уходит ровно одно проверенное фото', async () => {
    const images: unknown[] = [];
    const ai = answering(async () => MOCK_MEAL_PHOTO_OUTPUT);
    (ai as { analyzeMealPhoto: (input: { image: unknown }) => Promise<MealPhotoAiOutput> }).analyzeMealPhoto = async ({ image }) => (images.push(image), MOCK_MEAL_PHOTO_OUTPUT);
    await new MealPhotoService(ai).analyze(photo);
    assert.deepEqual(images, [{ mimeType: 'image/jpeg', base64: JPEG.toString('base64') }]);
  });

  it('отрицательные значения не попадают в результат', async () => {
    const output = { ...MOCK_MEAL_PHOTO_OUTPUT, items: [...MOCK_MEAL_PHOTO_OUTPUT.items, { name: 'Ошибка', grams: 50, kcal: -300, protein_g: 0, carbs_g: 0, fat_g: 0, confidence: 'low' as const }] };
    const { estimate } = await new MealPhotoService(answering(output)).analyze(photo);
    assert.equal(estimate.items.length, 4);
    assert.ok(estimate.total.caloriesKcal > 0);
  });

  it('нет еды на фото → MEAL_NOT_RECOGNIZED 422', async () => {
    const noFood: MealPhotoAiOutput = { is_food: false, meal_name: '', items: [], total_kcal: 0, kcal_min: null, kcal_max: null, confidence: 'low', assumptions: [] };
    await rejectsWith(new MealPhotoService(answering(noFood)).analyze(photo), 'MEAL_NOT_RECOGNIZED', 422);
  });

  it('бессмысленные числа во всех компонентах → AI_BAD_RESPONSE 502', async () => {
    const broken = { ...MOCK_MEAL_PHOTO_OUTPUT, items: MOCK_MEAL_PHOTO_OUTPUT.items.map((item) => ({ ...item, kcal: -1 })) };
    await rejectsWith(new MealPhotoService(answering(broken)).analyze(photo), 'AI_BAD_RESPONSE', 502);
  });

  it('ошибки Gemini и timeout переводятся в коды скана без технических деталей', async () => {
    const failing = (code: 'invalid_response' | 'timeout' | 'rate_limited' | 'unavailable') => answering(async () => { throw new AIProviderError('google', code, 'secret details'); });
    await rejectsWith(new MealPhotoService(failing('invalid_response')).analyze(photo), 'AI_BAD_RESPONSE', 502);
    await rejectsWith(new MealPhotoService(failing('timeout')).analyze(photo), 'AI_TIMEOUT', 504);
    await rejectsWith(new MealPhotoService(failing('rate_limited')).analyze(photo), 'AI_RATE_LIMITED', 429);
    await rejectsWith(new MealPhotoService(failing('unavailable')).analyze(photo), 'AI_UNAVAILABLE', 502);
    await rejectsWith(new MealPhotoService(answering(async () => { throw new TypeError('boom'); })).analyze(photo), 'SCAN_FAILED', 500);
  });

  it('нет фото или это не картинка → ошибка до вызова AI', async () => {
    let called = false;
    const ai = answering(async () => { called = true; return MOCK_MEAL_PHOTO_OUTPUT; });
    await rejectsWith(new MealPhotoService(ai).analyze(undefined), 'IMAGE_MISSING', 400);
    await rejectsWith(new MealPhotoService(ai).analyze({ ...photo, buffer: Buffer.from('not an image') }), 'IMAGE_INVALID', 400);
    assert.equal(called, false);
  });
});

describe('POST /scan/meal', () => {
  let app: INestApplication;
  let url = '';

  before(async () => {
    @Module({ controllers: [MealPhotoController], providers: [{ provide: MealPhotoService, useValue: new MealPhotoService(new MockProvider()) }] })
    class TestMealModule {}
    app = await NestFactory.create(TestMealModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    url = (await app.getUrl()).replace('[::1]', '127.0.0.1') + '/scan/meal';
  });
  after(() => app.close());

  it('multipart "image" → 200 { estimate } без Product Score', async () => {
    const form = new FormData();
    form.append('image', new Blob([new Uint8Array(JPEG)], { type: 'image/jpeg' }), 'meal.jpg');
    const response = await fetch(url, { method: 'POST', body: form });
    assert.equal(response.status, 200);
    const body = (await response.json()) as Record<string, unknown> & { estimate: { total: { caloriesKcal: number } } };
    assert.deepEqual(Object.keys(body), ['estimate']);
    assert.equal(body.estimate.total.caloriesKcal, 607);
  });

  it('без фото: код ошибки скана, без технических деталей', async () => {
    const response = await fetch(url, { method: 'POST', body: new FormData() });
    assert.equal(response.status, 400);
    const body = (await response.json()) as { code: string; message: string };
    assert.equal(body.code, 'IMAGE_MISSING');
  });
});
