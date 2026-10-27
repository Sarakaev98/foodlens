/**
 * Минимальное подмножество JSON Schema, которое принимает strict structured output:
 * объекты с additionalProperties: false, массивы, enum, nullable через anyOf.
 */
export type JsonSchema =
  | { readonly type: 'string'; readonly enum?: readonly string[]; readonly description?: string }
  | { readonly type: 'number' | 'integer' | 'boolean'; readonly description?: string }
  | { readonly type: 'null' }
  | { readonly type: 'array'; readonly items: JsonSchema; readonly description?: string }
  | {
      readonly type: 'object';
      readonly properties: Readonly<Record<string, JsonSchema>>;
      readonly required: readonly string[];
      readonly additionalProperties: false;
      readonly description?: string;
    }
  | { readonly anyOf: readonly JsonSchema[]; readonly description?: string };

/** Объект, где все поля обязательны и лишние запрещены (требование strict mode). */
export function objectSchema(properties: Readonly<Record<string, JsonSchema>>, description?: string): JsonSchema {
  return {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
    ...(description ? { description } : {}),
  };
}

export function nullable(schema: JsonSchema, description?: string): JsonSchema {
  return { anyOf: [schema, { type: 'null' }], ...(description ? { description } : {}) };
}

export function enumSchema(values: readonly string[], description?: string): JsonSchema {
  return { type: 'string', enum: values, ...(description ? { description } : {}) };
}

/**
 * Проверяет значение по той же схеме, что отправлена провайдеру.
 * Strict mode обещает соответствие, но доверять ответу внешнего сервиса без проверки нельзя.
 * Возвращает путь до первого несоответствия или null.
 */
export function findSchemaViolation(schema: JsonSchema, value: unknown, path = '$'): string | null {
  if ('anyOf' in schema) {
    return schema.anyOf.some((option) => findSchemaViolation(option, value, path) === null)
      ? null
      : `${path}: no matching variant`;
  }
  switch (schema.type) {
    case 'null':
      return value === null ? null : `${path}: expected null`;
    case 'boolean':
      return typeof value === 'boolean' ? null : `${path}: expected boolean`;
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? null : `${path}: expected number`;
    case 'integer':
      return Number.isInteger(value) ? null : `${path}: expected integer`;
    case 'string':
      if (typeof value !== 'string') return `${path}: expected string`;
      return schema.enum && !schema.enum.includes(value) ? `${path}: unexpected enum value` : null;
    case 'array': {
      if (!Array.isArray(value)) return `${path}: expected array`;
      for (const [index, item] of value.entries()) {
        const violation = findSchemaViolation(schema.items, item, `${path}[${index}]`);
        if (violation) return violation;
      }
      return null;
    }
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return `${path}: expected object`;
      const record = value as Record<string, unknown>;
      for (const key of schema.required) {
        if (!(key in record)) return `${path}.${key}: missing`;
      }
      for (const key of Object.keys(record)) {
        const property = schema.properties[key];
        if (!property) return `${path}.${key}: unexpected property`;
        const violation = findSchemaViolation(property, record[key], `${path}.${key}`);
        if (violation) return violation;
      }
      return null;
    }
  }
}
