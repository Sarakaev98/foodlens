import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { scoreProduct } from '../score-product';
import { FINAL_BENCHMARK, finalBenchmarkProduct } from './final-benchmark.data';

const result = (name: string) => scoreProduct(finalBenchmarkProduct(FINAL_BENCHMARK.find((item) => item.name.startsWith(name))!));
const value = (name: string) => result(name).value!;

describe('компактный benchmark: логичный порядок', () => {
  it('цельные и простые продукты в сильной зоне, переработанные в слабой', () => {
    for (const good of ['Яблоко', 'Овсянка', 'Йогурт', 'Яйца', 'Лосось', 'Творог', 'Цельнозерновой']) assert.ok(value(good) >= 7, good);
    for (const poor of ['Rollton', 'Лапша', 'Чипсы', 'Snickers', 'Coca-Cola Original', 'Coca-Cola Zero', 'Наггетсы']) assert.ok(value(poor) < 4, poor);
  });

  it('Rollton с неполными данными: оценка есть, confidence low, слабая зона, потолок ни при чём', () => {
    const rollton = result('Rollton');
    assert.equal(rollton.confidence, 'low');
    assert.deepEqual(rollton.missingFactors, ['sugars', 'saturatedFat', 'salt']);
    assert.equal(rollton.ceiling, null);
    assert.ok(rollton.value! < 4);
  });

  it('Coca-Cola Zero выше Original: сахара нет, но ультрапереработка и подсластители не дают высокой оценки', () => {
    assert.ok(value('Coca-Cola Zero') > value('Coca-Cola Original'));
    assert.ok(value('Coca-Cola Zero') < 4);
  });

  it('яблоко и овсянка выше чипсов и Snickers, Snickers не выше чипсов', () => {
    for (const good of ['Яблоко', 'Овсянка']) for (const poor of ['Чипсы', 'Snickers']) assert.ok(value(good) > value(poor) + 3, `${good} / ${poor}`);
    assert.ok(value('Snickers') <= value('Чипсы'));
  });

  it('оценка есть у каждого продукта', () => {
    for (const item of FINAL_BENCHMARK) assert.notEqual(scoreProduct(finalBenchmarkProduct(item)).value, null, item.name);
  });
});
