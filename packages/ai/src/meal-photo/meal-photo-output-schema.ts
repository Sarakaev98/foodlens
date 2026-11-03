import { CONFIDENCE_LEVELS } from '@foodlens/core';
import { enumSchema, nullable, objectSchema, type JsonSchema } from '../json-schema/json-schema';

const confidence = enumSchema(CONFIDENCE_LEVELS);

/** Короткие snake_case ключи: меньше токенов ответа. total модели только сверяется, итог считает сервер. */
export const MEAL_PHOTO_OUTPUT_SCHEMA: JsonSchema = objectSchema({
  is_food: { type: 'boolean' },
  meal_name: { type: 'string' },
  items: {
    type: 'array',
    items: objectSchema({
      name: { type: 'string' },
      grams: { type: 'number' },
      kcal: { type: 'number' },
      protein_g: { type: 'number' },
      carbs_g: { type: 'number' },
      fat_g: { type: 'number' },
      confidence,
    }),
  },
  total_kcal: { type: 'number' },
  kcal_min: nullable({ type: 'number' }),
  kcal_max: nullable({ type: 'number' }),
  confidence,
  assumptions: { type: 'array', items: { type: 'string' } },
});

export interface MealPhotoAiItem {
  readonly name: string;
  readonly grams: number;
  readonly kcal: number;
  readonly protein_g: number;
  readonly carbs_g: number;
  readonly fat_g: number;
  readonly confidence: (typeof CONFIDENCE_LEVELS)[number];
}

/** Сырой ответ модели после проверки схемы. Числам ещё нельзя доверять: их проверяет normalizeMealPhotoEstimate. */
export interface MealPhotoAiOutput {
  readonly is_food: boolean;
  readonly meal_name: string;
  readonly items: readonly MealPhotoAiItem[];
  readonly total_kcal: number;
  readonly kcal_min: number | null;
  readonly kcal_max: number | null;
  readonly confidence: (typeof CONFIDENCE_LEVELS)[number];
  readonly assumptions: readonly string[];
}

/** Vertex responseSchema: nullable вместо anyOf с null. */
export function vertexMealPhotoResponseSchema(): Record<string, unknown> {
  const convert = (schema: JsonSchema): Record<string, unknown> => {
    if ('anyOf' in schema) {
      const nonNull = schema.anyOf.filter((option) => !('type' in option && option.type === 'null'));
      return nonNull.length === 1 ? { ...convert(nonNull[0]!), nullable: true } : { anyOf: schema.anyOf.map(convert) };
    }
    const out: Record<string, unknown> = { type: schema.type.toUpperCase() };
    if (schema.type === 'string' && schema.enum) out.enum = schema.enum;
    if (schema.type === 'array') out.items = convert(schema.items);
    if (schema.type === 'object') {
      out.properties = Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, convert(value)]));
      out.required = schema.required;
      out.propertyOrdering = Object.keys(schema.properties);
    }
    return out;
  };
  return convert(MEAL_PHOTO_OUTPUT_SCHEMA);
}
