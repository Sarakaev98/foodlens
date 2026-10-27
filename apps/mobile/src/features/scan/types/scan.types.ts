import type { Product } from '@foodlens/core';

export type ScanMode = 'photo' | 'barcode';

/** Scan всегда отдаёт наружу нормализованный Product, независимо от способа сканирования. */
export interface ScanResult {
  readonly mode: ScanMode;
  readonly product: Product;
}

/** Фото, готовое к отправке: уменьшено и пересохранено в JPEG. Живёт только во временном кэше. */
export interface ScanPhoto {
  readonly uri: string;
  readonly width: number;
  readonly height: number;
}
