import type { AILogger, ExtractedPage, ExtractionPage, SourceDiscoveryInput, SourceDiscoveryResponse } from '@foodlens/ai';
import type { NutrientKey } from '@foodlens/core';
import { scanDebugEnabled } from '../../common/scan-debug';
import { splitIngredients } from './open-food-facts.mapper';
import type { IngredientsDecision, ProductLookupContext, ProductLookupProvider, ProductLookupResult, WebFieldSource } from './product-lookup.provider';
import { PageFetchError } from './web/page-fetcher';
import { EMPTY_NUTRITION, hasIngredientsMark, ingredientsFragment, mentionsIngredients, parsePage, printedIngredients, printedOnPage, type ExtractionMethod, type PageNutrition, type ParsedPage } from './web/page-nutrition';
import { aliasState, barcodeInResult, enrichedName, identityContext, namesNearBarcode, type AliasStanding, type NameEnrichment } from './web/identity-enrichment';
import { caloriesFit, compareMacros, hasReferenceMacros, identityFacts, ingredientsRejectReason, knownBrand, nameSpan, normalizeProductName, titleNamesVariant, titleRelevant, valuesAgree, variantTokens, verifyPage, FIELD_TOLERANCE, MIN_COMPARED_MACROS, type PageVerdict, type WebVerdictStatus } from './web/product-identity';
import { searchName } from './web/search-identity';
import { SEARCH_ORDER, searchStrategy, type SearchStep } from './web/search-strategy';
import { isBrandLikeDomain, isListPage, isManufacturerDomain, registrableDomain, sourceTier, type SourceTier } from './web/source-tier';
import { outranks, pageTrust, recipeFingerprint } from './web/source-trust';

export const WEB_SEARCH_PROVIDER = 'web_search';
/** Страховка от цикла или ошибки: каждый запрос стоит заметно дороже обычного скана. */
export const WEB_SEARCH_MAX_PER_HOUR = 60;
/** Сколько страниц полезно прочитать за скан. Выбирает код, а не модель. Недоступная страница лимит не тратит. */
export const MAX_PAGES_PER_SCAN = 10;
/** Предел всех попыток чтения за скан, включая неудачные: цикла по недоступным сайтам быть не может. */
export const MAX_PAGE_ATTEMPTS = 14;
/** Запасных чтений через Tavily на продукт. */
export const MAX_EXTRACTS_PER_PRODUCT = 2;
/** Разборов текста страницы через Gemini на продукт. Он только разбирает найденную страницу: источником фактов не является. */
export const MAX_AI_EXTRACTIONS_PER_PRODUCT = 2;
/** Поисковых запросов на продукт, пока жива память поиска. Вместе с чтениями Tavily это не больше 10 кредитов. */
export const MAX_SEARCHES_PER_PRODUCT = 8;
/** За один шаг читается меньше лимита, чтобы следующему запросу осталось что читать. */
const PAGES_PER_STEP = 3;
/** Сколько помнить найденные страницы: повторный скан и второй проход не тратят кредиты. */
export const SEARCH_MEMORY_TTL_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MAX_LOGGED_TEXT = 160;

const FIELDS: readonly (readonly [keyof typeof FIELD_TOLERANCE, NutrientKey])[] = [
  ['kcal', 'caloriesKcal'], ['protein', 'proteinG'], ['carbs', 'carbsG'], ['fat', 'fatG'],
  ['sugars', 'sugarsG'], ['saturatedFat', 'saturatedFatG'], ['salt', 'saltG'], ['sodiumMg', 'sodiumMg'], ['fiber', 'fiberG'],
];
const MACRO_FIELDS = ['kcal', 'protein', 'carbs', 'fat'] as const;
/** Масса NaCl к массе натрия. */
const SALT_PER_SODIUM = 2.5;
/** Сколько общих макросов нужно, чтобы сравнить две страницы между собой. */
const MIN_SHARED_MACROS = 2;

/**
 * Страниц о продукте тут не бывает: их не стоит читать даже при совпадении названия.
 * Open Food Facts уже спрошен по штрихкоду первым источником: его страница повторяет ту же запись и только тратит лимит чтений и AI-извлечение.
 */
const NOT_PRODUCT_SITES: readonly string[] = ['openfoodfacts.org', 'wikipedia.org', 'youtube.com', 'instagram.com', 'facebook.com', 'tiktok.com', 'vk.com', 'reddit.com', 'pinterest.com', 'kiddle.co', 'tavily.com'];

export interface WebSearchLimits {
  readonly maxQueries: number;
  readonly maxPages: number;
}

export class WebSearchLimitError extends Error {
  constructor() {
    super('Web search: hourly limit reached');
    this.name = 'WebSearchLimitError';
  }
}

/** Поиск страниц и AI-извлечение. Сменные: сюда можно подключить другой поисковый источник. */
export interface NutritionSearcher {
  discoverSources(input: SourceDiscoveryInput): Promise<SourceDiscoveryResponse>;
  extractNutrition(pages: readonly ExtractionPage[]): Promise<readonly ExtractedPage[]>;
  /** false: поиск сейчас недоступен (например, кончились кредиты), шаг пропускается молча. */
  isAvailable?(): boolean;
  /** Поиск готовым текстом запроса. Если он есть, работает пошаговая стратегия, иначе один запрос discoverSources. */
  searchQuery?(query: string): Promise<SourceDiscoveryResponse>;
  /** Состав из текста проверенной страницы. Вызывается не больше одного раза за скан, только когда код его не нашёл. */
  extractIngredients?(text: string): Promise<string | null>;
  /** Запасное чтение страниц, которые не открылись напрямую. Вызывается не больше одного раза за скан. */
  readPages?(urls: readonly string[]): Promise<readonly { readonly url: string; readonly content: string }[]>;
  /** Всего потрачено кредитов. Считает сам поиск, поэтому неудачное чтение без списания сюда не попадает. */
  creditsSpent?(): number;
}

export interface PageReader {
  fetchPage(url: string): Promise<{ readonly finalUrl: string; readonly domain: string; readonly contentType: string; readonly body: string }>;
}

interface LoadedPage {
  /** Адрес из результатов поиска. */
  readonly sourceUrl: string;
  readonly url: string;
  readonly domain: string;
  readonly tier: SourceTier;
  readonly page: ParsedPage;
  readonly nutrition: PageNutrition;
  readonly basis: ParsedPage['basis'];
  readonly method: ExtractionMethod | null;
  readonly reader: 'direct' | 'search_extract';
}

interface CheckedPage extends LoadedPage {
  readonly verdict: PageVerdict;
}

/** Что уже известно о продукте: запросы, страницы, ошибки чтения. Значения проверяются заново по текущим макросам. */
interface SearchMemory {
  readonly queries: Set<string>;
  readonly visited: Set<string>;
  readonly sources: Map<string, SourceDiscoveryResponse['sources'][number]>;
  readonly failed: Map<string, string>;
  pages: readonly LoadedPage[];
  /** Сколько чтений Tavily уже потрачено. */
  extracts: number;
  /** Сколько разборов через AI уже было, включая неудачные. */
  aiExtractions: number;
  /** Страница вне списка, прочитанная ради названия или состава: одна на продукт. В pages не попадает, значений не даёт. */
  identityUrl: string | null;
  outsidePage: LoadedPage | null;
  /** Название, уточнённое по точному штрихкоду. Только для поиска и сверки: в продукт не попадает. */
  enrichment: NameEnrichment | null;
  /** Результаты запросов со штрихкодом: только они могут подтвердить уточнённое название. */
  readonly witnesses: Set<string>;
  readonly expiresAt: number;
}

interface SearchCounters {
  searches: number;
  reads: number;
  extracts: number;
  aiExtractions: number;
  identityReads: number;
  credits?: number;
  webSearchQueries: number;
  readonly steps: string[];
}

interface ReadResult {
  readonly pages: readonly LoadedPage[];
  /** Найденные страницы, которые не удалось прочитать напрямую. */
  readonly unread: SourceDiscoveryResponse['sources'];
  readonly failed: ReadonlyMap<string, string>;
}

export type WebCandidateDecision = 'accepted' | 'variant_mismatch' | 'macro_mismatch' | 'insufficient_macros' | 'inaccessible' | 'other';

function candidateDecision({ status, reason }: PageVerdict, used: boolean): WebCandidateDecision {
  if (status === 'accepted') return used ? 'accepted' : 'other';
  if (reason === 'variant_mismatch') return 'variant_mismatch';
  if (reason === 'macros_differ' || reason === 'barcode_matches_macros_differ') return 'macro_mismatch';
  return reason === 'too_few_macros_to_compare' ? 'insufficient_macros' : 'other';
}

/** В лог идёт адрес без параметров: в них могут быть токены. */
function loggedUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`.slice(0, MAX_LOGGED_TEXT);
  } catch {
    return '';
  }
}

function knownMacros(context: ProductLookupContext): number {
  return [context.kcal, context.protein, context.carbs, context.fat].filter((value) => value !== null).length;
}

/** Страницы сверяются на 100 г/мл, поэтому значения на порцию пересчитываются. Без размера порции сверить нельзя. */
function per100Context(context: ProductLookupContext): ProductLookupContext | null {
  if (context.basis === 'per_100g' || context.basis === 'per_100ml') return context;
  const serving = context.basis === 'per_serving' ? context.serving?.match(/^(\d+(?:\.\d+)?) (g|ml)$/) : null;
  const amount = Number(serving?.[1]);
  if (!serving || !(amount > 0)) return null;
  const scale = (value: number | null) => (value === null ? null : Math.round((value * 1000) / amount) / 10);
  return { ...context, basis: serving[2] === 'ml' ? 'per_100ml' : 'per_100g', kcal: scale(context.kcal), protein: scale(context.protein), carbs: scale(context.carbs), fat: scale(context.fat) };
}

/** Без сверки с этикеткой или базой: значения считаются только вместе с макросами страницы. */
function withoutReference(context: ProductLookupContext): ProductLookupContext {
  return { ...context, basis: 'unknown', kcal: null, protein: null, carbs: null, fat: null };
}

const isNotProductSite = (domain: string): boolean => /forum|форум/.test(domain) || NOT_PRODUCT_SITES.some((site) => domain === site || domain.endsWith(`.${site}`));

/**
 * Порядок чтения: точный штрихкод в выдаче, производитель, крупный магазин, база продуктов, прочие страницы. Внутри уровня: метка «Состав:» в отрывке, пока нет состава, и название в заголовке. Текст модели здесь не участвует.
 * Отрывок из поиска только помогает выбрать страницу: значения из него не берутся.
 * Лимит чтений не тратится на то, что не пройдёт проверку: страницы не про этот товар и списки.
 */
const readingRank = ({ tier, barcodeHit }: { readonly tier: SourceTier; readonly barcodeHit: boolean }): number => (barcodeHit ? 0 : tier);

/** Заголовок обещает этот товар. Сайтам из списков достаточно бренда, прочим нужно само название. */
function worthReading(source: SourceDiscoveryResponse['sources'][number], tier: SourceTier, context: ProductLookupContext): boolean {
  return (tier < 4 && titleRelevant(source.title, context)) || titleNamesVariant(source.title, source.snippet ?? '', context, tier === 1 || isBrandLikeDomain(source.domain, context.brand));
}

function rankSources(sources: SourceDiscoveryResponse['sources'], context: ProductLookupContext, barcode: string | null, onlyRelevant: boolean, wantsIngredients: boolean) {
  const words = normalizeProductName(`${context.brand ?? ''} ${context.name ?? ''}`).split(' ').filter(Boolean);
  const seen = new Set<string>();
  return sources
    .filter(({ domain }) => !isNotProductSite(domain))
    .map((source) => {
      const title = normalizeProductName(source.title);
      return { source, marked: wantsIngredients && hasIngredientsMark(source.snippet ?? ''), barcodeHit: barcodeInResult(source, barcode), tier: sourceTier(source.domain, context.brand), hits: words.filter((word) => title.includes(word)).length };
    })
    .filter((item) => {
      if (!onlyRelevant) return true;
      if (isListPage(item.source.url, item.source.title)) return false;
      return item.barcodeHit || worthReading(item.source, item.tier, context);
    })
    .sort((a, b) => readingRank(a) - readingRank(b) || Number(b.marked) - Number(a.marked) || a.tier - b.tier || Number(b.hits > 0) - Number(a.hits > 0) || b.hits - a.hits)
    .filter(({ source }) => (seen.has(source.url) ? false : (seen.add(source.url), true)));
}

/** Поле уже найдено. Соль и натрий заменяют друг друга. */
function isFilled(field: string, values: Partial<Record<NutrientKey, number>>): boolean {
  if (field === 'salt' || field === 'sodiumMg') return values.saltG !== undefined || values.sodiumMg !== undefined;
  const key = FIELDS.find(([name]) => name === field)?.[1];
  return key !== undefined && values[key] !== undefined;
}

/** Даёт ли страница хоть одно недостающее значение. Страница, повторяющая известные макросы, поиск не заменяет. */
function addsMissingValue(page: LoadedPage, context: ProductLookupContext): boolean {
  return FIELDS.some(([field]) => context.missingFields.includes(field) && page.nutrition[field] !== null);
}

/** Найдены ли все запрошенные нутриенты; соль и натрий взаимозаменяемы. */
function hasRequestedValues(values: Partial<Record<NutrientKey, number>>, context: ProductLookupContext): boolean {
  return context.missingFields.every((field) => isFilled(field, values));
}

const NO_INGREDIENTS = { page: null, ingredientsOnly: false, decision: { found: false, accepted: false, source: null, rejectReason: null } } as const;

/**
 * Состав доверяется отдельно от значений: домен и судьба питания со страницы на него не влияют.
 * Если значения той же страницы не приняты, состав только для показа: в Product Score и Goal Match он не идёт.
 */
function chooseIngredients(checked: readonly CheckedPage[], outside: LoadedPage | null, context: ProductLookupContext, barcode: string | null, nameTrusted: boolean): { readonly page: LoadedPage | null; readonly ingredientsOnly: boolean; readonly decision: IngredientsDecision } {
  const pages: readonly (LoadedPage & { readonly verdict?: PageVerdict })[] = [...checked, ...(outside ? [outside] : [])].filter((page) => page.page.ingredients);
  const onPage = (item: LoadedPage) => identityFacts({ ...item.page, basis: item.basis, nutrition: item.nutrition }, context, barcode).barcodeMatch;
  // Страница рецептуры, исправившей базу, спорит с макросами базы по определению: сверять с ними нечего.
  const compared = (page: { readonly verdict?: PageVerdict }) => (page.verdict?.reason === CORRECTED_RECIPE ? { ...context, kcal: null, protein: null, carbs: null, fat: null } : context);
  const reasons = pages.map((page) => (page.verdict?.reason === OTHER_CLUSTER ? 'possible_recipe_mismatch' : ingredientsRejectReason({ ...page.page, basis: page.basis, nutrition: page.nutrition }, compared(page), barcode, page.url) ?? (nameTrusted || onPage(page) ? null : 'unconfirmed_alias')));
  const usable = pages.filter((_, index) => reasons[index] === null);
  // Самый полный состав среди страниц с тем же уровнем подтверждения: обрезанный блок не вытесняет целый.
  const fullest = (a: LoadedPage, b: LoadedPage) => b.page.ingredients!.length - a.page.ingredients!.length;
  const page = [...usable.filter(onPage)].sort(fullest)[0] ?? [...usable].sort(fullest)[0];
  // Точный штрихкод на странице подтверждает товар сам: такой состав идёт в расчёты, даже если значения страницы отклонены.
  if (page) return { page, ingredientsOnly: (page.verdict?.status !== 'accepted' || page.verdict.needsSecondSource) && !onPage(page), decision: { found: true, accepted: true, source: page.domain, rejectReason: null } };
  const issue = [...checked, ...(outside ? [outside] : [])].find((item) => item.page.ingredientsIssue);
  return { page: null, ingredientsOnly: false, decision: { found: pages.length > 0, accepted: false, source: pages[0]?.domain ?? issue?.domain ?? null, rejectReason: reasons[0] ?? issue?.page.ingredientsIssue ?? null } };
}

/** Уверенность не выше medium: состав со страницы не сверяется с этикеткой. */
const ingredientsSource = (page: LoadedPage, ingredientsOnly: boolean, retrievedAt: string, barcodeOnPage: boolean): WebFieldSource => ({
  url: page.url, domain: page.domain, tier: page.tier, confidence: 'medium', identityMatch: barcodeOnPage ? 'exact_barcode' : 'exact_name', retrievedAt, method: page.method ?? 'html', ...(ingredientsOnly ? { ingredientsOnly } : {}),
});

function skipReason(source: SourceDiscoveryResponse['sources'][number], tier: SourceTier, inResults: boolean, context: ProductLookupContext): string {
  if (isNotProductSite(source.domain)) return 'not_product_site';
  if (isListPage(source.url, source.title)) return 'list_page';
  return inResults || worthReading(source, tier, context) ? 'not_selected' : 'not_relevant';
}

const OTHER_CLUSTER = 'other_recipe_cluster';
const CORRECTED_RECIPE = 'corrected_recipe';
const OTHER_RECIPE: PageVerdict = { status: 'different_product_or_recipe', identityMatch: null, reason: OTHER_CLUSTER, needsSecondSource: false, conflicts: [] };

const trustOf = (page: CheckedPage) => pageTrust(page.tier, page.verdict.identityMatch, page.verdict.needsSecondSource);

/** Опровергнуть базу может производитель с подтверждением другого сайта или минимум два сильных независимых сайта. Один слабый сайт не может. */
function canCorrectBase(pages: readonly CheckedPage[]): boolean {
  const stronger = pages.filter((page) => outranks(trustOf(page), 'open_food_facts'));
  return independentSites(pages) >= 2 && (stronger.some((page) => trustOf(page) === 'official_manufacturer') || independentSites(stronger) >= 2);
}

/** Страницы, которые спорят с макросами базы, но сами подтверждают этот товар: возможная настоящая рецептура. Одна страница макросов не проверяет другую. */
function recipeRival(pages: readonly CheckedPage[], context: ProductLookupContext, barcode: string | null): readonly CheckedPage[] | null {
  const rivals = pages.flatMap((page): CheckedPage[] => {
    if (page.verdict.status === 'accepted' || !page.verdict.conflicts.length || !page.basis) return [];
    const facts = identityFacts({ ...page.page, basis: page.basis, nutrition: page.nutrition }, context, barcode);
    const official = page.tier === 1 && facts.brandMatch && facts.variantMatch;
    if (facts.otherVariant || (!facts.barcodeMatch && !official)) return [];
    const needsSecondSource = page.tier === 4 && !(page.method === 'json_ld' || page.method === 'embedded_json');
    return [{ ...page, verdict: { status: 'accepted', identityMatch: official ? 'official_variant' : 'exact_barcode', reason: CORRECTED_RECIPE, needsSecondSource, conflicts: [] } }];
  });
  const groups: CheckedPage[][] = [];
  for (const page of rivals) {
    const group = groups.find(([first]) => sameRecipe(first!, page));
    if (group) group.push(page);
    else groups.push([page]);
  }
  // База сама считается одним голосом вместе с подтвердившими её сайтами.
  const supporters = independentSites(pages.filter((page) => page.verdict.status === 'accepted')) + 1;
  return groups.find((group) => canCorrectBase(group) && independentSites(group) >= supporters) ?? null;
}

/** Две страницы описывают одну рецептуру: их макросы, которые есть на обеих, совпадают. */
function sameRecipe(a: CheckedPage, b: CheckedPage): boolean {
  const shared = MACRO_FIELDS.filter((field) => a.nutrition[field] !== null && b.nutrition[field] !== null);
  return shared.length >= MIN_SHARED_MACROS && shared.every((field) => valuesAgree(field, a.nutrition[field]!, b.nutrition[field]!));
}

const independentSites = (pages: readonly LoadedPage[]): number => new Set(pages.map((page) => registrableDomain(page.domain))).size;

/**
 * Рецептура, из которой можно брать значения. Этикетка задаёт её окончательно. Макросы базы тоже, пока более сильные источники не докажут другую рецептуру:
 * тогда её страницы принимаются, а страницы, согласные с базой, становятся другой группой.
 * Макросов нет: страницы группируются между собой, выигрывает группа с большим числом независимых сайтов, затем с лучшим источником. Ничья: выбирать не из чего.
 */
function selectRecipeCluster(pages: readonly CheckedPage[], reference: boolean, context: ProductLookupContext, barcode: string | null): readonly CheckedPage[] {
  if (reference) {
    if (!MACRO_FIELDS.some((field) => context.correctable?.[field] !== undefined)) return pages;
    const rival = recipeRival(pages, context, barcode);
    if (!rival) return pages;
    return pages.map((page) => rival.find((item) => item.url === page.url) ?? (page.verdict.status === 'accepted' ? { ...page, verdict: OTHER_RECIPE } : page));
  }
  const accepted = pages.filter((page) => page.verdict.status === 'accepted');
  const clusters: CheckedPage[][] = [];
  for (const page of accepted) {
    const cluster = clusters.find(([first]) => sameRecipe(first!, page));
    if (cluster) cluster.push(page);
    else clusters.push([page]);
  }
  const bestTier = (cluster: readonly CheckedPage[]) => Math.min(...cluster.map((page) => page.tier));
  const [top, next] = [...clusters].sort((a, b) => independentSites(b) - independentSites(a) || bestTier(a) - bestTier(b));
  const tied = next !== undefined && independentSites(top!) === independentSites(next) && bestTier(top!) === bestTier(next);
  const chosen = new Set<CheckedPage>(tied ? [] : top);
  return pages.map((page) => (page.verdict.status !== 'accepted' || chosen.has(page) ? page : { ...page, verdict: OTHER_RECIPE }));
}

/** Значение поля на странице. Соль и натрий приводятся друг к другу, чтобы их можно было сравнивать. */
function fieldValue(nutrition: PageNutrition, field: (typeof FIELDS)[number][0]): number | null {
  if (field === 'salt') return nutrition.salt ?? (nutrition.sodiumMg === null ? null : Math.round((nutrition.sodiumMg * SALT_PER_SODIUM) / 10) / 100);
  if (field === 'sodiumMg') return nutrition.sodiumMg ?? (nutrition.salt === null ? null : Math.round((nutrition.salt * 1000) / SALT_PER_SODIUM));
  return nutrition[field];
}

/**
 * Каждое поле решается отдельно, в пределах одной рецептуры и основы. Близкие значения образуют группу: не усредняются, берётся среднее по порядку.
 * Группа принимается, если её подтвердил один сильный источник или 2 и больше независимых сайта (medium). Сильный источник вместе со вторым сайтом: high.
 * Одна несильная страница без независимого подтверждения не заполняет пропуски.
 * Две равные группы или единственный слабый источник: поле остаётся неизвестным.
 */
function chooseValues(pages: readonly CheckedPage[], retrievedAt: string, requested: readonly string[], reference: boolean, known: ProductLookupContext) {
  const accepted = pages.filter((page) => page.verdict.status === 'accepted');
  const recipeCorrected = accepted.some((page) => page.verdict.reason === CORRECTED_RECIPE);
  const corrections: NutrientKey[] = [];
  const values: Partial<Record<NutrientKey, number>> = {};
  const sources: Partial<Record<NutrientKey, WebFieldSource>> = {};
  const unresolved: string[] = [];

  for (const [field, key] of FIELDS) {
    const existing = known.correctable?.[field];
    const suspicious = known.suspiciousFields?.includes(field) === true;
    if (!requested.includes(field) && existing === undefined && !recipeCorrected) continue;
    // Натрий выводится из принятой соли при слиянии: второй раз его не решаем.
    if (field === 'sodiumMg' && values.saltG !== undefined) continue;
    const found = accepted.flatMap((page) => {
      const value = page.verdict.conflicts.some((conflict) => conflict.field === field) ? null : fieldValue(page.nutrition, field);
      return value === null ? [] : [{ page, value }];
    }).sort((a, b) => a.value - b.value);
    if (found.length === 0) continue;
    const groups: (typeof found)[] = [];
    for (const item of found) {
      const group = groups.at(-1);
      if (group && valuesAgree(field, group[0]!.value, item.value)) group.push(item);
      else groups.push([item]);
    }
    const support = (group: typeof found) => independentSites(group.map((item) => item.page));
    const hasStrong = (group: typeof found) => group.some((item) => !item.page.verdict.needsSecondSource);
    const [top, next] = [...groups].sort((a, b) => support(b) - support(a) || Number(hasStrong(b)) - Number(hasStrong(a)));
    if (next && support(next) === support(top!) && hasStrong(next) === hasStrong(top!)) {
      // Равная поддержка разных значений не даёт достоверного числа.
      if (existing === undefined) unresolved.push(field);
      continue;
    }
    const sites = support(top!);
    if (sites < 2 && !hasStrong(top!)) {
      if (existing === undefined) unresolved.push(field);
      continue;
    }
    const middle = top![Math.floor((top!.length - 1) / 2)]!;
    if (existing !== undefined) {
      // Значение базы остаётся, пока его не опровергли более сильные источники. Подозрительному хватает обычного подтверждения.
      const agrees = valuesAgree(field, existing, middle.value);
      if (agrees && !recipeCorrected) continue;
      // Запись базы ниже подтверждения независимых сайтов.
      if (!agrees && !recipeCorrected && !suspicious && sites < 2) continue;
      if (!agrees) corrections.push(key);
    }
    const chosen = top!.find((item) => !item.page.verdict.needsSecondSource) ?? middle;
    values[key] = middle.value;
    sources[key] = { url: chosen.page.url, domain: chosen.page.domain, tier: chosen.page.tier, confidence: sites >= 2 && hasStrong(top!) ? 'high' : 'medium',
      identityMatch: chosen.page.verdict.identityMatch!, retrievedAt, method: chosen.page.method ?? 'html', basis: chosen.page.basis ?? undefined, consensusCount: sites, sources: top!.map((item) => item.page.url), trust: trustOf(chosen.page), dataQuality: hasStrong(top!) && chosen.page.tier < 4 ? 'verified' : 'confirmed' };
  }
  // Калории не из этой рецептуры: сумма БЖУ их не подтверждает.
  const fitting = (kcal: number) => caloriesFit(kcal, { protein: values.proteinG ?? known.protein, carbs: values.carbsG ?? known.carbs, fat: values.fatG ?? known.fat });
  if (values.caloriesKcal !== undefined && !fitting(values.caloriesKcal)) {
    delete values.caloriesKcal;
    delete sources.caloriesKcal;
  }
  // Без внешней сверки расхождение макросов значит, что страницы могли описать разные продукты.
  if (!reference && unresolved.some((field) => (MACRO_FIELDS as readonly string[]).includes(field))) return { values: {}, sources: {}, unresolved, corrections: [], recipeCorrected };
  return { values, sources, unresolved, corrections, recipeCorrected };
}

/**
 * Третий источник: поиск страниц → чтение страниц → извлечение → проверка продукта → доверенные значения.
 * Отключён по умолчанию. Поиску и AI уходят только данные продукта и текст страниц: без фото, профиля и макросов этикетки.
 * Макросы этикетки используются только здесь, в коде.
 */
export class GeminiSearchProductLookupProvider implements ProductLookupProvider {
  readonly name = WEB_SEARCH_PROVIDER;
  readonly needsBarcode = false;
  private recent: number[] = [];
  private readonly memory = new Map<string, SearchMemory>();

  constructor(
    private readonly searcher: NutritionSearcher,
    private readonly reader: PageReader,
    private readonly logger: AILogger = { log: () => undefined, warn: () => undefined },
    private readonly now: () => number = Date.now,
    private readonly debug: boolean = scanDebugEnabled(),
    private readonly limits: WebSearchLimits = { maxQueries: MAX_SEARCHES_PER_PRODUCT, maxPages: MAX_PAGES_PER_SCAN },
  ) {}

  /** Один и тот же продукт с тем же набором пропусков повторно не ищется. Новые макросы значат новую сверку страниц. */
  cacheKey(barcode: string | null, context?: ProductLookupContext): string {
    const missing = [...(context?.missingFields ?? []), ...(context?.needsIngredients ? ['ingredients'] : [])].sort().join(',');
    if (barcode) return `${barcode}|${missing}|${recipeFingerprint(context ?? { kcal: null, protein: null, carbs: null, fat: null })}`;
    return JSON.stringify([normalizeProductName(context?.brand ?? null), normalizeProductName(context?.name ?? null), variantTokens(context?.name ?? null, context?.brand ?? null), context?.serving, missing]);
  }

  async lookup(barcode: string | null, context?: ProductLookupContext): Promise<ProductLookupResult | null> {
    // Без значений для сверки страницу можно подтвердить только штрихкодом.
    if (!context) return null;
    const verifiable = per100Context(context);
    const reference = verifiable !== null && knownMacros(verifiable) >= MIN_COMPARED_MACROS;
    if (!reference && !barcode) return null;
    const base = reference ? verifiable : withoutReference(context);
    if (!barcode && !(base.brand && base.name)) return null;
    // Только для сверки: в продукт этот бренд не попадает.
    const known = base.brand ? base : { ...base, brand: knownBrand(base.name) };
    // Короткое имя вместо юридического: и для запросов, и для сверки страниц. В продукт оно не попадает.
    const label = { ...known, name: searchName(known.name) };
    const memory = this.recall(barcode, label);
    if (memory.queries.size === 0 && this.searcher.isAvailable?.() === false) {
      this.report('budget_exhausted', 0, []);
      return null;
    }

    const { brand, name, serving } = label;
    if (this.debug) this.logger.log('web_label', { barcode, brand, name, serving, basis: label.basis, kcal: label.kcal, protein: label.protein, carbs: label.carbs, fat: label.fat, missingFields: label.missingFields, variantTokens: variantTokens(name, brand) });
    const identity = (): ProductLookupContext => (memory.enrichment ? { ...label, name: memory.enrichment.name } : label);
    const witnesses = () => [...memory.sources.values()].filter((source) => memory.witnesses.has(source.url) || barcodeInResult(source, barcode));
    const standing = (domain?: string) => (memory.enrichment && barcode ? aliasState(memory.enrichment, witnesses(), barcode, label, domain) : null);
    // Уточнённое название заменяет штрихкод на странице только на настоящем домене производителя и только если оно подтверждено.
    const confirmed = (domain: string) => isManufacturerDomain(domain, label.brand) && standing(domain)?.state === 'confirmed';
    const verify = (page: LoadedPage) => verifyPage({ ...page.page, basis: page.basis, nutrition: page.nutrition }, page.tier, { ...identity(), nameConfirmed: confirmed(page.domain) }, barcode, page.url);
    const retrievedAt = new Date(this.now()).toISOString();
    const evaluate = () => {
      const checked = selectRecipeCluster(memory.pages.map((page): CheckedPage => ({ ...page, verdict: verify(page) })), reference, label, barcode);
      const basis = reference ? label.basis as 'per_100g' | 'per_100ml' : checked.find((page) => page.verdict.status === 'accepted')?.basis ?? null;
      const usable = checked.filter((page) => page.basis === basis);
      return { checked, basis, usable, ...chooseValues(usable, retrievedAt, label.missingFields, hasReferenceMacros(label), label) };
    };
    const creditsBefore = this.searcher.creditsSpent?.();
    const sufficient = base.brand !== null && base.name !== null;
    // Совпадение со слабым алиасом без штрихкода на странице ничего не доказывает.
    const nameTrusted = () => !memory.enrichment || standing()?.state === 'confirmed';
    const ingredients = () => chooseIngredients(evaluate().checked, memory.outsidePage, identity(), barcode, nameTrusted());
    const wantsIngredients = () => label.needsIngredients === true && ingredients().page === null;
    const stillMissing = () => { const { values } = evaluate(); return label.missingFields.filter((field) => !isFilled(field, values)); };
    const counters = await this.search(memory, barcode, identity, verify, () => hasRequestedValues(evaluate().values, label) && !wantsIngredients(), sufficient, wantsIngredients, stillMissing);
    if (creditsBefore !== undefined) counters.credits = this.searcher.creditsSpent!() - creditsBefore;
    if (memory.sources.size === 0) {
      context.onIngredients?.({ found: false, accepted: false, source: null, rejectReason: null });
      context.onSearch?.({ searches: counters.searches, candidates: 0, pagesRead: 0, accepted: [], rejected: [], credits: counters.credits ?? counters.searches, aiExtractions: 0, recipe: recipeFingerprint(label), rejectedRecipes: [], corrected: [] });
      this.report('no_grounded_source', counters.webSearchQueries, [], [], [], counters, memory.enrichment, standing());
      return null;
    }
    if (wantsIngredients()) await this.withIngredientsExtraction(memory, counters, identity(), barcode);
    for (let left = MAX_AI_EXTRACTIONS_PER_PRODUCT - memory.aiExtractions; left > 0 && !hasRequestedValues(evaluate().values, label); left--) memory.pages = await this.withAiExtraction(memory, counters, identity(), barcode, confirmed);
    const solid = evaluate();
    const { checked, basis, unresolved, corrections, recipeCorrected } = solid;
    const { values, sources } = solid;
    const status: WebVerdictStatus = Object.keys(values).length > 0 ? 'accepted' : unresolved.length > 0 ? 'unresolved_conflict'
      : checked.find((page) => page.verdict.status !== 'accepted')?.verdict.status ?? 'insufficient_identity';
    this.report(status, counters.webSearchQueries, checked, unresolved, Object.keys(values), counters, memory.enrichment, standing());
    context.onSearch?.({
      searches: counters.searches, candidates: memory.sources.size, pagesRead: memory.pages.length, accepted: Object.keys(values), credits: counters.credits ?? counters.searches + counters.extracts, aiExtractions: counters.aiExtractions,
      rejected: [...checked.filter((page) => page.verdict.status !== 'accepted').map((page) => ({ domain: page.domain, reason: page.verdict.reason })),
        ...[...memory.failed].map(([url, reason]) => ({ domain: memory.sources.get(url)?.domain ?? '', reason }))],
      recipe: recipeFingerprint(checked.find((page) => page.verdict.reason === CORRECTED_RECIPE)?.nutrition ?? label),
      rejectedRecipes: [...new Set(checked.filter((page) => page.verdict.status !== 'accepted' && (page.verdict.conflicts.length > 0 || page.verdict.reason === OTHER_CLUSTER)).map((page) => recipeFingerprint(page.nutrition)))],
      corrected: corrections,
    });
    if (this.debug) this.reportCandidates([...memory.sources.values()], checked, memory.failed, identity(), barcode, sources, memory.identityUrl);
    const composition = label.needsIngredients === false && !recipeCorrected ? NO_INGREDIENTS : ingredients();
    context.onIngredients?.(composition.decision);
    const hasValues = Object.keys(values).length > 0;
    if (!hasValues && !composition.page) return null;

    const nutrition = Object.fromEntries((['caloriesKcal', 'proteinG', 'carbsG', 'sugarsG', 'fatG', 'saturatedFatG', 'fiberG', 'saltG', 'sodiumMg'] as const)
      .map((key) => [key, values[key] ?? null])) as Record<NutrientKey, number | null>;
    const named = reference || !hasValues ? null : checked.find((page) => page.verdict.status === 'accepted');
    return {
      provider: WEB_SEARCH_PROVIDER, match: 'verified_identity', barcode: barcode ?? '', ...(corrections.length > 0 ? { corrections } : {}), ...(recipeCorrected ? { replacesRecipe: true } : {}),
      name: named?.page.identityText.trim().slice(0, MAX_LOGGED_TEXT) || null, brand: named?.page.brand ?? null, servingSize: null, ingredients: composition.page ? splitIngredients(composition.page.page.ingredients!) : null, allergens: null, additives: null,
      nutrition: hasValues ? { basis: basis!, values: nutrition, derived: [] } : null,
      evidence: { fields: sources, webSearchQueries: counters.webSearchQueries, ...(composition.page ? { ingredients: ingredientsSource(composition.page, composition.ingredientsOnly, retrievedAt, identityFacts({ ...composition.page.page, basis: composition.page.basis, nutrition: composition.page.nutrition }, identity(), barcode).barcodeMatch) } : {}) },
    };
  }

  private recall(barcode: string | null, context: ProductLookupContext): SearchMemory {
    const key = barcode ?? normalizeProductName(`${context.brand ?? ''} ${context.name ?? ''}`);
    for (const [stored, value] of this.memory) if (value.expiresAt <= this.now()) this.memory.delete(stored);
    const known = this.memory.get(key);
    if (known) return known;
    const fresh: SearchMemory = { queries: new Set(), visited: new Set(), sources: new Map(), failed: new Map(), pages: [], extracts: 0, aiExtractions: 0, enrichment: null, witnesses: new Set(), identityUrl: null, outsidePage: null, expiresAt: this.now() + SEARCH_MEMORY_TTL_MS };
    this.memory.set(key, fresh);
    return fresh;
  }

  /** Запросы по очереди, пока не найдены критичные поля. Без повторов: каждый запрос стоит кредит. */
  private async search(memory: SearchMemory, barcode: string | null, identity: () => ProductLookupContext, verify: (page: LoadedPage) => PageVerdict, enough: () => boolean, nameSufficient: boolean, wantsIngredients: () => boolean, stillMissing: () => readonly string[]): Promise<SearchCounters> {
    const counters: SearchCounters = { searches: 0, reads: 0, extracts: 0, aiExtractions: 0, identityReads: 0, webSearchQueries: 0, steps: [] };
    const staged = this.searcher.searchQuery !== undefined;
    for (const kind of staged ? SEARCH_ORDER : SEARCH_ORDER.slice(0, 1)) {
      if (enough()) break;
      // Запрос строится заново: предыдущий шаг мог уточнить название или найти то, чего не хватало.
      const label = { ...identity(), needsIngredients: wantsIngredients(), missingFields: stillMissing() };
      const steps: readonly SearchStep[] = staged ? searchStrategy(barcode, label) : [{ kind, query: `discover:${barcode ?? ''}` }];
      const step = steps.find((item) => item.kind === kind && !memory.queries.has(item.query));
      if (!step) continue;
      if (memory.queries.size >= this.limits.maxQueries) break;
      if (this.searcher.isAvailable?.() === false) break;
      let found: SourceDiscoveryResponse;
      try {
        this.reserveRequest();
        found = staged ? await this.searcher.searchQuery!(step.query) : await this.searcher.discoverSources({ barcode, brand: label.brand, name: label.name, serving: label.serving });
      } catch (error) {
        // Первый сбой виден скану и не кэшируется; после него найденное раньше остаётся в силе.
        if (counters.searches === 0 && memory.pages.length === 0) throw error;
        this.logger.warn('web_search_failed', { step: step.kind, error: (error as Error)?.message ?? 'failed' });
        break;
      }
      memory.queries.add(step.query);
      counters.searches++;
      counters.webSearchQueries += found.webSearchQueries;
      counters.steps.push(step.kind);
      for (const source of found.sources) if (!memory.sources.has(source.url)) memory.sources.set(source.url, source);
      if (step.kind === 'barcode' || step.kind === 'barcode_identity') for (const source of found.sources) memory.witnesses.add(source.url);
      if (staged && barcode) {
        if (this.debug) for (const source of found.sources.filter((item) => barcodeInResult(item, barcode))) {
          this.logger.log('identity_context', { domain: source.domain, url: loggedUrl(source.url), contexts: identityContext(`${source.title} ${source.snippet ?? ''}`, barcode, label) });
        }
        const known = memory.enrichment ? null : enrichedName([...memory.sources.values()], barcode, label);
        const fromPage = await this.outsideRead(memory, barcode, label, counters, !nameSufficient && !memory.enrichment && !known);
        const enrichment = memory.enrichment ? null : known ?? fromPage;
        if (enrichment) {
          memory.enrichment = enrichment;
          this.logger.log('identity_enrichment', { from: label.name, alias: enrichment.name, addition: enrichment.addition, provisional: enrichment.reason === 'single_barcode_result', reason: enrichment.reason, domains: enrichment.domains });
        }
      }
      const fresh = [...memory.sources.values()].filter((source) => !memory.visited.has(source.url));
      // Одно чтение остаётся последнему запросу: он ищет именно недостающие поля.
      const reserved = staged && step !== steps.at(-1) && this.limits.maxPages > 1 ? 1 : 0;
      let room = Math.min(staged ? PAGES_PER_STEP : this.limits.maxPages, this.limits.maxPages - memory.pages.length - (memory.outsidePage ? 1 : 0) - reserved);
      const ranked = rankSources(fresh, identity(), barcode, staged, wantsIngredients()).map(({ source }) => source);
      const unread: SourceDiscoveryResponse['sources'][number][] = [];
      // Недоступная страница не занимает место: вместо неё читается следующий кандидат.
      while (room > 0 && ranked.length > 0 && memory.visited.size < MAX_PAGE_ATTEMPTS) {
        const candidates = ranked.splice(0, room);
        for (const source of candidates) memory.visited.add(source.url);
        counters.reads += candidates.length;
        const read = await this.readPages(candidates, identity());
        for (const [url, reason] of read.failed) memory.failed.set(url, reason);
        memory.pages = [...memory.pages, ...read.pages];
        unread.push(...read.unread);
        room -= read.pages.length;
      }
      if (unread.length > 0 && memory.extracts < MAX_EXTRACTS_PER_PRODUCT && !enough() && this.searcher.isAvailable?.() !== false) memory.pages = await this.withSearchExtract({ pages: memory.pages, unread, failed: memory.failed }, identity(), verify, memory, counters);
    }
    return counters;
  }

  /**
   * Одна страница вне списка с точным штрихкодом в выдаче, если название неизвестно: например, страница тега.
   * Страница не попадает в pages, поэтому её значения и порция не доходят ни до проверки, ни до продукта. Состав с неё проверяется как обычно.
   */
  private async outsideRead(memory: SearchMemory, barcode: string, label: ProductLookupContext, counters: SearchCounters, nameUnknown: boolean): Promise<NameEnrichment | null> {
    if (memory.identityUrl !== null || memory.visited.size >= this.limits.maxPages) return null;
    const sources = [...memory.sources.values()];
    const named = (item: SourceDiscoveryResponse['sources'][number]) => nameSpan(item.title.split('|')[0]!, label) !== null;
    const exact = sources.filter((item) => barcodeInResult(item, barcode));
    const identityNeeded = nameUnknown && !exact.some((item) => named(item) || namesNearBarcode(item.snippet ?? '', barcode, label).length > 0);
    if (!identityNeeded) return null;
    const source = exact.filter((item) => !memory.visited.has(item.url) && !isNotProductSite(item.domain) && sourceTier(item.domain, label.brand) === 4)
      .sort((a, b) => Number(named(b)) - Number(named(a)))[0];
    if (!source) return null;
    memory.identityUrl = source.url;
    memory.visited.add(source.url);
    counters.reads++;
    counters.identityReads++;
    const read = await this.identityPage(source.url, memory, counters);
    if (read === null) return null;
    const parsed = parsePage(read.body);
    const page = read.extracted ? { ...parsed, identityText: `${source.title} ${parsed.identityText}`, productText: `${source.title.split('|')[0]} ${parsed.productText}` } : parsed;
    memory.outsidePage = { sourceUrl: source.url, url: source.url, domain: source.domain, tier: 4, page, nutrition: EMPTY_NUTRITION, basis: null, method: page.method, reader: read.extracted ? 'search_extract' : 'direct' };
    const hasCode = page.barcodes.includes(barcode) || barcodeInResult({ ...source, title: page.text, snippet: '' }, barcode);
    const near = namesNearBarcode(page.text, barcode, label);
    const enrichment = hasCode ? enrichedName([...sources, { ...source, title: page.productText, snippet: [...near, barcode].join('\n') }], barcode, label) : null;
    if (this.debug) this.logger.log('identity_read', { domain: source.domain, url: loggedUrl(source.url), reason: 'identity', hasCode, alias: enrichment?.name ?? null, name: page.productText.slice(0, MAX_LOGGED_TEXT), contexts: identityContext(page.text, barcode, label) });
    return enrichment;
  }

  /** Прямое чтение без повторов. Если не открылось, один раз запасное чтение: оно входит в общий лимит. */
  private async identityPage(url: string, memory: SearchMemory, counters: SearchCounters): Promise<{ readonly body: string; readonly extracted: boolean } | null> {
    try {
      return { body: (await this.reader.fetchPage(url)).body, extracted: false };
    } catch (error) {
      memory.failed.set(url, (error as Error)?.message ?? 'failed');
      this.logger.warn('identity_read_failed', { url: loggedUrl(url), error: (error as Error)?.message ?? 'failed' });
      if ((error instanceof PageFetchError && error.code === 'blocked_url') || memory.extracts >= MAX_EXTRACTS_PER_PRODUCT || !this.searcher.readPages || this.searcher.isAvailable?.() === false) return null;
    }
    memory.extracts++;
    counters.extracts++;
    try {
      const content = (await this.searcher.readPages!([url])).find((item) => item.url === url)?.content;
      return content ? { body: content, extracted: true } : null;
    } catch (error) {
      this.logger.warn('web_extract_failed', { error: (error as Error)?.message ?? 'failed' });
      return null;
    }
  }

  private async readPages(sources: SourceDiscoveryResponse['sources'], context: ProductLookupContext): Promise<ReadResult> {
    const failed = new Map<string, string>();
    const results = await Promise.all(sources.map(async (source): Promise<LoadedPage | 'blocked' | null> => {
      try {
        const fetched = await this.reader.fetchPage(source.url);
        const page = parsePage(fetched.contentType === 'application/ld+json' ? `<script type="application/ld+json">${fetched.body}</script>` : fetched.body);
        return { sourceUrl: source.url, url: fetched.finalUrl, domain: fetched.domain, tier: sourceTier(fetched.domain, context.brand), page, nutrition: page.nutrition, basis: page.basis, method: page.method, reader: 'direct' };
      } catch (error) {
        this.logger.warn('web_page_failed', { domain: source.domain, error: (error as Error)?.message ?? 'failed' });
        failed.set(source.url, (error as Error)?.message ?? 'failed');
        // Закрытый адрес не передаётся дальше: запасное чтение его не обходит.
        return error instanceof PageFetchError && error.code === 'blocked_url' ? 'blocked' : null;
      }
    }));
    const pages = results.filter((page): page is LoadedPage => page !== null && page !== 'blocked');
    // Пустая страница без текста о питании обычно значит, что содержимое подгружается через JavaScript.
    const unread = sources.filter((_, index) => {
      const result = results[index];
      return result === null || (result !== 'blocked' && result !== undefined && result.method === null && !result.page.relevantText);
    });
    return { pages, unread, failed };
  }

  /** Вызывается только если напрямую не нашлось страницы с недостающими значениями, которой хватает самой по себе: так кредит не тратится зря. */
  private async withSearchExtract({ pages, unread }: ReadResult, context: ProductLookupContext, verify: (page: LoadedPage) => PageVerdict, memory: SearchMemory, counters: SearchCounters): Promise<readonly LoadedPage[]> {
    if (!this.searcher.readPages || unread.length === 0) return pages;
    if (pages.some((page) => { const verdict = verify(page); return verdict.status === 'accepted' && !verdict.needsSecondSource && addsMissingValue(page, context); })) return pages;
    let contents: Awaited<ReturnType<NonNullable<NutritionSearcher['readPages']>>>;
    memory.extracts++;
    counters.extracts++;
    try {
      contents = await this.searcher.readPages(unread.map((source) => source.url));
    } catch (error) {
      this.logger.warn('web_extract_failed', { error: (error as Error)?.message ?? 'failed' });
      return pages;
    }
    const extracted = contents.flatMap((item): LoadedPage[] => {
      const source = unread.find((candidate) => candidate.url === item.url);
      if (!source) return [];
      const parsed = parsePage(item.content);
      const page = { ...parsed, identityText: `${source.title} ${parsed.identityText}`, productText: `${source.title.split('|')[0]} ${parsed.productText}` };
      return [{ sourceUrl: source.url, url: source.url, domain: source.domain, tier: sourceTier(source.domain, context.brand), page, nutrition: page.nutrition, basis: page.basis, method: page.method, reader: 'search_extract' }];
    });
    const replaced = new Set(extracted.map((page) => page.domain));
    return [...pages.filter((page) => !replaced.has(page.domain)), ...extracted];
  }

  /** Код не нашёл состав на странице про этот товар. Один запрос без поиска, только текст этой страницы. Ненапечатанное отбрасывается. */
  private async withIngredientsExtraction(memory: SearchMemory, counters: SearchCounters, label: ProductLookupContext, barcode: string | null): Promise<void> {
    if (memory.aiExtractions >= MAX_AI_EXTRACTIONS_PER_PRODUCT || !this.searcher.extractIngredients) return;
    const target = [...memory.pages, ...(memory.outsidePage ? [memory.outsidePage] : [])].find((page) => !page.page.ingredients && mentionsIngredients(page.page.text)
      && ingredientsRejectReason({ ...page.page, basis: page.basis, nutrition: page.nutrition }, label, barcode, page.url) === null);
    if (!target) return;
    memory.aiExtractions++;
    counters.aiExtractions++;
    const text = ingredientsFragment(target.page.text);
    let value: string | null;
    try {
      value = printedIngredients(await this.searcher.extractIngredients(text), text);
    } catch (error) {
      this.logger.warn('web_extraction_failed', { error: (error as Error)?.message ?? 'failed' });
      return;
    }
    if (!value) return;
    const update = (page: LoadedPage): LoadedPage => (page === target ? { ...page, page: { ...page.page, ingredients: value } } : page);
    memory.pages = memory.pages.map(update);
    if (memory.outsidePage) memory.outsidePage = update(memory.outsidePage);
  }

  /**
   * Один запрос на продукт и одна страница: найденная поиском, про этот товар, без таблицы, которую разобрал бы код.
   * Числа от AI проверяются по тексту страницы, а товар и адрес остаются со страницы. Повторов нет.
   */
  private async withAiExtraction(memory: SearchMemory, counters: SearchCounters, label: ProductLookupContext, barcode: string | null, confirmed: (domain: string) => boolean): Promise<readonly LoadedPage[]> {
    const { pages } = memory;
    if (memory.aiExtractions >= MAX_AI_EXTRACTIONS_PER_PRODUCT) return pages;
    const needAi = pages.map((page, id) => ({ id, page, facts: identityFacts({ ...page.page, nutrition: page.nutrition, basis: page.basis }, label, barcode) }))
      .filter(({ page, facts }) => page.method === null && page.page.relevantText && (page.tier < 4 || facts.barcodeMatch) && !facts.otherVariant && !page.page.malformed
        && (facts.barcodeMatch || hasReferenceMacros(label) || confirmed(page.domain))
        && (facts.barcodeMatch || (facts.variantMatch && (facts.brandMatch || !label.brand)) || (facts.variantSilent && facts.brandMatch && hasReferenceMacros(label))))
      .sort((a, b) => Number(b.facts.barcodeMatch) - Number(a.facts.barcodeMatch) || a.page.tier - b.page.tier)
      .slice(0, 1);
    if (needAi.length === 0) return pages;
    memory.aiExtractions++;
    counters.aiExtractions++;
    let extracted: readonly ExtractedPage[];
    try {
      extracted = await this.searcher.extractNutrition(needAi.map(({ id, page }) => ({ id, text: page.page.relevantText })));
    } catch (error) {
      this.logger.warn('web_extraction_failed', { error: (error as Error)?.message ?? 'failed' });
      return pages;
    }
    return pages.map((page, id) => {
      const item = extracted.find((entry) => entry.id === id);
      if (!item || page.method !== null) return page;
      const text = page.page.relevantText;
      const nutrition: PageNutrition = { ...EMPTY_NUTRITION,
        kcal: printedOnPage(item.kcal, text), protein: printedOnPage(item.protein, text), carbs: printedOnPage(item.carbs, text), fat: printedOnPage(item.fat, text),
        sugars: printedOnPage(item.sugars, text), saturatedFat: printedOnPage(item.saturatedFat, text), salt: printedOnPage(item.salt, text),
        sodiumMg: printedOnPage(item.sodiumMg, text), fiber: printedOnPage(item.fiber, text) };
      // Основа должна быть напечатана: без неё значения на порцию нельзя отличить от значений на 100 г.
      const basis = /100\s*(мл|ml)/i.test(text) ? 'per_100ml' : /100\s*(г|гр|g)/i.test(text) ? 'per_100g' : null;
      return { ...page, nutrition, basis, method: 'ai' };
    });
  }

  private report(status: WebVerdictStatus, queries: number, pages: readonly CheckedPage[], unresolved: readonly string[] = [], accepted: readonly string[] = [], counters?: SearchCounters, enrichment?: NameEnrichment | null, standing?: AliasStanding | null): void {
    this.logger.log('web_lookup', { status, webSearchQueries: queries, searches: counters?.searches ?? 0, reads: counters?.reads ?? 0, extracts: counters?.extracts ?? 0, identityReads: counters?.identityReads ?? 0, alias: enrichment?.name ?? null, aliasStrength: !enrichment ? null : enrichment.reason === 'single_barcode_result' ? 'weak' : 'strong', aliasReason: enrichment?.reason ?? null, aliasState: standing?.state ?? null, aliasConfirmedBy: standing?.by ?? null, credits: counters?.credits ?? (counters?.searches ?? 0) + (counters?.extracts ?? 0), aiExtractions: counters?.aiExtractions ?? 0, steps: counters?.steps ?? [], accepted, unresolved,
      pages: pages.map((page) => ({ domain: page.domain, tier: page.tier, reader: page.reader, method: page.method, values: page.nutrition, status: page.verdict.status, reason: page.verdict.reason, identityMatch: page.verdict.identityMatch, conflicts: page.verdict.conflicts })) });
  }

  /** Каждый найденный кандидат и решение по нему. Без тела страницы и без параметров адреса. */
  private reportCandidates(sources: SourceDiscoveryResponse['sources'], pages: readonly CheckedPage[], failed: ReadonlyMap<string, string>, label: ProductLookupContext, barcode: string | null, used: Partial<Record<NutrientKey, WebFieldSource>>, identityUrl: string | null): void {
    const usedUrls = new Set(Object.values(used).map((field) => field.url));
    for (const source of sources) {
      const page = pages.find((item) => item.sourceUrl === source.url);
      const inResults = barcodeInResult(source, barcode);
      const base = { domain: source.domain, url: loggedUrl(page?.url ?? source.url), title: source.title.slice(0, MAX_LOGGED_TEXT), tier: page?.tier ?? sourceTier(source.domain, label.brand), barcodeInResults: inResults, ...(hasIngredientsMark(source.snippet ?? '') ? { readBoost: 'ingredients_mark_in_snippet' } : {}) };
      if (!page) {
        const error = failed.get(source.url);
        this.logger.log('web_candidate', { ...base, decision: error ? 'inaccessible' : 'other', reason: error ?? (source.url === identityUrl ? 'identity_read_only' : skipReason(source, base.tier, inResults, label)) });
        continue;
      }
      const facts = identityFacts({ ...page.page, nutrition: page.nutrition, basis: page.basis }, label, barcode);
      this.logger.log('web_candidate', { ...base, reader: page.reader, method: page.method, pageName: page.page.identityText.slice(0, MAX_LOGGED_TEXT), basis: page.basis, values: page.nutrition,
        ...facts, macroComparisons: compareMacros(label, page.nutrition).comparisons, decision: candidateDecision(page.verdict, usedUrls.has(page.url)), reason: page.verdict.reason });
    }
  }

  private reserveRequest(): void {
    const now = this.now();
    this.recent = this.recent.filter((at) => now - at < HOUR_MS);
    if (this.recent.length >= WEB_SEARCH_MAX_PER_HOUR) throw new WebSearchLimitError();
    this.recent.push(now);
  }
}
