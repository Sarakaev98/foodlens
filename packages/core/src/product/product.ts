import type { Brand, ConfidenceLevel, Detected, ExternalProvenance } from '../common';
import type { NutrientKey, NutritionFacts } from '../nutrition';
import type { Additive } from './additive';
import type { Allergen } from './allergen';
import type { Ingredient } from './ingredient';
import type { ProductCategory } from './product-category';
import type { ProductSource } from './product-source';
import type { ProductSemantics } from './product-semantics';

export type ProductId = Brand<string, 'ProductId'>;

/**
 * Уверенность по разделам. Раздел, которого нет на изображении, имеет null:
 * уверенность в отсутствующих данных не имеет смысла.
 */
export interface ProductConfidence {
  readonly overall: ConfidenceLevel;
  readonly identity: ConfidenceLevel;
  readonly nutrition: ConfidenceLevel | null;
  readonly ingredients: ConfidenceLevel | null;
}

/**
 * Нормализованный продукт: единый формат, который возвращает Scan
 * независимо от способа получения (фото, штрихкод, ручной ввод)
 * и с которым работают scoring, AI и UI.
 */
export interface Product {
  readonly id: ProductId;
  readonly name: Detected<string>;
  readonly brand: Detected<string>;
  readonly category: Detected<ProductCategory>;
  /** null: этикетки с пищевой ценностью на изображении нет. */
  readonly nutrition: NutritionFacts | null;
  /** Per-field disclosure for completed MVP nutrition; source provenance remains on each value. */
  readonly nutritionMetadata?: {
    readonly version: string;
    readonly basis: { readonly quality: 'verified' | 'estimated'; readonly confidence: ConfidenceLevel; readonly reason: string };
    readonly fields: Readonly<Record<NutrientKey, NutritionFieldMetadata>>;
    /** Conflicting source facts cannot be repaired by overwriting exact values. Does not gate Product Score. */
    readonly constraints?: readonly string[];
  };
  /** Optional for legacy scans; missing context must never be invented by scoring. */
  readonly semantics?: ProductSemantics | null;
  /** Состав в порядке этикетки. not_detected: состава на изображении нет. */
  readonly ingredients: Detected<readonly Ingredient[]>;
  /** not_detected: ни состава, ни заявления об аллергенах не видно. Пустой список: аллергены не указаны. */
  readonly allergens: Detected<readonly Allergen[]>;
  readonly additives: Detected<readonly Additive[]>;
  readonly confidence: ProductConfidence;
  readonly source: ProductSource;
  /** Откуда взято значение из внешнего источника. Для отладки и будущей ссылки на источник. */
  readonly fieldEvidence?: readonly FieldEvidence[];
}

export interface FieldEvidence {
  readonly field: string;
  readonly source: ExternalProvenance;
  readonly url: string;
  readonly domain: string;
  /** 1: производитель; 2: крупный магазин; 3: база продуктов. */
  readonly tier: number;
  readonly confidence: ConfidenceLevel;
  /** Как подтверждён продукт: exact_barcode, official_variant или two_sources. */
  readonly identityMatch: string;
  /** ISO 8601. */
  readonly retrievedAt: string;
  /** verified: сильный источник; confirmed: согласие независимых сайтов; database: запись базы; estimated: оценка, показывается с «≈». */
  readonly dataQuality?: 'verified' | 'confirmed' | 'database' | 'estimated';
  /** Разброс значений оценки. */
  readonly estimatedRange?: readonly [number, number];
  /** Уровень доверия к источнику, например official_manufacturer. */
  readonly trust?: string;
  /** Значение источника заменено на это: более сильные источники его опровергли. */
  readonly corrected?: boolean;
  /** Основа значения после приведения, например per_100g. */
  readonly basis?: string;
  /** Сколько независимых сайтов дали это значение. */
  readonly consensusCount?: number;
  /** Адреса всех страниц, совпавших по значению. */
  readonly sources?: readonly string[];
  /** Состав только для показа: источник слабый, поэтому в Product Score и Goal Match он не идёт. */
  readonly ingredientsOnly?: boolean;
}

/** Estimates may be scored but must never masquerade as measurements. */
export interface NutritionFieldMetadata {
  readonly quality: 'verified' | 'estimated' | 'ai_estimated';
  readonly confidence: ConfidenceLevel;
  readonly method: 'source' | 'derived' | 'context_rules' | 'ai';
  readonly reason: string;
}
