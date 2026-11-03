import type { Logger } from '@nestjs/common';
import type { GoalMatch, GoalMatchV4, Product, ProductScore } from '@foodlens/core';
import { scanDebugEnabled } from '../../common/scan-debug';
import type { LookupStep } from '../product-lookup/multi-source-product-lookup';

/**
 * Журнал скана: только форма строк и полей. Решений здесь нет, ScanService лишь сообщает, что произошло.
 * Порядок ключей в JSON сохраняется: по этим строкам строится диагностика.
 */

/** Отладочная строка `<event> <json>`. Поля собираются, только если включён режим отладки скана. */
export function logScanDebug(logger: Logger, event: string, fields: () => Record<string, unknown>): void {
  if (scanDebugEnabled()) logger.log(`${event} ${JSON.stringify(fields())}`);
}

/** Вызывался ли analyzeProduct и почему. */
export interface ScanAiCall {
  readonly called: boolean;
  readonly reason: string;
  readonly images: number;
}

export interface ScanSummary {
  readonly requestId: string;
  readonly barcode: string | null;
  readonly images: readonly { readonly role?: string }[];
  readonly steps: readonly LookupStep[];
  readonly ai: ScanAiCall;
  readonly product: Product;
  readonly score: ProductScore;
  readonly needsPhoto: boolean;
  readonly goalMatch: GoalMatch | GoalMatchV4;
  readonly rawGoalMatch: GoalMatch | GoalMatchV4;
  readonly durationMs: () => number;
}

/** Сводка успешного скана: scan_flow и enrichment_summary. */
export function logScanSummary(logger: Logger, summary: ScanSummary): void {
  const { requestId, barcode, images, steps, ai, product, score, needsPhoto } = summary;
  const hit = (provider: string) => steps.some((step) => step.provider === provider && step.status === 'hit');
  logger.log(
    `scan_flow ${JSON.stringify({
      requestId,
      barcode,
      images: images.length,
      imageRoles: images.map((image) => image.role ?? null),
      offHit: hit('open_food_facts'),
      tavilyUsed: steps.some((step) => step.provider === 'web_search' && step.status !== 'not_needed'),
      webHit: hit('web_search'),
      geminiCalled: ai.called,
      geminiReason: ai.reason,
      geminiImages: ai.images,
      score: score.value,
      scoreConfidence: score.confidence,
      missingFactors: score.missingFactors,
      needsPhoto,
      ...ingredientsFlow(product, steps),
    })}`,
  );
  const web = steps.find((step) => step.provider === 'web_search' && step.status !== 'not_needed');
  logger.log(
    `enrichment_summary ${JSON.stringify({
      requestId,
      barcode,
      offFields: steps.find((step) => step.provider === 'open_food_facts')?.report?.filled ?? [],
      missingBeforeWeb: web?.missingFields ?? [],
      webStarted: web !== undefined,
      cacheHit: web !== undefined && !web.error && !web.search,
      ...web?.search,
      missingAfterWeb: score.missingFactors,
      scoreConfidence: score.confidence,
    })}`,
  );
}

/** Последняя строка успешного скана. durationMs считается в момент записи. */
export function logScanFinished(logger: Logger, summary: ScanSummary): void {
  const { requestId, barcode, images, steps, score, goalMatch, rawGoalMatch } = summary;
  const barcodeLookup = barcode ? (steps[0]?.status ?? null) : null;
  logger.log(
    `scan finished ${JSON.stringify({
      requestId,
      status: 200,
      images: images.length,
      score: score.value,
      goalMatch: goalMatch.value,
      goalMatchRaw: rawGoalMatch.value,
      goalMatchVersion: goalMatch.version,
      hasBarcode: barcode !== null,
      barcodeLookup,
      durationMs: summary.durationMs(),
    })}`,
  );
}

/** Штрихкод, признаки полей и названия заполненных полей. Текста состава и названия продукта здесь нет. */
export function logLookupStep(logger: Logger, requestId: string, barcode: string | null, step: LookupStep): void {
  const { provider, status, latencyMs, result, report, error, missingFields } = step;
  if (error) logger.warn(`barcode lookup failed ${JSON.stringify({ requestId, provider, error })}`);
  const values = result?.nutrition?.values;
  const fields = result
    ? {
        name: result.name !== null,
        brand: result.brand !== null,
        nutrition: result.nutrition !== null,
        serving: result.servingSize !== null,
        ingredients: result.ingredients !== null,
        allergens: result.allergens !== null,
        additives: result.additives !== null,
        sugars: values?.sugarsG != null,
        saturatedFat: values?.saturatedFatG != null,
        salt: values?.saltG != null,
        sodium: values?.sodiumMg != null,
      }
    : null;
  const evidence = result?.evidence;
  const search = evidence
    ? { webSearchQueries: evidence.webSearchQueries, domains: [...new Set(Object.values(evidence.fields).map((field) => field.domain))] }
    : undefined;
  logger.log(
    `product_lookup ${JSON.stringify({
      requestId,
      barcode,
      barcodePresent: barcode !== null,
      provider,
      status,
      triggered: status !== 'not_needed',
      missingFields,
      match: result?.match ?? null,
      basis: result?.nutrition?.basis ?? null,
      ...(scanDebugEnabled() && result?.beverage ? { beverage_classification: result.beverage } : {}),
      latencyMs,
      fields,
      search,
      ...report,
    })}`,
  );
}

/** Для журнала: что стало с составом. Без самого текста. */
function ingredientsFlow(product: Product, steps: readonly LookupStep[]) {
  const decision = steps.flatMap((step) => (step.ingredients ? [step.ingredients] : [])).at(-1);
  const accepted = product.ingredients.value !== null;
  const web = product.fieldEvidence?.find((item) => item.field === 'ingredients');
  return {
    ingredients_found: accepted || decision?.found === true,
    ingredients_source: web?.domain ?? (accepted ? product.ingredients.provenance : (decision?.source ?? null)),
    ingredients_accepted: accepted,
    ingredients_rejected: !accepted && decision?.found === true,
    reject_reason: accepted ? null : (decision?.rejectReason ?? null),
  };
}
