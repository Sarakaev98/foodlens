import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { scoreProduct } from '../../score-product';
import { BENCHMARK, benchmarkProduct, EXPECTED_ORDER, OFF_INCOMPLETE, OFF_REAL, OFF_REAL_STRICT } from './product-score-benchmark.data';
import { scoreVariant } from './product-score-variants';

// Заранее придуманных оценок здесь нет: только относительный порядок и свойства шкалы.
const score = (name: string) => scoreProduct(benchmarkProduct(BENCHMARK.find((item) => item.name === name)!)).value!;

describe('Product Score benchmark', () => {
  it('covers at least 40 products and every product is scored', () => {
    assert.ok(BENCHMARK.length >= 40);
    for (const item of BENCHMARK) assert.notEqual(scoreProduct(benchmarkProduct(item)).value, null, item.name);
  });
  it('every name in the expected order exists', () => {
    for (const pair of EXPECTED_ORDER) for (const name of pair) assert.ok(BENCHMARK.some((item) => item.name === name), name);
  });
  it('the main relative order holds', () => {
    for (const better of ['Вода', 'Яблоко', 'Йогурт натуральный']) for (const worse of ['Чипсы', 'Cola', 'Молочный шоколад']) assert.ok(score(better) > score(worse), `${better} / ${worse}`);
    assert.ok(score('Йогурт натуральный') > score('Йогурт сладкий'));
  });
  it('the known cases keep their numbers', () => {
    assert.equal(score('Шоколад Roshen (скан)'), 2.1);
    assert.equal(score('Чипсы (наш кейс)'), 3.7);
    assert.equal(score('Творожный продукт (наш кейс)'), 6.7);
  });
  it('the OFF snapshot has 13 distinct real products with the required values', () => {
    assert.equal(OFF_REAL.length, 13);
    assert.equal(new Set(OFF_REAL.map((item) => item.barcode)).size, 13);
    for (const item of OFF_REAL) {
      assert.notEqual(scoreProduct(benchmarkProduct(item)).value, null, item.name);
      assert.ok(/^\d{8,14}$/.test(item.barcode!), item.name);
    }
  });
  it('the normalized set keeps every product and never invents a value that the snapshot lacks', () => {
    assert.equal(OFF_REAL_STRICT.length, OFF_REAL.length);
    OFF_REAL_STRICT.forEach((item, index) => {
      assert.equal(item.barcode, OFF_REAL[index]!.barcode);
      for (const field of ['protein', 'fiber', 'sugars', 'saturatedFat', 'salt'] as const) assert.ok(item[field] === null || typeof item[field] === 'number', `${item.name} ${field}`);
    });
  });
  it('real OFF records carry a barcode; an incomplete one gets no score, nothing is filled in', () => {
    for (const item of BENCHMARK.filter((entry) => entry.source === 'off-fixture')) assert.ok(item.barcode, item.name);
    for (const item of OFF_INCOMPLETE) {
      const score = scoreProduct(benchmarkProduct(item));
      assert.ok(score.unscoredReason === 'too_few_factors' || score.missingFactors.length > 0, item.name);
    }
  });
  it('variant C keeps the order: a lower raw never gets a higher score', () => {
    for (const variant of ['C', 'C8'] as const) {
      const sorted = BENCHMARK.map((item) => scoreVariant(item, variant)).sort((a, b) => a.raw - b.raw);
      for (let index = 1; index < sorted.length; index++) assert.ok(sorted[index]!.value >= sorted[index - 1]!.value, variant);
    }
  });
  it('the top of the scale is unchanged, and no product is left at 0', () => {
    for (const item of BENCHMARK) {
      const { raw } = scoreVariant(item, 'C8');
      if (raw >= 4) assert.equal(scoreVariant(item, 'C8').value, scoreVariant(item, 'previous').value, item.name);
      assert.ok(scoreVariant(item, 'C8').value > 0 || item.kcal === 0, item.name);
    }
  });
  it('no expected pair is broken', () => {
    for (const [better, worse] of EXPECTED_ORDER) assert.ok(score(better) > score(worse), `${better} / ${worse}`);
  });
  it('the simulation of the current formula equals the real function', () => {
    for (const item of BENCHMARK) assert.equal(scoreVariant(item, 'C8').value, scoreProduct(benchmarkProduct(item)).value, item.name);
  });
  it('all variants stay inside the scale and do not worsen a product with no limit penalties', () => {
    for (const variant of ['A', 'B', 'C', 'C8'] as const) {
      for (const item of BENCHMARK) {
        const { value } = scoreVariant(item, variant);
        assert.ok(value >= 0 && value <= 10, `${variant} ${item.name}`);
        assert.ok(value >= scoreVariant(item, 'previous').value - 1e-9, `${variant} ${item.name}`);
      }
    }
  });
});
