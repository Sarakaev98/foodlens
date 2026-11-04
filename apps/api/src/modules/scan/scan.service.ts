import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { AIProviderError, type ProductImageRole } from '@foodlens/ai';
import type { GoalMatch, GoalMatchUserPlan, GoalMatchV4, Product, ProductScanResult } from '@foodlens/core';
import { goalMatchUnavailable, hasRequiredFactors, limitByProductScore, matchGoal, scoreProduct } from '@foodlens/scoring';
import type { ProductImageInput } from '@foodlens/ai';
import { SCAN_AI_PROVIDER, LABEL_SCAN_AI_PROVIDER, type ProductAnalyzer } from './scan-ai-provider.factory';
import { GoalMatchService } from '../goal-match/goal-match.service';
import { NutritionTargetsService } from '../nutrition-targets/nutrition-targets.service';
import { MultiSourceProductLookup, type EnrichedProduct } from '../product-lookup/multi-source-product-lookup';
import { PRODUCT_LOOKUP, type ProductLookupProvider } from '../product-lookup/product-lookup.provider';
import { confirmBarcodeIdentity, emptyBarcodeProduct, forScoring } from './barcode-product';
import { PRODUCT_GOAL_MATCH, PRODUCT_INGREDIENTS_DISPLAY } from '../ai/product-ai-support.factory';
import { IngredientsDisplayService } from './ingredients-display.service';
import { withProductIngredientFacts } from './product-ingredient-facts';
import { withIngredientFacts } from './ingredient-facts';
import { IMAGE_BARCODE_READER } from './image-barcode.token';
import { readImageBarcode, type ImageBarcodeReader } from './image-barcode';
import { estimateMissingNutrition, estimatedNutritionFields } from './nutrition-estimator';
import { nutritionPresence } from './nutrition-presence';
import { parseScanBarcode } from './scan-barcode';
import { ScanError, scanErrorFromAI } from './scan-error';
import { logLookupStep, logScanDebug, logScanFinished, logScanSummary, type ScanAiCall } from './scan-telemetry';
import { validateScanImages, type UploadedImage } from './scan-image.validation';

/**
 * Сценарий сканирования. Со штрихкодом: Open Food Facts → веб → Product Score → Goal Match;
 * AI-анализ фото только если этих данных не хватило для оценки. Без штрихкода: фото → AI → источники → оценки.
 * Обе оценки считаются здесь, после любого провайдера (google, meta или mock): провайдеры только распознают продукт.
 * Product Score не знает о пользователе; Goal Match считается отдельно и на Product Score не влияет.
 * Фото живёт только в памяти на время запроса: на диск и в БД ничего не пишется.
 * 1–3 фото одного продукта уходят одним запросом analyzeProduct: число AI-вызовов от количества фото не зависит.
 * Goal Match v4 (второй AI-вызов) только для eat_healthier и только при GOAL_MATCH_AI=mock|google|meta;
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
    @Inject(SCAN_AI_PROVIDER) private readonly ai: ProductAnalyzer,
    private readonly nutritionTargets: NutritionTargetsService,
    @Optional() private readonly goalMatchV4?: GoalMatchService,
    @Optional() @Inject(PRODUCT_LOOKUP) productLookup?: MultiSourceProductLookup | ProductLookupProvider,
    @Optional() @Inject(IMAGE_BARCODE_READER) barcodeReader?: ImageBarcodeReader,
    @Optional() private readonly ingredientsDisplay?: IngredientsDisplayService,
    // Nest requires this token. Default only preserves direct construction by existing unit fixtures.
    @Inject(LABEL_SCAN_AI_PROVIDER) private readonly labelAi: ProductAnalyzer = ai,
    @Inject(PRODUCT_INGREDIENTS_DISPLAY) private readonly productDisplay: IngredientsDisplayService | undefined = ingredientsDisplay,
    @Inject(PRODUCT_GOAL_MATCH) private readonly productGoalMatch: GoalMatchService | undefined = goalMatchV4,
  ) {
    this.readBarcode = barcodeReader ?? readImageBarcode;
    this.lookups = productLookup instanceof MultiSourceProductLookup ? productLookup : new MultiSourceProductLookup(productLookup ? [productLookup] : []);
  }

  async analyze(files: UploadedImage | readonly UploadedImage[] | undefined, userId: string, options: ScanOptions = {}): Promise<ScanResult> {
    const requestId = randomUUID();
    const startedAt = Date.now();
    try {
      const label = options.mode === SCAN_MODE_NUTRITION_LABEL;
      const analyzer = label ? this.labelAi : this.ai;
      const sentBarcode = label ? null : parseScanBarcode(options.barcode);
      const uploads = toFileList(files);
      const images = label
        ? validateScanImages(uploads.slice(0, 1), ['nutrition'])
        : sentBarcode && uploads.length === 0
          ? []
          : validateScanImages(uploads, options.roles);
      // Штрихкода с камеры нет: фото из галереи проверяется до всего остального. Код камеры всегда главнее.
      const decodeStartedAt = Date.now();
      const barcode = sentBarcode ?? (label ? null : await this.readBarcode(uploads));
      this.debug('barcode_source', () => ({
        requestId,
        source: sentBarcode ? 'camera' : barcode ? 'image' : 'none',
        barcode,
        decodeMs: sentBarcode ? 0 : Date.now() - decodeStartedAt,
      }));
      this.debug('api_barcode_received', () => ({
        requestId,
        received: typeof options.barcode === 'string' ? options.barcode.slice(0, 32) : null,
        receivedType: typeof options.barcode,
        barcode: sentBarcode,
      }));
      // План пользователя и поиск по штрихкоду никогда не роняют скан.
      const plan = this.loadPlan(userId, requestId);
      const flow = label ? await this.resolveLabel(images, requestId) : await this.resolveProduct(barcode, images, requestId);
      const { steps, ai } = flow;
      this.debug('ESTIMATION_INPUT', () => ({ requestId, nutrition: flow.product.nutrition }));
      const estimated = estimateMissingNutrition(forScoring(flow.product));
      // Keep display-only composition in the response, never in the scoring/estimation snapshot.
      const completed = { ...estimated, ingredients: flow.product.ingredients };
      this.debug('ESTIMATION_RESULT', () => ({ requestId, estimatedFields: estimatedNutritionFields(completed), metadata: completed.nutritionMetadata }));
      const ingredientFacts = label ? withIngredientFacts : withProductIngredientFacts;
      const product = ingredientFacts(completed);
      steps.forEach((step) => logLookupStep(this.logger, requestId, barcode, step));
      // Состав только для показа в расчёты не идёт, поэтому и выведенные из него добавки считаются без него.
      const scoring = ingredientFacts(forScoring(completed));
      this.debug('SCORING_INPUT', () => ({ requestId, nutrition: scoring.nutrition }));
      const score = scoreProduct(scoring);
      const needsPhoto = flow.needsPhoto && !hasRequiredFactors(score);
      this.debug('SCORING_RESULT', () => ({ requestId, value: score.value, confidence: score.confidence, missingFactors: score.missingFactors }));
      // Both scores consume exactly the same completed snapshot; provenance stays intact.
      this.debug('GOAL_MATCH_INPUT', () => ({ requestId, nutrition: scoring.nutrition, nutritionMetadata: scoring.nutritionMetadata }));
      const rawGoalMatch = await this.matchGoal(scoring, await plan, requestId, label ? this.goalMatchV4 : this.productGoalMatch);
      const goalMatch = limitByProductScore(rawGoalMatch, score);
      this.debug('GOAL_MATCH_RESULT', () => ({
        requestId,
        version: goalMatch.version,
        value: goalMatch.value,
        state: goalMatch.state,
        confidence: goalMatch.confidence,
        uncertainty: 'uncertainty' in goalMatch ? goalMatch.uncertainty : [],
        unavailableReason: goalMatch.unavailableReason,
      }));
      const summary = { requestId, barcode, images, steps, ai, aiProvider: analyzer.name ?? null, aiModel: analyzer.model ?? null, product, score, needsPhoto, goalMatch, rawGoalMatch, durationMs: () => Date.now() - startedAt };
      logScanSummary(this.logger, summary);
      this.logger.log(`nutrition_presence ${JSON.stringify({ requestId, ...nutritionPresence(product, score, goalMatch) })}`);
      const display = label ? this.ingredientsDisplay : this.productDisplay;
      const shownProduct = display ? await display.decorate(product) : product;
      this.logger.log(`scan_display ${JSON.stringify({ requestId,
        ingredientsStatus: shownProduct.ingredientsDisplay?.status ?? 'missing',
        ingredientsLanguage: shownProduct.ingredientsDisplay?.language ?? null,
        additivesCount: shownProduct.additives.value?.length ?? null,
        additivesDisplayCount: shownProduct.additivesDisplay?.length ?? null,
      })}`);
      logScanFinished(this.logger, summary);
      return {
        product: shownProduct,
        score,
        goalMatch,
        ...(barcode ? { barcode } : {}),
        ...(needsPhoto ? { needsPhoto, status: 'needs_nutrition_photo' as const } : {}),
      };
    } catch (error) {
      const scanError = toScanError(error).withRequestId(requestId);
      this.logger.warn(`scan failed ${JSON.stringify({ requestId, status: scanError.status, code: scanError.code, durationMs: Date.now() - startedAt })}`);
      if (scanError.code === 'SCAN_FAILED') this.logger.error(`unexpected scan error ${requestId}`, (error as Error)?.stack);
      throw scanError;
    }
  }

  /** Отдельный сценарий таблицы: только это фото, ничего не дополняется из баз. Без таблицы результата нет. */
  private async resolveLabel(images: readonly ProductImageInput[], requestId: string): Promise<ScanFlow> {
    const product = await this.labelAi.analyzeProduct({ kind: 'image', images, requestId });
    if (!product.nutrition) throw new ScanError('NUTRITION_TABLE_NOT_FOUND', 422, 'No readable nutrition table in the photo');
    return { product, steps: [], ai: { called: true, reason: 'nutrition_label', images: images.length }, needsPhoto: false };
  }

  /** Штрихкод первым: фото анализируется, только если данных из источников не хватило для Product Score. */
  private async resolveProduct(barcode: string | null, images: readonly ProductImageInput[], requestId: string): Promise<ScanFlow> {
    const lookup = this.lookups.begin(barcode, (stage, fields) => this.debug(stage, () => ({ requestId, barcode, ...fields })));
    // Одно общее фото: прежний вход провайдера, без изменений.
    const only = images.length === 1 && (!images[0]!.role || images[0]!.role === 'product') ? images[0]! : null;
    const analyzeAll = () =>
      this.ai.analyzeProduct(
        only ? { kind: 'image', image: { mimeType: only.mimeType, base64: only.base64 }, requestId } : { kind: 'image', images, requestId },
      );
    if (!barcode) {
      const enriched = await lookup.enrich(await analyzeAll());
      return { ...enriched, ai: { called: true, reason: 'no_barcode', images: images.length }, needsPhoto: false };
    }

    const found = await lookup.enrich(emptyBarcodeProduct(barcode));
    const product = confirmBarcodeIdentity(found.product, found.steps);
    const steps = found.steps;
    const scoring = forScoring(product);
    // Частичная оценка покажется в любом случае, но за недостающими значениями всё равно стоит сходить к фото.
    const scored = hasRequiredFactors(scoreProduct(scoring));
    // Со штрихкодом в AI идут только содержательные фото. product значит общий снимок: приложение отмечает так фото без таблицы и состава.
    // Фото без роли присылает старый клиент: что на нём, неизвестно, поэтому оно остаётся содержательным.
    const content = images.filter((image) => image.role !== 'product');
    if (scored && (scoring.ingredients.value !== null || content.length === 0)) {
      return { product, steps, ai: { called: false, reason: 'not_needed', images: 0 }, needsPhoto: false };
    }
    const hasData = steps.some((step) => step.status === 'hit');
    if (content.length === 0) {
      return { product, steps, ai: { called: false, reason: images.length === 0 ? 'no_photo' : 'needs_nutrition_photo', images: 0 }, needsPhoto: true };
    }
    // Значений хватает, но без состава Goal Match не определит источник сахара: здесь фото нужно не ради nutrition.
    const reason = scored ? 'no_ingredients' : hasData ? 'missing_critical' : 'not_found';
    try {
      const analyzed = await this.ai.analyzeProduct(
        content.length === 1 && !content[0]!.role ? { kind: 'image', image: content[0]!, requestId } : { kind: 'image', images: content, requestId },
      );
      const merged = await lookup.enrich(analyzed);
      return { product: merged.product, steps: [...steps, ...merged.steps], ai: { called: true, reason, images: content.length }, needsPhoto: false };
    } catch (error) {
      if (!hasData) throw error;
      // Данные по штрихкоду уже есть: сбой анализа фото не должен их терять.
      this.logger.warn(`photo fallback failed ${JSON.stringify({ requestId, error: (error as Error)?.message })}`);
      return { product, steps, ai: { called: true, reason: 'failed', images: content.length }, needsPhoto: !scored };
    }
  }

  /** Отладочная строка скана: поля собираются, только если включён SCAN_DEBUG. */
  private debug(event: string, fields: () => Record<string, unknown>): void {
    logScanDebug(this.logger, event, fields);
  }

  private async loadPlan(userId: string, requestId: string): Promise<GoalMatchUserPlan | null | 'unavailable'> {
    try {
      return await this.nutritionTargets.findPlanForUser(userId);
    } catch (error) {
      this.logger.warn(`nutrition plan unavailable ${JSON.stringify({ requestId, error: (error as Error)?.message })}`);
      return 'unavailable';
    }
  }

  private async matchGoal(product: Product, plan: GoalMatchUserPlan | null | 'unavailable', requestId: string, evaluator = this.goalMatchV4): Promise<GoalMatch | GoalMatchV4> {
    if (plan === 'unavailable') return goalMatchUnavailable('profile_unavailable');
    if (plan?.goal === 'eat_healthier' && evaluator?.enabled) {
      try {
        const evaluation = await evaluator.evaluate(product, plan, requestId);
        this.logger.log(
          `goal match v4 ${JSON.stringify({ requestId, outcome: evaluation.outcome, aiCalls: evaluation.aiCalls, cacheHit: evaluation.cacheHit })}`,
        );
        return evaluation.goalMatch;
      } catch (error) {
        this.logger.error(`goal match v4 failed, using v3 ${requestId}`, (error as Error)?.stack);
      }
    }
    return matchGoal(product, plan);
  }
}

interface ScanFlow extends EnrichedProduct {
  /** Вызывался ли analyzeProduct (AI-распознавание фото) и почему. */
  readonly ai: ScanAiCall;
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

function toFileList(files: UploadedImage | readonly UploadedImage[] | undefined): readonly UploadedImage[] {
  if (!files) return [];
  return 'buffer' in files ? [files] : files;
}

/**
 * ProductScanResult, но goalMatch может быть v4 (только при GOAL_MATCH_AI=mock|google|meta и цели eat_healthier).
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
