import type { GoalMatchAiInput, GoalMatchAiOutput } from '@foodlens/core';

/** Идентичность «модели» для кэша и метаданных: меняется вместе с записанными ответами. */
export const MOCK_GOAL_MATCH_MODEL = 'mock-goal-match-recordings-v1';

/**
 * Заранее записанный ответ AI для одного демо-продукта. Продукт узнаётся по названию и калорийности
 * на 100 г/мл, а не по баллу v3: mock ничего не вычисляет и v3 не копирует.
 * responses: ответы на последовательные вызовы (последний повторяется). По умолчанию один ответ.
 */
export interface MockGoalMatchRecording {
  readonly id: string;
  /** Подстроки названия в нижнем регистре (ё = е). */
  readonly names: readonly string[];
  readonly kcalPer100: number;
  readonly responses: readonly [GoalMatchAiOutput, ...GoalMatchAiOutput[]];
}

const output = (o: Omit<GoalMatchAiOutput, 'version'>): GoalMatchAiOutput => ({ version: 'goal-match-ai-v1', ...o });

/**
 * Ответы составлены по рубрике eat-healthier-rubric-v1 (оценки из колонки AI sanity matrix) и проходят
 * настоящий validateGoalMatchAiOutput (тест в apps/api). Тексты без чисел, зависящих от плана пользователя,
 * и без упоминаний белка там, где белок может быть не прочитан (чипсы в демо AI_PROVIDER=mock).
 */
export const MOCK_GOAL_MATCH_RECORDINGS: readonly MockGoalMatchRecording[] = [
  {
    id: 'greek_yogurt', names: ['греческий йогурт', 'greek yogurt'], kcalPer100: 66,
    responses: [output({
      band: 'good_fit', score: 8.5, confidence: 'high',
      dimensions: { nutrientDensity: 'strong_positive', processing: 'positive', sugar: 'positive',
        fatQuality: 'neutral', sodium: 'positive', portion: 'positive' },
      factors: [
        { code: 'high_protein', direction: 'positive', impact: 'high',
          facts: ['facts.perServing.proteinG', 'facts.levels.protein'], text: 'High in protein per serving.' },
        { code: 'whole_food', direction: 'positive', impact: 'medium',
          facts: ['semantics.processing.value'], text: 'Simple ingredients, minimally processed.' },
        { code: 'low_salt', direction: 'positive', impact: 'low',
          facts: ['product.per100.saltG'], text: 'Almost no salt.' },
      ],
      summary: 'A good pick for your goal: high in protein with simple ingredients.',
      warnings: ['fiber_unknown'],
    })],
  },
  {
    id: 'apple', names: ['яблок', 'apple'], kcalPer100: 52,
    responses: [output({
      band: 'good_fit', score: 8.5, confidence: 'high',
      dimensions: { nutrientDensity: 'positive', processing: 'strong_positive', sugar: 'neutral',
        fatQuality: 'neutral', sodium: 'positive', portion: 'positive' },
      factors: [
        { code: 'whole_food', direction: 'positive', impact: 'high',
          facts: ['semantics.processing.value'], text: 'Whole, unprocessed fruit.' },
        { code: 'fiber_source', direction: 'positive', impact: 'medium',
          facts: ['facts.perServing.fiberG', 'facts.levels.fiber'], text: 'A good source of fiber.' },
        { code: 'intrinsic_sugar', direction: 'positive', impact: 'low',
          facts: ['semantics.sugarSource.value'], text: 'The sugar comes from the fruit itself.' },
      ],
      summary: 'Whole fruit with fiber, and its sugar comes from the fruit itself.',
      warnings: [],
    })],
  },
  {
    id: 'chips', names: ['чипсы', 'chips'], kcalPer100: 536,
    responses: [output({
      band: 'poor_fit', score: 3, confidence: 'high',
      dimensions: { nutrientDensity: 'negative', processing: 'strong_negative', sugar: 'neutral',
        fatQuality: 'negative', sodium: 'strong_negative', portion: 'neutral' },
      factors: [
        { code: 'ultra_processed', direction: 'negative', impact: 'high',
          facts: ['semantics.processing.value'], text: 'Ultra-processed snack.' },
        { code: 'high_salt', direction: 'negative', impact: 'medium',
          facts: ['facts.perServing.saltG', 'facts.levels.salt'], text: 'A lot of salt for a small serving.' },
      ],
      summary: 'An ultra-processed salty snack that fits your goal poorly.',
      warnings: [],
    })],
  },
  {
    id: 'cola', names: ['кола', 'cola'], kcalPer100: 42,
    responses: [output({
      band: 'very_poor_fit', score: 1.5, confidence: 'high',
      dimensions: { nutrientDensity: 'strong_negative', processing: 'strong_negative', sugar: 'strong_negative',
        fatQuality: 'neutral', sodium: 'neutral', portion: 'negative' },
      factors: [
        { code: 'high_sugar', direction: 'negative', impact: 'high',
          facts: ['facts.share.freeSugarLimitPct', 'facts.levels.freeSugar'], text: 'One serving is 70% of your daily free sugar limit.' },
        { code: 'ultra_processed', direction: 'negative', impact: 'medium',
          facts: ['semantics.processing.value'], text: 'Ultra-processed drink.' },
      ],
      summary: 'A sugary soda that does little for your goal.',
      warnings: [],
    })],
  },
  {
    id: 'protein_bar', names: ['протеиновый батончик', 'protein bar'], kcalPer100: 350,
    responses: [output({
      band: 'mixed_fit', score: 5.5, confidence: 'high',
      dimensions: { nutrientDensity: 'positive', processing: 'strong_negative', sugar: 'neutral',
        fatQuality: 'neutral', sodium: 'neutral', portion: 'neutral' },
      factors: [
        { code: 'sweeteners', direction: 'negative', impact: 'high',
          facts: ['product.ingredients'], text: 'Contains a sweetener.' },
        { code: 'ultra_processed', direction: 'negative', impact: 'medium',
          facts: ['semantics.processing.value'], text: 'Ultra-processed bar.' },
        { code: 'high_protein', direction: 'positive', impact: 'medium',
          facts: ['facts.perServing.proteinG', 'facts.levels.protein'], text: 'High in protein.' },
      ],
      summary: 'High in protein, but it is an ultra-processed bar with a sweetener.',
      warnings: ['sweeteners'],
    })],
  },
];

const normalize = (s: string) => s.toLowerCase().replace(/ё/gu, 'е');

export function findMockGoalMatchRecording(
  input: GoalMatchAiInput,
  recordings: readonly MockGoalMatchRecording[],
): MockGoalMatchRecording | null {
  const name = input.product.name === null ? '' : normalize(input.product.name);
  return recordings.find((r) => r.names.some((n) => name.includes(normalize(n))) &&
    Math.abs(input.product.per100.kcal - r.kcalPer100) <= 1) ?? null;
}
