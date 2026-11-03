import type { ConfidenceLevel } from '../common';

export const PRODUCT_SEMANTICS_VERSION = 'semantics-v1' as const;
export const SUGAR_SOURCES = ['intrinsic', 'added', 'mixed', 'none', 'unknown'] as const;
export type SugarSource = (typeof SUGAR_SOURCES)[number];
export const PROCESSING_LEVELS = ['whole_or_minimal', 'processed', 'ultra_processed', 'unknown'] as const;
export type ProcessingLevel = (typeof PROCESSING_LEVELS)[number];
export const PRODUCT_FORMS = ['food', 'beverage', 'unknown'] as const;
export type ProductForm = (typeof PRODUCT_FORMS)[number];

export interface SemanticField<T extends string> {
  readonly value: T;
  readonly confidence: ConfidenceLevel;
  readonly evidence: readonly string[];
}

export interface ProductFormField {
  readonly value: ProductForm;
  readonly confidence: ConfidenceLevel;
}

export interface TypicalServing {
  readonly amount: number;
  readonly unit: 'g' | 'ml';
  readonly confidence: ConfidenceLevel;
  readonly evidence: readonly string[];
}

export interface ProductSemantics {
  readonly version: typeof PRODUCT_SEMANTICS_VERSION;
  readonly sugarSource: SemanticField<SugarSource>;
  readonly processing: SemanticField<ProcessingLevel>;
  readonly productForm: ProductFormField;
  readonly typicalServing: TypicalServing | null;
}
