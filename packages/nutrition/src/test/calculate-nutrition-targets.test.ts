import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ACTIVITY_LEVELS, NUTRITION_GOALS, type NutritionTargets } from '@foodlens/core';
import { calculateNutritionTargets, type NutritionTargetsInput } from '../calculate-nutrition-targets';
import { calculateBmr, calculateTdee } from '../energy';
import { ACTIVITY_MULTIPLIERS, KCAL_PER_GRAM, MACRO_SPLITS, NUTRITION_CALCULATION_VERSION } from '../nutrition-coefficients';

const BASE: NutritionTargetsInput = {
  sex: 'male',
  age: 28,
  heightCm: 180,
  weightKg: 90,
  activityLevel: 'moderate',
  goal: 'eat_healthier',
};

/** Допуск на округление: калории до 10 ккал, граммы до 1 г. */
const near = (actual: number, expected: number, tolerance: number) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} to be within ${tolerance} of ${expected}`);

function assertSaneTargets(targets: NutritionTargets): void {
  for (const value of [
    targets.caloriesKcal,
    targets.proteinG,
    targets.carbsG,
    targets.fatG,
    targets.calculation.bmrKcal,
    targets.calculation.tdeeKcal,
  ]) {
    assert.ok(Number.isFinite(value), `${value} is not finite`);
    assert.ok(value > 0, `${value} is not positive`);
  }
  assert.ok(Number.isInteger(targets.proteinG) && Number.isInteger(targets.carbsG) && Number.isInteger(targets.fatG));
  assert.equal(targets.caloriesKcal % 10, 0);
}

describe('calculateNutritionTargets: fixed example', () => {
  const targets = calculateNutritionTargets(BASE);

  it('matches Mifflin-St Jeor BMR and TDEE', () => {
    near(targets.calculation.bmrKcal, 1890, 0.001);
    near(targets.calculation.tdeeKcal, 2929.5, 0.001);
  });

  it('rounds calories to about 2930 kcal', () => {
    near(targets.caloriesKcal, 2930, 10);
  });

  it('splits 25 / 30 / 45 into about 183 g protein, 98 g fat, 330 g carbs', () => {
    near(targets.proteinG, 183, 1);
    near(targets.fatG, 98, 1);
    near(targets.carbsG, 330, 1);
  });

  it('exposes calculation details', () => {
    assert.equal(targets.calculation.version, NUTRITION_CALCULATION_VERSION);
    assert.equal(targets.calculation.goalAdjustmentPercent, 0);
    assert.deepEqual(targets.calculation.macroSplit, { proteinPercent: 25, fatPercent: 30, carbsPercent: 45 });
  });
});

describe('calculateBmr', () => {
  it('uses +5 for male and -161 for female', () => {
    const male = calculateBmr({ ...BASE, sex: 'male' });
    const female = calculateBmr({ ...BASE, sex: 'female' });
    near(male - female, 166, 0.001);
    near(female, 1724, 0.001);
  });

  it('grows by 10 kcal per kg of weight', () => {
    near(calculateBmr({ ...BASE, weightKg: 91 }) - calculateBmr(BASE), 10, 0.001);
  });

  it('rejects non-finite or non-positive input', () => {
    assert.throws(() => calculateBmr({ ...BASE, weightKg: Number.NaN }), RangeError);
    assert.throws(() => calculateBmr({ ...BASE, heightCm: 0 }), RangeError);
    assert.throws(() => calculateBmr({ ...BASE, age: Number.POSITIVE_INFINITY }), RangeError);
  });
});

describe('activity levels', () => {
  it('apply the configured multiplier to TDEE', () => {
    for (const level of ACTIVITY_LEVELS) {
      near(calculateTdee(1890, level), 1890 * ACTIVITY_MULTIPLIERS[level], 0.001);
    }
  });

  it('increase TDEE and calories with each level', () => {
    const results = ACTIVITY_LEVELS.map((activityLevel) => calculateNutritionTargets({ ...BASE, activityLevel }));
    for (let i = 1; i < results.length; i += 1) {
      assert.ok(results[i]!.calculation.tdeeKcal > results[i - 1]!.calculation.tdeeKcal);
      assert.ok(results[i]!.caloriesKcal > results[i - 1]!.caloriesKcal);
    }
    results.forEach(assertSaneTargets);
  });
});

describe('goals', () => {
  const expectedAdjustment = { lose_weight: -15, maintain_weight: 0, gain_weight: 10, eat_healthier: 0 } as const;

  for (const goal of NUTRITION_GOALS) {
    it(`${goal}: adjusts calories by ${expectedAdjustment[goal]}% and keeps the macro split`, () => {
      const targets = calculateNutritionTargets({ ...BASE, goal });
      const split = MACRO_SPLITS[goal];

      assert.equal(targets.calculation.goalAdjustmentPercent, expectedAdjustment[goal]);
      near(targets.caloriesKcal, 2929.5 * (1 + expectedAdjustment[goal] / 100), 5);
      assert.equal(split.proteinPercent + split.fatPercent + split.carbsPercent, 100);

      const kcalFromMacros =
        targets.proteinG * KCAL_PER_GRAM.protein + targets.carbsG * KCAL_PER_GRAM.carbs + targets.fatG * KCAL_PER_GRAM.fat;
      near(kcalFromMacros, targets.caloriesKcal, 15);
      near((targets.proteinG * KCAL_PER_GRAM.protein * 100) / targets.caloriesKcal, split.proteinPercent, 1);
      near((targets.fatG * KCAL_PER_GRAM.fat * 100) / targets.caloriesKcal, split.fatPercent, 1);
      near((targets.carbsG * KCAL_PER_GRAM.carbs * 100) / targets.caloriesKcal, split.carbsPercent, 1);
      assertSaneTargets(targets);
    });
  }

  it('lose_weight < maintain_weight < gain_weight for the same person', () => {
    const [lose, maintain, gain] = (['lose_weight', 'maintain_weight', 'gain_weight'] as const).map(
      (goal) => calculateNutritionTargets({ ...BASE, goal }).caloriesKcal,
    );
    assert.ok(lose! < maintain! && maintain! < gain!);
  });
});

describe('profile changes', () => {
  it('heavier weight gives more calories', () => {
    assert.ok(calculateNutritionTargets({ ...BASE, weightKg: 100 }).caloriesKcal > calculateNutritionTargets(BASE).caloriesKcal);
  });

  it('female gives fewer calories than male with the same metrics', () => {
    assert.ok(calculateNutritionTargets({ ...BASE, sex: 'female' }).caloriesKcal < calculateNutritionTargets(BASE).caloriesKcal);
  });

  it('stays finite and positive across the allowed profile range', () => {
    for (const sex of ['female', 'male'] as const) {
      for (const [age, heightCm, weightKg] of [
        [13, 100, 30],
        [120, 100, 30],
        [13, 250, 300],
        [120, 250, 300],
      ] as const) {
        for (const activityLevel of ACTIVITY_LEVELS) {
          for (const goal of NUTRITION_GOALS) {
            assertSaneTargets(calculateNutritionTargets({ sex, age, heightCm, weightKg, activityLevel, goal }));
          }
        }
      }
    }
  });
});
