import type { Product } from '@foodlens/core';

export type ScanMode = 'photo' | 'barcode';

/** Scan всегда отдаёт наружу нормализованный Product, независимо от способа сканирования. */
export interface ScanResult {
  readonly mode: ScanMode;
  readonly product: Product;
}
