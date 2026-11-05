import { ALLERGEN_CODES, PRODUCT_CATEGORIES, PRODUCT_SEMANTICS_VERSION, SUGAR_SOURCES,
  PROCESSING_LEVELS, PRODUCT_FORMS, CONFIDENCE_LEVELS, type ProductSemantics } from '@foodlens/core';
import { enumSchema, nullable, objectSchema, type JsonSchema } from '../../json-schema/json-schema';

/**
 * Формат ответа Meta (структурированный вывод). Намеренно отличается от core Product:
 * он описывает то, что модель увидела на фото, вместе с доказательствами,
 * а превращение в Product делает нормализатор.
 */
export const META_PRODUCT_ANALYSIS_VERSION = 'meta-product-analysis-v2';

export const META_EVIDENCE = ['visible_text', 'visual_inference', 'not_visible'] as const;
export type MetaEvidence = (typeof META_EVIDENCE)[number];

export const META_IMAGE_QUALITY = ['clear', 'partially_readable', 'unreadable'] as const;
export const META_VISIBLE_SECTIONS = [
  'front_of_package',
  'nutrition_table',
  'ingredients_list',
  'allergen_statement',
] as const;
export const META_NUTRITION_BASES = ['per_100g', 'per_100ml', 'per_serving', 'not_stated'] as const;
export const META_ALLERGEN_EVIDENCE = [
  'allergen_statement',
  'highlighted_in_ingredients',
  'derived_from_ingredient',
] as const;
export const META_CONFIDENCE = ['high', 'medium', 'low'] as const;

type MetaConfidence = (typeof META_CONFIDENCE)[number];

export interface MetaTextField {
  readonly value: string | null;
  readonly evidence: MetaEvidence;
}

export interface MetaProductAnalysis {
  /** Optional for old responses. English names in source order, without changing the printed fields. */
  readonly english?: { readonly name?: string | null; readonly ingredients: readonly string[]; readonly additives: readonly (string | null)[] } | null;
  /** Optional in legacy stored/mock responses; new structured responses always include the block. */
  readonly semantics?: ProductSemantics | null;
  readonly image: {
    readonly is_food_product: boolean;
    readonly quality: (typeof META_IMAGE_QUALITY)[number];
    readonly visible_sections: readonly (typeof META_VISIBLE_SECTIONS)[number][];
  };
  readonly identity: {
    readonly name: MetaTextField;
    readonly brand: MetaTextField;
    /** Строка, а не тип категории: нормализатор не доверяет enum и сам приводит неизвестное к "other". */
    readonly category: { readonly value: string | null; readonly evidence: MetaEvidence };
  };
  readonly nutrition_table: {
    readonly visible: boolean;
    readonly basis: (typeof META_NUTRITION_BASES)[number];
    readonly serving_size: { readonly amount: number | null; readonly unit: 'g' | 'ml' | null };
    readonly energy_kcal: number | null;
    readonly energy_kj: number | null;
    readonly protein_g: number | null;
    readonly carbohydrates_g: number | null;
    readonly sugars_g: number | null;
    readonly fat_g: number | null;
    readonly saturated_fat_g: number | null;
    readonly fiber_g: number | null;
    readonly salt_g: number | null;
    readonly sodium: { readonly amount: number | null; readonly unit: 'mg' | 'g' | null };
  };
  readonly ingredients: {
    readonly visible: boolean;
    readonly items: readonly { readonly name: string; readonly percent: number | null }[];
  };
  readonly allergens: {
    readonly statement_visible: boolean;
    readonly items: readonly {
      readonly allergen: string;
      readonly presence: 'contains' | 'may_contain';
      readonly evidence: (typeof META_ALLERGEN_EVIDENCE)[number];
    }[];
  };
  readonly additives: readonly { readonly e_number: string | null; readonly name: string | null }[];
  readonly confidence: {
    readonly overall: MetaConfidence;
    readonly identity: MetaConfidence;
    readonly nutrition: MetaConfidence;
    readonly ingredients: MetaConfidence;
  };
}

const textField = (description: string): JsonSchema =>
  objectSchema(
    {
      value: nullable({ type: 'string' }),
      evidence: enumSchema(META_EVIDENCE),
    },
    description,
  );

const grams = (description: string): JsonSchema => nullable({ type: 'number' }, `${description}, grams. null if not printed.`);

const semanticField = (values: readonly string[]): JsonSchema => objectSchema({
  value: enumSchema(values), confidence: enumSchema(CONFIDENCE_LEVELS),
  evidence: { type: 'array', items: { type: 'string' } },
});

export const PRODUCT_SEMANTICS_SCHEMA: JsonSchema = objectSchema({
  version: enumSchema([PRODUCT_SEMANTICS_VERSION]),
  sugarSource: semanticField(SUGAR_SOURCES),
  processing: semanticField(PROCESSING_LEVELS),
  productForm: objectSchema({ value: enumSchema(PRODUCT_FORMS), confidence: enumSchema(CONFIDENCE_LEVELS) }),
  typicalServing: nullable(objectSchema({
    amount: { type: 'number' }, unit: enumSchema(['g', 'ml']), confidence: enumSchema(CONFIDENCE_LEVELS),
    evidence: { type: 'array', items: { type: 'string' } },
  })),
});

export const META_PRODUCT_ANALYSIS_SCHEMA: JsonSchema = objectSchema({
  semantics: nullable(PRODUCT_SEMANTICS_SCHEMA),
  image: objectSchema({
    is_food_product: { type: 'boolean', description: 'true if the photo shows a packaged food or drink product' },
    quality: enumSchema(META_IMAGE_QUALITY, 'How readable the printed text is'),
    visible_sections: { type: 'array', items: enumSchema(META_VISIBLE_SECTIONS) },
  }),
  identity: objectSchema({
    name: textField('Product name as printed, without the brand'),
    brand: textField('Brand as printed or shown by logo'),
    category: objectSchema({
      value: nullable(enumSchema(PRODUCT_CATEGORIES)),
      evidence: enumSchema(META_EVIDENCE),
    }),
  }),
  nutrition_table: objectSchema(
    {
      visible: { type: 'boolean' },
      basis: enumSchema(META_NUTRITION_BASES, 'Column the values were taken from'),
      serving_size: objectSchema({
        amount: nullable({ type: 'number' }),
        unit: nullable(enumSchema(['g', 'ml'])),
      }),
      energy_kcal: nullable({ type: 'number' }, 'Energy in kcal. null if only kJ is printed.'),
      energy_kj: nullable({ type: 'number' }, 'Energy in kJ'),
      protein_g: grams('Protein'),
      carbohydrates_g: grams('Total carbohydrates'),
      sugars_g: grams('Sugars'),
      fat_g: grams('Total fat'),
      saturated_fat_g: grams('Saturated fat'),
      fiber_g: grams('Dietary fiber'),
      salt_g: grams('Salt (NaCl) only, never sodium'),
      sodium: objectSchema(
        { amount: nullable({ type: 'number' }), unit: nullable(enumSchema(['mg', 'g'])) },
        'Sodium only, never salt',
      ),
    },
    'Values from ONE column of the printed nutrition table',
  ),
  ingredients: objectSchema({
    visible: { type: 'boolean' },
    items: {
      type: 'array',
      description: 'Ingredients in printed order',
      items: objectSchema({ name: { type: 'string' }, percent: nullable({ type: 'number' }) }),
    },
  }),
  allergens: objectSchema({
    statement_visible: { type: 'boolean' },
    items: {
      type: 'array',
      items: objectSchema({
        allergen: enumSchema(ALLERGEN_CODES),
        presence: enumSchema(['contains', 'may_contain']),
        evidence: enumSchema(META_ALLERGEN_EVIDENCE),
      }),
    },
  }),
  additives: {
    type: 'array',
    description: 'Food additives from the ingredients list',
    items: objectSchema({ e_number: nullable({ type: 'string' }), name: nullable({ type: 'string' }) }),
  },
  english: nullable(objectSchema({
    name: nullable({ type: 'string' }),
    ingredients: { type: 'array', items: { type: 'string' } },
    additives: { type: 'array', items: nullable({ type: 'string' }) },
  })),
  confidence: objectSchema({
    overall: enumSchema(META_CONFIDENCE),
    identity: enumSchema(META_CONFIDENCE),
    nutrition: enumSchema(META_CONFIDENCE),
    ingredients: enumSchema(META_CONFIDENCE),
  }),
});
