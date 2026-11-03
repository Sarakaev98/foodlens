import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { AIProviderError, type AIProvider, type ProductImageRole } from '@foodlens/ai';
import type { GoalMatch, GoalMatchUserPlan, GoalMatchV4, Product, ProductScanResult } from '@foodlens/core';
import { goalMatchUnavailable, hasRequiredFactors, limitByProductScore, matchGoal, scoreProduct } from '@foodlens/scoring';
import type { ProductImageInput } from '@foodlens/ai';
import { scanDebugEnabled } from '../../common/scan-debug';
import { AI_PROVIDER } from '../ai/ai.tokens';
import { GoalMatchService } from '../goal-match/goal-match.service';
import { NutritionTargetsService } from '../nutrition-targets/nutrition-targets.service';
import { MultiSourceProductLookup, type EnrichedProduct, type LookupStep } from '../product-lookup/multi-source-product-lookup';
import { PRODUCT_LOOKUP, type ProductLookupProvider } from '../product-lookup/product-lookup.provider';
import { confirmBarcodeIdentity, emptyBarcodeProduct, forScoring } from './barcode-product';
import { withIngredientFacts } from './ingredient-facts';
import { IMAGE_BARCODE_READER } from './image-barcode.token';
import { readImageBarcode, type ImageBarcodeReader } from './image-barcode';
import { estimateMissingNutrition, estimatedNutritionFields } from './nutrition-estimator';
import { nutritionPresence } from './nutrition-presence';
import { parseScanBarcode } from './scan-barcode';
import { ScanError, scanErrorFromAI } from './scan-error';
import { validateScanImages, type UploadedImage } from './scan-image.validation';

/**
 * Сценарий сканирования. Со штрихкодом: Open Food Facts → веб → Product Score → Goal Match;
 * AI-анализ фото только если этих данных не хватило для оценки. Без штрихкода: фото → AI → источники → оценки.
 * Обе оценки считаются здесь, после любого провайдера (meta или mock): провайдеры только распознают продукт.
 * Product Score не знает о пользователе; Goal Match считается отдельно и на Product Score не влияет.
 * Фото живёт только в памяти на время запроса: на диск и в БД ничего не пишется.
 * 1–3 фото одного продукта уходят одним запросом analyzeProduct: число AI-вызовов от количества фото не зависит.
 * Goal Match v4 (второй AI-вызов) только для eat_healthier и только при GOAL_MATCH_AI=mock|meta;
 * при off и для остальных целей результат прежний (matchGoal). Ошибка v4 скан не роняет.
 * Штрихкод в запрос к AI не попадает. Если фото всё же анализируется, найденные данные дополняют его заново:
 * этикетка главнее баз (MultiSourceProductLookup). Со штрихкодом фото необязательно: при нехватке данных
 * ответ содержит needsPhoto. Если штрихкода нет, продукт не найден или база недоступна, скан идёт по фото.
 * Режим nutrition_label: одно фото таблицы сразу уходит в AI, штрихкод и базы не участвуют.
 */
export const SCAN_MODE_FIELD = 'mode';
const SCAN_MODE_NUTRITION_LABEL = 'nutrition_label';

@Injectable()
export class ScanService {
  private readonly logger = new Logger(ScanService.name);
  private readonly lookups: MultiSourceProductLookup;
  private readonly readBarcode: ImageBarcodeReader;

  constructor(
    @Inject(AI_PROVIDER) private readonly ai: AIProvider,
    private readonly nutritionTargets: NutritionTargetsService,
    @Optional() private readonly goalMatchV4?: GoalMatchService,
    @Optional() @Inject(PRODUCT_LOOKUP) productLookup?: MultiSourceProductLookup | ProductLookupProvider,
    @Optional() @Inject(IMAGE_BARCODE_READER) barcodeReader?: ImageBarcodeReader,
  ) {
    this.readBarcode = barcodeReader ?? readImageBarcode;
    this.lookups = productLookup instanceof MultiSourceProductLookup ? productLookup : new MultiSourceProductLookup(productLookup ? [productLookup] : []);
  }

  async analyze(files: UploadedImage | readonly UploadedImage[] | undefined, userId: string, options: ScanOptions = {}): Promise<ScanResult> {
    const requestId = randomUUID();
    const startedAt = Date.now();
    try {
      const label = options.mode === SCAN_MODE_NUTRITION_LABEL;
      const sentBarcode = label ? null : parseScanBarcode(options.barcode);
      const uploads = toFileList(files);
      const images = label
        ? validateScanImages(uploads.slice(0, 1), ['nutrition'])
        : sentBarcode && uploads.length === 0 ? [] : validateScanImages(uploads, options.roles);
      // Штрихкода с камеры нет: фото из галереи проверяется до всего остального. Код камеры всегда главнее.
      const decodeStartedAt = Date.now();
      const barcode = sentBarcode ?? (label ? null : await this.readBarcode(uploads));
      if (scanDebugEnabled()) this.logger.log(`barcode_source ${JSON.stringify({ requestId, source: sentBarcode ? 'camera' : barcode ? 'image' : 'none', barcode, decodeMs: sentBarcode ? 0 : Date.now() - decodeStartedAt })}`);
      if (scanDebugEnabled()) this.logger.log(`api_barcode_received ${JSON.stringify({ requestId, received: typeof options.barcode === 'string' ? options.barcode.slice(0, 32) : null, receivedType: typeof options.barcode, barcode: sentBarcode })}`);
      // План пользователя и поиск по штрихкоду никогда не роняют скан.
      const plan = this.loadPlan(userId, requestId);
      const flow = label ? await this.resolveLabel(images, requestId) : await this.resolveProduct(barcode, images, requestId);
      const { steps, gemini } = flow;
      if (scanDebugEnabled()) this.logger.log(`ESTIMATION_INPUT ${JSON.stringify({ requestId, nutrition: flow.product.nutrition })}`);
      const estimated = estimateMissingNutrition(forScoring(flow.product));
      // Keep display-only composition in the response, never in the scoring/estimation snapshot.
      const completed = { ...estimated, ingredients: flow.product.ingredients };
      if (scanDebugEnabled()) this.logger.log(`ESTIMATION_RESULT ${JSON.stringify({ requestId, estimatedFields: estimatedNutritionFields(completed), metadata: completed.nutritionMetadata })}`);
      const product = withIngredientFacts(completed);
      steps.forEach((step) => this.logLookup(requestId, barcode, step));
      // Состав только для показа в расчёты не идёт, поэтому и выведенные из него добавки считаются без него.
      const scoring = withIngredientFacts(forScoring(completed));
      if (scanDebugEnabled()) this.logger.log(`SCORING_INPUT ${JSON.stringify({ requestId, nutrition: scoring.nutrition })}`);
      const score = scoreProduct(scoring);
      const needsPhoto = flow.needsPhoto && !hasRequiredFactors(score);
      if (scanDebugEnabled()) this.logger.log(`SCORING_RESULT ${JSON.stringify({ requestId, value: score.value, confidence: score.confidence, missingFactors: score.missingFactors })}`);
      // Both scores consume exactly the same completed snapshot; provenance stays intact.
      if (scanDebugEnabled()) this.logger.log(`GOAL_MATCH_INPUT ${JSON.stringify({ requestId, nutrition: scoring.nutrition, nutritionMetadata: scoring.nutritionMetadata })}`);
      const rawGoalMatch = await this.matchGoal(scoring, await plan, requestId);
      const goalMatch = limitByProductScore(rawGoalMatch, score);
      if (scanDebugEnabled()) this.logger.log(`GOAL_MATCH_RESULT ${JSON.stringify({ requestId, version: goalMatch.version, value: goalMatch.value, state: goalMatch.state, confidence: goalMatch.confidence, uncertainty: 'uncertainty' in goalMatch ? goalMatch.uncertainty : [], unavailableReason: goalMatch.unavailableReason })}`);
      const barcodeLookup = barcode ? steps[0]?.status ?? null : null;
      const hit = (provider: string) => steps.some((step) => step.provider === provider && step.status === 'hit');
      this.logger.log(`scan_flow ${JSON.stringify({ requestId, barcode, images: images.length, imageRoles: images.map((image) => image.role ?? null), offHit: hit('open_food_facts'), tavilyUsed: steps.some((step) => step.provider === 'web_search' && step.status !== 'not_needed'), webHit: hit('web_search'), geminiCalled: gemini.called, geminiReason: gemini.reason, geminiImages: gemini.images, score: score.value, scoreConfidence: score.confidence, missingFactors: score.missingFactors, needsPhoto, ...ingredientsFlow(product, steps) })}`);
      const web = steps.find((step) => step.provider === 'web_search' && step.status !== 'not_needed');
      this.logger.log(`enrichment_summary ${JSON.stringify({ requestId, barcode, offFields: steps.find((step) => step.provider === 'open_food_facts')?.report?.filled ?? [], missingBeforeWeb: web?.missingFields ?? [], webStarted: web !== undefined, cacheHit: web !== undefined && !web.error && !web.search, ...web?.search, missingAfterWeb: score.missingFactors, scoreConfidence: score.confidence })}`);
      this.logger.log(`nutrition_presence ${JSON.stringify({ requestId, ...nutritionPresence(product, score, goalMatch) })}`);
      this.logger.log(
        `scan finished ${JSON.stringify({ requestId, status: 200, images: images.length, score: score.value, goalMatch: goalMatch.value, goalMatchRaw: rawGoalMatch.value, goalMatchVersion: goalMatch.version, hasBarcode: barcode !== null, barcodeLookup, durationMs: Date.now() - startedAt })}`,
      );
      return { product, score, goalMatch, ...(barcode ? { barcode } : {}), ...(needsPhoto ? { needsPhoto, status: 'needs_nutrition_photo' as const } : {}) };
    } catch (error) {
      const scanError = toScanError(error).withRequestId(requestId);
      this.logger.warn(
        `scan failed ${JSON.stringify({ requestId, status: scanError.status, code: scanError.code, durationMs: Date.now() - startedAt })}`,
      );
      if (scanError.code === 'SCAN_FAILED') this.logger.error(`unexpected scan error ${requestId}`, (error as Error)?.stack);
      throw scanError;
    }
  }

  /** Отдельный сценарий таблицы: только это фото, ничего не дополняется из баз. Без таблицы результата нет. */
  private async resolveLabel(images: readonly ProductImageInput[], requestId: string): Promise<ScanFlow> {
    const product = await this.ai.analyzeProduct({ kind: 'image', images, requestId });
    if (!product.nutrition) throw new ScanError('NUTRITION_TABLE_NOT_FOUND', 422, 'No readable nutrition table in the photo');
    return { product, steps: [], gemini: { called: true, reason: 'nutrition_label', images: images.length }, needsPhoto: false };
  }

  /** Штрихкод первым: фото анализируется, только если данных из источников не хватило для Product Score. */
  private async resolveProduct(barcode: string | null, images: readonly ProductImageInput[], requestId: string): Promise<ScanFlow> {
    const lookup = this.lookups.begin(barcode, (stage, fields) => {
      if (scanDebugEnabled()) this.logger.log(`${stage} ${JSON.stringify({ requestId, barcode, ...fields })}`);
    });
    // Одно общее фото: прежний вход провайдера, без изменений.
    const only = images.length === 1 && (!images[0]!.role || images[0]!.role === 'product') ? images[0]! : null;
    const analyzeAll = () => this.ai.analyzeProduct(only ? { kind: 'image', image: { mimeType: only.mimeType, base64: only.base64 }, requestId } : { kind: 'image', images, requestId });
    if (!barcode) return { ...(await lookup.enrich(await analyzeAll())), gemini: { called: true, reason: 'no_barcode', images: images.length }, needsPhoto: false };

    const found = await lookup.enrich(emptyBarcodeProduct(barcode));
    const product = confirmBarcodeIdentity(found.product, found.steps);
    const steps = found.steps;
    const scoring = forScoring(product);
    // Частичная оценка покажется в любом случае, но за недостающими значениями всё равно стоит сходить к фото.
    const scored = hasRequiredFactors(scoreProduct(scoring));
    // Со штрихкодом в AI идут только содержательные фото. product значит общий снимок: приложение отмечает так фото без таблицы и состава.
    // Фото без роли присылает старый клиент: что на нём, неизвестно, поэтому оно остаётся содержательным.
    const content = images.filter((image) => image.role !== 'product');
    if (scored && (scoring.ingredients.value !== null || content.length === 0)) return { product, steps, gemini: { called: false, reason: 'not_needed', images: 0 }, needsPhoto: false };
    const hasData = steps.some((step) => step.status === 'hit');
    if (content.length === 0) return { product, steps, gemini: { called: false, reason: images.length === 0 ? 'no_photo' : 'needs_nutrition_photo', images: 0 }, needsPhoto: true };
    // Значений хватает, но без состава Goal Match не определит источник сахара: здесь фото нужно не ради nutrition.
    const reason = scored ? 'no_ingredients' : hasData ? 'missing_critical' : 'not_found';
    try {
      const analyzed = await this.ai.analyzeProduct(content.length === 1 && !content[0]!.role ? { kind: 'image', image: content[0]!, requestId } : { kind: 'image', images: content, requestId });
      const merged = await lookup.enrich(analyzed);
      return { product: merged.product, steps: [...steps, ...merged.steps], gemini: { called: true, reason, images: content.length }, needsPhoto: false };
    } catch (error) {
      if (!hasData) throw error;
      // Данные по штрихкоду уже есть: сбой анализа фото не должен их терять.
      this.logger.warn(`photo fallback failed ${JSON.stringify({ requestId, error: (error as Error)?.message })}`);
      return { product, steps, gemini: { called: true, reason: 'failed', images: content.length }, needsPhoto: !scored };
    }
  }

  /** Штрихкод, признаки полей и названия заполненных полей. Текста состава и названия продукта здесь нет. */
  private logLookup(requestId: string, barcode: string | null, step: LookupStep): void {
    const { provider, status, latencyMs, result, report, error, missingFields } = step;
    if (error) this.logger.warn(`barcode lookup failed ${JSON.stringify({ requestId, provider, error })}`);
    const values = result?.nutrition?.values;
    const fields = result ? {
      name: result.name !== null, brand: result.brand !== null, nutrition: result.nutrition !== null, serving: result.servingSize !== null,
      ingredients: result.ingredients !== null, allergens: result.allergens !== null, additives: result.additives !== null,
      sugars: values?.sugarsG != null, saturatedFat: values?.saturatedFatG != null, salt: values?.saltG != null, sodium: values?.sodiumMg != null,
    } : null;
    const evidence = result?.evidence;
    const search = evidence ? { webSearchQueries: evidence.webSearchQueries, domains: [...new Set(Object.values(evidence.fields).map((field) => field.domain))] } : undefined;
    this.logger.log(`product_lookup ${JSON.stringify({ requestId, barcode, barcodePresent: barcode !== null, provider, status, triggered: status !== 'not_needed', missingFields, match: result?.match ?? null, basis: result?.nutrition?.basis ?? null, ...(scanDebugEnabled() && result?.beverage ? { beverage_classification: result.beverage } : {}), latencyMs, fields, search, ...report })}`);
  }

  private async loadPlan(userId: string, requestId: string): Promise<GoalMatchUserPlan | null | 'unavailable'> {
    try {
      return await this.nutritionTargets.findPlanForUser(userId);
    } catch (error) {
      this.logger.warn(`nutrition plan unavailable ${JSON.stringify({ requestId, error: (error as Error)?.message })}`);
      return 'unavailable';
    }
  }

  private async matchGoal(product: Product, plan: GoalMatchUserPlan | null | 'unavailable', requestId: string): Promise<GoalMatch | GoalMatchV4> {
    if (plan === 'unavailable') return goalMatchUnavailable('profile_unavailable');
    if (plan?.goal === 'eat_healthier' && this.goalMatchV4?.enabled) {
      try {
        const evaluation = await this.goalMatchV4.evaluate(product, plan, requestId);
        this.logger.log(`goal match v4 ${JSON.stringify({ requestId, outcome: evaluation.outcome, aiCalls: evaluation.aiCalls, cacheHit: evaluation.cacheHit })}`);
        return evaluation.goalMatch;
      } catch (error) {
        this.logger.error(`goal match v4 failed, using v3 ${requestId}`, (error as Error)?.stack);
      }
    }
    return matchGoal(product, plan);
  }
}

interface ScanFlow extends EnrichedProduct {
  /** Вызывался ли analyzeProduct и почему. */
  readonly gemini: { readonly called: boolean; readonly reason: string; readonly images: number };
  readonly needsPhoto: boolean;
}

export interface ScanOptions {
  /** Сырое значение поля "barcode"; некорректное игнорируется. */
  readonly barcode?: unknown;
  /** Подсказки к фото в том же порядке; undefined значит «без роли». */
  readonly roles?: readonly (ProductImageRole | undefined)[];
  /** Сырое значение поля "mode". Всё, кроме nutrition_label, означает обычный скан. */
  readonly mode?: unknown;
}

/** Для журнала: что стало с составом. Без самого текста. */
function ingredientsFlow(product: Product, steps: readonly LookupStep[]) {
  const decision = steps.flatMap((step) => (step.ingredients ? [step.ingredients] : [])).at(-1);
  const accepted = product.ingredients.value !== null;
  const web = product.fieldEvidence?.find((item) => item.field === 'ingredients');
  return {
    ingredients_found: accepted || decision?.found === true,
    ingredients_source: web?.domain ?? (accepted ? product.ingredients.provenance : decision?.source ?? null),
    ingredients_accepted: accepted,
    ingredients_rejected: !accepted && decision?.found === true,
    reject_reason: accepted ? null : decision?.rejectReason ?? null,
  };
}

function toFileList(files: UploadedImage | readonly UploadedImage[] | undefined): readonly UploadedImage[] {
  if (!files) return [];
  return 'buffer' in files ? [files] : files;
}

/**
 * ProductScanResult, но goalMatch может быть v4 (только при GOAL_MATCH_AI=mock|meta и цели eat_healthier).
 * barcode есть только если клиент прислал корректный штрихкод.
 */
export type ScanResult = Omit<ProductScanResult, 'goalMatch'> & {
  readonly goalMatch: GoalMatch | GoalMatchV4;
  readonly barcode?: string;
  /** По штрихкоду данных мало: фото таблицы поможет. Только для запроса без фото. */
  readonly needsPhoto?: boolean;
  /** Данных нет ни в базе, ни в вебе: нужна таблица питания с упаковки. */
  readonly status?: 'needs_nutrition_photo';
};

export function toScanError(error: unknown): ScanError {
  if (error instanceof ScanError) return error;
  if (error instanceof AIProviderError) return scanErrorFromAI(error.code);
  return new ScanError('SCAN_FAILED', 500, 'Product analysis failed');
}
