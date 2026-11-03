import type { Product } from '@foodlens/core';

/** product: штрихкод или фото упаковки; label: отдельный скан таблицы пищевой ценности. */
export type ScanMode = 'product' | 'label';

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

/** Что на фото. Только подсказка серверу и подпись в предпросмотре. */
export type ScanPhotoRole = 'product' | 'nutrition' | 'ingredients';

/** Фото в наборе одного скана. */
export interface ScanSlot {
  readonly photo: ScanPhoto;
  readonly role: ScanPhotoRole;
}
