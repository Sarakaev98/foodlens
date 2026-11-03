import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GoalMatchV3, ProductScore } from '@foodlens/core';
import { limitByProductScore } from '../goal-match-product-limit';
import { matchGoal } from '../match-goal';
import { scoreProduct } from '../score-product';
import { BENCHMARK, benchmarkProduct } from './benchmark/product-score-benchmark.data';
import { healthPlan } from './eat-healthier.fixtures';
import { FINAL_BENCHMARK, finalBenchmarkProduct } from './final-benchmark.data';

const all = [...BENCHMARK.map((item) => [item.name, scoreProduct(benchmarkProduct(item))] as const), ...FINAL_BENCHMARK.map((item) => [item.name, scoreProduct(finalBenchmarkProduct(item))] as const)];
const known = all.flatMap(([name, score]) => (score.value === null ? [] : [{ name, value: score.value, raw: score.factors.reduce((sum, item) => sum + item.points, 8), capped: score.ceiling?.max ?? null }]));
const value = (name: string) => known.find((item) => item.name.startsWith(name))!.value;

describe('нижняя часть шкалы', () => {
  it('обычные плохие продукты не падают в один ноль', () => {
    const poor = known.filter((item) => item.value < 3);
    assert.ok(poor.length >= 10);
    assert.equal(poor.filter((item) => item.value < 1).length, 0);
    assert.ok(new Set(poor.map((item) => item.value)).size >= 8);
  });
  it('крайний профиль доходит почти до нуля', () => {
    const worst = finalBenchmarkProduct({ name: 'крайний', unit: 'g', values: { caloriesKcal: 650, proteinG: 1, carbsG: 60, sugarsG: 60, fatG: 40, saturatedFatG: 25, saltG: 6 },
      additives: ['E102', 'E211', 'E621', 'E951', 'E471', 'E322'], ingredients: ['сахар', 'ароматизатор'], processing: 'ultra_processed' });
    assert.equal(scoreProduct(worst).value, 0);
  });
  it('полезные продукты остаются высоко', () => {
    for (const name of ['Яблоко', 'Овсянка', 'Йогурт натуральный', 'Яйца', 'Лосось', 'Творог 5%', 'Цельнозерновой хлеб', 'Картофель']) assert.ok(value(name) >= 7, name);
  });
  it('порядок сохраняется: большая сумма не даёт меньшую оценку', () => {
    const plain = known.filter((item) => item.capped === null).sort((a, b) => a.raw - b.raw);
    for (let index = 1; index < plain.length; index++) assert.ok(plain[index]!.value >= plain[index - 1]!.value, plain[index]!.name);
  });
  it('логичные пары', () => {
    for (const [better, worse] of [['Овсянка', 'Сладкие хлопья'], ['Яблоко', 'Карамель'], ['Йогурт натуральный', 'Десертный йогурт'], ['Лосось', 'Варёная колбаса'], ['Картофель', 'Пюре быстрого приготовления'], ['Coca-Cola Zero', 'Coca-Cola Original']] as const) {
      assert.ok(value(better) > value(worse), `${better} / ${worse}`);
    }
  });
});

describe('Goal Match и Product Score', () => {
  const match = (value: number, goal: GoalMatchV3['goal']) => ({ ...(matchGoal(finalBenchmarkProduct(FINAL_BENCHMARK[0]!), healthPlan()) as GoalMatchV3), value, goal, level: 'great', range: { min: value - 1, max: value + 1 } }) as GoalMatchV3;
  const score = (value: number | null) => ({ value }) as ProductScore;

  it('eat_healthier: Goal Match не выше Product Score, уровень и диапазон следуют за ним', () => {
    const limited = limitByProductScore(match(4.1, 'eat_healthier'), score(2.4));
    assert.deepEqual([limited.value, limited.level, limited.range], [2.4, 'poor', { min: 2.4, max: 2.4 }]);
  });
  it('eat_healthier: Goal Match может быть ниже', () => {
    assert.equal(limitByProductScore(match(3.8, 'eat_healthier'), score(5.5)).value, 3.8);
  });
  it('другие цели не ограничиваются, как и оценка без значения', () => {
    assert.equal(limitByProductScore(match(6, 'lose_weight'), score(3)).value, 6);
    assert.equal(limitByProductScore(match(6, 'eat_healthier'), score(null)).value, 6);
  });
  it('ни один продукт benchmark не нарушает правило', () => {
    const plan = healthPlan();
    for (const item of FINAL_BENCHMARK) {
      const product = finalBenchmarkProduct(item);
      const scored = scoreProduct(product);
      const limited = limitByProductScore(matchGoal(product, plan), scored);
      if (limited.value !== null) assert.ok(limited.value <= scored.value!, item.name);
    }
  });
  it('уверенность остаётся в данных и не меняет значение оценки', () => {
    const product = finalBenchmarkProduct(FINAL_BENCHMARK[0]!);
    const low = scoreProduct({ ...product, confidence: { ...product.confidence, nutrition: 'low' } });
    const high = scoreProduct({ ...product, confidence: { ...product.confidence, nutrition: 'high' } });
    assert.equal(low.confidence, 'low'); assert.equal(high.value, low.value);
  });
});
