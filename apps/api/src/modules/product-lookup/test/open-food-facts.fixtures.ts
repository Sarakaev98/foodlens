/** Форма ответа Open Food Facts API v3.6 (сверена с реальным ответом); значения вымышленные. Тесты в сеть не ходят. */
export const BARCODE = '4607001771234';

const nutrient = (value: number, unit = 'g', source = 'manufacturer') => ({ source, source_index: 0, source_per: '100g', unit, value });

export const OFF_NUTRIENTS = {
  energy: nutrient(1800, 'kJ'), 'energy-kj': nutrient(1800, 'kJ'), 'energy-kcal': nutrient(430, 'kcal'),
  proteins: nutrient(4.5), carbohydrates: nutrient(63), sugars: nutrient(38), fat: nutrient(18), 'saturated-fat': nutrient(9),
  fiber: nutrient(1.2), salt: nutrient(0.4),
  // Оценки базы: их брать нельзя.
  sodium: { ...nutrient(0.16), modifier: '~' },
  calcium: { ...nutrient(0.01, 'g', 'estimate'), modifier: '~' },
};

export const offProduct = (overrides: Record<string, unknown> = {}) => ({
  product_name: 'Чокопай', brands: 'Lotte, Другой бренд', serving_quantity_unit: 'g',
  nutrition: {
    aggregated_set: { nutrients: OFF_NUTRIENTS, per: '100g', preparation: 'as_sold' },
    input_sets: [{ nutrients: {}, per: '100g', per_quantity: 100, per_unit: 'g', preparation: 'as_sold', source: 'manufacturer' }],
  },
  ingredients_text: 'мука пшеничная, сахар, шоколадная глазурь (какао-масло, эмульгатор), яйца.',
  allergens_tags: ['en:gluten', 'en:eggs', 'en:milk'],
  traces_tags: ['en:soybeans'],
  additives_tags: ['en:e322', 'en:e476'],
  ...overrides,
});

export const offFound = (product: unknown = offProduct()) => new Response(JSON.stringify({
  code: BARCODE, errors: [], product, result: { id: 'product_found', lc_name: 'Product found', name: 'Product found' }, status: 'success', warnings: [],
}));

export const offNotFound = () => new Response(JSON.stringify({ code: BARCODE, errors: [{ message: { id: 'product_not_found' } }], result: { id: 'product_not_found' }, status: 'failure' }), { status: 404 });
