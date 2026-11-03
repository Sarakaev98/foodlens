import { estimateMissingNutrition } from '../../scan/nutrition-estimator';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Logger } from '@nestjs/common';
import { AIProviderError, AIUnavailableError, MetaProvider, MockProvider, MOCK_GOAL_MATCH_MODEL, MOCK_GOAL_MATCH_RECORDINGS,
  type AIProvider, type MockGoalMatchRecording } from '@foodlens/ai';
import type { GoalMatchAiInput, GoalMatchUserPlan, GoalMatchV4, Product } from '@foodlens/core';
import { limitByProductScore, matchGoal, prepareGoalMatchV4, scoreProduct, validateGoalMatchAiOutput } from '@foodlens/scoring';
import { loadAppConfig } from '../../../config/app-config';
import { createGoalMatchAIProvider } from '../../ai/ai-provider.factory';
import type { NutritionTargetsService } from '../../nutrition-targets/nutrition-targets.service';
import { ScanService } from '../../scan/scan.service';
import { GoalMatchAiCache, goalMatchAiCacheKey } from '../goal-match-ai-cache';
import { GOAL_MATCH_AI_TIMEOUT_MS, GoalMatchService } from '../goal-match.service';
import { withIngredientFacts } from '../../scan/ingredient-facts';
import {
  APPLE, CHIPS, CHIPS_PROTEIN_CLAIM, CHIPS_TOO_HIGH, COLA, COLA_HALLUCINATION, INVALID_OUTPUT, PEAR, PROTEIN_BAR,
  eatHealthierPlan, noCalories, noProtein, spyGoalMatch,
} from './goal-match-v4.fixtures';

Logger.overrideLogger(false);

const USER_ID = 'test-user';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const FILE = { mimetype: 'image/jpeg', buffer: JPEG, size: JPEG.length };
const IMAGE = { kind: 'image', image: { mimeType: 'image/jpeg', base64: JPEG.toString('base64') } } as const;

/** Йогурт из MockProvider.analyzeProduct: этикетка, состав и аллерген (молоко) как после настоящей нормализации. */
const yogurt = (): Promise<Product> => new MockProvider().analyzeProduct(IMAGE);
const plans = (plan: GoalMatchUserPlan | null) => ({ findPlanForUser: async () => plan }) as unknown as NutritionTargetsService;
/** Скан-провайдер, который «распознаёт» заданный продукт. */
const scanning = (product: Product): AIProvider => {
  const provider = new MockProvider();
  provider.analyzeProduct = async () => product;
  return provider;
};
const recording = (id: string, name: string, kcalPer100: number, ...responses: MockGoalMatchRecording['responses']): MockGoalMatchRecording =>
  ({ id, names: [name], kcalPer100, responses });

async function scan(product: Product, goalMatchAi: AIProvider | null, plan = eatHealthierPlan(), timeoutMs?: number) {
  const service = new GoalMatchService(goalMatchAi, { timeoutMs });
  return new ScanService(scanning(product), plans(plan), service).analyze(FILE, USER_ID);
}
function v4(result: { readonly goalMatch: unknown }): GoalMatchV4 {
  const goalMatch = result.goalMatch as GoalMatchV4;
  assert.equal(goalMatch.version, 'goal-match-v4');
  return goalMatch;
}
const ready = (product: Product, plan = eatHealthierPlan()) => {
  const prepared = prepareGoalMatchV4(product, plan);
  assert.equal(prepared.state, 'ready');
  return prepared as Extract<typeof prepared, { state: 'ready' }>;
};

describe('Mock Goal Match provider', () => {
  it('каждый записанный ответ проходит настоящий validateGoalMatchAiOutput без правок', async () => {
    const products: Record<string, Product> = { greek_yogurt: await yogurt(), apple: APPLE, chips: CHIPS, cola: COLA, protein_bar: PROTEIN_BAR };
    assert.deepEqual(MOCK_GOAL_MATCH_RECORDINGS.map((r) => r.id).sort(), Object.keys(products).sort());
    const expected = { greek_yogurt: 8.5, apple: 8.5, chips: 3, cola: 1.5, protein_bar: 5.5 } as const;
    for (const [id, product] of Object.entries(products)) {
      const { input } = ready(product);
      const output = await new MockProvider().evaluateGoalMatch(input);
      assert.equal(output.score, expected[id as keyof typeof expected], id);
      const validation = validateGoalMatchAiOutput(output, input);
      assert.ok(validation.valid, `${id}: ${JSON.stringify(validation)}`);
      assert.equal(validation.adjusted, false, id);
      assert.deepEqual(validation.output, output, id);
    }
  });

  it('чипсы без белка (демо AI_PROVIDER=mock): тот же ответ валиден и ничего не утверждает о белке', async () => {
    const { input } = ready(noProtein(CHIPS));
    assert.ok(input.missing.includes('proteinG'));
    const output = await new MockProvider().evaluateGoalMatch(input);
    assert.equal(validateGoalMatchAiOutput(output, input).valid, true);
    assert.ok(!/protein|бел/i.test(JSON.stringify(output)));
  });

  it('mock не копирует v3: оценки отличаются от расчётных, неизвестный продукт → AIUnavailableError', async () => {
    for (const [product, v3] of [[await yogurt(), 8.7], [CHIPS, 4.2], [PROTEIN_BAR, 8.9]] as const) {
      const prepared = ready(product);
      assert.equal(prepared.deterministic.value, v3);
      assert.notEqual((await new MockProvider().evaluateGoalMatch(prepared.input)).score, v3);
    }
    await assert.rejects(new MockProvider().evaluateGoalMatch(ready(PEAR).input),
      (error: unknown) => error instanceof AIUnavailableError && error.code === 'unavailable');
    // Та же «кола», но другая этикетка (ккал) — записи нет, оценка не выдумывается.
    const otherCola = { ...COLA, nutrition: { ...COLA.nutrition!, caloriesKcal: { value: 20, provenance: 'observed' as const } } };
    await assert.rejects(new MockProvider().evaluateGoalMatch(ready(otherCola).input), AIUnavailableError);
  });

  it('MetaProvider.evaluateGoalMatch зарезервирован: запроса нет, ошибка not_implemented', async () => {
    let fetched = false;
    const meta = new MetaProvider({ apiKey: 'test-key', fetch: (async () => { fetched = true; throw new Error('no network'); }) as typeof fetch });
    await assert.rejects(meta.evaluateGoalMatch(), (error: unknown) => error instanceof AIProviderError && error.code === 'not_implemented');
    assert.equal(fetched, false);
  });
});

describe('GOAL_MATCH_AI config', () => {
  const config = (value?: string) => loadAppConfig({ DATABASE_URL: 'postgresql://test', ...(value === undefined ? {} : { GOAL_MATCH_AI: value }) });
  it('по умолчанию off; off → провайдера нет; mock → MockProvider; meta → MetaProvider без вызова', () => {
    assert.equal(config().goalMatchAi.mode, 'off');
    assert.equal(createGoalMatchAIProvider(config()), null);
    assert.equal(createGoalMatchAIProvider(config('off')), null);
    assert.ok(createGoalMatchAIProvider(config('mock')) instanceof MockProvider);
    assert.ok(createGoalMatchAIProvider(config('meta')) instanceof MetaProvider);
  });
  it('неизвестное значение → ошибка конфигурации при запуске', () => {
    for (const value of ['on', 'Mock', '', 'true']) assert.throws(() => config(value), /Unknown GOAL_MATCH_AI/);
  });
});

describe('Scan API + Goal Match v4 (GOAL_MATCH_AI=mock)', () => {
  it('A. completed yogurt rejects a stale fiber_unknown recording and keeps numeric v3 fallback', async () => {
    const product = await yogurt();
    const result = await scan(product, new MockProvider());
    const gm = v4(result);
    assert.equal(gm.source, 'deterministic'); assert.equal(typeof gm.value, 'number');
    assert.equal(gm.ai, null);
    assert.deepEqual(gm.deterministic, matchGoal(estimateMissingNutrition(product), eatHealthierPlan()));
    assert.equal(gm.confidence, 'medium');
    assert.deepEqual(result.score, scoreProduct(estimateMissingNutrition(product)));
    assert.equal(result.score.value, 9.4);
  });

  it('B. чипсы: v3 4.2 → AI 3.0', async () => {
    const gm = v4(await scan(CHIPS, new MockProvider()));
    assert.equal(gm.source, 'ai'); assert.equal(gm.value, 3); assert.equal(gm.deterministic.value, 4.2); assert.equal(gm.adjusted, false);
  });

  it('C. протеиновый батончик: AI существенно снижает слишком оптимистичную v3 8.9, итог не выше Product Score', async () => {
    const result = await scan(PROTEIN_BAR, new MockProvider());
    const gm = v4(result);
    assert.equal(gm.deterministic.value, 8.9);
    assert.equal(gm.source, 'ai'); assert.equal(gm.value, Math.min(5.5, result.score.value!)); assert.equal(gm.adjusted, false); assert.equal(gm.ai_disagreement, false);
    assert.deepEqual(gm.ai!.warnings, ['sweeteners']);
  });

  it('D. галлюцинация: кола 9.0 при v3 2.5 → source deterministic, 2.5, ai_disagreement', async () => {
    const ai = new MockProvider({ goalMatchRecordings: [recording('cola', 'кола', 42, COLA_HALLUCINATION)] });
    const gm = v4(await scan(COLA, ai));
    assert.equal(gm.source, 'deterministic'); assert.equal(gm.value, 2.5); assert.equal(gm.ai_disagreement, true);
    assert.equal(gm.ai, null); assert.equal(gm.adjusted, false); assert.equal(gm.confidence, 'medium');
    assert.deepEqual(gm.factors, gm.deterministic.factors);
  });

  it('E. умеренное расхождение: чипсы 6.5 → прижато к 5.7, adjusted, итог не выше Product Score', async () => {
    const ai = new MockProvider({ goalMatchRecordings: [recording('chips', 'чипсы', 536, CHIPS_TOO_HIGH)] });
    const result = await scan(CHIPS, ai);
    const gm = v4(result);
    assert.equal(gm.source, 'ai'); assert.equal(gm.adjusted, true); assert.equal(gm.value, Math.min(5.7, result.score.value!));
    assert.equal(gm.ai!.score, 6.5); assert.equal(gm.confidence, 'medium');
  });

  it('F. AI недоступен (нет записи или ошибка провайдера) → скан успешен, расчётный fallback', async () => {
    const unknown = await scan(PEAR, new MockProvider());
    const gm = v4(unknown);
    assert.equal(gm.source, 'deterministic'); assert.equal(gm.ai, null); assert.equal(gm.ai_disagreement, false);
    assert.equal(gm.value, Math.min(matchGoal(PEAR, eatHealthierPlan()).value!, unknown.score.value!));
    assert.deepEqual(unknown.score, scoreProduct(PEAR));
    const broken = { name: 'broken', evaluateGoalMatch: async () => { throw new AIProviderError('broken', 'unavailable', 'secret details'); } } as unknown as AIProvider;
    const failed = await scan(CHIPS, broken);
    const fallback = v4(failed);
    assert.equal(fallback.source, 'deterministic'); assert.equal(fallback.value, Math.min(4.2, failed.score.value!));
    assert.ok(!JSON.stringify(fallback).includes('secret'));
    const crashing = { name: 'crashing', evaluateGoalMatch: () => { throw new TypeError('boom'); } } as unknown as AIProvider;
    const crashed = await scan(CHIPS, crashing);
    assert.equal(v4(crashed).value, Math.min(4.2, crashed.score.value!));
  });

  it('G. таймаут AI → скан не падает, расчётный fallback; по умолчанию 8 секунд', async () => {
    assert.equal(GOAL_MATCH_AI_TIMEOUT_MS, 8000);
    const hanging = { name: 'hanging', evaluateGoalMatch: () => new Promise<never>(() => undefined) } as unknown as AIProvider;
    const startedAt = Date.now();
    const result = await scan(CHIPS, hanging, eatHealthierPlan(), 30);
    assert.ok(Date.now() - startedAt < 2000);
    const gm = v4(result);
    assert.equal(gm.source, 'deterministic'); assert.equal(gm.value, Math.min(4.2, result.score.value!)); assert.equal(result.score.value, scoreProduct(withIngredientFacts(CHIPS)).value);
    const evaluation = await new GoalMatchService(hanging, { timeoutMs: 30 }).evaluate(CHIPS, eatHealthierPlan());
    assert.equal(evaluation.outcome, 'ai_timeout'); assert.equal(evaluation.aiCalls, 1);
  });

  it('H. невалидный ответ дважды → ровно 2 вызова и fallback; невалидный, затем валидный → AI', async () => {
    const twice = spyGoalMatch(new MockProvider({ goalMatchRecordings: [recording('chips', 'чипсы', 536, INVALID_OUTPUT, INVALID_OUTPUT, CHIPS_TOO_HIGH)] }));
    const evaluation = await new GoalMatchService(twice).evaluate(CHIPS, eatHealthierPlan());
    assert.equal(twice.inputs.length, 2); assert.equal(evaluation.aiCalls, 2); assert.equal(evaluation.outcome, 'ai_invalid');
    assert.equal(evaluation.goalMatch.source, 'deterministic'); assert.equal(evaluation.goalMatch.value, 4.2);
    assert.equal(evaluation.goalMatch.confidence, 'medium');
    const retry = spyGoalMatch(new MockProvider({ goalMatchRecordings: [recording('chips', 'чипсы', 536, INVALID_OUTPUT, MOCK_GOAL_MATCH_RECORDINGS.find((r) => r.id === 'chips')!.responses[0])] }));
    const recovered = await new GoalMatchService(retry).evaluate(CHIPS, eatHealthierPlan());
    assert.equal(retry.inputs.length, 2); assert.equal(recovered.outcome, 'ai_accepted');
    assert.equal(recovered.goalMatch.source, 'ai'); assert.equal(recovered.goalMatch.value, 3);
  });

  it('I. truly missing calories at the Goal Match boundary remain terminal', async () => {
    const ai = spyGoalMatch(new MockProvider());
    const product = noCalories(CHIPS);
    const gm = (await new GoalMatchService(ai).evaluate(product, eatHealthierPlan())).goalMatch;
    assert.equal(ai.inputs.length, 0);
    assert.equal(gm.state, 'insufficient_data'); assert.equal(gm.unavailableReason, 'no_calories');
    assert.equal(gm.value, null); assert.equal(gm.source, 'deterministic'); assert.equal(gm.ai, null);
    assert.deepEqual(gm.deterministic, matchGoal(product, eatHealthierPlan()));
  });

  it('J. conflict (аллерген молоко) → AI не вызывается, conflict остаётся hard guard', async () => {
    const ai = spyGoalMatch(new MockProvider());
    const gm = v4(await scan(await yogurt(), ai, eatHealthierPlan({ allergens: ['milk'] })));
    assert.equal(ai.inputs.length, 0);
    assert.equal(gm.level, 'conflict'); assert.equal(gm.value, 0); assert.equal(gm.source, 'deterministic');
  });

  it('K. API uses estimated protein while the raw boundary still validates missing protein', async () => {
    const product = noProtein(CHIPS);
    const ai = spyGoalMatch(new MockProvider());
    const gm = v4(await scan(product, ai));
    assert.equal(ai.inputs.length, 1);
    const input = ai.inputs[0] as GoalMatchAiInput;
    assert.ok(!input.missing.includes('proteinG'));
    assert.equal(typeof input.product.per100.proteinG, 'number');
    assert.equal(gm.source, 'ai'); assert.equal(gm.value, 3);
    assert.equal(validateGoalMatchAiOutput(CHIPS_PROTEIN_CLAIM, input).valid, true);
    assert.equal(validateGoalMatchAiOutput(CHIPS_PROTEIN_CLAIM, ready(product).input).valid, false);
    const claiming = spyGoalMatch(new MockProvider({ goalMatchRecordings: [recording('chips', 'чипсы', 536, CHIPS_PROTEIN_CLAIM)] }));
    const rejected = await new GoalMatchService(claiming).evaluate(product, eatHealthierPlan());
    assert.equal(claiming.inputs.length, 2); assert.equal(rejected.outcome, 'ai_invalid');
    assert.equal(rejected.goalMatch.source, 'deterministic'); assert.equal(rejected.goalMatch.value, matchGoal(product, eatHealthierPlan()).value);
  });

  it('L. GOAL_MATCH_AI=off: ответ совпадает с текущей v3 и со ScanService без Goal Match v4', async () => {
    for (const product of [await yogurt(), CHIPS, PROTEIN_BAR, COLA, noProtein(CHIPS), noCalories(CHIPS)]) {
      const off = await scan(product, null);
      const legacy = await new ScanService(scanning(product), plans(eatHealthierPlan())).analyze(FILE, USER_ID);
      assert.deepEqual(off, legacy);
      assert.deepEqual(off.goalMatch, limitByProductScore(matchGoal(withIngredientFacts(estimateMissingNutrition(product)), eatHealthierPlan()), off.score));
      assert.equal(off.goalMatch.version, 'goal-match-v3');
    }
    const offService = new GoalMatchService(createGoalMatchAIProvider(loadAppConfig({ DATABASE_URL: 'postgresql://test' })));
    assert.equal(offService.enabled, false);
  });

  it('другие цели и отсутствие профиля не меняются даже при GOAL_MATCH_AI=mock', async () => {
    const product = await yogurt();
    for (const goal of ['lose_weight', 'maintain_weight', 'gain_weight'] as const) {
      const ai = spyGoalMatch(new MockProvider());
      const plan = eatHealthierPlan({ goal });
      const result = await scan(product, ai, plan);
      assert.equal(ai.inputs.length, 0);
      assert.deepEqual(result.goalMatch, matchGoal(product, plan));
    }
    const noProfile = await new ScanService(scanning(product), plans(null), new GoalMatchService(new MockProvider())).analyze(FILE, USER_ID);
    assert.deepEqual(noProfile.goalMatch, matchGoal(product, null));
  });
});

describe('Goal Match AI cache', () => {
  it('повторный скан того же продукта берёт проверенный ответ из кэша, без вызова AI', async () => {
    const ai = spyGoalMatch(new MockProvider());
    const service = new GoalMatchService(ai);
    const first = await service.evaluate(CHIPS, eatHealthierPlan());
    const second = await service.evaluate(CHIPS, eatHealthierPlan());
    assert.equal(ai.inputs.length, 1);
    assert.equal(first.cacheHit, false); assert.equal(first.goalMatch.ai!.cacheHit, false);
    assert.equal(second.cacheHit, true); assert.equal(second.aiCalls, 0); assert.equal(second.goalMatch.ai!.cacheHit, true);
    assert.equal(second.goalMatch.value, first.goalMatch.value);
    // Другой план → другой AI input → новый вызов.
    await service.evaluate(CHIPS, eatHealthierPlan({ targets: { ...eatHealthierPlan().targets, caloriesKcal: 1800 } }));
    assert.equal(ai.inputs.length, 2);
  });

  it('невалидный ответ и недоступный AI не кэшируются', async () => {
    const ai = spyGoalMatch(new MockProvider({ goalMatchRecordings: [recording('chips', 'чипсы', 536, INVALID_OUTPUT)] }));
    const service = new GoalMatchService(ai);
    await service.evaluate(CHIPS, eatHealthierPlan()); await service.evaluate(CHIPS, eatHealthierPlan());
    assert.equal(ai.inputs.length, 4);
    const unknown = spyGoalMatch(new MockProvider());
    const other = new GoalMatchService(unknown);
    await other.evaluate(PEAR, eatHealthierPlan()); await other.evaluate(PEAR, eatHealthierPlan());
    assert.equal(unknown.inputs.length, 2);
  });

  it('ключ учитывает input, его версию, версию промпта и провайдера/модель; порядок полей не важен', () => {
    const input = ready(CHIPS).input;
    const mock = { name: 'mock', model: MOCK_GOAL_MATCH_MODEL };
    const key = goalMatchAiCacheKey(input, mock);
    assert.match(key, /^[0-9a-f]{64}$/);
    const reordered = Object.fromEntries(Object.entries(input).reverse()) as unknown as GoalMatchAiInput;
    assert.equal(goalMatchAiCacheKey(reordered, mock), key);
    assert.notEqual(goalMatchAiCacheKey(input, { name: 'meta', model: 'muse-spark-1.3' }), key);
    assert.notEqual(goalMatchAiCacheKey(input, { name: 'mock', model: 'mock-goal-match-recordings-v2' }), key);
    assert.notEqual(goalMatchAiCacheKey(ready(APPLE).input, mock), key);
  });

  it('LRU: ограниченный размер, вытесняется давно не использованная запись', () => {
    const cache = new GoalMatchAiCache(2);
    const entry = { output: CHIPS_TOO_HIGH, adjusted: false };
    cache.set('a', entry); cache.set('b', entry);
    assert.ok(cache.get('a'));
    cache.set('c', entry);
    assert.equal(cache.size, 2); assert.equal(cache.get('b'), undefined); assert.ok(cache.get('a')); assert.ok(cache.get('c'));
    assert.equal(new GoalMatchAiCache().size, 0);
    assert.throws(() => new GoalMatchAiCache(0));
  });
});
