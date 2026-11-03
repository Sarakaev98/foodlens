import type { MetaProductAnalysis } from '../meta/meta-product-analysis';

/**
 * Полный корректный ответ Meta: йогурт с видимой этикеткой и составом.
 * Один источник данных для MockProvider и для unit tests (src/test/meta-fixtures.ts).
 */
export const MOCK_META_PRODUCT_ANALYSIS: MetaProductAnalysis = {
  semantics: {
    version: 'semantics-v1',
    sugarSource: { value: 'intrinsic', confidence: 'high', evidence: ['молоко нормализованное', 'закваска'] },
    processing: { value: 'whole_or_minimal', confidence: 'high', evidence: ['молоко нормализованное', 'сливки', 'закваска'] },
    productForm: { value: 'food', confidence: 'high' },
    typicalServing: null,
  },
  image: { is_food_product: true, quality: 'clear', visible_sections: ['front_of_package', 'nutrition_table', 'ingredients_list'] },
  identity: {
    name: { value: '  Греческий   йогурт 2% ', evidence: 'visible_text' },
    brand: { value: 'Epica', evidence: 'visible_text' },
    category: { value: 'yogurt', evidence: 'visual_inference' },
  },
  nutrition_table: {
    visible: true,
    basis: 'per_100g',
    serving_size: { amount: 130, unit: 'g' },
    energy_kcal: 66,
    energy_kj: 276,
    protein_g: 9.5,
    carbohydrates_g: 3.6,
    sugars_g: 3.6,
    fat_g: 2,
    saturated_fat_g: 1.3,
    fiber_g: null,
    salt_g: 0.1,
    sodium: { amount: null, unit: null },
  },
  ingredients: {
    visible: true,
    items: [
      { name: 'молоко нормализованное', percent: null },
      { name: 'сливки', percent: 5 },
      { name: 'закваска', percent: null },
    ],
  },
  allergens: {
    statement_visible: true,
    items: [{ allergen: 'milk', presence: 'contains', evidence: 'allergen_statement' }],
  },
  additives: [],
  confidence: { overall: 'high', identity: 'high', nutrition: 'high', ingredients: 'high' },
};
