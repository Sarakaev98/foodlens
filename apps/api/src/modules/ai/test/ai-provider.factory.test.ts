import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Logger } from '@nestjs/common';
import { AIProviderError, MetaProvider, MockProvider } from '@foodlens/ai';
import { loadAppConfig } from '../../../config/app-config';
import { createAIProvider } from '../ai-provider.factory';

Logger.overrideLogger(false);

const IMAGE = { kind: 'image', image: { mimeType: 'image/jpeg', base64: Buffer.from('fake-jpeg').toString('base64') } } as const;
const BASE_ENV = { DATABASE_URL: 'postgresql://test' } as const;

const providerFor = (env: Readonly<Record<string, string | undefined>>) => createAIProvider(loadAppConfig({ ...BASE_ENV, ...env }));

describe('createAIProvider', () => {
  it('AI_PROVIDER=mock → MockProvider, анализ работает без MODEL_API_KEY', async () => {
    const provider = providerFor({ AI_PROVIDER: 'mock' });
    assert.ok(provider instanceof MockProvider);
    const product = await provider.analyzeProduct(IMAGE);
    assert.equal(product.name.value, 'Чипсы');
    assert.equal(product.nutrition?.proteinG.value, null);
  });

  it('AI_PROVIDER не задан или meta → MetaProvider с настройками из env', () => {
    for (const env of [{}, { AI_PROVIDER: 'meta' }] as const) {
      const provider = providerFor({ ...env, MODEL_API_KEY: 'test-key', MODEL_NAME: 'custom-model' });
      assert.ok(provider instanceof MetaProvider);
      assert.equal(provider.model, 'custom-model');
    }
  });

  it('AI_PROVIDER=meta без ключа: подмены на mock нет, остаётся not_configured', async () => {
    const provider = providerFor({ AI_PROVIDER: 'meta', MODEL_API_KEY: '' });
    assert.ok(provider instanceof MetaProvider);
    await assert.rejects(provider.analyzeProduct(IMAGE), (error: unknown) => error instanceof AIProviderError && error.code === 'not_configured');
  });

  it('неизвестный AI_PROVIDER → ошибка конфигурации при запуске', () => {
    for (const value of ['openai', 'Mock', '']) {
      assert.throws(() => loadAppConfig({ ...BASE_ENV, AI_PROVIDER: value }), /Unknown AI_PROVIDER/);
    }
  });
});
