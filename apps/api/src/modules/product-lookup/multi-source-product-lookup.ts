import { abortableLookup, WEB_ENRICHMENT_TIMEOUT_MS } from './lookup-budget';
import { isExternalProvenance, type Product } from '@foodlens/core';
import type { IngredientsDecision, ProductLookupContext, ProductLookupProvider, ProductLookupResult, WebSearchSummary } from './product-lookup.provider';
import { nutritionAnomalies } from './nutrition-anomalies';
import { applyMergeConfidence, mergeProductLookup, type ProductMergeReport } from './product-merge';

export interface LookupStep {
  readonly provider: string;
  /** Решение по составу на страницах источника. */
  readonly ingredients?: IngredientsDecision;
  /** not_needed: источник не вызывался, запрашиваемых пропусков уже нет. */
  readonly status: 'hit' | 'miss' | 'error' | 'not_needed';
  readonly result: ProductLookupResult | null;
  readonly report: ProductMergeReport | null;
  readonly latencyMs: number;
  readonly error: string | null;
  /** Пропуски на момент вызова источника. */
  readonly missingFields: readonly string[];
  /** Итог поиска страниц. Нет, если ответ взят из кэша. */
  readonly search?: WebSearchSummary;
}

export interface EnrichedProduct {
  readonly product: Product;
  readonly steps: readonly LookupStep[];
}

/** Главные факторы риска для оценки. Полный список пропусков даёт missingNutritionFields. */
export function missingCriticalNutrients(product: Product): readonly string[] {
  const n = product.nutrition;
  if (!n) return ['sugars', 'saturatedFat', 'salt'];
  return [
    ...(n.sugarsG.value === null ? ['sugars'] : []),
    ...(n.saturatedFatG.value === null ? ['saturatedFat'] : []),
    ...(n.saltG.value === null && n.sodiumMg.value === null ? ['salt'] : []),
  ];
}

/** Все доступные для поиска нутриенты. Соль и натрий покрывают друг друга. */
export function missingNutritionFields(product: Product): readonly string[] {
  const n = product.nutrition;
  const fields = [['kcal', 'caloriesKcal'], ['protein', 'proteinG'], ['carbs', 'carbsG'], ['fat', 'fatG'], ['fiber', 'fiberG']] as const;
  return [...missingCriticalNutrients(product), ...fields.filter(([, key]) => n?.[key].value == null).map(([field]) => field)];
}

export type LookupDiagnostic = (stage: string, fields: Readonly<Record<string, unknown>>) => void;

const nutritionSnapshot = (product: Product) => ({
  basis: product.nutrition?.basis ?? null,
  values: product.nutrition ? Object.fromEntries(Object.entries(product.nutrition).filter(([key]) => key !== 'basis' && key !== 'servingSize').map(([key, field]) => [key, field.value])) : null,
});

type Lookup = Pick<LookupStep, 'status' | 'result' | 'latencyMs' | 'error' | 'ingredients' | 'search'>;

/** Без этого числа макросов не с чем сверять страницу, поэтому они ищутся вместе с остальным. */
const MIN_REFERENCE_MACROS = 3;

/** Только данные продукта для внешнего поиска. Все недостающие нутриенты могут запустить поиск. */
function correctableValues(product: Product): Readonly<Record<string, number>> {
  const n = product.nutrition;
  if (!n || n.basis === 'per_serving' || n.basis === 'unknown') return {};
  const fields = [['kcal', n.caloriesKcal], ['protein', n.proteinG], ['carbs', n.carbsG], ['fat', n.fatG], ['sugars', n.sugarsG], ['saturatedFat', n.saturatedFatG], ['salt', n.saltG], ['fiber', n.fiberG]] as const;
  return Object.fromEntries(fields.flatMap(([field, value]) => (value.value !== null && isExternalProvenance(value.provenance) ? [[field, value.value]] : [])));
}

function lookupContext(product: Product, missing: readonly string[], suspicious: readonly string[]): ProductLookupContext {
  const n = product.nutrition;
  const serving = n?.servingSize.value;
  // Подозрительный макрос не годится для сверки страниц: он сам проверяется.
  const trusted = (field: string, value: number | null | undefined) => (suspicious.includes(field) ? null : value ?? null);
  const macros = { kcal: trusted('kcal', n?.caloriesKcal.value), protein: trusted('protein', n?.proteinG.value), carbs: trusted('carbs', n?.carbsG.value), fat: trusted('fat', n?.fatG.value) };
  const known = Object.values(macros).filter((value) => value !== null).length;
  const missingMacros = known < MIN_REFERENCE_MACROS ? Object.entries(macros).filter(([, value]) => value === null).map(([field]) => field) : [];
  return {
    brand: product.brand.value, name: product.name.value, serving: serving ? `${serving.amount} ${serving.unit}` : null, basis: n?.basis ?? 'unknown', ...macros,
    missingFields: [...new Set([...missing, ...(n?.sodiumMg.value == null && missing.includes('salt') ? ['sodiumMg'] : []), ...(n?.fiberG.value == null ? ['fiber'] : []), ...missingMacros])],
    needsIngredients: product.ingredients.value === null,
    correctable: correctableValues(product),
    suspiciousFields: suspicious,
  };
}

async function runLookup(source: ProductLookupProvider, barcode: string | null, context?: ProductLookupContext, budgetMs = WEB_ENRICHMENT_TIMEOUT_MS): Promise<Lookup> {
  const startedAt = Date.now();
  let ingredients: IngredientsDecision | undefined;
  let search: WebSearchSummary | undefined;
  if (source.name === 'web_search' && budgetMs <= 0) return { status: 'error', result: null, latencyMs: 0, error: 'web enrichment deadline exceeded' };
  const controller = source.name === 'web_search' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), budgetMs) : undefined;
  try {
    const result = await abortableLookup(controller?.signal, () => source.lookup(barcode, context && { ...context, ...(controller ? { signal: controller.signal } : {}), onIngredients: (decision) => { ingredients = decision; }, onSearch: (summary) => { search = summary; } }));
    return { status: result ? 'hit' : 'miss', result, latencyMs: Date.now() - startedAt, error: null, ...(ingredients ? { ingredients } : {}), ...(search ? { search } : {}) };
  } catch (error) {
    return { status: 'error', result: null, latencyMs: Date.now() - startedAt, error: (error as Error)?.message ?? 'lookup failed' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Источники по порядку доверия. Первый запускается сразу, параллельно с анализом фото;
 * следующие вызываются, если после предыдущих остались пропуски или аномалии.
 * Ни один сбой источника не роняет скан, и ни один из них не получает фото: только штрихкод.
 */
export class MultiSourceProductLookup {
  constructor(private readonly sources: readonly ProductLookupProvider[]) {}

  begin(barcode: string | null, diagnostic: LookupDiagnostic = () => undefined) {
    const sources = this.sources.filter((source) => barcode !== null || source.needsBarcode === false);
    const needsBarcodeFirst = sources[0]?.needsBarcode !== false;
    const first = needsBarcodeFirst ? sources[0] : undefined;
    const rest = needsBarcodeFirst ? sources.slice(1) : sources;
    let webDeadline: number | null = null;
    const started = first ? runLookup(first, barcode) : null;

    return {
      enrich: async (analyzed: Product): Promise<EnrichedProduct> => {
        const steps: LookupStep[] = [];
        let product = analyzed;
        const apply = (provider: string, lookup: Lookup, missing: readonly string[]) => {
          const merged = lookup.result ? mergeProductLookup(product, lookup.result) : null;
          product = merged?.product ?? product;
          steps.push({ provider, ...lookup, report: merged?.report ?? null, missingFields: missing });
        };
        if (first && started) {
          apply(first.name, await started, missingNutritionFields(analyzed));
          diagnostic('PRODUCT_IDENTIFIED', { namePresent: product.name.value !== null, brandPresent: product.brand.value !== null, source: first.name, status: steps[0]!.status });
          diagnostic('PRIMARY_NUTRITION', nutritionSnapshot(product));
        } else {
          diagnostic('PRODUCT_IDENTIFIED', { namePresent: product.name.value !== null, brandPresent: product.brand.value !== null, source: 'analysis' });
          diagnostic('PRIMARY_NUTRITION', nutritionSnapshot(product));
        }
        for (const source of rest) {
          const suspicious = barcode ? nutritionAnomalies(product) : [];
          const missing = [...new Set([...missingNutritionFields(product), ...suspicious])];
          // Состав ищет веб-поиск; достаточность идентификации проверяет провайдер.
          const ingredientsOnly = source.needsBarcode === false && product.ingredients.value === null;
          diagnostic('MISSING_FIELDS', { provider: source.name, missing, ingredients: product.ingredients.value === null });
          // Missing fiber alone does not justify a web search when OFF supplied all core/risk nutrients.
          const offSufficient = source.name === 'web_search' && !ingredientsOnly &&
            steps.some(step => step.provider === 'open_food_facts' && step.status === 'hit') &&
            missing.every(field => field === 'fiber');
          if ((missing.length === 0 && !ingredientsOnly) || offSufficient) {
            steps.push({ provider: source.name, status: 'not_needed', result: null, report: null, latencyMs: 0, error: null, missingFields: missing });
            continue;
          }
          diagnostic('ENRICHMENT_STARTED', { provider: source.name, missing });
          if (source.name === 'web_search') webDeadline ??= Date.now() + WEB_ENRICHMENT_TIMEOUT_MS;
          const budgetMs = source.name === 'web_search' ? Math.max(0, webDeadline! - Date.now()) : WEB_ENRICHMENT_TIMEOUT_MS;
          apply(source.name, await runLookup(source, barcode, lookupContext(product, missing, suspicious), budgetMs), missing);
          const step = steps.at(-1)!;
          diagnostic('ENRICHMENT_RESULT', { provider: source.name, status: step.status, errorPresent: step.error !== null, report: step.report, search: step.search ?? null });
        }
        const reports = steps.flatMap((step) => (step.report ? [step.report] : []));
        diagnostic('MERGED_NUTRITION', { ...nutritionSnapshot(product), missing: missingNutritionFields(product) });
        return { product: reports.length > 0 ? applyMergeConfidence(product, reports) : product, steps };
      },
    };
  }
}
