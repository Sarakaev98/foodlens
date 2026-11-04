import type { Additive, Allergen, ConfidenceLevel, ExternalProvenance, FieldEvidence, Ingredient, NutrientKey, ProductCategory, ServingSize } from '@foodlens/core';

/** DI-токен для ProductLookupProvider: источник данных о продукте по штрихкоду. */
export const PRODUCT_LOOKUP = Symbol('PRODUCT_LOOKUP');

/** Пищевая ценность из базы, всегда на 100 г или 100 мл. null: значения нет, это не ноль. */
export interface ProductLookupNutrition {
  readonly basis: 'per_100g' | 'per_100ml';
  readonly values: Readonly<Record<NutrientKey, number | null>>;
  /** Значения, рассчитанные из других (ккал из кДж), а не указанные в базе напрямую. */
  readonly derived: readonly NutrientKey[];
}

/** По данным источника: напиток ли это. unknown: категорий нет. */
export type BeverageClassification = 'beverage' | 'not_beverage' | 'unknown';

/** Откуда взято значение со страницы. Сохраняется в Product для заполненных полей. */
export interface WebFieldSource {
  readonly url: string;
  readonly domain: string;
  readonly tier: number;
  readonly confidence: ConfidenceLevel;
  readonly identityMatch: string;
  readonly retrievedAt: string;
  readonly method: string;
  readonly ingredientsOnly?: boolean;
  readonly basis?: string;
  readonly consensusCount?: number;
  readonly sources?: readonly string[];
  readonly trust?: string;
  readonly dataQuality?: FieldEvidence['dataQuality'];
  readonly estimatedRange?: readonly [number, number];
}

/** Что стало с составом на найденных страницах. Без текста состава. */
export interface IngredientsDecision {
  readonly found: boolean;
  readonly accepted: boolean;
  readonly source: string | null;
  readonly rejectReason: string | null;
}

/** Итог поиска страниц для журнала. Без текста страниц. */
export interface WebSearchSummary {
  readonly searches: number;
  readonly candidates: number;
  readonly pagesRead: number;
  readonly accepted: readonly string[];
  readonly rejected: readonly { readonly domain: string; readonly reason: string }[];
  readonly credits: number;
  readonly aiExtractions: number;
  /** Отпечаток принятой рецептуры и отклонённых групп. */
  readonly recipe: string;
  readonly rejectedRecipes: readonly string[];
  /** Значения базы, исправленные более сильными источниками. */
  readonly corrected: readonly string[];
}

export interface ProductLookupEvidence {
  readonly fields: Partial<Record<NutrientKey, WebFieldSource>>;
  readonly ingredients?: WebFieldSource;
  readonly webSearchQueries: number;
}

/** Что уже известно о продукте. Только данные продукта: ни фото, ни профиля, ни оценок. */
export interface ProductLookupContext {
  readonly brand: string | null;
  readonly name: string | null;
  readonly serving: string | null;
  readonly basis: string;
  readonly kcal: number | null;
  readonly protein: number | null;
  readonly carbs: number | null;
  readonly fat: number | null;
  readonly missingFields: readonly string[];
  /** Название уточнено по точному штрихкоду в результатах поиска, а страница с домена производителя. */
  readonly nameConfirmed?: boolean;
  /** Состава пока нет: ради него можно прочитать страницу с точным штрихкодом. Сам поиск он не запускает. */
  readonly needsIngredients?: boolean;
  /** Значения из базы: их может исправить более сильный источник. С этикетки сюда не попадают. */
  readonly correctable?: Readonly<Record<string, number>>;
  /** Значения базы, которые противоречат сами себе: их можно заменить одним сильным источником или consensus. */
  readonly suspiciousFields?: readonly string[];
  readonly onIngredients?: (decision: IngredientsDecision) => void;
  readonly onSearch?: (summary: WebSearchSummary) => void;
}

/**
 * Насколько точно запись относится к продукту. В расчёты попадает только:
 * exact_barcode: точное совпадение штрихкода;
 * verified_identity: страница уже проверена кодом до слияния (штрихкод, вариант, макросы этикетки);
 * verified_attributes: штрихкода нет, но бренд, название, размер упаковки и макросы совпали (проверяется при слиянии);
 * name_only никогда не влияет на оценки.
 */
export type ProductLookupMatch = 'exact_barcode' | 'verified_identity' | 'verified_attributes' | 'name_only';

/** Только то, что база действительно содержит. Оценки базы сюда не попадают. */
export interface ProductLookupResult {
  readonly provider: ExternalProvenance;
  readonly match: ProductLookupMatch;
  readonly barcode: string;
  readonly name: string | null;
  readonly brand: string | null;
  readonly nutrition: ProductLookupNutrition | null;
  readonly servingSize: ServingSize | null;
  readonly ingredients: readonly Ingredient[] | null;
  /** Source text ends in a list separator: completeness is not established. */
  readonly ingredientsIncomplete?: boolean;
  readonly allergens: readonly Allergen[] | null;
  readonly additives: readonly Additive[] | null;
  readonly evidence?: ProductLookupEvidence;
  /** Поля nutrition, заменяющие значения из базы, а не только заполняющие пустоту. */
  readonly corrections?: readonly NutrientKey[];
  /** Категория из базы. */
  readonly category?: ProductCategory | null;
  /** Оценки самой базы: только если поле не нашлось больше нигде. */
  readonly estimates?: Partial<Record<NutrientKey, number>>;
  /** Группа обработки NOVA 1–4 из базы. */
  readonly nova?: number | null;
  /** Победила другая рецептура: всё, что она не подтвердила, относится к старой и очищается. */
  readonly replacesRecipe?: boolean;
  readonly beverage?: BeverageClassification;
}

/**
 * Поиск продукта по точному штрихкоду. null: продукта в базе нет.
 * Ошибка источника бросается наружу; ScanService её перехватывает и скан продолжается без базы.
 */
export interface ProductLookupProvider {
  readonly name: string;
  /** false: источник может работать без штрихкода. По умолчанию штрихкод обязателен. */
  readonly needsBarcode?: boolean;
  lookup(barcode: string | null, context?: ProductLookupContext): Promise<ProductLookupResult | null>;
  /** Ключ кэша, если одного штрихкода недостаточно. */
  cacheKey?(barcode: string | null, context?: ProductLookupContext): string;
}

/** Базы нет, сети нет, всегда null. Для тестов и PRODUCT_LOOKUP=none. */
export class NullProductLookupProvider implements ProductLookupProvider {
  readonly name = 'null';

  async lookup(): Promise<ProductLookupResult | null> {
    return null;
  }
}
