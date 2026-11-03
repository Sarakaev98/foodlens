import { CONFIDENCE_LEVELS, type ConfidenceLevel } from '../common';
import {
  PROCESSING_LEVELS, PRODUCT_FORMS, PRODUCT_SEMANTICS_VERSION, SUGAR_SOURCES,
  type ProductSemantics, type SemanticField, type TypicalServing,
} from './product-semantics';

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
const hasOnly = (r: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(r).every((key) => keys.includes(key));
const confidence = (value: unknown): value is ConfidenceLevel =>
  typeof value === 'string' && (CONFIDENCE_LEVELS as readonly string[]).includes(value);
function evidence(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value.map((item) => item.trim()).filter(Boolean) : null;
}
function field<T extends string>(raw: unknown, allowed: readonly T[], evidenceRequired: T): SemanticField<T | 'unknown'> {
  const unknown: SemanticField<'unknown'> = { value: 'unknown', confidence: 'low', evidence: [] };
  const r = record(raw);
  if (!r || !hasOnly(r, ['value', 'confidence', 'evidence']) || !confidence(r.confidence)) return unknown;
  const words = evidence(r.evidence);
  if (words === null || typeof r.value !== 'string' || !(allowed as readonly string[]).includes(r.value)) return unknown;
  if (r.value === evidenceRequired && words.length === 0) return unknown;
  return { value: r.value as T, confidence: r.confidence, evidence: words };
}
function typical(raw: unknown): TypicalServing | null {
  const r = record(raw);
  if (!r || !hasOnly(r, ['amount', 'unit', 'confidence', 'evidence']) ||
      typeof r.amount !== 'number' || !Number.isFinite(r.amount) || r.amount <= 0 ||
      (r.unit !== 'g' && r.unit !== 'ml') || !confidence(r.confidence)) return null;
  const words = evidence(r.evidence);
  return words === null ? null : { amount: r.amount, unit: r.unit, confidence: r.confidence, evidence: words };
}

/** Missing/invalid blocks remain unavailable; invalid individual fields become explicit unknowns. */
export function normalizeProductSemantics(raw: unknown, hasLabelServing = false): ProductSemantics | null {
  const r = record(raw);
  const keys = ['version', 'sugarSource', 'processing', 'productForm', 'typicalServing'];
  if (!r || r.version !== PRODUCT_SEMANTICS_VERSION || !hasOnly(r, keys) ||
      keys.some((key) => !Object.prototype.hasOwnProperty.call(r, key))) return null;
  const form = record(r.productForm);
  const formValid = form && hasOnly(form, ['value', 'confidence']) && confidence(form.confidence) &&
    typeof form.value === 'string' && (PRODUCT_FORMS as readonly string[]).includes(form.value);
  return {
    version: PRODUCT_SEMANTICS_VERSION,
    sugarSource: field(r.sugarSource, SUGAR_SOURCES, 'intrinsic'),
    processing: field(r.processing, PROCESSING_LEVELS, 'whole_or_minimal'),
    productForm: formValid
      ? { value: form.value as ProductSemantics['productForm']['value'], confidence: form.confidence as ConfidenceLevel }
      : { value: 'unknown', confidence: 'low' },
    typicalServing: hasLabelServing ? null : typical(r.typicalServing),
  };
}
