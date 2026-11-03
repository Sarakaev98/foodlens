import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  NOT_DETECTED,
  observed,
  type Allergen,
  type GoalMatch,
  type GoalMatchUserPlan,
  type NutrientKey,
  type NutritionFacts,
  type NutritionGoal,
  type NutritionTargets,
  type Product,
  type ProductCategory,
  type ProductId,
} from '@foodlens/core';
import { BASE_MATCH, GOAL_MATCH_VERSION } from '../goal-match-rules';
import { curvePoints, goalMatchUnavailable, matchGoal } from '../match-goal';
import { scoreProduct } from '../score-product';

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

interface ProductExtras {
  readonly allergens?: Product['allergens'];
  readonly category?: ProductCategory;
  readonly ingredients?: readonly string[] | null;
}

function product(facts: NutritionFacts | null, extras: ProductExtras = {}): Product {
  return {
    id: 'scan_test' as ProductId,
    name: observed('Test'),
    brand: NOT_DETECTED,
    category: extras.category ? observed(extras.category) : NOT_DETECTED,
    nutrition: facts,
    ingredients:
      extras.ingredients === null ? NOT_DETECTED : observed((extras.ingredients ?? ['x']).map((name) => ({ name, percent: null }))),
    allergens: extras.allergens ?? observed([]),
    additives: observed([]),
    confidence: { overall: 'high', identity: 'high', nutrition: 'high', ingredients: 'high' },
    source: { type: 'manual' },
  };
}

/** Значения с этикетки йогурта из MockProvider (мок-ответ Meta): 130 г порция. */
const GREEK_YOGURT: Nutrients = {
  caloriesKcal: 66,
  proteinG: 9.5,
  carbsG: 3.6,
  sugarsG: 3.6,
  fatG: 2,
  saturatedFatG: 1.3,
  saltG: 0.1,
};
const SERVING_130G = observed({ amount: 130, unit: 'g' } as const);
const yogurt = (extras: ProductExtras = {}) => product(nutrition(GREEK_YOGURT, { servingSize: SERVING_130G }), extras);

const COLA: Nutrients = { caloriesKcal: 42, proteinG: 0, carbsG: 10.6, sugarsG: 10.6, fatG: 0, saturatedFatG: 0, saltG: 0 };

/** Цели как из Nutrition Engine для 2000 ккал; доли БЖУ по цели, как в MACRO_SPLITS. */
const TARGETS: Readonly<Record<NutritionGoal, NutritionTargets>> = {
  lose_weight: targets(2000, 30, 30, 40),
  maintain_weight: targets(2000, 25, 30, 45),
  gain_weight: targets(2000, 25, 25, 50),
  eat_healthier: targets(2000, 25, 30, 45),
};

function targets(caloriesKcal: number, proteinPercent: number, fatPercent: number, carbsPercent: number): NutritionTargets {
  return {
    caloriesKcal,
    proteinG: (caloriesKcal * proteinPercent) / 100 / 4,
    fatG: (caloriesKcal * fatPercent) / 100 / 9,
    carbsG: (caloriesKcal * carbsPercent) / 100 / 4,
    calculation: {
      version: 'test',
      bmrKcal: 0,
      tdeeKcal: caloriesKcal,
      goalAdjustmentPercent: 0,
      macroSplit: { proteinPercent, fatPercent, carbsPercent },
    },
  };
}

function plan(goal: NutritionGoal, overrides: Partial<GoalMatchUserPlan> = {}): GoalMatchUserPlan {
  return { goal, targets: TARGETS[goal], dietaryPreferences: [], allergens: [], avoidedIngredients: [], ...overrides };
}

const factor = (match: GoalMatch, kind: string) => match.factors.find((item) => item.kind === kind);
const GOALS: readonly NutritionGoal[] = ['lose_weight', 'maintain_weight', 'gain_weight'];

describe('matchGoal: детерминированность и отделение от Product Score', () => {
  it('одинаковый продукт и план → одинаковый результат', () => {
    const first = matchGoal(yogurt(), plan('lose_weight'));
    const second = matchGoal(yogurt(), plan('lose_weight'));
    assert.deepEqual(first, second);
    assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
    assert.equal(first.version, GOAL_MATCH_VERSION);
  });

  it('Product Score не зависит от целей и не меняется после Goal Match', () => {
    const item = yogurt();
    const before = scoreProduct(item);
    for (const goal of GOALS) matchGoal(item, plan(goal, { allergens: ['milk'] }));
    assert.deepEqual(scoreProduct(item), before);
    assert.equal(before.value, 9.4);
  });

  it('один и тот же продукт по-разному подходит разным целям', () => {
    const values = GOALS.map((goal) => matchGoal(yogurt(), plan(goal)).value);
    assert.ok(new Set(values).size >= 3, `ожидались разные значения: ${values.join(', ')}`);
    assert.ok(values.every((value) => value !== null && value >= 60));
  });

  it('при одинаковой цели результат зависит от дневных целей пользователя', () => {
    const small = matchGoal(yogurt(), plan('lose_weight', { targets: targets(1200, 30, 30, 40) }));
    const large = matchGoal(yogurt(), plan('lose_weight', { targets: targets(3500, 30, 30, 40) }));
    assert.notEqual(factor(small, 'calories')!.value, factor(large, 'calories')!.value);
    assert.notEqual(factor(small, 'salt')!.value, factor(large, 'salt')!.value);
  });

  it('Product Score и Goal Match могут расходиться: объективно плохой продукт может подходить цели лучше', () => {
    // Кола: Product Score низкий для всех; для набора веса Goal Match выше, чем для снижения.
    const cola = product(nutrition(COLA, { basis: 'per_100ml', servingSize: observed({ amount: 330, unit: 'ml' }) }));
    const lose = matchGoal(cola, plan('lose_weight')).value!;
    const gain = matchGoal(cola, plan('gain_weight')).value!;
    assert.ok(gain > lose);
    assert.equal(matchGoal(cola, plan('lose_weight')).level, 'poor');
  });
});

describe('matchGoal: нутриенты относительно плана', () => {
  it('йогурт при снижении веса: много белка — плюс, порция занимает малую долю калорий', () => {
    const match = matchGoal(yogurt(), plan('lose_weight'));
    const protein = factor(match, 'protein')!;
    assert.equal(protein.level, 'high');
    assert.equal(protein.impact, 'positive');
    assert.ok(protein.points >= 15);
    // 9.5 г × 4 ккал / 66 ккал = 57.6% калорий из белка; в плане 30% → 1.92.
    assert.equal(protein.value, 1.92);
    // 12.35 г белка в порции из 150 г дневной цели.
    assert.equal(protein.portionShare, 8.2);
    assert.equal(match.level, 'great');
  });

  it('белок весит больше при снижении и наборе веса, чем при поддержании', () => {
    const lose = factor(matchGoal(yogurt(), plan('lose_weight')), 'protein')!.points;
    const maintain = factor(matchGoal(yogurt(), plan('maintain_weight')), 'protein')!.points;
    assert.ok(lose > maintain);
  });

  it('сладкий напиток при снижении веса: большой штраф за сахар, мало белка', () => {
    const cola = matchGoal(product(nutrition(COLA, { basis: 'per_100ml' })), plan('lose_weight'));
    assert.equal(factor(cola, 'sugars')!.level, 'high');
    assert.equal(factor(cola, 'sugars')!.points, -25);
    assert.equal(factor(cola, 'protein')!.impact, 'negative');
    assert.ok(cola.value! < 40);
  });

  it('калорийность на 100 г учитывается для еды и не учитывается для напитков', () => {
    const chips = matchGoal(product(nutrition({ caloriesKcal: 536, proteinG: 6.5, carbsG: 53, sugarsG: 0.6, fatG: 34, saturatedFatG: 3.1, saltG: 1.4 })), plan('lose_weight'));
    assert.equal(factor(chips, 'energyDensity')!.level, 'high');
    assert.ok(factor(chips, 'energyDensity')!.points <= -15);
    assert.equal(chips.level, 'poor');
    const cola = matchGoal(product(nutrition(COLA, { basis: 'per_100ml' })), plan('lose_weight'));
    assert.equal(factor(cola, 'energyDensity'), undefined);
  });

  it('у некалорийного продукта доли в калориях не считаются', () => {
    const water = matchGoal(
      product(nutrition({ caloriesKcal: 0, proteinG: 0, carbsG: 0, sugarsG: 0, fatG: 0, saturatedFatG: 0, saltG: 0.01 }, { basis: 'per_100ml' })),
      plan('lose_weight'),
    );
    assert.equal(factor(water, 'salt')!.level, 'not_counted');
    assert.equal(water.value, BASE_MATCH);
  });
});

describe('matchGoal: порция', () => {
  it('калории порции считаются по размеру порции с упаковки', () => {
    const match = matchGoal(yogurt(), plan('lose_weight'));
    assert.deepEqual(match.portion, { basis: 'serving', amount: 130, unit: 'g', caloriesKcal: 85.8 });
    // 66 ккал × 1.3 = 85.8 ккал из 2000.
    assert.equal(factor(match, 'calories')!.value, 4.3);
    assert.equal(factor(match, 'calories')!.level, 'low');
  });

  it('большая порция занимает большую долю дневных калорий и даёт штраф', () => {
    const meal = product(nutrition(GREEK_YOGURT, { servingSize: observed({ amount: 1000, unit: 'g' }) }));
    const calories = factor(matchGoal(meal, plan('lose_weight')), 'calories')!;
    assert.equal(calories.value, 33);
    assert.equal(calories.level, 'high');
    assert.ok(calories.points < 0);
  });

  it('значения на порцию используются как есть, даже если размер порции не виден', () => {
    const perServing = product(nutrition({ ...GREEK_YOGURT, caloriesKcal: 400 }, { basis: 'per_serving' }));
    const match = matchGoal(perServing, plan('lose_weight'));
    assert.deepEqual(match.portion, { basis: 'serving', amount: null, unit: null, caloriesKcal: 400 });
    assert.equal(factor(match, 'calories')!.value, 20);
    assert.equal(factor(match, 'energyDensity')!.level, 'not_counted');
  });

  it('без размера порции: 100 г не сравниваются с дневной нормой, калории не учитываются', () => {
    const match = matchGoal(product(nutrition(GREEK_YOGURT)), plan('lose_weight'));
    assert.deepEqual(match.portion, { basis: 'per_100', amount: 100, unit: 'g', caloriesKcal: 66 });
    assert.equal(factor(match, 'calories')!.level, 'not_counted');
    assert.equal(factor(match, 'calories')!.points, 0);
    assert.equal(factor(match, 'protein')!.portionShare, null);
    assert.equal(typeof match.value, 'number');
  });

  it('порция в мл при значениях на 100 г не пересчитывается', () => {
    const match = matchGoal(product(nutrition(GREEK_YOGURT, { servingSize: observed({ amount: 200, unit: 'ml' }) })), plan('lose_weight'));
    assert.equal(match.portion!.basis, 'per_100');
    assert.equal(factor(match, 'calories')!.level, 'not_counted');
  });
});

describe('matchGoal: недостаточно данных', () => {
  it('нет профиля → value null, no_profile, цели не угадываются', () => {
    const match = matchGoal(yogurt(), null);
    assert.deepEqual(match, goalMatchUnavailable('no_profile'));
    assert.equal(match.value, null);
    assert.equal(match.goal, null);
    assert.deepEqual(match.factors, []);
  });

  it('нет таблицы, неизвестна основа, нет калорийности → value null с причиной', () => {
    assert.equal(matchGoal(product(null), plan('lose_weight')).unavailableReason, 'no_nutrition');
    assert.equal(matchGoal(product(nutrition(GREEK_YOGURT, { basis: 'unknown' })), plan('lose_weight')).unavailableReason, 'unknown_basis');
    const noKcal = matchGoal(product(nutrition({ ...GREEK_YOGURT, caloriesKcal: null })), plan('lose_weight'));
    assert.equal(noKcal.unavailableReason, 'no_calories');
    assert.equal(noKcal.value, null);
    assert.equal(noKcal.level, null);
  });

  it('отсутствующий нутриент не считается нулём: not_counted и 0 баллов', () => {
    const match = matchGoal(product(nutrition({ ...GREEK_YOGURT, sugarsG: null, saltG: null }, { servingSize: SERVING_130G })), plan('lose_weight'));
    for (const kind of ['sugars', 'salt']) {
      assert.equal(factor(match, kind)!.level, 'not_counted');
      assert.equal(factor(match, kind)!.points, 0);
      assert.equal(factor(match, kind)!.value, null);
    }
  });

  it('value всегда целое 0–100', () => {
    const extremes = [
      nutrition({ caloriesKcal: 900, proteinG: 0, carbsG: 0, sugarsG: 0, fatG: 100, saturatedFatG: 60, saltG: 10 }, { servingSize: observed({ amount: 500, unit: 'g' }) }),
      nutrition({ caloriesKcal: 20, proteinG: 5, carbsG: 0, sugarsG: 0, fatG: 0, saturatedFatG: 0, saltG: 0 }, { servingSize: observed({ amount: 50, unit: 'g' }) }),
      nutrition({ caloriesKcal: 400, proteinG: 0, carbsG: 100, sugarsG: 100, fatG: 0, saturatedFatG: 0, saltG: 0 }),
    ];
    for (const facts of extremes) {
      for (const goal of GOALS) {
        const value = matchGoal(product(facts), plan(goal)).value!;
        assert.ok(Number.isInteger(value) && value >= 0 && value <= 100, `${goal}: ${value}`);
      }
    }
  });
});

describe('matchGoal: ограничения профиля', () => {
  const milk: Allergen = { code: 'milk', presence: 'contains', provenance: 'observed' };

  it('аллерген из профиля → conflict, value 0', () => {
    const match = matchGoal(yogurt({ allergens: observed([milk]) }), plan('lose_weight', { allergens: ['milk'] }));
    assert.equal(match.value, 0);
    assert.equal(match.level, 'conflict');
    assert.deepEqual(factor(match, 'allergens')!.matches, ['milk']);
    assert.equal(factor(match, 'allergens')!.impact, 'negative');
  });

  it('conflict работает и без таблицы пищевой ценности', () => {
    const match = matchGoal(product(null, { allergens: observed([milk]) }), plan('lose_weight', { allergens: ['milk'] }));
    assert.equal(match.value, 0);
    assert.equal(match.level, 'conflict');
  });

  it('«может содержать» → штраф, но не conflict; аллергенов не видно → not_counted', () => {
    const traces = matchGoal(yogurt({ allergens: observed([{ ...milk, presence: 'may_contain' }]) }), plan('lose_weight', { allergens: ['milk'] }));
    assert.equal(factor(traces, 'allergens')!.level, 'may_contain');
    assert.equal(factor(traces, 'allergens')!.points, -30);
    assert.notEqual(traces.level, 'conflict');
    const unknown = matchGoal(yogurt({ allergens: NOT_DETECTED }), plan('lose_weight', { allergens: ['milk'] }));
    assert.equal(factor(unknown, 'allergens')!.level, 'not_counted');
    assert.equal(matchGoal(yogurt(), plan('lose_weight')).factors.some((item) => item.kind === 'allergens'), false);
  });

  it('диета: молоко для веганов и мясо для вегетарианцев → conflict; halal не проверяется', () => {
    const vegan = matchGoal(yogurt({ allergens: observed([milk]) }), plan('maintain_weight', { dietaryPreferences: ['vegan'] }));
    assert.equal(vegan.level, 'conflict');
    assert.deepEqual(factor(vegan, 'diet')!.matches, ['milk']);
    const vegetarian = matchGoal(yogurt({ category: 'meat' }), plan('maintain_weight', { dietaryPreferences: ['vegetarian'] }));
    assert.equal(vegetarian.level, 'conflict');
    const halal = matchGoal(yogurt(), plan('maintain_weight', { dietaryPreferences: ['halal'] }));
    assert.equal(factor(halal, 'diet')!.level, 'not_counted');
    assert.deepEqual(factor(halal, 'diet')!.matches, ['halal']);
    assert.equal(halal.value, matchGoal(yogurt(), plan('maintain_weight')).value);
    assert.notEqual(halal.level, 'conflict');
  });

  it('непроверенные предпочтения передаются для пояснения без изменения баллов', () => {
    const base = matchGoal(yogurt(), plan('maintain_weight'));
    for (const diets of [['other'], ['halal', 'other'], ['vegan', 'vegetarian', 'pescatarian']] as const) {
      const unknown = matchGoal(yogurt({ allergens: NOT_DETECTED }), plan('maintain_weight', { dietaryPreferences: diets }));
      assert.equal(factor(unknown, 'diet')!.level, 'not_counted');
      assert.deepEqual(factor(unknown, 'diet')!.matches, diets);
      assert.equal(unknown.value, base.value);
    }
  });

  it('ингредиент из списка «избегать» → штраф, без учёта регистра и «ё»', () => {
    const base = matchGoal(yogurt({ ingredients: ['Молоко', 'Сливки'] }), plan('maintain_weight')).value!;
    const match = matchGoal(yogurt({ ingredients: ['Молоко', 'Сливки'] }), plan('maintain_weight', { avoidedIngredients: [' сливки '] }));
    assert.deepEqual(factor(match, 'avoidedIngredients')!.matches, ['сливки']);
    assert.equal(match.value, base - 40);
    assert.notEqual(match.level, 'conflict');
    const noIngredients = matchGoal(yogurt({ ingredients: null }), plan('maintain_weight', { avoidedIngredients: ['сливки'] }));
    assert.equal(factor(noIngredients, 'avoidedIngredients')!.level, 'not_counted');
  });
});

describe('curvePoints', () => {
  it('линейно между точками, за краями — крайние значения', () => {
    const curve = [[0, -10], [1, 0], [2, 20]] as const;
    assert.equal(curvePoints(curve, -1), -10);
    assert.equal(curvePoints(curve, 0.5), -5);
    assert.equal(curvePoints(curve, 1.5), 10);
    assert.equal(curvePoints(curve, 5), 20);
  });
});
