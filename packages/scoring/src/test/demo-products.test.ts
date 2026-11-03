import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  NOT_DETECTED,
  observed,
  PRODUCT_SEMANTICS_VERSION,
  type GoalMatchUserPlan,
  type Ingredient,
  type NutrientKey,
  type NutritionBasis,
  type NutritionFacts,
  type ProcessingLevel,
  type Product,
  type ProductId,
} from '@foodlens/core';
import { matchGoal, scoreProduct } from '../index';

interface DemoProduct {
  readonly name: string;
  readonly basis: NutritionBasis;
  readonly values: Partial<Record<NutrientKey, number>>;
  readonly ingredients: readonly string[];
  readonly additives: readonly string[];
  readonly processing: ProcessingLevel;
}

/** Демо-набор для видео: типичные значения этикеток, без реальных брендов. */
const DEMO: Readonly<Record<'healthy' | 'medium' | 'unhealthy' | 'beverage' | 'incomplete', DemoProduct>> = {
  healthy: {
    name: 'Скир натуральный', basis: 'per_100g',
    values: { caloriesKcal: 63, proteinG: 11, carbsG: 4, sugarsG: 3.5, fatG: 0.2, saturatedFatG: 0.1, saltG: 0.1, fiberG: 0 },
    ingredients: ['молоко обезжиренное', 'закваска'], additives: [], processing: 'whole_or_minimal',
  },
  medium: {
    name: 'Йогурт фруктовый', basis: 'per_100g',
    values: { caloriesKcal: 100, proteinG: 3.5, carbsG: 15, sugarsG: 13, fatG: 2.5, saturatedFatG: 1.7, saltG: 0.13, fiberG: 0.3 },
    ingredients: ['молоко', 'сахар', 'клубника', 'крахмал'], additives: [], processing: 'processed',
  },
  unhealthy: {
    name: 'Печенье с шоколадом', basis: 'per_100g',
    values: { caloriesKcal: 480, proteinG: 6, carbsG: 62, sugarsG: 30, fatG: 23, saturatedFatG: 10, saltG: 0.9, fiberG: 2.5 },
    ingredients: ['мука пшеничная', 'сахар', 'пальмовое масло', 'эмульгатор E322', 'ароматизатор'], additives: ['E322', 'E500', 'E503'], processing: 'ultra_processed',
  },
  beverage: {
    name: 'Газированный напиток', basis: 'per_100ml',
    values: { caloriesKcal: 42, proteinG: 0, carbsG: 10.6, sugarsG: 10.6, fatG: 0, saturatedFatG: 0, saltG: 0 },
    ingredients: ['вода', 'сахар', 'диоксид углерода', 'E150d', 'E338'], additives: ['E150d', 'E338'], processing: 'ultra_processed',
  },
  incomplete: {
    name: 'Лапша быстрого приготовления', basis: 'per_100g',
    values: { caloriesKcal: 450, proteinG: 9, carbsG: 60, fatG: 20 },
    ingredients: ['мука пшеничная', 'пальмовое масло', 'соль', 'усилитель вкуса E621', 'загуститель E412', 'краситель E101'],
    additives: ['E621', 'E412', 'E101'], processing: 'ultra_processed',
  },
};

function toProduct(demo: DemoProduct): Product {
  const value = (key: NutrientKey) => (demo.values[key] === undefined ? NOT_DETECTED : observed(demo.values[key]));
  const nutrition: NutritionFacts = {
    basis: demo.basis, servingSize: NOT_DETECTED, caloriesKcal: value('caloriesKcal'), proteinG: value('proteinG'), carbsG: value('carbsG'),
    sugarsG: value('sugarsG'), fatG: value('fatG'), saturatedFatG: value('saturatedFatG'), fiberG: value('fiberG'), saltG: value('saltG'), sodiumMg: value('sodiumMg'),
  };
  const ingredients: Ingredient[] = demo.ingredients.map((name) => ({ name, percent: null }));
  return {
    id: 'demo' as ProductId, name: observed(demo.name), brand: NOT_DETECTED, category: NOT_DETECTED, nutrition,
    semantics: {
      version: PRODUCT_SEMANTICS_VERSION,
      sugarSource: { value: 'unknown', confidence: 'low', evidence: [] },
      processing: { value: demo.processing, confidence: 'medium', evidence: ['ingredients'] },
      productForm: { value: demo.basis === 'per_100ml' ? 'beverage' : 'food', confidence: 'high' },
      typicalServing: null,
    },
    ingredients: observed(ingredients), allergens: observed([]), additives: observed(demo.additives.map((code) => ({ code, name: null }))),
    confidence: { overall: 'high', identity: 'high', nutrition: 'high', ingredients: 'high' }, source: { type: 'manual' },
  };
}

const PLAN: GoalMatchUserPlan = {
  goal: 'lose_weight',
  targets: {
    caloriesKcal: 2000, proteinG: 150, fatG: 67, carbsG: 200,
    calculation: { version: 'nutrition-v1', bmrKcal: 1500, tdeeKcal: 2350, goalAdjustmentPercent: -15, macroSplit: { proteinPercent: 30, fatPercent: 30, carbsPercent: 40 } },
  },
  dietaryPreferences: ['none'], allergens: [], avoidedIngredients: [],
};

const results = Object.fromEntries(Object.entries(DEMO).map(([key, demo]) => {
  const product = toProduct(demo);
  return [key, { product, score: scoreProduct(product), goalMatch: matchGoal(product, PLAN) }];
})) as Record<keyof typeof DEMO, { product: Product; score: ReturnType<typeof scoreProduct>; goalMatch: ReturnType<typeof matchGoal> }>;

describe('демо-продукты для видео', () => {
  it('у каждого есть оценка, Goal Match и состав', () => {
    for (const [key, { product, score, goalMatch }] of Object.entries(results)) {
      assert.equal(typeof score.value, 'number', key);
      assert.equal(typeof goalMatch.value, 'number', key);
      assert.ok((product.ingredients.value?.length ?? 0) > 0, key);
    }
  });

  it('оценки выглядят логично: полезное выше среднего, среднее выше вредного', () => {
    const { healthy, medium, unhealthy, beverage, incomplete } = results;
    assert.ok(healthy.score.value! >= 8);
    assert.ok(medium.score.value! >= 4 && medium.score.value! < 8);
    assert.ok(unhealthy.score.value! < 4);
    assert.ok(beverage.score.value! < 4);
    assert.ok(incomplete.score.value! > unhealthy.score.value! && incomplete.score.value! < 6);
  });

  it('полные этикетки уверенные, неполная честно показывает, чего не хватает', () => {
    for (const key of ['healthy', 'medium', 'unhealthy', 'beverage'] as const) {
      assert.equal(results[key].score.confidence, 'high', key);
      assert.deepEqual(results[key].score.missingFactors, [], key);
    }
    assert.equal(results.incomplete.score.confidence, 'low');
    assert.deepEqual(results.incomplete.score.missingFactors, ['sugars', 'saturatedFat', 'salt']);
  });
});
