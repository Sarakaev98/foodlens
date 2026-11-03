import { createHash } from 'node:crypto';
import type { GoalMatchAiInput, GoalMatchAiMetadata, GoalMatchAiOutput } from '@foodlens/core';

export const GOAL_MATCH_AI_PROMPT_VERSION: GoalMatchAiMetadata['promptVersion'] = 'eat-healthier-rubric-v2';
export const GOAL_MATCH_AI_CACHE_SIZE = 1000;

/** Уже проверенный validator ответ: в кэш не попадает ничего, что не прошло validateGoalMatchAiOutput. */
export interface CachedGoalMatchAi {
  readonly output: GoalMatchAiOutput;
  readonly adjusted: boolean;
}

/** JSON с отсортированными ключами: одинаковый вход даёт одинаковый ключ независимо от порядка полей. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Ключ: канонический AI input, его версия, версия промпта и идентичность провайдера/модели. */
export function goalMatchAiCacheKey(input: GoalMatchAiInput, provider: { readonly name: string; readonly model: string }): string {
  return createHash('sha256').update(canonicalJson({
    inputVersion: input.version, promptVersion: GOAL_MATCH_AI_PROMPT_VERSION,
    provider: provider.name, model: provider.model, input,
  })).digest('hex');
}

/** In-memory LRU на Map: порядок вставки = давность использования, при переполнении удаляется самая старая запись. */
export class GoalMatchAiCache {
  private readonly entries = new Map<string, CachedGoalMatchAi>();

  constructor(private readonly maxEntries = GOAL_MATCH_AI_CACHE_SIZE) {
    if (!Number.isInteger(maxEntries) || maxEntries <= 0) throw new Error('Cache size must be a positive integer');
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: string): CachedGoalMatchAi | undefined {
    const value = this.entries.get(key);
    if (value) {
      this.entries.delete(key);
      this.entries.set(key, value);
    }
    return value;
  }

  set(key: string, value: CachedGoalMatchAi): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value!);
  }
}
