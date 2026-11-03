import { MEAL_SLOTS } from '@foodlens/core';
import { enumSchema, objectSchema, type JsonSchema } from '../json-schema/json-schema';

/** Итоги дня модель не присылает: их считает код. */
export const MEAL_PLAN_OUTPUT_SCHEMA: JsonSchema = objectSchema({
  meals: {
    type: 'array',
    items: objectSchema({
      slot: enumSchema(MEAL_SLOTS),
      name: { type: 'string' },
      description: { type: 'string' },
      ingredients: { type: 'array', items: { type: 'string' } },
      portion: { type: 'string' },
      calories_kcal: { type: 'number' },
      protein_g: { type: 'number' },
      carbs_g: { type: 'number' },
      fat_g: { type: 'number' },
    }),
  },
});

export interface MealPlanOutput {
  readonly meals: readonly {
    readonly slot: (typeof MEAL_SLOTS)[number];
    readonly name: string;
    readonly description: string;
    readonly ingredients: readonly string[];
    readonly portion: string;
    readonly calories_kcal: number;
    readonly protein_g: number;
    readonly carbs_g: number;
    readonly fat_g: number;
  }[];
}

/** Vertex responseSchema supports a subset; do not send unsupported additionalProperties. */
export function vertexMealPlanResponseSchema(): Record<string, unknown> {
  const convert = (schema: JsonSchema): Record<string, unknown> => {
    if ('anyOf' in schema) return { anyOf: schema.anyOf.map(convert) };
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
  return convert(MEAL_PLAN_OUTPUT_SCHEMA);
}
