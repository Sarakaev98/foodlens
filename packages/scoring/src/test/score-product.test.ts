import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  NOT_DETECTED,
  observed,
  type Additive,
  type Detected,
  type NutrientKey,
  type NutritionFacts,
  type Product,
  type ProductId,
  type ProductScore,
} from '@foodlens/core';
import { BASE_SCORE, HIGH_LEVEL_CEILING, LOW_SCALE_FLOOR, MAX_BONUS, PRODUCT_SCORE_VERSION } from '../product-score-rules';
import { calibrateLowScale, hasRequiredFactors, roundScore, scoreProduct } from '../score-product';

type Nutrients = Partial<Record<NutrientKey, number | null>>;

function nutrition(values: Nutrients, overrides: Partial<NutritionFacts> = {}): NutritionFacts {
  const value = (key: NutrientKey) => {
    const number = values[key];
    return number === undefined || number === null ? NOT_DETECTED : observed(number);
  };
  return {
    basis: 'per_100g',
    servingSize: NOT_DETECTED,
    caloriesKcal: value('caloriesKcal'),
    proteinG: value('proteinG'),
    carbsG: value('carbsG'),
    sugarsG: value('sugarsG'),
    fatG: value('fatG'),
    saturatedFatG: value('saturatedFatG'),
    fiberG: value('fiberG'),
    saltG: value('saltG'),
    sodiumMg: value('sodiumMg'),
    ...overrides,
  };
}

const drink = (values: Nutrients) => nutrition(values, { basis: 'per_100ml' });

function product(facts: NutritionFacts | null, additives: Detected<readonly Additive[]> = observed([])): Product {
  return {
    id: 'scan_test' as ProductId,
    name: observed('Test'),
    brand: NOT_DETECTED,
    category: NOT_DETECTED,
    nutrition: facts,
    ingredients: observed([{ name: 'x', percent: null }]),
    allergens: observed([]),
    additives,
    confidence: { overall: 'high', identity: 'high', nutrition: 'high', ingredients: 'high' },
    source: { type: 'manual' },
  };
}

const additives = (count: number): Detected<readonly Additive[]> =>
  observed(Array.from({ length: count }, (_, index) => ({ code: `E${100 + index}`, name: null })));

const factor = (score: ProductScore, kind: string) => score.factors.find((item) => item.kind === kind)!;
const score = (facts: NutritionFacts | null, extra?: Detected<readonly Additive[]>) => scoreProduct(product(facts, extra));

/**
 * Типичные значения на 100 г / 100 мл по этикеткам распространённых продуктов (не конкретные бренды).
 * Набор калибровки Product Score v2: те же значения в PRODUCT-SCORE-CALIBRATION.md.
 */
const BENCHMARK = {
  water: score(drink({ caloriesKcal: 0, sugarsG: 0, saturatedFatG: 0, saltG: 0, proteinG: 0 })),
  cola: score(drink({ caloriesKcal: 42, sugarsG: 10.6, saturatedFatG: 0, saltG: 0, proteinG: 0 }), additives(2)),
  orangeJuice: score(drink({ caloriesKcal: 45, sugarsG: 8.4, saturatedFatG: 0, saltG: 0, proteinG: 0.7, fiberG: 0.2 })),
  milk: score(drink({ caloriesKcal: 64, sugarsG: 4.8, saturatedFatG: 2.1, saltG: 0.1, proteinG: 3.3 })),
  /** Те же значения, что у фикстуры MockProvider (греческий йогурт 2%), после нормализатора. */
  greekYogurt: score(nutrition({ caloriesKcal: 66, proteinG: 9.5, carbsG: 3.6, sugarsG: 3.6, fatG: 2, saturatedFatG: 1.3, saltG: 0.1, sodiumMg: 40 })),
  fruitYogurt: score(nutrition({ caloriesKcal: 100, sugarsG: 13, saturatedFatG: 1.7, saltG: 0.13, proteinG: 3.5, fiberG: 0.3 }), additives(2)),
  chips: score(nutrition({ caloriesKcal: 536, sugarsG: 0.6, saturatedFatG: 3.1, saltG: 1.4, proteinG: 6.5, fiberG: 4.4 })),
  milkChocolate: score(nutrition({ caloriesKcal: 535, sugarsG: 56, saturatedFatG: 18.5, saltG: 0.24, proteinG: 7.5, fiberG: 2 }), additives(1)),
  cookies: score(nutrition({ caloriesKcal: 480, sugarsG: 30, saturatedFatG: 10, saltG: 0.9, proteinG: 6, fiberG: 2.5 }), additives(3)),
  skyr: score(nutrition({ caloriesKcal: 63, sugarsG: 3.5, saturatedFatG: 0.1, saltG: 0.1, proteinG: 11 })),
  oats: score(nutrition({ caloriesKcal: 372, sugarsG: 1, saturatedFatG: 1.3, saltG: 0.01, proteinG: 13.5, fiberG: 10 })),
  sausage: score(nutrition({ caloriesKcal: 280, sugarsG: 1, saturatedFatG: 10, saltG: 2.2, proteinG: 12, fiberG: 0 }), additives(4)),
};

const value = (result: ProductScore) => result.value!;

describe('scoreProduct v3: калибровка на типичных продуктах', () => {
  it('ожидаемые оценки набора калибровки', () => {
    const actual = Object.fromEntries(Object.entries(BENCHMARK).map(([name, result]) => [name, result.value]));
    assert.deepEqual(actual, {
      water: 8,
      cola: 3.6,
      orangeJuice: 4.6,
      milk: 6.2,
      greekYogurt: 9.4,
      fruitYogurt: 5.1,
      chips: 3.8,
      milkChocolate: 2.1,
      cookies: 2,
      skyr: 9.5,
      oats: 8.6,
      sausage: 2.5,
    });
  });

  it('порядок разумный: полезное выше умеренного, умеренное выше вредного', () => {
    const { water, cola, orangeJuice, milk, greekYogurt, fruitYogurt, chips, milkChocolate, cookies, skyr, oats, sausage } = BENCHMARK;
    for (const good of [water, greekYogurt, skyr, oats]) assert.ok(value(good) >= 8);
    for (const moderate of [milk, orangeJuice, fruitYogurt]) assert.ok(value(moderate) >= 4 && value(moderate) < 8);
    for (const poor of [cola, chips, milkChocolate, cookies, sausage]) assert.ok(value(poor) < 4);
    assert.ok(value(orangeJuice) > value(cola), 'сок без добавок и с меньшим сахаром выше колы');
    assert.ok(value(milk) > value(orangeJuice));
  });
});

describe('scoreProduct v3: штрафы', () => {
  it('сладкий напиток получает существенный штраф (раньше кола получала 7.0 за «мало жира и соли»)', () => {
    const { cola } = BENCHMARK;
    assert.ok(factor(cola, 'sugars').points <= -4, 'сахар в напитке: штраф не меньше 4 баллов');
    assert.equal(factor(cola, 'saturatedFat').points, 0, '«мало жиров» не добавляет баллов');
    assert.equal(factor(cola, 'saturatedFat').impact, 'positive', 'но показывается как хороший признак');
    assert.ok(value(cola) < HIGH_LEVEL_CEILING);
  });

  it('сахар в напитке штрафуется сильнее, чем то же количество в еде', () => {
    const asDrink = score(drink({ sugarsG: 10, saturatedFatG: 0, saltG: 0 }));
    const asFood = score(nutrition({ sugarsG: 10, saturatedFatG: 0, saltG: 0 }));
    assert.ok(factor(asDrink, 'sugars').points < factor(asFood, 'sugars').points);
  });

  it('много сахара в еде: существенный штраф и потолок', () => {
    const sweet = score(nutrition({ caloriesKcal: 300, sugarsG: 40, saturatedFatG: 0.5, saltG: 0.1 }));
    assert.equal(factor(sweet, 'sugars').level, 'high');
    assert.ok(factor(sweet, 'sugars').points <= -5);
    assert.ok(value(sweet) <= HIGH_LEVEL_CEILING);
  });

  it('много соли: существенный штраф и потолок', () => {
    const salty = score(nutrition({ caloriesKcal: 70, sugarsG: 1, saturatedFatG: 0.2, saltG: 3, proteinG: 2 }));
    assert.equal(factor(salty, 'salt').level, 'high');
    assert.ok(factor(salty, 'salt').points <= -5);
    assert.ok(value(salty) <= HIGH_LEVEL_CEILING);
  });

  it('много насыщенных жиров: существенный штраф и потолок', () => {
    const fatty = score(nutrition({ caloriesKcal: 150, sugarsG: 1, saturatedFatG: 12, saltG: 0.1 }));
    assert.equal(factor(fatty, 'saturatedFat').level, 'high');
    assert.ok(factor(fatty, 'saturatedFat').points <= -5);
    assert.ok(value(fatty) <= HIGH_LEVEL_CEILING);
  });

  it('чипсы: несколько мелких плюсов не перекрывают соль, жир и калорийность (раньше 7.0)', () => {
    const { chips } = BENCHMARK;
    const bonus = chips.factors.reduce((sum, item) => sum + Math.max(0, item.points), 0);
    const penalty = chips.factors.reduce((sum, item) => sum + Math.min(0, item.points), 0);
    assert.ok(bonus < -penalty / 4);
    assert.ok(value(chips) < 4);
  });

  it('потолок: белок и клетчатка не вытягивают продукт с «красным» нутриентом выше 4', () => {
    const sugaryProteinBar = score(nutrition({ caloriesKcal: 70, sugarsG: 23, saturatedFatG: 0.5, saltG: 0.1, proteinG: 20, fiberG: 10 }));
    assert.deepEqual(sugaryProteinBar.ceiling, { max: HIGH_LEVEL_CEILING, factorIds: ['sugars.high'] });
    assert.equal(sugaryProteinBar.value, HIGH_LEVEL_CEILING);
    assert.equal(BENCHMARK.greekYogurt.ceiling, null);
  });

  it('добавки: штраф за каждую, с ограничением', () => {
    const base = nutrition({ caloriesKcal: 60, sugarsG: 1, saturatedFatG: 0.2, saltG: 0.1 });
    assert.equal(factor(score(base, additives(0)), 'additives').points, 0);
    assert.equal(factor(score(base, additives(2)), 'additives').points, -1.3, 'два красителя: длина списка и один класс');
    assert.equal(factor(score(base, additives(10)), 'additives').points, -2.5);
    const allClasses = observed(['E621', 'E951', 'E211', 'E129', 'E330'].map((code) => ({ code, name: null })));
    assert.equal(factor(score(base, allClasses), 'additives').points, -3.5, 'длина и классы ограничены');
    assert.equal(factor(score(base, additives(10)), 'additives').level, 'many');
  });
});

describe('scoreProduct v3: бонусы', () => {
  it('высокий белок и мало минусов — высокая оценка', () => {
    assert.ok(value(BENCHMARK.skyr) >= 9);
    assert.equal(factor(BENCHMARK.skyr, 'protein').points, 1.5);
  });

  it('сумма бонусов ограничена MAX_BONUS', () => {
    const { oats } = BENCHMARK;
    const bonus = oats.factors.reduce((sum, item) => sum + Math.max(0, item.points), 0);
    assert.equal(bonus, MAX_BONUS);
    assert.deepEqual([factor(oats, 'protein').points, factor(oats, 'fiber').points], [1, 1]);
  });
});

describe('scoreProduct v3: данные и инварианты', () => {
  it('фикстура MockProvider (греческий йогурт): 9.4 и понятные причины', () => {
    const yogurt = BENCHMARK.greekYogurt;
    assert.equal(yogurt.value, 9.4);
    assert.deepEqual(
      yogurt.factors.map((item) => [item.id, item.points, item.impact]),
      [
        ['energy.low', 0, 'positive'],
        ['protein.moderate', 1.35, 'positive'],
        ['sugars.low', 0, 'positive'],
        ['saturatedFat.low', 0, 'positive'],
        ['fiber.not_detected', 0, 'neutral'],
        ['salt.low', 0, 'positive'],
        ['additives.none', 0, 'neutral'],
        ['processing.not_detected', 0, 'neutral'],
      ],
    );
  });

  it('отсутствующее значение не считается нулём: фактор не учитывается', () => {
    const withoutFiber = score(nutrition({ caloriesKcal: 120, sugarsG: 3, saturatedFatG: 1, saltG: 0.2, proteinG: 4 }));
    const withZeroFiber = score(nutrition({ caloriesKcal: 120, sugarsG: 3, saturatedFatG: 1, saltG: 0.2, proteinG: 4, fiberG: 0 }));
    assert.deepEqual([factor(withoutFiber, 'fiber').level, factor(withoutFiber, 'fiber').value], ['not_detected', null]);
    assert.deepEqual([factor(withZeroFiber, 'fiber').level, factor(withZeroFiber, 'fiber').value], ['low', 0]);
    const unknownAdditives = score(nutrition({ sugarsG: 3, saturatedFatG: 1, saltG: 0.2 }), NOT_DETECTED);
    assert.equal(factor(unknownAdditives, 'additives').level, 'not_detected');
  });

  it('неизвестное нейтрально: те же известные данные дают ту же оценку, разница только в confidence', () => {
    const known = { caloriesKcal: 450, proteinG: 9, carbsG: 60, fatG: 20 };
    const partial = score(nutrition(known), additives(3));
    const complete = score(nutrition({ ...known, sugarsG: 1, saturatedFatG: 0.5, saltG: 0.1 }), additives(3));
    assert.equal(partial.value, complete.value);
    assert.deepEqual([partial.confidence, complete.confidence], ['low', 'high']);
    assert.equal(partial.ceiling, null);
  });

  it('один неизвестный минус ничего не меняет в оценке и не включает потолок', () => {
    const known = { caloriesKcal: 80, proteinG: 20, fiberG: 8, sugarsG: 1, saturatedFatG: 0.5 };
    assert.equal(score(nutrition(known)).value, score(nutrition({ ...known, saltG: 0.1 })).value);
    assert.equal(score(nutrition(known)).ceiling, null);
  });

  it('два и больше неизвестных минуса: общий потолок защищает только от явно завышенной оценки', () => {
    const onlyGoodNews = score(nutrition({ caloriesKcal: 80, proteinG: 20, fiberG: 8 }), NOT_DETECTED);
    assert.equal(onlyGoodNews.value, 8);
    assert.deepEqual(onlyGoodNews.ceiling?.factorIds, ['sugars.not_detected', 'saturatedFat.not_detected', 'salt.not_detected']);
    assert.equal(onlyGoodNews.confidence, 'low');
    assert.deepEqual(onlyGoodNews.missingFactors, ['sugars', 'saturatedFat', 'salt', 'additives']);
    assert.equal(hasRequiredFactors(onlyGoodNews), false);
  });

  it('один неизвестный минус: confidence medium, остальные штрафы работают', () => {
    const noSalt = score(nutrition({ caloriesKcal: 100, proteinG: 4, sugarsG: 2, saturatedFatG: 3 }));
    assert.equal(noSalt.confidence, 'medium');
    assert.deepEqual(noSalt.missingFactors, ['salt']);
    assert.ok(factor(noSalt, 'saturatedFat').points < 0);
    assert.equal(factor(noSalt, 'salt').points, 0);
  });

  it('неизвестное значение не штрафуется и не считается нулём', () => {
    const facts = { caloriesKcal: 450, proteinG: 9, carbsG: 60, fatG: 20 };
    const unknown = score(nutrition(facts));
    const known = score(nutrition({ ...facts, sugarsG: 25, saturatedFatG: 9, saltG: 2 }));
    assert.deepEqual(['sugars', 'saturatedFat', 'salt'].map((kind) => factor(unknown, kind).level), ['not_detected', 'not_detected', 'not_detected']);
    assert.deepEqual(['sugars', 'saturatedFat', 'salt'].map((kind) => factor(unknown, kind).points), [0, 0, 0]);
    assert.ok(value(known) < value(unknown), 'известные минусы снижают оценку, неизвестные нет');
  });

  it('инстантная лапша: оценка по подтверждённым данным, confidence low и понятный список', () => {
    const noodles: Product = {
      ...product(nutrition({ caloriesKcal: 450, proteinG: 9, carbsG: 60, fatG: 20 }), additives(3)),
      semantics: {
        version: 'semantics-v1',
        sugarSource: { value: 'unknown', confidence: 'low', evidence: [] },
        processing: { value: 'ultra_processed', confidence: 'medium', evidence: ['ingredients'] },
        productForm: { value: 'food', confidence: 'high' },
        typicalServing: null,
      },
    };
    const result = scoreProduct(noodles);
    assert.equal(typeof result.value, 'number');
    assert.equal(result.confidence, 'low');
    assert.deepEqual(result.missingFactors, ['sugars', 'saturatedFat', 'salt']);
    assert.equal(factor(result, 'processing').points, -2);
    assert.equal(factor(result, 'additives').points, -1.7, 'три добавки и один класс (краситель)');
    assert.ok(result.value! < 5, 'известные минусы работают и при неполных данных');
  });

  it('обработка даёт ограниченный вклад и только при ультрапереработке', () => {
    const base = nutrition({ caloriesKcal: 60, proteinG: 2, sugarsG: 1, saturatedFatG: 0.2, saltG: 0.1 });
    const withProcessing = (processing: 'whole_or_minimal' | 'processed' | 'ultra_processed' | 'unknown') => scoreProduct({
      ...product(base),
      semantics: {
        version: 'semantics-v1',
        sugarSource: { value: 'unknown', confidence: 'low', evidence: [] },
        processing: { value: processing, confidence: 'medium', evidence: ['ingredients'] },
        productForm: { value: 'food', confidence: 'high' },
        typicalServing: null,
      },
    });
    assert.deepEqual(
      (['whole_or_minimal', 'processed', 'unknown', 'ultra_processed'] as const).map((level) => factor(withProcessing(level), 'processing').points),
      [0, 0, 0, -2],
    );
    assert.equal(withProcessing('ultra_processed').value, value(withProcessing('processed')) - 2);
  });

  it('совсем мало значений: оценки нет', () => {
    const few = score(nutrition({ caloriesKcal: 350, proteinG: 20 }));
    assert.deepEqual([few.value, few.unscoredReason, few.confidence], [null, 'too_few_factors', 'low']);
    assert.ok(few.factors.every((item) => item.points === 0 && item.impact === 'neutral'));
  });

  it('полная этикетка: confidence high и пустой список', () => {
    const { skyr } = BENCHMARK;
    assert.deepEqual([skyr.confidence, skyr.missingFactors, hasRequiredFactors(skyr)], ['high', [], true]);
  });

  it('confidence не выше уверенности в самих значениях', () => {
    const facts = nutrition({ caloriesKcal: 60, proteinG: 2, sugarsG: 1, saturatedFatG: 0.2, saltG: 0.1 });
    const blurry: Product = { ...product(facts), confidence: { overall: 'low', identity: 'high', nutrition: 'low', ingredients: 'high' } };
    assert.equal(scoreProduct(blurry).confidence, 'low');
  });

  it('нет таблицы или непонятна основа — оценки нет, без ошибок', () => {
    assert.deepEqual([score(null).value, score(null).unscoredReason], [null, 'no_nutrition']);
    const facts = nutrition({ caloriesKcal: 66, sugarsG: 3.6, saturatedFatG: 1.3, saltG: 0.1 });
    assert.equal(score({ ...facts, basis: 'unknown' }).unscoredReason, 'unknown_basis');
    assert.equal(score({ ...facts, basis: 'per_serving' }).unscoredReason, 'unknown_basis');
  });

  it('значения на порцию пересчитываются на 100 г по размеру порции', () => {
    const perServing = nutrition(
      { caloriesKcal: 33, proteinG: 4.75, sugarsG: 1.8, saturatedFatG: 0.65, saltG: 0.05 },
      { basis: 'per_serving', servingSize: observed({ amount: 50, unit: 'g' }) },
    );
    const per100 = nutrition({ caloriesKcal: 66, proteinG: 9.5, sugarsG: 3.6, saturatedFatG: 1.3, saltG: 0.1 });
    assert.equal(factor(score(perServing), 'protein').value, 9.5);
    assert.equal(score(perServing).value, score(per100).value);
  });

  it('оценка = база + сумма баллов факторов, затем потолок и ограничение 0–10', () => {
    for (const result of Object.values(BENCHMARK)) {
      const raw = result.factors.reduce((total, item) => total + item.points, BASE_SCORE);
      const capped = result.ceiling ? Math.min(raw, result.ceiling.max) : raw;
      assert.ok(Math.abs(value(result) - roundScore(calibrateLowScale(capped))) <= 0.1, JSON.stringify(result));
      for (const item of result.factors) {
        assert.equal(item.id, `${item.kind}.${item.level}`);
        if (item.points < 0) assert.equal(item.impact, 'negative');
        if (item.points > 0) assert.equal(item.impact, 'positive');
      }
    }
  });

  it('низ шкалы: сжатие линейное, непрерывное и монотонное, верх не меняется', () => {
    assert.equal(PRODUCT_SCORE_VERSION, 'product-score-v6');
    assert.equal(calibrateLowScale(LOW_SCALE_FLOOR), 0);
    assert.equal(calibrateLowScale(HIGH_LEVEL_CEILING), HIGH_LEVEL_CEILING);
    assert.equal(LOW_SCALE_FLOOR, -16);
    assert.equal(calibrateLowScale(-6), 2);
    for (const raw of [4, 4.1, 6.5, 8, 10, 12]) assert.equal(calibrateLowScale(raw), raw);
    assert.equal(roundScore(calibrateLowScale(-16)), 0);
    for (let raw = -16; raw < 12; raw += 0.25) assert.ok(calibrateLowScale(raw + 0.25) > calibrateLowScale(raw));
  });

  it('потолок остаётся потолком: продукт с высоким риском получает ровно его', () => {
    const risky = score(nutrition({ caloriesKcal: 50, proteinG: 30, sugarsG: 23, saturatedFatG: 0, fiberG: 20, saltG: 0 }));
    assert.deepEqual([risky.ceiling?.max, risky.value], [HIGH_LEVEL_CEILING, HIGH_LEVEL_CEILING]);
  });

  it('оценка никогда не выше 10 и не ниже 0', () => {
    const best = score(nutrition({ caloriesKcal: 20, proteinG: 30, sugarsG: 0, saturatedFatG: 0, fiberG: 20, saltG: 0 }));
    assert.equal(best.value, 10);
    const worst = score(nutrition({ caloriesKcal: 900, proteinG: 0, sugarsG: 90, saturatedFatG: 60, fiberG: 0, saltG: 20 }), additives(20));
    assert.ok(worst.value! >= 0 && worst.value! < 1);
    for (const raw of [-100, -0.01, 0, 4.44, 4.45, 9.96, 10.01, 1000]) {
      const rounded = roundScore(raw);
      assert.ok(rounded >= 0 && rounded <= 10, String(raw));
      assert.equal(rounded, Math.round(rounded * 10) / 10, 'один знак после запятой');
    }
  });

  it('одинаковые данные всегда дают одинаковый результат', () => {
    const facts = nutrition({ caloriesKcal: 480, sugarsG: 30, saturatedFatG: 10, saltG: 0.9, proteinG: 6, fiberG: 2.5 });
    const first = score(facts, additives(3));
    for (let i = 0; i < 5; i++) assert.deepEqual(score(facts, additives(3)), first);
  });

  it('пороги уровней: граница low включительно, high строго выше', () => {
    const at = (sugarsG: number) => factor(score(nutrition({ sugarsG, saturatedFatG: 0, saltG: 0 })), 'sugars');
    assert.deepEqual([at(5).level, at(5).points], ['low', 0]);
    assert.equal(at(5.01).level, 'moderate');
    assert.deepEqual([at(22.5).level, at(22.5).points], ['moderate', -3]);
    assert.equal(at(22.6).level, 'high');
  });
});
