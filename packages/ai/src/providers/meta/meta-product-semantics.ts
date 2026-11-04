import { normalizeProductSemantics } from '@foodlens/core';

/** Canonicalize only the semantic extension before strict validation of the complete AI response.
 * Original nutrition/identity/allergen fields are never repaired or guessed here.
 */
export function prepareMetaProductAnalysis(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw;
  const r = raw as Record<string, unknown>;
  const table = r.nutrition_table as { serving_size?: { amount?: unknown; unit?: unknown } } | undefined;
  const serving = table?.serving_size;
  const hasLabelServing = typeof serving?.amount === 'number' && Number.isFinite(serving.amount) &&
    serving.amount > 0 && (serving.unit === 'g' || serving.unit === 'ml');
  return { ...r, english: r.english && typeof r.english === 'object' && !Array.isArray(r.english) ? { name: null, ...r.english } : r.english ?? null, semantics: normalizeProductSemantics(r.semantics, hasLabelServing) };
}
