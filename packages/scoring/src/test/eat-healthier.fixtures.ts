import { NOT_DETECTED, observed, type Product, type ProductId, type GoalMatchUserPlan,
  type ProcessingLevel, type SugarSource, type ProductForm } from '@foodlens/core';
import type { HealthFeatures } from '../goal-match-v3-calculation';

export interface HealthFixture {
  readonly id: string;
  readonly label: string;
  readonly portion: number;
  /** kcal, protein, fat, carbs, sugars, saturated fat, salt, fiber; per 100 g/ml. */
  readonly values: readonly (number | null)[];
  readonly sugarSource: SugarSource;
  readonly processing: ProcessingLevel;
  readonly productForm: ProductForm;
  readonly sanity: readonly number[] | null;
  readonly expected: number;
}

/** Representative, explicitly declared labels; the design did not provide raw nutrition tables.
 * Sanity ranges are diagnostic, not a reason to change the approved formula.
 * Bread, cake and butter deliberately preserve their formula/range deviations.
 */
export const HEALTH_FIXTURES: readonly HealthFixture[] = [
  {
    "id": "yogurt",
    "label": "Greek yogurt",
    "portion": 130,
    "values": [
      66,
      9.5,
      2,
      3.6,
      3.6,
      1.3,
      0.1,
      null
    ],
    "sugarSource": "intrinsic",
    "processing": "whole_or_minimal",
    "productForm": "food",
    "sanity": [
      8.5,
      9.2
    ],
    "expected": 8.7
  },
  {
    "id": "skyr",
    "label": "Skyr",
    "portion": 150,
    "values": [
      63,
      11,
      0.2,
      4,
      3.5,
      0.1,
      0.1,
      0
    ],
    "sugarSource": "intrinsic",
    "processing": "whole_or_minimal",
    "productForm": "food",
    "sanity": [
      9,
      10
    ],
    "expected": 9.5
  },
  {
    "id": "broccoli",
    "label": "Broccoli",
    "portion": 150,
    "values": [
      34,
      2.8,
      0.4,
      6.6,
      1.7,
      0.04,
      0.08,
      2.6
    ],
    "sugarSource": "intrinsic",
    "processing": "whole_or_minimal",
    "productForm": "food",
    "sanity": [
      8,
      9.5
    ],
    "expected": 9.3
  },
  {
    "id": "carrot",
    "label": "Carrot",
    "portion": 100,
    "values": [
      41,
      0.9,
      0.2,
      9.6,
      4.7,
      0.04,
      0.17,
      2.8
    ],
    "sugarSource": "intrinsic",
    "processing": "whole_or_minimal",
    "productForm": "food",
    "sanity": [
      8,
      9.5
    ],
    "expected": 8.4
  },
  {
    "id": "apple",
    "label": "Whole apple",
    "portion": 180,
    "values": [
      52,
      0.3,
      0.2,
      14,
      10.4,
      0.03,
      0,
      2.4
    ],
    "sugarSource": "intrinsic",
    "processing": "whole_or_minimal",
    "productForm": "food",
    "sanity": [
      8,
      10
    ],
    "expected": 8.5
  },
  {
    "id": "almond",
    "label": "Almond",
    "portion": 30,
    "values": [
      579,
      21.2,
      49.9,
      21.6,
      4.4,
      3.8,
      0.01,
      12.5
    ],
    "sugarSource": "intrinsic",
    "processing": "whole_or_minimal",
    "productForm": "food",
    "sanity": [
      7,
      9
    ],
    "expected": 8.4
  },
  {
    "id": "walnut",
    "label": "Walnut",
    "portion": 30,
    "values": [
      654,
      15.2,
      65.2,
      13.7,
      2.6,
      6.1,
      0.005,
      6.7
    ],
    "sugarSource": "intrinsic",
    "processing": "whole_or_minimal",
    "productForm": "food",
    "sanity": [
      7,
      9
    ],
    "expected": 7
  },
  {
    "id": "avocado",
    "label": "Avocado",
    "portion": 70,
    "values": [
      160,
      2,
      14.7,
      8.5,
      0.7,
      2.1,
      0.02,
      6.7
    ],
    "sugarSource": "intrinsic",
    "processing": "whole_or_minimal",
    "productForm": "food",
    "sanity": [
      7,
      9
    ],
    "expected": 8.5
  },
  {
    "id": "oatmeal",
    "label": "Dry oatmeal",
    "portion": 40,
    "values": [
      372,
      13.5,
      7,
      60,
      1,
      1.3,
      0.01,
      10
    ],
    "sugarSource": "intrinsic",
    "processing": "whole_or_minimal",
    "productForm": "food",
    "sanity": [
      8,
      9
    ],
    "expected": 8.7
  },
  {
    "id": "oatmeal_water",
    "label": "Oatmeal plus water",
    "portion": 250,
    "values": [
      59.52,
      2.16,
      1.12,
      9.6,
      0.16,
      0.208,
      0.0016,
      1.6
    ],
    "sugarSource": "intrinsic",
    "processing": "whole_or_minimal",
    "productForm": "food",
    "sanity": [
      8,
      9
    ],
    "expected": 8.7
  },
  {
    "id": "bread",
    "label": "Whole-grain bread",
    "portion": 60,
    "values": [
      250,
      9,
      4,
      43,
      4,
      0.7,
      1.2,
      6
    ],
    "sugarSource": "mixed",
    "processing": "processed",
    "productForm": "food",
    "sanity": [
      7,
      9
    ],
    "expected": 6.9
  },
  {
    "id": "eggs",
    "label": "Eggs",
    "portion": 100,
    "values": [
      143,
      12.6,
      9.5,
      0.7,
      0.4,
      3.1,
      0.36,
      0
    ],
    "sugarSource": "intrinsic",
    "processing": "whole_or_minimal",
    "productForm": "food",
    "sanity": [
      7,
      9
    ],
    "expected": 8.5
  },
  {
    "id": "chicken",
    "label": "Chicken breast",
    "portion": 150,
    "values": [
      165,
      31,
      3.6,
      0,
      0,
      1,
      0.2,
      0
    ],
    "sugarSource": "none",
    "processing": "whole_or_minimal",
    "productForm": "food",
    "sanity": [
      8,
      10
    ],
    "expected": 9.5
  },
  {
    "id": "salmon",
    "label": "Salmon",
    "portion": 125,
    "values": [
      208,
      20,
      13,
      0,
      0,
      3,
      0.15,
      0
    ],
    "sugarSource": "none",
    "processing": "whole_or_minimal",
    "productForm": "food",
    "sanity": [
      8,
      9.5
    ],
    "expected": 8.8
  },
  {
    "id": "cola",
    "label": "Cola",
    "portion": 330,
    "values": [
      42,
      0,
      0,
      10.6,
      10.6,
      0,
      0,
      0
    ],
    "sugarSource": "added",
    "processing": "ultra_processed",
    "productForm": "beverage",
    "sanity": [
      1,
      3
    ],
    "expected": 2.5
  },
  {
    "id": "juice",
    "label": "Orange juice",
    "portion": 250,
    "values": [
      45,
      0.7,
      0.2,
      10.4,
      8.4,
      0.02,
      0.002,
      0.2
    ],
    "sugarSource": "added",
    "processing": "whole_or_minimal",
    "productForm": "beverage",
    "sanity": null,
    "expected": 4.6
  },
  {
    "id": "pudding",
    "label": "Chocolate pudding",
    "portion": 125,
    "values": [
      120,
      3,
      3,
      20,
      16,
      1.8,
      0.15,
      0.5
    ],
    "sugarSource": "added",
    "processing": "ultra_processed",
    "productForm": "food",
    "sanity": [
      2,
      4
    ],
    "expected": 3.2
  },
  {
    "id": "cake",
    "label": "Cake",
    "portion": 80,
    "values": [
      400,
      5,
      20,
      50,
      35,
      9.5,
      0.5,
      1
    ],
    "sugarSource": "added",
    "processing": "ultra_processed",
    "productForm": "food",
    "sanity": [
      2,
      4
    ],
    "expected": 1.5
  },
  {
    "id": "chips",
    "label": "Chips",
    "portion": 30,
    "values": [
      536,
      6.5,
      34,
      53,
      0.6,
      3.1,
      1.4,
      4.4
    ],
    "sugarSource": "added",
    "processing": "ultra_processed",
    "productForm": "food",
    "sanity": [
      3,
      5
    ],
    "expected": 4.2
  },
  {
    "id": "chocolate",
    "label": "Milk chocolate",
    "portion": 25,
    "values": [
      535,
      7.5,
      30,
      59,
      56,
      18.5,
      0.24,
      2
    ],
    "sugarSource": "added",
    "processing": "ultra_processed",
    "productForm": "food",
    "sanity": [
      1,
      3
    ],
    "expected": 1.7
  },
  {
    "id": "butter",
    "label": "Butter",
    "portion": 10,
    "values": [
      748,
      0.5,
      82,
      0.8,
      0.8,
      52,
      0.03,
      0
    ],
    "sugarSource": "none",
    "processing": "processed",
    "productForm": "food",
    "sanity": [
      2,
      3
    ],
    "expected": 3.3
  },
  {
    "id": "gel",
    "label": "Empty low-calorie gel",
    "portion": 150,
    "values": [
      5,
      0,
      0,
      1,
      0,
      0,
      0,
      0
    ],
    "sugarSource": "none",
    "processing": "ultra_processed",
    "productForm": "food",
    "sanity": [
      0,
      6
    ],
    "expected": 5.5
  },
  {
    "id": "trace_water",
    "label": "Trace-protein water",
    "portion": 500,
    "values": [
      0,
      0.1,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "sugarSource": "none",
    "processing": "ultra_processed",
    "productForm": "beverage",
    "sanity": [
      0,
      6
    ],
    "expected": 5.5
  }
];

export function healthPlan(proteinG = 139): GoalMatchUserPlan {
  return {
    goal: 'eat_healthier',
    targets: { caloriesKcal: 2000, proteinG, fatG: 67, carbsG: 225,
      calculation: { version: 'test', bmrKcal: 1400, tdeeKcal: 2000, goalAdjustmentPercent: 0,
        macroSplit: { proteinPercent: 25, fatPercent: 30, carbsPercent: 45 } } },
    dietaryPreferences: [], allergens: [], avoidedIngredients: [],
  };
}

export function fixtureProduct(fixture: HealthFixture): Product {
  const value = (index: number) => fixture.values[index] === null || fixture.values[index] === undefined
    ? NOT_DETECTED : observed(fixture.values[index]!);
  return {
    id: fixture.id as ProductId, name: observed(fixture.label), brand: NOT_DETECTED, category: NOT_DETECTED,
    nutrition: {
      basis: fixture.productForm === 'beverage' ? 'per_100ml' : 'per_100g',
      servingSize: observed({ amount: fixture.portion, unit: fixture.productForm === 'beverage' ? 'ml' : 'g' }),
      caloriesKcal: value(0), proteinG: value(1), fatG: value(2), carbsG: value(3), sugarsG: value(4),
      saturatedFatG: value(5), saltG: value(6), fiberG: value(7), sodiumMg: NOT_DETECTED,
    },
    semantics: {
      version: 'semantics-v1',
      sugarSource: { value: fixture.sugarSource, confidence: 'high', evidence: ['fixture ingredient evidence'] },
      processing: { value: fixture.processing, confidence: 'high', evidence: ['fixture visible structure'] },
      productForm: { value: fixture.productForm, confidence: 'high' }, typicalServing: null,
    },
    ingredients: observed([{ name: 'fixture ingredient', percent: null }]), allergens: observed([]), additives: observed([]),
    confidence: { overall: 'high', identity: 'high', nutrition: 'high', ingredients: 'high' },
    source: { type: 'manual' },
  };
}

export function fixtureFeatures(f: HealthFixture, proteinTargetG = 139): HealthFeatures {
  return { caloriesKcal: f.values[0]!, proteinG: f.values[1]!, sugarsG: f.values[4]!,
    saturatedFatG: f.values[5]!, saltG: f.values[6]!, fiberG: f.values[7] ?? null,
    servingMultiplier: f.portion / 100, proteinTargetG, sugarSource: f.sugarSource,
    processing: f.processing, productForm: f.productForm };
}
