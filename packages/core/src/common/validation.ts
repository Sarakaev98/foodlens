/**
 * Небольшие чистые валидаторы без внешних зависимостей. Используются
 * и на backend, и в mobile, поэтому правила проверки существуют в одном месте.
 */

export type ValidationIssueCode =
  | 'required'
  | 'invalid_type'
  | 'not_integer'
  | 'out_of_range'
  | 'unknown_value'
  | 'too_long'
  | 'too_many'
  | 'exclusive_value';

export interface ValidationIssue {
  readonly field: string;
  readonly code: ValidationIssueCode;
  readonly params?: Readonly<Record<string, string | number>>;
}

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

export type FieldResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issue: ValidationIssue };

export type FieldValidator<T> = (value: unknown, field: string) => FieldResult<T>;

const valid = <T>(value: T): FieldResult<T> => ({ ok: true, value });
const invalid = <T>(issue: ValidationIssue): FieldResult<T> => ({ ok: false, issue });

export function oneOf<const T extends string>(allowed: readonly T[]): FieldValidator<T> {
  return (value, field) => {
    if (value === undefined || value === null || value === '') return invalid({ field, code: 'required' });
    if (typeof value !== 'string') return invalid({ field, code: 'invalid_type' });
    return (allowed as readonly string[]).includes(value)
      ? valid(value as T)
      : invalid({ field, code: 'unknown_value', params: { value } });
  };
}

export interface NumberRange {
  readonly min: number;
  readonly max: number;
  readonly integer?: boolean;
}

export function numberInRange({ min, max, integer = false }: NumberRange): FieldValidator<number> {
  return (value, field) => {
    if (value === undefined || value === null || value === '') return invalid({ field, code: 'required' });
    if (typeof value !== 'number' || !Number.isFinite(value)) return invalid({ field, code: 'invalid_type' });
    if (integer && !Number.isInteger(value)) return invalid({ field, code: 'not_integer' });
    if (value < min || value > max) return invalid({ field, code: 'out_of_range', params: { min, max } });
    return valid(value);
  };
}

/** Непустая строка без пробелов по краям. */
export function trimmedText({ maxLength }: { readonly maxLength: number }): FieldValidator<string> {
  return (value, field) => {
    if (typeof value !== 'string') return invalid({ field, code: 'invalid_type' });
    const text = value.trim();
    if (text.length === 0) return invalid({ field, code: 'required' });
    if (text.length > maxLength) return invalid({ field, code: 'too_long', params: { max: maxLength } });
    return valid(text);
  };
}

/** Массив значений: проверяет каждый элемент и убирает дубликаты (по ключу). */
export function uniqueListOf<T>(
  item: FieldValidator<T>,
  { maxItems, key = (v) => String(v) }: { readonly maxItems: number; readonly key?: (value: T) => string },
): FieldValidator<T[]> {
  return (value, field) => {
    if (value === undefined || value === null) return invalid({ field, code: 'required' });
    if (!Array.isArray(value)) return invalid({ field, code: 'invalid_type' });
    if (value.length > maxItems) return invalid({ field, code: 'too_many', params: { max: maxItems } });

    const seen = new Set<string>();
    const result: T[] = [];
    for (const [index, raw] of value.entries()) {
      const parsed = item(raw, field);
      if (!parsed.ok) return invalid({ ...parsed.issue, params: { ...parsed.issue.params, index } });
      const itemKey = key(parsed.value);
      if (!seen.has(itemKey)) {
        seen.add(itemKey);
        result.push(parsed.value);
      }
    }
    return valid(result);
  };
}
