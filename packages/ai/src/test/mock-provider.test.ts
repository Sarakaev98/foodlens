import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AIProviderError, type AIProviderErrorCode } from '../errors';
import { normalizeMetaProductAnalysis } from '../providers/meta/meta-product-normalizer';
import { MockProvider } from '../providers/mock/mock-provider';
import { MOCK_META_PRODUCT_ANALYSIS } from '../providers/mock/mock-product-analysis';
import { CONTEXT, metaAnalysis } from './meta-fixtures';

const IMAGE = { kind: 'image', image: { mimeType: 'image/jpeg', base64: Buffer.from('fake-jpeg').toString('base64') } } as const;

const mock = (overrides: ConstructorParameters<typeof MockProvider>[0] = {}) =>
  new MockProvider({ createId: () => 'test', now: () => new Date(CONTEXT.analyzedAt), ...overrides });

async function rejectsWith(promise: Promise<unknown>, code: AIProviderErrorCode): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof AIProviderError && error.code === code);
}

describe('MockProvider.analyzeProduct', () => {
  it('отдаёт фикстуру через тот же нормализатор: результат совпадает с нормализацией ответа Meta', async () => {
    const product = await mock().analyzeProduct(IMAGE);
    assert.deepEqual(product, normalizeMetaProductAnalysis(metaAnalysis(), CONTEXT));
  });

  it('возвращает валидный нормализованный Product', async () => {
    const product = await mock().analyzeProduct(IMAGE);
    assert.equal(product.id, 'scan_test');
    assert.deepEqual(product.name, { value: 'Греческий йогурт 2%', provenance: 'observed' });
    assert.deepEqual(product.brand, { value: 'Epica', provenance: 'observed' });
    assert.deepEqual(product.category, { value: 'yogurt', provenance: 'inferred' });
    assert.equal(product.nutrition?.basis, 'per_100g');
    assert.deepEqual(product.nutrition?.caloriesKcal, { value: 66, provenance: 'observed' });
    assert.deepEqual(product.nutrition?.sodiumMg, { value: 40, provenance: 'inferred' });
    assert.equal(product.ingredients.value?.length, 3);
    assert.deepEqual(product.allergens.value, [{ code: 'milk', presence: 'contains', provenance: 'observed' }]);
    assert.deepEqual(product.additives.value, []);
    assert.equal(product.confidence.overall, 'high');
    assert.equal(product.source.type, 'meta_vision');
  });

  it('работает без ключа и без сети', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => assert.fail('mock не должен обращаться к сети')) as typeof fetch;
    try {
      await new MockProvider().analyzeProduct(IMAGE);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('не меняет общую фикстуру между вызовами', async () => {
    const before = structuredClone(MOCK_META_PRODUCT_ANALYSIS);
    await mock().analyzeProduct(IMAGE);
    await mock().analyzeProduct(IMAGE);
    assert.deepEqual(MOCK_META_PRODUCT_ANALYSIS, before);
  });

  it('ошибки идут по тем же кодам, что и у Meta: не по схеме, не еда, не фото', async () => {
    const broken = { ...metaAnalysis(), confidence: { overall: 'sure' } } as unknown as typeof MOCK_META_PRODUCT_ANALYSIS;
    await rejectsWith(mock({ analysis: broken }).analyzeProduct(IMAGE), 'invalid_response');
    await rejectsWith(mock({ analysis: metaAnalysis({ image: { is_food_product: false } }) }).analyzeProduct(IMAGE), 'product_not_recognized');
    await rejectsWith(mock().analyzeProduct({ kind: 'text', text: 'йогурт' }), 'unsupported_input');
  });

  it('остальные методы явно не реализованы', async () => {
    await rejectsWith(mock().explainProduct(), 'not_implemented');
  });
});
