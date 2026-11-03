import { META_PRODUCT_ANALYSIS_SCHEMA, type MetaProductAnalysis } from '../meta/meta-product-analysis';
import { prepareMetaProductAnalysis } from '../meta/meta-product-semantics';
import { enumSchema, objectSchema, type JsonSchema } from '../../json-schema/json-schema';

/** The existing extraction contract, not a Google-specific Product model. */
export const GOOGLE_PRODUCT_ANALYSIS_SCHEMA = META_PRODUCT_ANALYSIS_SCHEMA;
export const GOOGLE_PRODUCT_ANALYSIS_VERSION = 'google-product-analysis-v2';
const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

const STATUS_VALUES = ['observed', 'not_listed', 'unreadable'] as const;
export type GoogleNutritionStatus = (typeof STATUS_VALUES)[number];
const STATUS_FIELDS = ['sugars', 'saturated_fat', 'salt'] as const;
const NUTRITION_STATUS_SCHEMA = objectSchema(Object.fromEntries(STATUS_FIELDS.map((key) => [key, enumSchema(STATUS_VALUES)])));

/** Diagnostic only: enum values for the log. Never reaches Product, and a bad value is null, not a failed scan. */
export function googleNutritionStatus(raw: unknown): Record<(typeof STATUS_FIELDS)[number], GoogleNutritionStatus | null> {
  const status = record(raw) && record(raw.nutrition_status) ? raw.nutrition_status : {};
  const read = (key: (typeof STATUS_FIELDS)[number]) => STATUS_VALUES.find((value) => value === status[key]) ?? null;
  return { sugars: read('sugars'), saturated_fat: read('saturated_fat'), salt: read('salt') };
}

/** Repair only omitted nullable fields, never invent facts or zeros. */
export function prepareGoogleProductAnalysis(input: unknown): unknown {
  if (!record(input)) return input;
  const { nutrition_status: _diagnostic, ...raw } = input;
  const table = raw.nutrition_table;
  const nutrition = record(table) ? { ...table } : table;
  if (record(nutrition)) {
    for (const key of ['energy_kcal', 'energy_kj', 'protein_g', 'carbohydrates_g', 'sugars_g', 'fat_g', 'saturated_fat_g', 'fiber_g', 'salt_g'])
      if (nutrition[key] === undefined) nutrition[key] = null;
    for (const key of ['serving_size', 'sodium']) {
      if (nutrition[key] === undefined) nutrition[key] = { amount: null, unit: null };
      else if (record(nutrition[key])) {
        const field = nutrition[key] as Record<string, unknown>;
        nutrition[key] = { ...field, amount: field.amount === undefined ? null : field.amount, unit: field.unit === undefined ? null : field.unit };
      }
    }
  }
  const prepared = prepareMetaProductAnalysis({ ...raw, nutrition_table: nutrition });
  if (record(prepared) && record(prepared.semantics)) {
    const semantics = { ...prepared.semantics };
    for (const key of ['sugarSource', 'processing']) {
      const field = semantics[key];
      if (record(field) && field.value !== 'unknown' && Array.isArray(field.evidence) && field.evidence.length === 0)
        semantics[key] = { value: 'unknown', confidence: 'low', evidence: [] };
    }
    return { ...prepared, semantics };
  }
  return prepared;
}

/**
 * Vertex/OpenAPI nullable is used instead of branching every optional scalar through anyOf.
 * Descriptions are dropped: the system prompt is the single source of field instructions.
 */
export function googleProductResponseSchema(): Record<string, unknown> {
  const convert = (schema: JsonSchema): Record<string, unknown> => {
    if ('anyOf' in schema) {
      const nonNull = schema.anyOf.filter((s) => !('type' in s && s.type === 'null'));
      if (nonNull.length === 1 && nonNull.length < schema.anyOf.length) return { ...convert(nonNull[0]!), nullable: true };
      return { anyOf: schema.anyOf.map(convert) };
    }
    const out: Record<string, unknown> = { type: schema.type.toUpperCase() };
    if (schema.type === 'string' && schema.enum) out.enum = schema.enum;
    if (schema.type === 'array') out.items = convert(schema.items);
    if (schema.type === 'object') {
      out.properties = Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, convert(v)]));
      out.required = schema.required;
      out.propertyOrdering = Object.keys(schema.properties);
    }
    return out;
  };
  const base = convert(GOOGLE_PRODUCT_ANALYSIS_SCHEMA) as { properties: Record<string, unknown>; required: string[]; propertyOrdering: string[] };
  return {
    ...base,
    properties: { ...base.properties, nutrition_status: convert(NUTRITION_STATUS_SCHEMA) },
    required: [...base.required, 'nutrition_status'],
    propertyOrdering: base.propertyOrdering.flatMap((key) => (key === 'nutrition_table' ? [key, 'nutrition_status'] : [key])),
  };
}

/** Provider-level bounds; contradictory cross-nutrient tables still have the existing v4 guard. */
export function validGoogleProductQuantities(analysis: MetaProductAnalysis): boolean {
  const n = analysis.nutrition_table;
  const per100 = n.basis === 'per_100g' || n.basis === 'per_100ml';
  const within = (x: number | null, max: number) => x === null || (Number.isFinite(x) && x >= 0 && x <= max);
  const kcalMax = per100 ? 900 : 5000,
    gramsMax = per100 ? 100 : 1000;
  if (!within(n.energy_kcal, kcalMax) || !within(n.energy_kj, kcalMax * 4.184)) return false;
  for (const x of [n.protein_g, n.carbohydrates_g, n.sugars_g, n.fat_g, n.saturated_fat_g, n.fiber_g, n.salt_g]) if (!within(x, gramsMax)) return false;
  if (n.serving_size.amount !== null && (!within(n.serving_size.amount, 5000) || n.serving_size.amount === 0)) return false;
  const sodium = n.sodium;
  if (sodium.amount !== null) {
    if (!within(sodium.amount, 100000)) return false;
    if (sodium.unit !== null && !within(sodium.amount * (sodium.unit === 'g' ? 1000 : 1), per100 ? 40000 : 100000)) return false;
  }
  if (
    n.visible &&
    [n.energy_kcal, n.energy_kj, n.protein_g, n.carbohydrates_g, n.sugars_g, n.fat_g, n.saturated_fat_g, n.fiber_g, n.salt_g, n.sodium.amount].some(
      (x) => x !== null,
    )
  ) {
    if (!analysis.image.visible_sections.includes('nutrition_table') || analysis.image.quality === 'unreadable') return false;
  }
  for (const item of analysis.ingredients.items) if (!item.name.trim() || item.name.length > 1000 || !within(item.percent, 100)) return false;
  return true;
}
