import { NOT_DETECTED, observed, PRODUCT_SEMANTICS_VERSION, type NutrientKey, type NutritionFacts, type ProcessingLevel, type Product, type ProductId } from '@foodlens/core';

type Values = Partial<Record<NutrientKey, number>>;

export interface FinalBenchmarkItem {
  readonly name: string;
  readonly unit: 'g' | 'ml';
  readonly values: Values;
  readonly additives: readonly string[];
  readonly ingredients: readonly string[];
  readonly processing: ProcessingLevel;
}

/** Типичные значения этикеток на 100 г или 100 мл. Rollton: только то, что известно о нём на самом деле. */
export const FINAL_BENCHMARK: readonly FinalBenchmarkItem[] = [
  { name: 'Яблоко', unit: 'g', values: { caloriesKcal: 52, proteinG: 0.3, carbsG: 14, sugarsG: 10.4, fatG: 0.2, saturatedFatG: 0.03, fiberG: 2.4, saltG: 0 }, additives: [], ingredients: ['яблоко'], processing: 'whole_or_minimal' },
  { name: 'Овсянка', unit: 'g', values: { caloriesKcal: 372, proteinG: 13.5, carbsG: 60, sugarsG: 1, fatG: 7, saturatedFatG: 1.3, fiberG: 10, saltG: 0.01 }, additives: [], ingredients: ['овсяные хлопья'], processing: 'whole_or_minimal' },
  { name: 'Йогурт натуральный', unit: 'g', values: { caloriesKcal: 62, proteinG: 3.5, carbsG: 4.7, sugarsG: 4.7, fatG: 3.2, saturatedFatG: 2.1, fiberG: 0, saltG: 0.12 }, additives: [], ingredients: ['молоко', 'закваска'], processing: 'whole_or_minimal' },
  { name: 'Яйца', unit: 'g', values: { caloriesKcal: 143, proteinG: 12.6, carbsG: 0.7, sugarsG: 0.4, fatG: 9.5, saturatedFatG: 3.1, fiberG: 0, saltG: 0.36 }, additives: [], ingredients: ['яйцо'], processing: 'whole_or_minimal' },
  { name: 'Лосось', unit: 'g', values: { caloriesKcal: 208, proteinG: 20, carbsG: 0, sugarsG: 0, fatG: 13, saturatedFatG: 3.1, fiberG: 0, saltG: 0.15 }, additives: [], ingredients: ['лосось'], processing: 'whole_or_minimal' },
  { name: 'Творог 5%', unit: 'g', values: { caloriesKcal: 121, proteinG: 17, carbsG: 1.8, sugarsG: 1.8, fatG: 5, saturatedFatG: 3, fiberG: 0, saltG: 0.1 }, additives: [], ingredients: ['молоко', 'закваска'], processing: 'whole_or_minimal' },
  { name: 'Цельнозерновой хлеб', unit: 'g', values: { caloriesKcal: 247, proteinG: 13, carbsG: 41, sugarsG: 6, fatG: 3.4, saturatedFatG: 0.7, fiberG: 7, saltG: 1.1 }, additives: [], ingredients: ['цельнозерновая мука', 'вода', 'дрожжи', 'соль'], processing: 'processed' },
  { name: 'Оливковое масло', unit: 'g', values: { caloriesKcal: 884, proteinG: 0, carbsG: 0, sugarsG: 0, fatG: 100, saturatedFatG: 14, fiberG: 0, saltG: 0 }, additives: [], ingredients: ['оливковое масло'], processing: 'whole_or_minimal' },
  { name: 'Coca-Cola Zero', unit: 'ml', values: { caloriesKcal: 0.3, proteinG: 0, carbsG: 0, sugarsG: 0, fatG: 0, saturatedFatG: 0, saltG: 0.02 }, additives: ['E150d', 'E338', 'E331', 'E950', 'E951'], ingredients: ['вода', 'краситель E150d', 'подсластители', 'ароматизатор'], processing: 'ultra_processed' },
  { name: 'Coca-Cola Original', unit: 'ml', values: { caloriesKcal: 42, proteinG: 0, carbsG: 10.6, sugarsG: 10.6, fatG: 0, saturatedFatG: 0, saltG: 0 }, additives: ['E150d', 'E338'], ingredients: ['вода', 'сахар', 'краситель E150d', 'ароматизатор'], processing: 'ultra_processed' },
  { name: 'Наггетсы', unit: 'g', values: { caloriesKcal: 280, proteinG: 15, carbsG: 18, sugarsG: 0.5, fatG: 17, saturatedFatG: 3, fiberG: 1, saltG: 1.2 }, additives: ['E450', 'E451', 'E621'], ingredients: ['курица', 'панировка', 'усилитель вкуса E621'], processing: 'ultra_processed' },
  { name: 'Чипсы', unit: 'g', values: { caloriesKcal: 536, proteinG: 6.5, carbsG: 53, sugarsG: 0.6, fatG: 34, saturatedFatG: 3.1, fiberG: 4.4, saltG: 1.4 }, additives: ['E621', 'E551'], ingredients: ['картофель', 'масло', 'усилитель вкуса E621', 'ароматизатор'], processing: 'ultra_processed' },
  { name: 'Rollton (пюре быстрого приготовления)', unit: 'g', values: { caloriesKcal: 350, proteinG: 6, carbsG: 65, fatG: 7.5 }, additives: ['E621', 'E627', 'E631', 'E551', 'E471'], ingredients: ['картофельные хлопья', 'мальтодекстрин', 'усилитель вкуса E621', 'ароматизатор'], processing: 'ultra_processed' },
  { name: 'Лапша быстрого приготовления', unit: 'g', values: { caloriesKcal: 450, proteinG: 9, carbsG: 60, sugarsG: 2, fatG: 20, saturatedFatG: 9, fiberG: 2.5, saltG: 3.6 }, additives: ['E621', 'E627', 'E631', 'E501', 'E412', 'E101'], ingredients: ['мука', 'пальмовое масло', 'усилитель вкуса E621', 'краситель E101'], processing: 'ultra_processed' },
  { name: 'Картофель', unit: 'g', values: { caloriesKcal: 77, proteinG: 2, carbsG: 17, sugarsG: 0.8, fatG: 0.1, saturatedFatG: 0.03, fiberG: 2.2, saltG: 0.01 }, additives: [], ingredients: ['картофель'], processing: 'whole_or_minimal' },
  { name: 'Пюре быстрого приготовления', unit: 'g', values: { caloriesKcal: 350, proteinG: 6, carbsG: 65, sugarsG: 5, fatG: 7.5, saturatedFatG: 2, fiberG: 5, saltG: 3 }, additives: ['E621', 'E551', 'E471'], ingredients: ['картофельные хлопья', 'мальтодекстрин', 'усилитель вкуса E621', 'ароматизатор'], processing: 'ultra_processed' },
  { name: 'Snickers', unit: 'g', values: { caloriesKcal: 488, proteinG: 8.6, carbsG: 60, sugarsG: 47, fatG: 23, saturatedFatG: 6.7, fiberG: 1.5, saltG: 0.6 }, additives: ['E322', 'E471'], ingredients: ['сахар', 'арахис', 'пальмовое масло', 'ароматизатор'], processing: 'ultra_processed' },
];

export function finalBenchmarkProduct({ unit, values, additives, ingredients, processing }: FinalBenchmarkItem): Product {
  const value = (key: NutrientKey) => (values[key] === undefined ? NOT_DETECTED : observed(values[key]));
  const nutrition: NutritionFacts = {
    basis: unit === 'ml' ? 'per_100ml' : 'per_100g', servingSize: NOT_DETECTED, caloriesKcal: value('caloriesKcal'), proteinG: value('proteinG'), carbsG: value('carbsG'),
    sugarsG: value('sugarsG'), fatG: value('fatG'), saturatedFatG: value('saturatedFatG'), fiberG: value('fiberG'), saltG: value('saltG'), sodiumMg: value('sodiumMg'),
  };
  return {
    id: 'benchmark' as ProductId, name: NOT_DETECTED, brand: NOT_DETECTED, category: NOT_DETECTED, nutrition,
    semantics: {
      version: PRODUCT_SEMANTICS_VERSION,
      sugarSource: { value: 'unknown', confidence: 'low', evidence: [] },
      processing: { value: processing, confidence: 'medium', evidence: ['ingredients'] },
      productForm: { value: unit === 'ml' ? 'beverage' : 'food', confidence: 'high' },
      typicalServing: null,
    },
    ingredients: observed(ingredients.map((name) => ({ name, percent: null }))), allergens: observed([]), additives: observed(additives.map((code) => ({ code, name: null }))),
    confidence: { overall: 'high', identity: 'high', nutrition: 'high', ingredients: 'high' }, source: { type: 'manual' },
  };
}
