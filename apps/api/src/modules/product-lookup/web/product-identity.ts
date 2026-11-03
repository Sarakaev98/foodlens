import type { ProductLookupContext } from '../product-lookup.provider';
import { implausibleNutrition, type PageNutrition, type ParsedPage } from './page-nutrition';
import { isListPage, type SourceTier } from './source-tier';

export type WebVerdictStatus = 'accepted' | 'different_product_or_recipe' | 'recipe_version_conflict' | 'insufficient_identity' | 'no_grounded_source' | 'unresolved_conflict' | 'budget_exhausted';

/** exact_barcode: случай A или страница производителя со штрихкодом. official_variant: случай B. two_sources: случай C, нужен второй независимый источник. */
export type IdentityMatch = 'exact_barcode' | 'official_variant' | 'two_sources';

/**
 * Допуски сверки со значениями этикетки: большее из относительного и абсолютного отклонения.
 * Они покрывают округление и пересчёт кДж, но не другую рецептуру:
 * обычный Snickers (жиры 25 против 28,6) и чужой Choco Pie (углеводы 70,5 против 63) в них не проходят.
 */
export const MACRO_TOLERANCE = {
  kcal: { relative: 0.05, absolute: 15 },
  protein: { relative: 0.1, absolute: 1 },
  carbs: { relative: 0.1, absolute: 1 },
  fat: { relative: 0.1, absolute: 1 },
} as const;
/** Сверка имеет смысл минимум по стольким значениям. */
export const MIN_COMPARED_MACROS = 3;
/** Допуск совпадения двух источников по одному полю. 48 и 48,2 совпадают, 48 и 32 нет. */
export const FIELD_TOLERANCE: Readonly<Record<'kcal' | 'protein' | 'carbs' | 'fat' | 'sugars' | 'saturatedFat' | 'fiber' | 'salt' | 'sodiumMg', { readonly relative: number; readonly absolute: number }>> = {
  ...MACRO_TOLERANCE,
  sugars: { relative: 0.05, absolute: 0.5 }, saturatedFat: { relative: 0.05, absolute: 0.5 }, fiber: { relative: 0.05, absolute: 0.5 },
  salt: { relative: 0.1, absolute: 0.1 }, sodiumMg: { relative: 0.1, absolute: 40 },
};

const MACROS = ['kcal', 'protein', 'carbs', 'fat'] as const;

export interface MacroComparison {
  readonly field: string;
  readonly label: number;
  readonly page: number;
  readonly allowed: number;
}

export interface MacroCheck {
  readonly compared: number;
  readonly conflicts: readonly MacroComparison[];
  /** Все сравнения, для диагностики. */
  readonly comparisons: readonly (MacroComparison & { readonly passed: boolean })[];
}

export function compareMacros(context: ProductLookupContext, page: PageNutrition): MacroCheck {
  const conflicts: MacroComparison[] = [];
  const comparisons: (MacroComparison & { passed: boolean })[] = [];
  let compared = 0;
  for (const field of MACROS) {
    const label = context[field];
    const value = page[field];
    if (label === null || value === null) continue;
    compared++;
    const tolerance = MACRO_TOLERANCE[field];
    const allowed = Math.max(tolerance.relative * label, tolerance.absolute);
    const comparison = { field, label, page: value, allowed: Math.round(allowed * 100) / 100 };
    const passed = Math.abs(label - value) <= allowed + 1e-9;
    comparisons.push({ ...comparison, passed });
    if (!passed) conflicts.push(comparison);
  }
  return { compared, conflicts, comparisons };
}

/** Калории сходятся с суммой БЖУ по 4/4/9. Клетчатка и полиолы дают небольшое расхождение. Нет всех трёх значений: сверять не с чем. */
export function caloriesFit(kcal: number, { protein, carbs, fat }: { readonly protein: number | null; readonly carbs: number | null; readonly fat: number | null }): boolean {
  if (protein === null || carbs === null || fat === null) return true;
  const expected = 4 * protein + 4 * carbs + 9 * fat;
  return Math.abs(kcal - expected) <= Math.max(0.1 * expected, 20);
}

export function valuesAgree(field: keyof typeof FIELD_TOLERANCE, a: number, b: number): boolean {
  const tolerance = FIELD_TOLERANCE[field];
  return Math.abs(a - b) <= Math.max(tolerance.relative * Math.max(a, b), tolerance.absolute) + 1e-9;
}

/** Слова, не отличающие один вариант продукта от другого. */
const GENERIC_WORDS = new Set([
  'шоколадный', 'шоколадные', 'батончик', 'батончики', 'печенье', 'пирожное', 'конфеты', 'напиток', 'продукт', 'упаковка', 'шт', 'г', 'гр', 'кг', 'мл', 'л',
  'chocolate', 'bar', 'bars', 'biscuit', 'cookie', 'cake', 'pack', 'g', 'kg', 'ml', 'with', 'and', 'the', 'с', 'и', 'в',
]);
/** Написание одного названия или варианта на разных языках. Дополняется здесь. */
const SYNONYMS: readonly (readonly string[])[] = [
  ['snickers', 'сникерс'], ['orion', 'орион'], ['choco', 'чоко'], ['pie', 'пай'], ['чокопай', 'chocopie'],
  ['coca', 'кока'], ['cola', 'кола'], ['orange', 'апельсин', 'апельсиновая', 'апельсиновый'], ['zero', 'зеро'], ['vanilla', 'ваниль', 'ванильная', 'ванильный'],
  ['лесной', 'лесным', 'фундук', 'фундуком', 'hazelnut', 'hazelnuts'], ['орех', 'ореха', 'орехом', 'nut', 'nuts', 'hazelnut', 'фундук'],
];

/** Вкусы и версии: если страница называет другой такой вариант, это другой товар. Дополняется здесь. */
const VARIANT_WORDS = [
  'orange', 'vanilla', 'cream', 'cherry', 'lime', 'lemon', 'peach', 'strawberry', 'raspberry', 'mango', 'mint', 'banana', 'coconut', 'peanut', 'almond', 'caramel', 'coffee', 'zero', 'diet', 'light',
  'апельсин', 'апельсиновая', 'апельсиновый', 'ваниль', 'ванильная', 'ванильный', 'крем', 'вишня', 'вишневая', 'лимон', 'лимонная', 'лайм', 'персик', 'клубника', 'малина', 'манго', 'мята', 'банан', 'кокос', 'арахис', 'миндаль', 'карамель', 'кофе', 'зеро', 'лайт',
];
/** Считаются другим вариантом, только если у продукта на этикетке вариант назван: «Original» при «Zero», но не при «Coca-Cola». */
const BASE_VARIANT_WORDS = ['original', 'classic', 'оригинальная', 'оригинальный', 'классическая', 'классический'];
/** Бренд для сверки, если в базе поле пустое: название начинается с него. Первое слово названия брендом не считается. */
const KNOWN_BRANDS = ['Coca-Cola', 'Кока-Кола', 'Pepsi', 'Fanta', 'Sprite', 'Snickers', 'Сникерс', 'Mars', 'Twix', 'Bounty', 'Milka', 'Oreo', 'Nestle', 'Lotte', 'Orion', 'Roshen', 'Kinder', 'Ferrero'];

const RUSSIAN_ENDING = /(?:ыми|ими|ами|ями|ого|его|ому|ему|ая|яя|ое|ее|ой|ей|ый|ий|ым|им|ом|ем|ах|ях|ам|ям|ов|ев|ую|юю|а|я|ы|и|у|ю|е|о)$/;
const MIN_STEM = 4;

/** Основа русского слова: «лесного», «лесной» и «лесным» один вариант продукта. Короткие и нерусские слова не меняются. */
export function wordStem(token: string): string {
  if (!/^[а-я]+$/.test(token) || token.length <= MIN_STEM) return token;
  const stem = token.replace(RUSSIAN_ENDING, '');
  return stem.length >= MIN_STEM ? stem : token;
}

const GENERIC_STEMS = new Set([...GENERIC_WORDS].map(wordStem));
const VARIANT_STEMS = new Set(VARIANT_WORDS.map(wordStem));
const BASE_VARIANT_STEMS = new Set(BASE_VARIANT_WORDS.map(wordStem));

export function normalizeProductName(text: string | null): string {
  return (text ?? '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

const tokens = (text: string | null): readonly string[] => normalizeProductName(text).split(' ').filter(Boolean);

function spellings(token: string): readonly string[] {
  const stem = wordStem(token);
  return (SYNONYMS.find((group) => group.some((word) => wordStem(word) === stem)) ?? [token]).map(wordStem);
}

function containsToken(pageTokens: readonly string[], token: string): boolean {
  const stems = pageTokens.map(wordStem);
  return spellings(token).some((word) => stems.includes(word));
}

/** Слова названия без бренда и общих слов: то, что отличает именно этот вариант. */
export function variantTokens(name: string | null, brand: string | null): readonly string[] {
  const brandWords = tokens(brand).flatMap(spellings);
  return tokens(name).filter((token) => !GENERIC_STEMS.has(wordStem(token)) && !brandWords.includes(wordStem(token)) && !/^\d+$/.test(token));
}

/** Слова названия в единой записи. */
export const nameWords = tokens;

const MAX_NAME_SPAN = 8;

/** Кусок текста со словами бренда и названия подряд, плюс одно слово: соседние товары на странице-списке в него не попадают. */
export function nameSpan(text: string, context: ProductLookupContext): string | null {
  const found = tokens(text);
  const required = tokens(`${context.brand ?? ''} ${context.name ?? ''}`);
  if (required.length === 0) return null;
  for (let start = 0; start < found.length; start++) {
    const part = found.slice(start, start + MAX_NAME_SPAN);
    if (!containsToken(required, found[start]!) || !required.every((word) => containsToken(part, word))) continue;
    const last = part.reduce((end, token, index) => (containsToken(required, token) ? index : end), 0);
    return part.slice(0, last + 2).join(' ');
  }
  return null;
}

/** Все слова первого текста уже есть во втором, с учётом написаний: «Чоко Пай» и «Choco Pie». */
export function sameWords(part: string, text: string): boolean {
  const words = tokens(part);
  const found = tokens(text);
  return words.length > 0 && words.every((word) => containsToken(found, word));
}

/** Вариант, которого нет в названии, если остальные слова названия в этом тексте есть. Не один такой вариант: это перечисление, а не товар. */
export function nameAddition(text: string, context: ProductLookupContext): string | null {
  const found = tokens(text);
  const name = tokens(context.name);
  if (name.length === 0 || ![...tokens(context.brand), ...name].every((word) => containsToken(found, word))) return null;
  const extra = new Set(found.filter((token) => VARIANT_STEMS.has(wordStem(token)) && !containsToken(name, token)).map((token) => spellings(token)[0]!));
  const [word] = extra;
  return extra.size === 1 && word ? word : null;
}

/** Recipe claims are product identity, not loose words shared with the base product. */
function variantMarkers(text: string): string[] {
  const patterns: readonly [string, RegExp][] = [
    ['no_sugar', /\b(?:no (?:added )?sugar(?: added)?|sugar free|sugarfree)\b|без сахара/u],
    ['reduced_sugar', /\b(?:reduced|less) sugar\b|пониженн[а-я]* сахар/u],
    ['reduced_fat', /\b(?:reduced|low) fat\b|пониженн[а-я]* жир/u],
    ['zero', /\bzero\b|зеро/u], ['light', /\blight\b|лайт/u],
    ['spicy', /\b(?:spicy|hot)\b|остр[а-я]*/u],
  ];
  return patterns.filter(([,pattern]) => pattern.test(text)).map(([name]) => name);
}
function namesOtherVariant(found: readonly string[], context: ProductLookupContext): boolean {
  const label = tokens(context.name);
  if (label.length === 0) return false;
  const labelHasVariant = label.some((token) => VARIANT_STEMS.has(wordStem(token)));
  if (variantMarkers(found.join(' ')).join('|') !== variantMarkers(label.join(' ')).join('|')) return true;
  return found.some((token) => {
    const stem = wordStem(token);
    return (VARIANT_STEMS.has(stem) || (labelHasVariant && BASE_VARIANT_STEMS.has(stem))) && !containsToken(label, token);
  });
}

/** Столько разных штрихкодов на странице значат список товаров, а не карточку. */
const LIST_PAGE_BARCODES = 4;

/** Страница перечисляет товары. Страница самого штрихкода может показывать соседние коды: это всё равно карточка. */
function listsProducts(page: ParsedPage, barcode: string | null, url: string): boolean {
  const distinct = new Set(page.text.match(/(?<!\d)\d{13}(?!\d)/g) ?? []);
  const ownPage = barcode !== null && (url.includes(barcode) || page.productText.includes(barcode));
  return isListPage(url, page.productText) || (distinct.size >= LIST_PAGE_BARCODES && !ownPage);
}

/**
 * Почему состав нельзя взять со страницы. null: можно. Домен и значения питания здесь не участвуют.
 * Макросы страницы не должны спорить с подтверждёнными: иначе это другая рецептура, и лучше без состава.
 * A: штрихкод на самой странице, бренд и вариант не спорят, название того же семейства.
 * B: штрихкода нет, но совпали бренд и всё название с вариантом.
 */
export function ingredientsRejectReason(page: ParsedPage, context: ProductLookupContext, barcode: string | null, url = ''): string | null {
  if (listsProducts(page, barcode, url)) return 'list_page';
  const facts = identityFacts(page, context, barcode);
  if (facts.otherVariant) return 'variant_conflict';
  if (page.basis === context.basis && compareMacros(context, page.nutrition).conflicts.some((conflict) => conflict.field !== 'kcal')) return 'possible_recipe_mismatch';
  if (!facts.barcodeMatch) {
    if (!facts.brandMatch) return 'brand_mismatch';
    return facts.variantMatch ? null : 'name_mismatch';
  }
  // Бренд неизвестен, например когда базы нет: спорить не с чем, штрихкод на странице определяет товар.
  const brand = tokens(context.brand);
  const name = variantTokens(context.name, context.brand);
  // Безликий заголовок вроде «<штрихкод> - EAN-13»: товар называет сама страница.
  const heading = tokens(page.productText);
  const generic = ![...brand, ...name].some((word) => containsToken(heading, word));
  const found = generic ? tokens(page.text) : heading;
  if (brand.length > 0 && !facts.brandMatch && !brand.every((word) => containsToken(found, word)) && !facts.variantSilent) return 'brand_mismatch';
  return name.length === 0 || name.some((word) => containsToken(found, word)) ? null : 'name_mismatch';
}

/** Заголовок со всем названием и брендом: для страницы вне списка без штрихкода в выдаче этого достаточно, чтобы её прочитать. */
export const titleNamesProduct = (title: string, context: ProductLookupContext): boolean => nameSpan(title.split('|')[0]!, context) !== null;

/** Бренд из начала названия, если он известен. */
export function knownBrand(name: string | null): string | null {
  const text = `${normalizeProductName(name)} `;
  return KNOWN_BRANDS.find((brand) => text.startsWith(`${normalizeProductName(brand)} `)) ?? null;
}

/**
 * Заголовок называет продукт: все слова названия на месте, другого варианта нет. Бренд может отсутствовать в заголовке,
 * если он есть в отрывке или сайт похож на сайт бренда. Только решение читать страницу: значения проверяются после чтения.
 */
export function titleNamesVariant(title: string, snippet: string, context: ProductLookupContext, brandSite: boolean): boolean {
  const found = tokens(title.split('|')[0]!);
  const name = variantTokens(context.name, context.brand);
  if (name.length === 0) return titleNamesProduct(title, context);
  if (namesOtherVariant(found, context) || !name.every((word) => containsToken(found, word))) return false;
  const brand = tokens(context.brand);
  if ([found, tokens(snippet)].some((text) => brand.every((word) => containsToken(text, word)))) return true;
  // Без бренда заголовок не должен называть ничего лишнего: «Simply Orange» на сайте Coca-Cola это не Coca-Cola Orange.
  const label = tokens(context.name);
  return brandSite && found.every((token) => GENERIC_STEMS.has(wordStem(token)) || /^\d/.test(token) || containsToken(label, token));
}

/**
 * Стоит ли читать страницу по её заголовку, когда штрихкода в выдаче нет. Часть после «|» не учитывается: там обычно имя сайта.
 * Отсекает явно другой вариант. Бренд известен: нужен он. Нет: нужны слова названия. Полное название при известном бренде не обязательно.
 */
export function titleRelevant(title: string, context: ProductLookupContext): boolean {
  const found = tokens(title.split('|')[0]!);
  const brand = tokens(context.brand);
  const name = variantTokens(context.name, context.brand);
  if (brand.length === 0 && name.length === 0) return true;
  if (namesOtherVariant(found, context)) return false;
  return (brand.length > 0 ? brand : name).every((word) => containsToken(found, word));
}

export const hasReferenceMacros = (context: ProductLookupContext): boolean => MACROS.filter((field) => context[field] !== null).length >= MIN_COMPARED_MACROS;

export interface IdentityFacts {
  readonly barcodeMatch: boolean;
  readonly brandMatch: boolean;
  readonly variantMatch: boolean;
  /** Страница называет другой вкус или версию. */
  readonly otherVariant: boolean;
  /** Вариант на странице не указан: кроме бренда и слов названия там ничего нет. */
  readonly variantSilent: boolean;
}

/** GTIN-8/UPC/EAN/GTIN-14 share the same zero-padded representation. */
export function normalizedBarcode(value: string | null): string | null {
  const digits = (value ?? '').trim().replace(/[\s-]/g, '');
  return /^(?:\d{8}|\d{12,14})$/.test(digits) ? digits.padStart(14, '0') : null;
}
export function identityFacts(page: ParsedPage, context: ProductLookupContext, barcode: string | null): IdentityFacts {
  const requested = normalizedBarcode(barcode);
  const codes = [...page.barcodes, ...(page.text.match(/(?<!\d)\d{8,14}(?!\d)/g) ?? [])];
  const barcodeMatch = requested !== null && codes.some(code => normalizedBarcode(code) === requested);
  const pageTokens = tokens(`${page.identityText} ${page.brand ?? ''}`);
  const brandWords = tokens(context.brand);
  const brandMatch = brandWords.length > 0 && brandWords.every((word) => containsToken(pageTokens, word));
  const variant = variantTokens(context.name, context.brand);
  const productTokens = tokens(`${page.productText} ${page.brand ?? ''}`);
  const nameWords = tokens(context.name);
  const extra = productTokens.filter((token) => !GENERIC_STEMS.has(wordStem(token)) && !/^\d/.test(token) && !containsToken(nameWords, token) && !containsToken(brandWords, token));
  return { barcodeMatch, brandMatch, variantMatch: nameWords.length > 0 && variant.every((word) => containsToken(productTokens, word)),
    otherVariant: namesOtherVariant(productTokens, context), variantSilent: extra.length === 0 };
}

/** Чем подтверждён товар на странице, которая одна может дать оценку. */
export type SoloIdentity = 'exact_barcode' | 'exact_name';

export interface PageVerdict {
  readonly status: Exclude<WebVerdictStatus, 'no_grounded_source' | 'unresolved_conflict' | 'budget_exhausted'>;
  readonly identityMatch: IdentityMatch | null;
  readonly reason: string;
  /** Страница не сильный источник: как подтверждённое значение она проходит только вместе со вторым независимым сайтом. */
  readonly needsSecondSource: boolean;
  /** Несильная страница с точным товаром и той же рецептурой: и без второго сайта даёт недостающее поле как оценку. */
  readonly solo?: SoloIdentity;
  readonly conflicts: MacroCheck['conflicts'];
}

const rejected = (status: PageVerdict['status'], reason: string, conflicts: MacroCheck['conflicts'] = []): PageVerdict =>
  ({ status, identityMatch: null, reason, needsSecondSource: false, conflicts });

/**
 * Товар на странице подтверждён настолько, что при совпавшей рецептуре ей хватит себя одной для оценки.
 * Штрихкод: страница про этот товар, а не список с кодом. Без штрихкода: бренд и слова, отличающие этот вариант. Домен здесь не участвует.
 */
function soloIdentity(page: ParsedPage, context: ProductLookupContext, facts: IdentityFacts, barcode: string | null, url: string): SoloIdentity | null {
  if (!facts.barcodeMatch) return facts.brandMatch && facts.variantMatch && variantTokens(context.name, context.brand).length > 0 ? 'exact_name' : null;
  const unnamed = tokens(context.brand).length === 0 && tokens(context.name).length === 0;
  return (unnamed || facts.brandMatch || facts.variantMatch) && !listsProducts(page, barcode, url) ? 'exact_barcode' : null;
}

const secondSource = (solo: SoloIdentity | null): PageVerdict => ({ status: 'accepted', identityMatch: 'two_sources', reason: solo ? `${solo}_single_source` : 'needs_second_source', needsSecondSource: true, ...(solo ? { solo } : {}), conflicts: [] });

/**
 * Сверить не с чем: нет ни этикетки, ни макросов из базы. Подходит только страница с этим штрихкодом и своими макросами:
 * производителя сама по себе, остальные лишь вместе со вторым независимым источником той же рецептуры.
 */
function verifyWithoutReference(page: ParsedPage, tier: SourceTier, facts: IdentityFacts, nameConfirmed: boolean): PageVerdict {
  if (MACROS.filter((field) => page.nutrition[field] !== null).length < MIN_COMPARED_MACROS) return rejected('insufficient_identity', 'too_few_macros_on_page');
  if (facts.otherVariant) return rejected('different_product_or_recipe', 'variant_mismatch');
  if (!facts.barcodeMatch) {
    // Штрихкод уже подтвердил название в выдаче, а официальная страница называет этот же товар.
    if (nameConfirmed && tier === 1 && facts.brandMatch && facts.variantMatch) return { status: 'accepted', identityMatch: 'official_variant', reason: 'official_page_barcode_confirmed_name', needsSecondSource: false, conflicts: [] };
    return rejected('insufficient_identity', 'no_reference_without_barcode');
  }
  if (tier === 1) return { status: 'accepted', identityMatch: 'exact_barcode', reason: 'manufacturer_page_with_barcode', needsSecondSource: false, conflicts: [] };
  return { status: 'accepted', identityMatch: 'two_sources', reason: 'needs_second_source', needsSecondSource: true, conflicts: [] };
}

/**
 * Решение по странице. Макросы проверяются первыми: даже точный штрихкод не спасает другую рецептуру.
 * Случай A: штрихкод и макросы. Случай B: сайт производителя, тот же вариант и макросы. Случай C: см. выбор значений.
 */
export function verifyPage(page: ParsedPage, tier: SourceTier, context: ProductLookupContext, barcode: string | null, url = ''): PageVerdict {
  const verdict = verifyRecipe(page, tier, context, barcode, url);
  // Принятая страница помнит поле, которое не сошлось: оно одно не участвует в выборе значений.
  return verdict.status === 'accepted' ? { ...verdict, conflicts: compareMacros(context, page.nutrition).conflicts } : verdict;
}

function verifyRecipe(page: ParsedPage, tier: SourceTier, context: ProductLookupContext, barcode: string | null, url: string): PageVerdict {
  if (!page.basis) return rejected('insufficient_identity', 'no_per_100_nutrition');
  if (page.malformed) return rejected('insufficient_identity', 'malformed_nutrition');
  const implausible = implausibleNutrition(page.nutrition);
  if (implausible) return rejected('insufficient_identity', `implausible_nutrition:${implausible}`);
  const macros = compareMacros(context, page.nutrition);
  const facts = identityFacts(page, context, barcode);
  if (!hasReferenceMacros(context)) return verifyWithoutReference(page, tier, facts, context.nameConfirmed === true);
  if (page.basis !== context.basis) return rejected('insufficient_identity', 'basis_mismatch');
  // Рецептуру различают белки, углеводы и жиры. Калории часто округлены или посчитаны иначе: одна эта строка не отменяет страницу.
  const recipeConflicts = macros.conflicts.filter((conflict) => conflict.field !== 'kcal');
  if (recipeConflicts.length > 0) {
    return facts.barcodeMatch ? rejected('recipe_version_conflict', 'barcode_matches_macros_differ', macros.conflicts)
      : rejected('different_product_or_recipe', 'macros_differ', macros.conflicts);
  }
  if (facts.otherVariant) return rejected('different_product_or_recipe', 'variant_mismatch');
  if (macros.compared < MIN_COMPARED_MACROS) {
    // Страница с частью таблицы тоже полезна: не спорит с рецептурой, но одна ничего не доказывает.
    return macros.compared > 0 && (facts.barcodeMatch || (facts.brandMatch && facts.variantMatch)) ? secondSource(null) : rejected('insufficient_identity', 'too_few_macros_to_compare');
  }
  const solo = soloIdentity(page, context, facts, barcode, url);
  if (tier === 4) {
    // Неизвестный домен не бывает сильным источником, но точный товар с той же рецептурой даёт оценку и без второго сайта.
    return facts.barcodeMatch || (facts.brandMatch && facts.variantMatch) ? secondSource(solo) : rejected('insufficient_identity', 'weak_source');
  }
  if (facts.barcodeMatch) return { status: 'accepted', identityMatch: 'exact_barcode', reason: 'exact_barcode_and_macros', needsSecondSource: false, conflicts: [] };
  if (!facts.brandMatch) return rejected('insufficient_identity', 'brand_mismatch');
  // Вариант на странице не указан: решают бренд и макросы, отсутствие слова само по себе не отказ.
  if (!facts.variantMatch && !facts.variantSilent) return rejected('insufficient_identity', 'variant_mismatch');
  if (tier === 1) return { status: 'accepted', identityMatch: 'official_variant', reason: 'official_page_variant_and_macros', needsSecondSource: false, conflicts: [] };
  return secondSource(solo);
}
