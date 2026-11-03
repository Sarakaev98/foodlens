import type { MetaProductAnalysis } from '../providers/meta/meta-product-analysis';
import { MOCK_META_PRODUCT_ANALYSIS } from '../providers/mock/mock-product-analysis';

type DeepPartial<T> = { -readonly [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** Полный корректный ответ Meta (тот же, что отдаёт MockProvider) с точечными изменениями. */
export function metaAnalysis(overrides: DeepPartial<MetaProductAnalysis> = {}): MetaProductAnalysis {
  return merge(structuredClone(MOCK_META_PRODUCT_ANALYSIS), overrides) as MetaProductAnalysis;
}

function merge(target: unknown, patch: unknown): unknown {
  if (patch === undefined) return target;
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) return patch;
  const result: Record<string, unknown> = { ...(target as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch)) result[key] = merge(result[key], value);
  return result;
}

export const CONTEXT = { productId: 'scan_test', analyzedAt: '2026-10-27T12:00:00.000Z' } as const;
