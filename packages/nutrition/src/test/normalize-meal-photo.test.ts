import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeMealPhotoEstimate, type RawMealPhotoEstimate } from '../meal-photo/normalize-meal-photo';

type RawItem = RawMealPhotoEstimate['items'][number];
const item = (overrides: Partial<RawItem> = {}): RawItem => ({ name: 'Рис', grams: 180, kcal: 234, protein_g: 5, carbs_g: 51, fat_g: 1, confidence: 'medium', ...overrides });
const raw = (overrides: Partial<RawMealPhotoEstimate> = {}): RawMealPhotoEstimate => ({
  is_food: true, meal_name: 'Курица с рисом', items: [item()], total_kcal: 234, kcal_min: 190, kcal_max: 280, confidence: 'medium', assumptions: [], ...overrides,
});

function estimateOf(input: RawMealPhotoEstimate) {
  const result = normalizeMealPhotoEstimate(input);
  assert.equal(result.kind, 'estimate');
  return result as Extract<typeof result, { kind: 'estimate' }>;
}

describe('normalizeMealPhotoEstimate', () => {
  it('valid response: поля переводятся в формат FoodLens', () => {
    const { estimate } = estimateOf(raw({ assumptions: ['  Возможно, использовано масло  ', ''] }));
    assert.deepEqual(estimate, {
      mealName: 'Курица с рисом',
      items: [{ name: 'Рис', estimatedGrams: 180, caloriesKcal: 234, proteinG: 5, carbsG: 51, fatG: 1, confidence: 'medium' }],
      total: { caloriesKcal: 234, proteinG: 5, carbsG: 51, fatG: 1 },
      calorieRange: { min: 190, max: 280 },
      confidence: 'medium',
      assumptions: ['Возможно, использовано масло'],
    });
  });

  it('несколько компонентов: итог всегда сумма компонентов, total модели только в отчёте', () => {
    const { estimate, report } = estimateOf(raw({
      items: [
        item({ name: 'Курица', grams: 150, kcal: 248, protein_g: 46, carbs_g: 0, fat_g: 6 }),
        item(),
        item({ name: 'Овощи', grams: 100, kcal: 35, protein_g: 2, carbs_g: 7, fat_g: 0 }),
      ],
      total_kcal: 700, kcal_min: 450, kcal_max: 650,
    }));
    assert.equal(estimate.items.length, 3);
    assert.deepEqual(estimate.total, { caloriesKcal: 517, proteinG: 53, carbsG: 58, fatG: 7 });
    assert.equal(report.aiTotalKcal, 700);
    assert.equal(report.totalDiffPercent, 35);
    assert.ok(estimate.calorieRange.min <= 517 && 517 <= estimate.calorieRange.max);
  });

  it('отрицательные, бесконечные и невозможные значения: компонент отбрасывается, уверенность не выше medium', () => {
    const { estimate, report } = estimateOf(raw({
      confidence: 'high',
      items: [
        item(),
        item({ name: 'Соус', kcal: -50 }),
        item({ name: 'Масло', grams: -10 }),
        item({ name: 'Хлеб', protein_g: Number.NaN }),
        item({ name: 'Торт', grams: 100, kcal: 2000, protein_g: 0, carbs_g: 0, fat_g: 0 }),
        item({ name: 'Гора риса', grams: 9000 }),
        item({ name: 'Белок', grams: 50, protein_g: 80, carbs_g: 0, fat_g: 0, kcal: 320 }),
        item({ name: '   ' }),
      ],
    }));
    assert.deepEqual(estimate.items.map((entry) => entry.name), ['Рис']);
    assert.equal(report.droppedItems, 7);
    assert.equal(estimate.confidence, 'medium');
  });

  it('ккал не согласуются с БЖУ: калории компонента пересчитываются как 4Б+4У+9Ж', () => {
    const { estimate, report } = estimateOf(raw({ items: [item({ kcal: 600 })] }));
    assert.equal(estimate.items[0]!.caloriesKcal, 4 * 5 + 4 * 51 + 9 * 1);
    assert.equal(report.adjustedItems, 1);
    // Небольшое расхождение (округление модели) не трогаем.
    assert.equal(estimateOf(raw({ items: [item({ kcal: 245 })] })).estimate.items[0]!.caloriesKcal, 245);
  });

  it('неправдоподобный диапазон заменяется разбросом по уверенности и всегда содержит итог', () => {
    assert.deepEqual(estimateOf(raw({ kcal_min: null, kcal_max: null, confidence: 'low' })).estimate.calorieRange, { min: 160, max: 300 });
    assert.deepEqual(estimateOf(raw({ kcal_min: 300, kcal_max: 400 })).estimate.calorieRange, { min: 190, max: 280 });
    assert.deepEqual(estimateOf(raw({ kcal_min: 10, kcal_max: 5000, confidence: 'high' })).estimate.calorieRange, { min: 210, max: 260 });
  });

  it('пустое название блюда и длинные допущения обрабатываются безопасно', () => {
    const { estimate } = estimateOf(raw({ meal_name: '  ', assumptions: ['a'.repeat(500), 'b', 'c', 'd'] }));
    assert.equal(estimate.mealName, 'Рис');
    assert.equal(estimate.assumptions.length, 3);
    assert.equal(estimate.assumptions[0]!.length, 120);
  });

  it('no food: is_food=false или нет компонентов', () => {
    assert.deepEqual(normalizeMealPhotoEstimate(raw({ is_food: false })), { kind: 'no_food' });
    assert.deepEqual(normalizeMealPhotoEstimate(raw({ items: [] })), { kind: 'no_food' });
  });

  it('еда есть, но все компоненты бессмысленные → invalid', () => {
    assert.deepEqual(normalizeMealPhotoEstimate(raw({ items: [item({ kcal: -1 }), item({ grams: Number.POSITIVE_INFINITY })] })), { kind: 'invalid' });
    assert.deepEqual(normalizeMealPhotoEstimate(raw({ items: [item({ kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 })] })), { kind: 'invalid' });
  });
});
