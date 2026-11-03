import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Logger } from '@nestjs/common';
import { AIProviderError, MockProvider, type AIProvider, type AIProviderErrorCode } from '@foodlens/ai';
import { NOT_DETECTED, observed, type GoalMatchUserPlan, type NutritionFacts } from '@foodlens/core';
import { calculateNutritionTargets } from '@foodlens/nutrition';
import { limitByProductScore, matchGoal, scoreProduct } from '@foodlens/scoring';
import type { NutritionTargetsService } from '../../nutrition-targets/nutrition-targets.service';
import { ScanError } from '../scan-error';
import { validateScanImage, SCAN_MAX_IMAGE_BYTES, type UploadedImage } from '../scan-image.validation';
import { ScanService } from '../scan.service';

Logger.overrideLogger(false);

const USER_ID = 'test-user';

function planFor(goal: GoalMatchUserPlan['goal']): GoalMatchUserPlan {
  const profile = { goal, age: 30, sex: 'female', heightCm: 168, weightKg: 70, activityLevel: 'light' } as const;
  return { goal, targets: calculateNutritionTargets(profile), dietaryPreferences: [], allergens: [], avoidedIngredients: [] };
}

/** Заглушка источника планов: тот же интерфейс, что у NutritionTargetsService. */
function plans(find: (userId: string) => Promise<GoalMatchUserPlan | null>): NutritionTargetsService {
  return { findPlanForUser: find } as unknown as NutritionTargetsService;
}

const NO_PROFILE = plans(async () => null);

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
    await assert.rejects(new ScanService(failingProvider(code), NO_PROFILE).analyze(file(), USER_ID), (error: unknown) => {
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
    await assert.rejects(new ScanService(crashing, NO_PROFILE).analyze(file(), USER_ID), (error: unknown) => error instanceof ScanError && error.code === 'SCAN_FAILED');
  });

  it('невалидный файл не доходит до провайдера', async () => {
    let called = false;
    const provider = { analyzeProduct: async () => { called = true; } } as unknown as AIProvider;
    await assert.rejects(new ScanService(provider, NO_PROFILE).analyze(undefined, USER_ID), (error: unknown) => error instanceof ScanError);
    assert.equal(called, false);
  });

  it('результат скана содержит Product и Product Score, посчитанный после провайдера', async () => {
    const result = await new ScanService(new MockProvider(), NO_PROFILE).analyze(file(), USER_ID);
    assert.equal(result.product.name.value, 'Греческий йогурт 2%');
    assert.deepEqual(result.score, scoreProduct(result.product));
    assert.equal(result.score.value, 9.4);
    assert.equal(result.score.unscoredReason, null);
  });

  it('mock: ответ { product, score, goalMatch }, Goal Match по плану пользователя, а не из провайдера', async () => {
    const plan = planFor('lose_weight');
    let askedFor: string | null = null;
    const service = new ScanService(new MockProvider(), plans(async (userId) => ((askedFor = userId), plan)));
    const result = await service.analyze(file(), USER_ID);
    assert.deepEqual(Object.keys(result).sort(), ['goalMatch', 'product', 'score']);
    assert.equal(askedFor, USER_ID);
    assert.deepEqual(result.goalMatch, matchGoal(result.product, plan));
    assert.equal(result.goalMatch.goal, 'lose_weight');
    assert.equal(typeof result.goalMatch.value, 'number');
    assert.deepEqual(result.goalMatch.portion, { basis: 'serving', amount: 130, unit: 'g', caloriesKcal: 85.8 });
  });

  it('йогурт: API v3 uses 0–10, fixed risks, semantic context and unchanged Product Score', async () => {
    const result = await new ScanService(new MockProvider(), plans(async () => planFor('eat_healthier'))).analyze(file(), USER_ID);
    assert.equal(result.score.value, 9.4);
    assert.equal(result.product.semantics!.version, 'semantics-v1');
    assert.ok(result.goalMatch.version === 'goal-match-v3');
    assert.equal(result.goalMatch.state, 'goal_match');
    assert.equal(result.goalMatch.value, 8.8); // This API fixture has a 124 g protein target; reference design uses 139 g.
    assert.equal(result.goalMatch.confidence, 'medium'); // Fiber is not printed.
    const saturatedFat = result.goalMatch.factors.find((item) => item.kind === 'saturatedFat')!;
    assert.ok(Math.abs(saturatedFat.value! - 1.69) < 1e-10);
    assert.ok(Math.abs(saturatedFat.points + 0.402597) < 1e-6);
    assert.ok(Math.abs(saturatedFat.portionShare! - 8.45) < 1e-10);
    const serialized = JSON.parse(JSON.stringify(result));
    assert.equal(serialized.goalMatch.value, 8.8);
    assert.equal(serialized.goalMatch.range.min, 8.8);
  });

  it('Product Score в ответе одинаковый при любых целях пользователя', async () => {
    const scores = await Promise.all(
      (['lose_weight', 'gain_weight', 'eat_healthier'] as const).map(async (goal) => {
        const result = await new ScanService(new MockProvider(), plans(async () => planFor(goal))).analyze(file(), USER_ID);
        return result.score;
      }),
    );
    assert.deepEqual(scores[1], scores[0]);
    assert.deepEqual(scores[2], scores[0]);
  });

  it('нет профиля → скан работает, goalMatch без значения (no_profile)', async () => {
    const result = await new ScanService(new MockProvider(), NO_PROFILE).analyze(file(), USER_ID);
    assert.equal(result.score.value, 9.4);
    assert.equal(result.goalMatch.value, null);
    assert.equal(result.goalMatch.unavailableReason, 'no_profile');
  });

  it('профиль не загрузился (ошибка БД) → скан работает, goalMatch profile_unavailable', async () => {
    const broken = plans(async () => {
      throw new Error('connection refused');
    });
    const result = await new ScanService(new MockProvider(), broken).analyze(file(), USER_ID);
    assert.equal(result.score.value, 9.4);
    assert.equal(result.goalMatch.value, null);
    assert.equal(result.goalMatch.unavailableReason, 'profile_unavailable');
  });
});


describe('ScanService: nutrition_presence log', () => {
  async function presenceLog(nutrition: Partial<NutritionFacts> | null, plan: GoalMatchUserPlan | null = planFor('eat_healthier')) {
    const original = await new MockProvider().analyzeProduct({ kind: 'image', image: { mimeType: 'image/jpeg', base64: JPEG.toString('base64') } });
    const product = {
      ...original,
      nutrition: nutrition === null ? null : { ...original.nutrition!, ...nutrition },
      name: observed('Секретное название'),
      ingredients: observed([{ name: 'секретный ингредиент', percent: null }]),
    };
    const provider = new MockProvider();
    provider.analyzeProduct = async () => product;
    const lines: string[] = [];
    const capture = (message: unknown) => { lines.push(String(message)); };
    Logger.overrideLogger({ log: capture, warn: capture, error: capture, debug: capture, verbose: capture });
    try {
      await new ScanService(provider, plans(async () => plan)).analyze(file(), USER_ID);
    } finally {
      Logger.overrideLogger(false);
    }
    const presence = lines.filter((line) => line.startsWith('nutrition_presence '));
    assert.equal(presence.length, 1, 'ровно одна строка на скан');
    return { line: presence[0]!, fields: JSON.parse(presence[0]!.slice('nutrition_presence '.length)) as Record<string, unknown> };
  }

  it('сахара, насыщенные жиры и соль отсутствуют: false и коды причин', async () => {
    const { fields } = await presenceLog({ sugarsG: NOT_DETECTED, saturatedFatG: NOT_DETECTED, saltG: NOT_DETECTED, sodiumMg: NOT_DETECTED, fiberG: NOT_DETECTED });
    const { requestId, ...rest } = fields;
    assert.equal(typeof requestId, 'string');
    assert.deepEqual(rest, {
      calories: true, protein: true, carbs: true, sugars: true, fat: true, saturatedFat: true, fiber: true, salt: true, sodium: true,
      unscoredReason: null, unavailableReason: null,
    });
  });

  it('значение 0 считается присутствующим, это не «нет данных»', async () => {
    const { fields } = await presenceLog({ sugarsG: observed(0), saturatedFatG: observed(0), saltG: observed(0) });
    assert.deepEqual([fields.sugars, fields.saturatedFat, fields.salt, fields.unscoredReason], [true, true, true, null]);
  });

  it('нет таблицы: все признаки false, без падения', async () => {
    const { fields } = await presenceLog(null);
    assert.equal(fields.calories, true); assert.equal(fields.sodium, true);
    assert.equal(fields.unscoredReason, null); assert.equal(fields.unavailableReason, null);
  });

  it('в логе только признаки и коды: нет значений, названия, состава, профиля', async () => {
    const { line, fields } = await presenceLog({ caloriesKcal: observed(431.5), proteinG: observed(7.25), sugarsG: NOT_DETECTED });
    assert.deepEqual(Object.keys(fields).sort(), ['calories', 'carbs', 'fat', 'fiber', 'protein', 'requestId', 'salt', 'saturatedFat',
      'sodium', 'sugars', 'unavailableReason', 'unscoredReason'].sort());
    for (const [key, value] of Object.entries(fields)) {
      if (key === 'requestId' || key === 'unscoredReason' || key === 'unavailableReason') continue;
      assert.equal(typeof value, 'boolean', key);
    }
    for (const secret of ['431', '7.25', 'Секретное', 'секретный', USER_ID, JPEG.toString('base64')]) {
      assert.ok(!line.includes(secret), `в логе нет ${secret}`);
    }
  });
});

describe('ScanService: missing protein in v3', () => {
  it('returns a numeric score, uses estimated protein in both scores', async () => {
    const original = await new MockProvider().analyzeProduct({ kind: 'image', image: { mimeType: 'image/jpeg', base64: JPEG.toString('base64') } });
    const product = { ...original, nutrition: { ...original.nutrition!, proteinG: NOT_DETECTED } };
    const provider = new MockProvider();
    provider.analyzeProduct = async () => product;
    const result = await new ScanService(provider, plans(async () => planFor('eat_healthier'))).analyze(file(), USER_ID);
    assert.equal(result.product.nutritionMetadata!.fields.proteinG.quality, 'estimated');
    assert.deepEqual(result.score, scoreProduct(result.product));
    assert.ok(result.goalMatch.version === 'goal-match-v3');
    assert.equal(result.goalMatch.state, 'goal_match');
    assert.deepEqual(result.goalMatch, limitByProductScore(matchGoal(result.product, planFor('eat_healthier')), result.score));
    assert.equal(result.goalMatch.confidence, 'medium'); assert.ok(result.goalMatch.uncertainty.includes('nutrition'));
    const serialized = JSON.parse(JSON.stringify(result));
    const protein = serialized.goalMatch.factors.find((f: {kind: string}) => f.kind === 'protein');
    assert.equal(typeof protein.value, 'number'); assert.equal(typeof protein.portionShare, 'number');
    assert.equal(typeof serialized.product.nutrition.proteinG.value, 'number');
    assert.equal(serialized.product.nutritionMetadata.fields.proteinG.quality, 'estimated');
  });
});

describe('ScanService: режим таблицы', () => {
  const noBarcodeReader = async () => {
    throw new Error('the label mode must not look for a barcode');
  };

  it('одно фото с ролью nutrition, без штрихкода и баз; оценка и Goal Match считаются', async () => {
    const inputs: unknown[] = [];
    const mock = new MockProvider();
    const ai: AIProvider = Object.assign(Object.create(mock), { analyzeProduct: (input: Parameters<AIProvider['analyzeProduct']>[0]) => (inputs.push(input), mock.analyzeProduct(input)) });
    const service = new ScanService(ai, plans(async () => planFor('lose_weight')), undefined, undefined, noBarcodeReader);
    const result = await service.analyze([file(), file()], USER_ID, { mode: 'nutrition_label', barcode: '4607001771234' });
    assert.equal(inputs.length, 1);
    const images = (inputs[0] as { images: { role: string }[] }).images;
    assert.deepEqual(images.map((image) => image.role), ['nutrition']);
    assert.equal(typeof result.score.value, 'number');
    assert.equal(typeof result.goalMatch.value, 'number');
    assert.equal(result.barcode, undefined);
    assert.equal(result.needsPhoto, undefined);
  });

  it('таблица не прочитана: понятная ошибка, а не пустой результат', async () => {
    const mock = new MockProvider();
    const ai: AIProvider = Object.assign(Object.create(mock), { analyzeProduct: async (input: Parameters<AIProvider['analyzeProduct']>[0]) => ({ ...(await mock.analyzeProduct(input)), nutrition: null }) });
    const service = new ScanService(ai, NO_PROFILE, undefined, undefined, noBarcodeReader);
    await assert.rejects(service.analyze(file(), USER_ID, { mode: 'nutrition_label' }), (error: ScanError) => error.code === 'NUTRITION_TABLE_NOT_FOUND' && error.status === 422);
  });

  it('без фото ошибка фото, как в обычном скане', async () => {
    const service = new ScanService(new MockProvider(), NO_PROFILE, undefined, undefined, noBarcodeReader);
    await assert.rejects(service.analyze([], USER_ID, { mode: 'nutrition_label' }), (error: ScanError) => error.code === 'IMAGE_MISSING');
  });
});
