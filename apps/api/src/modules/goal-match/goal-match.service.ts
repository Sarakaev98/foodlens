import { Logger } from '@nestjs/common';
import { AIProviderError, type GoalMatchEvaluator } from '@foodlens/ai';
import type { GoalMatchAiOutput, GoalMatchUserPlan, GoalMatchV4, Product } from '@foodlens/core';
import { prepareGoalMatchV4, reconcileGoalMatch, validateGoalMatchAiOutput } from '@foodlens/scoring';
import { GoalMatchAiCache, goalMatchAiCacheKey, type CachedGoalMatchAi } from './goal-match-ai-cache';

/** Из архитектурного документа: дольше ждать второй AI-вызов нельзя, дальше расчётный fallback. */
export const GOAL_MATCH_AI_TIMEOUT_MS = 8000;
/** Один повтор после невалидного ответа, без бесконечных retry. */
export const GOAL_MATCH_AI_MAX_ATTEMPTS = 2;

/**
 * Чем закончился AI Goal Match. Только для логов и тестов: в ответ API попадают source / adjusted / ai_disagreement,
 * внутренние тексты ошибок пользователю не уходят.
 */
export type GoalMatchAiOutcome =
  | 'terminal' | 'ai_accepted' | 'ai_adjusted' | 'ai_disagreement' | 'ai_unavailable' | 'ai_timeout' | 'ai_invalid';

export interface GoalMatchEvaluation {
  readonly goalMatch: GoalMatchV4;
  readonly outcome: GoalMatchAiOutcome;
  /** Сколько раз вызван provider.evaluateGoalMatch (0 для terminal и попадания в кэш). */
  readonly aiCalls: number;
  readonly cacheHit: boolean;
}

export interface GoalMatchServiceOptions {
  readonly timeoutMs?: number;
  readonly cache?: GoalMatchAiCache;
}

class GoalMatchAiTimeoutError extends Error {}

type Attempt =
  | { readonly kind: 'valid'; readonly value: CachedGoalMatchAi }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'failed'; readonly outcome: 'ai_unavailable' | 'ai_timeout' };

/**
 * Оркестрация Goal Match v4 для eat_healthier:
 * v3 и guards (prepareGoalMatchV4) → AI input → provider.evaluateGoalMatch (таймаут, кэш, один retry)
 * → validateGoalMatchAiOutput → reconcileGoalMatch → GoalMatchV4.
 * Код решает, что можно показать: terminal-состояния v3 до AI не доходят, ограничения профиля применяет reconcile.
 */
export class GoalMatchService {
  private readonly logger = new Logger(GoalMatchService.name);
  private readonly timeoutMs: number;
  private readonly cache: GoalMatchAiCache;

  /** provider = null: GOAL_MATCH_AI=off, сервис выключен и ScanService использует прежний matchGoal. */
  constructor(private readonly provider: GoalMatchEvaluator | null, options: GoalMatchServiceOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? GOAL_MATCH_AI_TIMEOUT_MS;
    this.cache = options.cache ?? new GoalMatchAiCache();
  }

  get enabled(): boolean {
    return this.provider !== null;
  }

  async evaluate(product: Product, plan: GoalMatchUserPlan, requestId?: string): Promise<GoalMatchEvaluation> {
    if (!this.provider) throw new Error('GoalMatchService is disabled (GOAL_MATCH_AI=off)');
    if (plan.goal !== 'eat_healthier') throw new Error('Goal Match v4 supports eat_healthier only');
    const provider = this.provider;
    const prepared = prepareGoalMatchV4(product, plan);
    if (prepared.state === 'terminal') {
      return { goalMatch: prepared.result, outcome: 'terminal', aiCalls: 0, cacheHit: false };
    }

    const identity = { name: provider.name, model: providerModel(provider) };
    const key = goalMatchAiCacheKey(prepared.input, identity);
    let accepted = this.cache.get(key) ?? null;
    const cacheHit = accepted !== null;
    let aiCalls = 0, invalid = false;
    let failure: 'ai_unavailable' | 'ai_timeout' | null = null;

    while (!accepted && aiCalls < GOAL_MATCH_AI_MAX_ATTEMPTS) {
      aiCalls++;
      const attempt = await this.attempt(provider, prepared.input, requestId, aiCalls);
      if (attempt.kind === 'valid') {
        accepted = attempt.value;
        this.cache.set(key, accepted);
      } else if (attempt.kind === 'invalid') {
        invalid = true;
      } else {
        failure = attempt.outcome;
        break;
      }
    }

    const goalMatch = reconcileGoalMatch({
      ai: accepted?.output ?? null,
      deterministic: prepared.deterministic,
      deterministicBase: prepared.deterministicBase,
      riskRamps: prepared.riskRamps,
      restrictions: prepared.restrictions,
      dataConfidence: prepared.dataConfidence,
      validationAdjusted: accepted?.adjusted ?? false,
      ...(accepted ? {} : invalid ? { aiStatus: 'invalid' as const } : { aiStatus: 'unavailable' as const }),
      metadata: { model: identity.model, cacheHit },
    });
    const outcome: GoalMatchAiOutcome = goalMatch.source === 'ai' ? (goalMatch.adjusted ? 'ai_adjusted' : 'ai_accepted')
      : goalMatch.ai_disagreement ? 'ai_disagreement' : failure ?? (invalid ? 'ai_invalid' : 'ai_unavailable');
    return { goalMatch, outcome, aiCalls, cacheHit };
  }

  private async attempt(provider: GoalMatchEvaluator, input: Parameters<GoalMatchEvaluator['evaluateGoalMatch']>[0],
    requestId: string | undefined, attempt: number): Promise<Attempt> {
    let raw: GoalMatchAiOutput;
    try {
      raw = await withTimeout(Promise.resolve().then(() => provider.evaluateGoalMatch(input)), this.timeoutMs);
    } catch (error) {
      const outcome = error instanceof GoalMatchAiTimeoutError ? 'ai_timeout' : 'ai_unavailable';
      // Только код ошибки: тексты провайдера в лог и в ответ не попадают.
      const code = error instanceof AIProviderError ? error.code : error instanceof GoalMatchAiTimeoutError ? 'timeout' : 'unexpected';
      this.logger.warn(`goal match AI failed ${JSON.stringify({ requestId, provider: provider.name, attempt, outcome, code })}`);
      return { kind: 'failed', outcome };
    }
    const validation = validateGoalMatchAiOutput(raw, input);
    if (validation.valid) return { kind: 'valid', value: { output: validation.output, adjusted: validation.adjusted } };
    this.logger.warn(`goal match AI response rejected ${JSON.stringify({ requestId, provider: provider.name, attempt, errors: validation.errors })}`);
    return { kind: 'invalid' };
  }
}

function providerModel(provider: GoalMatchEvaluator): string {
  const model = (provider as GoalMatchEvaluator & { readonly model?: unknown }).model;
  return typeof model === 'string' && model ? model : provider.name;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new GoalMatchAiTimeoutError()), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });
}
