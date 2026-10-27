import type { MetaProductAnalysis } from '../providers/meta/meta-product-analysis';

type DeepPartial<T> = { -readonly [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** Полный корректный ответ Meta: йогурт с видимой этикеткой и составом. */
export function metaAnalysis(overrides: DeepPartial<MetaProductAnalysis> = {}): MetaProductAnalysis {
  const base: MetaProductAnalysis = {
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
  return merge(base, overrides) as MetaProductAnalysis;
}

function merge(target: unknown, patch: unknown): unknown {
  if (patch === undefined) return target;
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) return patch;
  const result: Record<string, unknown> = { ...(target as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch)) result[key] = merge(result[key], value);
  return result;
}

export const CONTEXT = { productId: 'scan_test', analyzedAt: '2026-10-27T12:00:00.000Z' } as const;
