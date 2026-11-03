import type { ScoreFactor } from '@foodlens/core';
import { roundScore, scoreProduct } from '../../score-product';
import { BASE_SCORE, ENERGY_RULE, HIGH_LEVEL_CEILING, LOW_SCALE_FLOOR, REQUIRED_FACTORS, SALT_RULE, SATURATED_FAT_RULE, SUGARS_RULE, type LimitRule, type ProductForm } from '../../product-score-rules';
import { benchmarkProduct, type BenchmarkItem } from './product-score-benchmark.data';

/** Симуляция вариантов калибровки на факторах настоящего scoreProduct(). В коде приложения ничего не меняет. */
/** previous: формула v2 без сжатия низа. C8: действующая формула. */
export type Variant = 'previous' | 'A' | 'B' | 'C' | 'C8';

const RULES: Readonly<Record<'sugars' | 'saturatedFat' | 'salt' | 'energy', LimitRule>> = { sugars: SUGARS_RULE, saturatedFat: SATURATED_FAT_RULE, salt: SALT_RULE, energy: ENERGY_RULE };
const LIMITS = ['sugars', 'saturatedFat', 'salt', 'energy'] as const;
/** Вариант A: сумма пределов сахара и насыщенных жиров меньше базы. */
const A_MAX: Readonly<Record<(typeof LIMITS)[number], number>> = { sugars: 4, saturatedFat: 3.5, salt: 3.5, energy: 1.5 };
/** Вариант B: те же штрафы, но второй и следующие риски считаются с убывающим весом. */
const B_WEIGHTS = [1, 0.6, 0.4, 0.3] as const;
/** Вариант C: ниже потолка шкала сжимается линейно от нижней точки raw. Теоретический минимум формулы и точка около реального низа набора. */
const C_WORST_RAW = BASE_SCORE - 6 - 5 - 5 - 2.5 - 2;
const C8_LOW_RAW = LOW_SCALE_FLOOR;

const penalty = (factor: ScoreFactor, rule: LimitRule, form: ProductForm): number => {
  if (factor.value === null) return 0;
  // Округление как у настоящего фактора: иначе сравнение с текущей оценкой расходится на 0.1.
  return Math.round((rule.weight[form] * Math.max(0, factor.value - rule.lowMax[form]) * 100) / (rule.highAbove[form] - rule.lowMax[form])) / 100;
};

export interface VariantResult {
  readonly value: number;
  readonly raw: number;
}

export function scoreVariant(item: BenchmarkItem, variant: Variant): VariantResult {
  const score = scoreProduct(benchmarkProduct(item));
  const form: ProductForm = item.unit === 'ml' ? 'drink' : 'food';
  const byKind = Object.fromEntries(score.factors.map((factor) => [factor.kind, factor])) as Record<ScoreFactor['kind'], ScoreFactor>;
  const positive = score.factors.reduce((sum, factor) => sum + Math.max(0, factor.points), 0);
  const additives = -byKind.additives.points;
  const current = LIMITS.map((kind) => -byKind[kind].points);
  const severe = REQUIRED_FACTORS.some((kind) => byKind[kind].level === 'high');
  const finish = (raw: number) => ({ raw: Math.round(raw * 100) / 100, value: roundScore(severe ? Math.min(raw, HIGH_LEVEL_CEILING) : raw) });
  const rawCurrent = score.factors.reduce((sum, factor) => sum + factor.points, BASE_SCORE);

  if (variant === 'A') {
    const reduced = LIMITS.map((kind) => Math.min(A_MAX[kind], penalty(byKind[kind], RULES[kind], form)));
    return finish(BASE_SCORE + positive - additives - reduced.reduce((sum, item) => sum + item, 0));
  }
  if (variant === 'B') {
    const ordered = [...current].sort((a, b) => b - a);
    return finish(BASE_SCORE + positive - additives - ordered.reduce((sum, item, index) => sum + item * B_WEIGHTS[index]!, 0));
  }
  if (variant === 'C' || variant === 'C8') {
    const low = variant === 'C' ? C_WORST_RAW : C8_LOW_RAW;
    const compressed = rawCurrent >= HIGH_LEVEL_CEILING ? rawCurrent : (HIGH_LEVEL_CEILING * (rawCurrent - low)) / (HIGH_LEVEL_CEILING - low);
    return { raw: Math.round(rawCurrent * 100) / 100, value: roundScore(severe ? Math.min(compressed, HIGH_LEVEL_CEILING) : compressed) };
  }
  return finish(rawCurrent);
}
