const KJ_PER_KCAL = 4.184;
const MAX_RELEVANT_TEXT = 4000;
const MAX_GRAMS = 100;
const MAX_KCAL = 900;
const MAX_SODIUM_MG = 40_000;
/** Сумма весовых значений на 100 г или мл: запас на округление. */
const MAX_MASS_SUM = 105;
/** Сахара не больше углеводов, насыщенные жиры не больше жиров: запас на округление. */
const SUBSET_MARGIN = 0.5;
const MIN_FAT_WITH_SATURATES = 5;
/** Калории по макросам (Атвотер: 4, 4, 9). Запас большой: клетчатка и полиолы дают расхождение и в настоящей таблице. */
const KCAL_MARGIN = { relative: 0.35, absolute: 40 };
/** Шаблоны, не заполненные на странице: цифры рядом с ними не значения. */
const BROKEN_TEXT = /\{\{|\}\}|\$\{|%[a-z_]+%|\bNaN\b|\bundefined\b|\[object\b/i;

export interface PageNutrition {
  readonly kcal: number | null;
  readonly protein: number | null;
  readonly carbs: number | null;
  readonly fat: number | null;
  readonly sugars: number | null;
  readonly saturatedFat: number | null;
  readonly salt: number | null;
  readonly sodiumMg: number | null;
  readonly fiber: number | null;
}

export const EMPTY_NUTRITION: PageNutrition = { kcal: null, protein: null, carbs: null, fat: null, sugars: null, saturatedFat: null, salt: null, sodiumMg: null, fiber: null };

export type ExtractionMethod = 'json_ld' | 'embedded_json' | 'html' | 'ai';

export interface ParsedPage {
  /** Название, заголовок и бренд со страницы: для проверки, тот ли это продукт. */
  readonly identityText: string;
  /** То же без имени сайта после «|»: только эти слова говорят, какой это товар. */
  readonly productText: string;
  readonly brand: string | null;
  readonly barcodes: readonly string[];
  readonly basis: 'per_100g' | 'per_100ml' | null;
  readonly nutrition: PageNutrition;
  readonly method: ExtractionMethod | null;
  /** Строка состава со страницы: только из поля или секции, явно названных составом. */
  readonly ingredients: string | null;
  /** Секция состава есть, но в ней не состав. */
  readonly ingredientsIssue: 'not_ingredients_content' | null;
  /** Очищенный текст рядом с таблицей питания: только он может уйти на AI-извлечение. */
  readonly relevantText: string;
  /** Весь текст страницы: для поиска штрихкода и проверки чисел от AI. */
  readonly text: string;
  /** В таблице страницы есть отрицательное, невозможное или незаполненное значение. Такой странице нельзя верить целиком. */
  readonly malformed: boolean;
}

type Json = Record<string, unknown>;
const record = (value: unknown): value is Json => !!value && typeof value === 'object' && !Array.isArray(value);
const string = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);
const clean = (value: number | null, max: number): number | null => (value !== null && Number.isFinite(value) && value >= 0 && value <= max ? value : null);
const parseDecimal = (value: string): number => Number(value.replace(',', '.'));

function decodeEntities(text: string): string {
  return text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));
}

export function pageText(html: string): string {
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
  return decodeEntities(body.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Число с единицей из значения schema.org: "7,5 g", "2150 kJ", "200 mg". */
function quantity(value: unknown): { readonly amount: number; readonly unit: string } | null {
  if (typeof value === 'number') return { amount: value, unit: '' };
  const match = string(value)?.match(/^<?\s*(\d+(?:[.,]\d+)?)\s*([a-zа-я]*)/i);
  return match ? { amount: parseDecimal(match[1]!), unit: match[2]!.toLowerCase() } : null;
}

function grams(value: unknown): number | null {
  const parsed = quantity(value);
  if (!parsed) return null;
  if (parsed.unit === 'mg' || parsed.unit === 'мг') return clean(parsed.amount / 1000, MAX_GRAMS);
  return clean(parsed.amount, MAX_GRAMS);
}

function energyKcal(value: unknown): number | null {
  const parsed = quantity(value);
  if (!parsed) return null;
  const kj = parsed.unit === 'kj' || parsed.unit === 'кдж';
  return clean(kj ? Math.round(parsed.amount / KJ_PER_KCAL) : parsed.amount, MAX_KCAL);
}

function sodiumMg(value: unknown): number | null {
  const parsed = quantity(value);
  if (!parsed) return null;
  const milligrams = parsed.unit === 'mg' || parsed.unit === 'мг';
  return clean(milligrams ? parsed.amount : parsed.amount * 1000, MAX_SODIUM_MG);
}

/** Значение есть, но его нельзя принять: шаблон, минус или число вне возможных пределов. */
function brokenValue(value: unknown, parse: (value: unknown) => number | null): boolean {
  if (typeof value === 'string' && (BROKEN_TEXT.test(value) || value.trim() === 'null' || /^\s*[-−]\s*\d/.test(value))) return true;
  return quantity(value) !== null && parse(value) === null;
}

function jsonLdNodes(html: string): readonly Json[] {
  const nodes: Json[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (record(value)) {
      nodes.push(value);
      if (Array.isArray(value['@graph'])) value['@graph'].forEach(visit);
    }
  };
  for (const match of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      visit(JSON.parse(match[1]!));
    } catch {
      // Битый блок разметки не должен мешать разбору остальной страницы.
    }
  }
  return nodes;
}

const typeIs = (node: Json, type: string): boolean => (Array.isArray(node['@type']) ? node['@type'] : [node['@type']]).includes(type);

/** Основа и множитель до 100 г или мл. Порция пересчитывается, только если её размер указан в граммах или миллилитрах. */
function basisFromServing(value: unknown): { readonly basis: 'per_100g' | 'per_100ml'; readonly scale: number } | null {
  const parsed = quantity(value);
  if (!parsed || !(parsed.amount > 0)) return null;
  const basis = parsed.unit === 'ml' || parsed.unit === 'мл' ? 'per_100ml' : parsed.unit === 'g' || parsed.unit === 'г' || parsed.unit === 'гр' ? 'per_100g' : null;
  return basis ? { basis, scale: 100 / parsed.amount } : null;
}

function scaled(nutrition: PageNutrition, scale: number): PageNutrition {
  if (scale === 1) return nutrition;
  const value = (amount: number | null, max: number) => (amount === null ? null : clean(Math.round(amount * scale * 100) / 100, max));
  return { kcal: value(nutrition.kcal, MAX_KCAL), protein: value(nutrition.protein, MAX_GRAMS), carbs: value(nutrition.carbs, MAX_GRAMS), fat: value(nutrition.fat, MAX_GRAMS), sugars: value(nutrition.sugars, MAX_GRAMS),
    saturatedFat: value(nutrition.saturatedFat, MAX_GRAMS), salt: value(nutrition.salt, MAX_GRAMS), sodiumMg: value(nutrition.sodiumMg, MAX_SODIUM_MG), fiber: value(nutrition.fiber, MAX_GRAMS) };
}

function fromJsonLd(html: string): Pick<ParsedPage, 'brand' | 'barcodes' | 'basis' | 'nutrition' | 'malformed' | 'ingredients'> & { readonly name: string | null } | null {
  const product = jsonLdNodes(html).find((node) => typeIs(node, 'Product'));
  if (!product) return null;
  const brand = record(product.brand) ? string(product.brand.name) : string(product.brand);
  const barcodes = ['gtin13', 'gtin', 'gtin12', 'gtin8', 'gtin14'].flatMap((key) => {
    const value = string(product[key]) ?? (typeof product[key] === 'number' ? String(product[key]) : null);
    return value ? [value] : [];
  });
  const info = record(product.nutrition) ? product.nutrition : null;
  const serving = info ? basisFromServing(info.servingSize) : null;
  const basis = serving?.basis ?? null;
  const nutrition: PageNutrition = info && serving ? scaled({
    kcal: energyKcal(info.calories), protein: grams(info.proteinContent), carbs: grams(info.carbohydrateContent), fat: grams(info.fatContent),
    sugars: grams(info.sugarContent), saturatedFat: grams(info.saturatedFatContent), fiber: grams(info.fiberContent), salt: null, sodiumMg: sodiumMg(info.sodiumContent),
  }, serving.scale) : EMPTY_NUTRITION;
  const broken = info !== null && ([[info.calories, energyKcal], [info.sodiumContent, sodiumMg], ...[info.proteinContent, info.carbohydrateContent, info.fatContent, info.sugarContent, info.saturatedFatContent, info.fiberContent].map((value) => [value, grams] as const)] as const)
    .some(([value, parse]) => brokenValue(value, parse));
  const listed = product.ingredients ?? product.recipeIngredient;
  return { name: string(product.name), brand, barcodes, basis, nutrition, malformed: broken, ingredients: ingredientValue(Array.isArray(listed) ? listed.filter((item) => typeof item === 'string').join(', ') : listed) };
}

const EMBEDDED_FIELDS: readonly (readonly [keyof PageNutrition, RegExp])[] = [
  ['kcal', /^(energykcal|kcal|calories|ккал|калорийность)/], ['saturatedFat', /^(saturatedfat|saturates|насыщенн)/],
  ['sugars', /^(sugars?|сахар)/], ['fiber', /^(fib(er|re)|клетчатк|пищевыеволокна)/], ['protein', /^(proteins?|белк|белок)/],
  ['carbs', /^(carbohydrates?|carbs|углевод)/], ['fat', /^(fats?|жиры?)$/], ['salt', /^(salt|соль)/],
];
const BARCODE_KEY = /^(gtin(13|14|12|8)?|ean(13)?|barcode|штрихкод)$/;
const MAX_EMBEDDED_NODES = 50_000;
const embeddedKey = (key: string): string => key.toLowerCase().replace(/[^a-zа-яё0-9]/g, '').replace(/(per)?100(g|ml)$/, '');

/** Список вида [{name: 'Белки', value: 7.5}] приводится к объекту с такими же ключами, как у обычной таблицы. */
function nutrientMap(node: Json | readonly unknown[]): Json {
  if (!Array.isArray(node)) return node as Json;
  const entries = node.filter(record).flatMap((item) => {
    const name = string(item.name) ?? string(item.title) ?? string(item.label);
    return name && (item.value ?? item.amount) !== undefined ? [[name, item.value ?? item.amount] as const] : [];
  });
  return Object.fromEntries(entries);
}

function embeddedBasis(node: Json | readonly unknown[], source: Json): 'per_100g' | 'per_100ml' | null {
  const keys = Object.keys(source).join(' ').toLowerCase();
  if (/100_?ml/.test(keys)) return 'per_100ml';
  if (/100_?g/.test(keys)) return 'per_100g';
  const text = Object.values(node).filter((value) => typeof value === 'string').join(' ');
  const marker = /100\s*(г|гр|g|мл|ml)(?![a-zа-я])/i.exec(text);
  return !marker ? null : marker[1]!.toLowerCase() === 'мл' || marker[1]!.toLowerCase() === 'ml' ? 'per_100ml' : 'per_100g';
}

/**
 * Данные о товаре внутри страницы (например, __NEXT_DATA__). Основа «на 100» должна быть указана явно.
 * Если таблиц несколько, это могут быть соседние товары: тогда блок не используется.
 */
function fromEmbeddedJson(html: string): Pick<ParsedPage, 'barcodes' | 'basis' | 'nutrition' | 'malformed'> | null {
  const found: { readonly barcodes: readonly string[]; readonly basis: 'per_100g' | 'per_100ml'; readonly nutrition: PageNutrition; readonly malformed: boolean }[] = [];
  let visited = 0;
  const barcodesOf = (node: unknown): readonly string[] => (!record(node) ? [] : Object.entries(node).flatMap(([key, value]) =>
    (BARCODE_KEY.test(embeddedKey(key)) && /^\d{8,14}$/.test(String(value)) ? [String(value)] : [])));
  const visit = (node: unknown, parent: unknown, depth: number): void => {
    if (!node || typeof node !== 'object' || depth > 30 || ++visited > MAX_EMBEDDED_NODES) return;
    const source = nutrientMap(node as Json);
    const values = Object.entries(source).filter(([, value]) => typeof value === 'number' || typeof value === 'string');
    const take = (field: keyof PageNutrition): unknown => {
      const pattern = EMBEDDED_FIELDS.find(([name]) => name === field)![1];
      return values.find(([key]) => pattern.test(embeddedKey(key)))?.[1];
    };
    const nutrition: PageNutrition = { ...EMPTY_NUTRITION, kcal: energyKcal(take('kcal')), protein: grams(take('protein')), carbs: grams(take('carbs')), fat: grams(take('fat')),
      sugars: grams(take('sugars')), saturatedFat: grams(take('saturatedFat')), fiber: grams(take('fiber')), salt: grams(take('salt')) };
    const malformed = brokenValue(take('kcal'), energyKcal) || (['protein', 'carbs', 'fat', 'sugars', 'saturatedFat', 'fiber', 'salt'] as const).some((field) => brokenValue(take(field), grams));
    const macros = [nutrition.kcal, nutrition.protein, nutrition.carbs, nutrition.fat].filter((value) => value !== null).length;
    const basis = macros >= 3 ? embeddedBasis(node as Json, source) ?? (record(parent) ? embeddedBasis(parent, parent) : null) : null;
    if (basis) found.push({ basis, nutrition, malformed, barcodes: [...barcodesOf(node), ...barcodesOf(parent)] });
    else Object.values(node).forEach((child) => visit(child, node, depth + 1));
  };
  for (const match of html.matchAll(/<script[^>]*(?:application\/json|__NEXT_DATA__)[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      visit(JSON.parse(match[1]!), null, 0);
    } catch {
      // Служебный JSON страницы часто бывает не про товар или битый: разбор идёт дальше.
    }
  }
  const [first] = found;
  return first && found.every((item) => JSON.stringify(item.nutrition) === JSON.stringify(first.nutrition)) ? first : null;
}

const NUMBER = String.raw`(\d+(?:[.,]\d+)?)`;
const GAP = String.raw`[^\d%]{0,30}?`;
/** Единица обязательна: «сахар 12%» из состава значением не считается. */
const GRAM_UNIT = String.raw`\s*(?:г|гр|g)(?![a-zа-я])`;
const PER_100 = /(?:на|в|per|\/)\s*100\s*(г|гр|g|мл|ml)(?![a-zа-я])/i;
/** Порция с указанным размером: «на порцию (40 г)». Без размера значения нельзя сравнить с «на 100 г». */
const PER_SERVING = /(?:на\s+порцию|per\s+serving|порция)\s*[(:]?\s*(\d+(?:[.,]\d+)?)\s*(г|гр|g|мл|ml)(?![a-zа-я])/i;

function matchGrams(text: string, label: string): { readonly value: number; readonly negative: boolean; readonly start: number; readonly end: number } | null {
  // Единица после числа («белки 7,5 г») или в заголовке строки таблицы («Белки, г 7,5»).
  const match = new RegExp(`(?:${label})${GAP}<?\\s*${NUMBER}${GRAM_UNIT}`, 'iu').exec(text) ??
    new RegExp(`(?:${label})\\s*[,(]\\s*(?:г|гр|g)\\s*\\)?[:\\s]*<?\\s*${NUMBER}(?!\\s*%)`, 'iu').exec(text);
  if (!match) return null;
  // Минус вплотную к числу. «Белки - 7,5 г» с пробелом это просто тире.
  const negative = /\s[-−]$/.test(match[0].slice(0, match[0].lastIndexOf(match[1]!)));
  return { value: parseDecimal(match[1]!), negative, start: match.index, end: match.index + match[0].length };
}

/** Таблица или строка «на 100 г»: берётся окно рядом с этой пометкой, чтобы не попасть в состав и описание. */
function fromText(text: string): { readonly basis: 'per_100g' | 'per_100ml' | null; readonly nutrition: PageNutrition; readonly window: string; readonly malformed: boolean } {
  const per100 = PER_100.exec(text);
  const marker = per100 ?? PER_SERVING.exec(text);
  if (!marker) return { basis: null, nutrition: EMPTY_NUTRITION, window: '', malformed: false };
  const window = text.slice(Math.max(0, marker.index - 250), marker.index + 900);
  const unit = (per100 ? marker[1]! : marker[2]!).toLowerCase();
  const scale = per100 ? 1 : 100 / parseDecimal(marker[1]!);
  let rest = window;
  let malformed = BROKEN_TEXT.test(window);
  const take = (label: string): number | null => {
    const found = matchGrams(rest, label);
    if (!found) return null;
    malformed ||= found.negative || found.value > MAX_GRAMS;
    // Найденное значение убирается: «насыщенные жиры» не должны попасть в «жиры», а «сахара» в «углеводы».
    rest = `${rest.slice(0, found.start)} ${rest.slice(found.end)}`;
    return clean(found.value, MAX_GRAMS);
  };
  const saturatedFat = take(String.raw`(?:в\s*т\.?\s*ч\.?\s*)?насыщенн\p{L}*(?:\s+жир\p{L}*)?(?:\s+кислот\p{L}*)?|of\s+which\s+saturates|saturates|saturated\s+fat`);
  const sugars = take(String.raw`(?:в\s*т\.?\s*ч\.?\s*)?(?:из\s+них\s+)?сахар\p{L}*|of\s+which\s+sugars|sugars?`);
  const fiber = take(String.raw`пищев\p{L}*\s+волокн\p{L}*|клетчатк\p{L}*|fib(?:re|er)`);
  const salt = take(String.raw`соль|salt`);
  const protein = take(String.raw`белк\p{L}*|белок|proteins?`);
  const carbs = take(String.raw`углевод\p{L}*|carbohydrates?`);
  const fat = take(String.raw`жир\p{L}*|(?:total\s+)?fat`);
  // «100 ккал» часто служебная строка таблицы, а не калорийность: берётся, только если другого числа нет.
  const kcalValues = [...window.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:ккал|kcal)/giu)];
  const kcalMatch = kcalValues.find((match) => parseDecimal(match[1]!) !== 100) ?? kcalValues[0] ?? null;
  const kjMatch = /(\d+(?:[.,]\d+)?)\s*(?:кдж|kj)/iu.exec(window);
  malformed ||= kcalMatch !== null && parseDecimal(kcalMatch[1]!) > MAX_KCAL;
  const kcal = kcalMatch ? clean(parseDecimal(kcalMatch[1]!), MAX_KCAL) : kjMatch ? clean(Math.round(parseDecimal(kjMatch[1]!) / KJ_PER_KCAL), MAX_KCAL) : null;
  const sodium = new RegExp(String.raw`(?:натри\p{L}*|sodium)${GAP}${NUMBER}\s*(мг|mg|г|g)(?![a-zа-я])`, 'iu').exec(window);
  const milligrams = sodium ? (sodium[2]!.toLowerCase() === 'мг' || sodium[2]!.toLowerCase() === 'mg' ? parseDecimal(sodium[1]!) : parseDecimal(sodium[1]!) * 1000) : null;
  return {
    basis: unit === 'мл' || unit === 'ml' ? 'per_100ml' : 'per_100g',
    nutrition: scaled({ kcal, protein, carbs, fat, sugars, saturatedFat, salt, sodiumMg: clean(milligrams, MAX_SODIUM_MG), fiber }, scale),
    window,
    malformed,
  };
}

/** Значения, которых не бывает на 100 г или мл, в том числе от AI. null: явных противоречий нет. */
export function implausibleNutrition({ kcal, protein, carbs, fat, sugars, saturatedFat, salt, fiber }: PageNutrition): string | null {
  if ([protein, carbs, fat, salt, fiber].reduce<number>((sum, value) => sum + (value ?? 0), 0) > MAX_MASS_SUM) return 'mass_over_100';
  if (sugars !== null && carbs !== null && sugars > carbs + SUBSET_MARGIN) return 'sugars_over_carbs';
  if (saturatedFat !== null && fat !== null && saturatedFat > fat + SUBSET_MARGIN) return 'saturated_fat_over_fat';
  // Заполнитель базы вместо значения: жирный продукт без насыщенных жиров не бывает.
  if (saturatedFat === 0 && fat !== null && fat >= MIN_FAT_WITH_SATURATES) return 'zero_saturated_fat';
  if (kcal === null || protein === null || carbs === null || fat === null) return null;
  const expected = 4 * protein + 4 * carbs + 9 * fat;
  return Math.abs(kcal - expected) > Math.max(KCAL_MARGIN.absolute, KCAL_MARGIN.relative * Math.max(kcal, expected)) ? 'kcal_differs_from_macros' : null;
}

const hasValues = (nutrition: PageNutrition): boolean => Object.values(nutrition).some((value) => value !== null);

/** Текст для AI: окно с таблицей, иначе фрагмент вокруг слов о питании. Огромный HTML не отправляется. */
function relevantFragment(text: string, window: string): string {
  if (window) return window.slice(0, MAX_RELEVANT_TEXT);
  const hit = text.search(/пищев\p{L}*\s+ценност|энергетическ\p{L}*\s+ценност|калорийност|nutrition|белк\p{L}*|protein/iu);
  return hit < 0 ? '' : text.slice(Math.max(0, hit - 300), hit + MAX_RELEVANT_TEXT - 300);
}

const INGREDIENT_HEADING = String.raw`(?:ингредиенты|состав\s+продукта|состав|ingredient\s+list|ingredients\s+list|ingredients|composition|içindekiler|შემადგენლობა)`;
const WORD_START = String.raw`(?<![\p{L}\p{N}])`;
const WORD_END = String.raw`(?![\p{L}\p{N}])`;
const SECTION_END = String.raw`\.\s|\.$|пищевая ценность|энергетическая ценность|nutrition|может содержать|условия хранения|срок годности|хранить|характеристики|описание|производитель`;
/** «Состав: мука, соль». Слово должно быть целым: «в составе (фрукты, овощи)» подписью не считается. */
const INGREDIENTS_LABEL = new RegExp(`${WORD_START}${INGREDIENT_HEADING}${WORD_END}\\s*[*_]*\\s*[:：—–-]\\s*[*_]*\\s*(.{1,800})`, 'giu');
/** Элемент, весь текст которого это заголовок: дальше идёт секция. Ссылки и кнопки это меню, а не заголовки. */
const INGREDIENTS_ELEMENT = new RegExp(`<(?!a\\b|button\\b|option\\b|li\\b)([a-z0-9]+)(?:\\s[^>]*)?>\\s*${INGREDIENT_HEADING}\\s*:?\\s*</\\1>`, 'giu');
/** Текст из Tavily extract приходит в markdown: заголовок или строка таблицы. */
const INGREDIENTS_MARKDOWN = new RegExp(`^\\s*(?:#{1,6}\\s*|\\|\\s*|\\*\\*)${INGREDIENT_HEADING}${WORD_END}\\s*:?\\s*(?:\\*\\*)?\\s*\\|?\\s*([^\\n#][^\\n]*)`, 'gimu');
const NOT_A_LABEL_BEFORE = /(?:^|[\s(])(?:в|во|на|о|об|по|из|для|и|их|наш|ваш|in|of|the|our|your|see)\s*$/iu;
const NO_INGREDIENTS = /нет данных|не указан|отсутству|no data|not available|добавить|заполнить|неполн/i;
const NOT_A_LIST_START = /^(и|или|and|or|of|the|на|для)\s/i;
/** Обрывок вроде «е (фрукты, овощи)»: одна буква в начале, знак вместо слова, слово «состав» внутри самого списка. */
const NOT_A_LIST_PART = /^\p{L}[\s(]|^[^\p{L}\p{N}]|ингредиент|ingredient|состав\p{L}*|composition/iu;
const MIN_LIST_PARTS = 2;
const MIN_PART_LETTERS = 2;
const AFTER_HEADING = 4000;
const EMBEDDED_INGREDIENTS_KEY = /^(ingredients?|ingredientstext|ingredientlist|composition|sostav|состав|ингредиенты)$/;
const MAX_INGREDIENTS_TEXT = 4000;
const INGREDIENTS_WINDOW = 1500;

/** Вторая линия защиты: похоже ли содержимое на перечисление. Первая: текст берётся только из поля или секции состава. */
function ingredientValue(value: unknown): string | null {
  const text = string(value)?.replace(/\s+/g, ' ');
  if (!text || NO_INGREDIENTS.test(text) || BROKEN_TEXT.test(text) || NOT_A_LIST_START.test(text) || NOT_A_LIST_PART.test(text)) return null;
  if (text.split('(').length !== text.split(')').length) return null;
  const parts = text.split(/[,;]/).map((part) => part.replace(/[^\p{L}]/gu, ''));
  return parts.length >= MIN_LIST_PARTS && parts.every((part) => part.length >= MIN_PART_LETTERS) ? text : null;
}

const cutSection = (text: string): string => text.split(new RegExp(SECTION_END, 'iu'))[0]!.trim();

/** Текст секции после заголовка: до конца блока или следующего заголовка. */
function blockAfter(html: string, index: number): string {
  const rest = html.slice(index, index + AFTER_HEADING).replace(/^(?:\s*<\/[^>]+>)+/, '');
  const end = rest.search(/<\/(?:p|div|td|dd|section|ul|ol)>|<h[1-6]\b/i);
  return pageText(end < 0 ? rest : rest.slice(0, end));
}

/** Секции, явно названные составом, по порядку надёжности. Текста без такого заголовка здесь не бывает. */
function ingredientsSections(html: string, text: string): readonly string[] {
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const elements = [...body.matchAll(INGREDIENTS_ELEMENT)].map((match) => blockAfter(body, match.index + match[0].length));
  const markdown = [...html.matchAll(INGREDIENTS_MARKDOWN)].map((match) => pageText(match[1]!.replace(/\|\s*$/, '')));
  const labels = [...text.matchAll(INGREDIENTS_LABEL)].filter((match) => !NOT_A_LABEL_BEFORE.test(text.slice(Math.max(0, match.index - 12), match.index))).map((match) => match[1]!);
  return [...elements, ...markdown, ...labels].map(cutSection).filter(Boolean);
}

/** Состав в данных страницы. Если вариантов несколько, это могут быть соседние товары: тогда он не используется. */
function embeddedIngredients(html: string): string | null {
  const found = new Set<string>();
  let visited = 0;
  const visit = (node: unknown, depth: number): void => {
    if (!node || typeof node !== 'object' || depth > 30 || ++visited > MAX_EMBEDDED_NODES) return;
    for (const [key, value] of Object.entries(node)) {
      const text = EMBEDDED_INGREDIENTS_KEY.test(embeddedKey(key)) ? ingredientValue(value) : null;
      if (text) found.add(text);
      else visit(value, depth + 1);
    }
  };
  for (const match of html.matchAll(/<script[^>]*(?:application\/json|__NEXT_DATA__)[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      visit(JSON.parse(match[1]!), 0);
    } catch {
      // Служебный JSON страницы часто бывает не про товар или битый: разбор идёт дальше.
    }
  }
  const [first] = found;
  return found.size === 1 && first ? first : null;
}

const headingAt = (text: string): number => text.search(new RegExp(`${WORD_START}${INGREDIENT_HEADING}${WORD_END}`, 'iu'));

const INGREDIENTS_MARK = new RegExp(`${WORD_START}(?:состав|ингредиенты|ingredients)\\s*:`, 'giu');

/** Метка состава в отрывке выдачи: повод прочитать страницу раньше других. Сам отрывок составом не становится. */
export const hasIngredientsMark = (text: string): boolean =>
  [...text.matchAll(INGREDIENTS_MARK)].some((match) => !NOT_A_LABEL_BEFORE.test(text.slice(Math.max(0, match.index - 12), match.index)));

/** Есть ли на странице слово «состав» целиком: без него незачем спрашивать AI. */
export const mentionsIngredients = (text: string): boolean => headingAt(text) >= 0;

/** Текст для AI: рядом с первым упоминанием состава. Вся страница не отправляется. */
export function ingredientsFragment(text: string): string {
  const hit = headingAt(text);
  return hit < 0 ? '' : text.slice(Math.max(0, hit - 100), hit + INGREDIENTS_WINDOW).slice(0, MAX_INGREDIENTS_TEXT);
}

/** Состав от AI считается, только если каждая его часть напечатана после заголовка состава: придуманное отменяет ответ целиком. */
export function printedIngredients(value: string | null, text: string): string | null {
  const plain = (part: string) => part.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
  const hit = headingAt(text);
  const valid = ingredientValue(value);
  if (hit < 0 || !valid) return null;
  const page = plain(text.slice(hit));
  return valid.split(/[,;]/).map(plain).filter(Boolean).every((part) => page.includes(part)) ? valid : null;
}

/** Сначала разметка schema.org, затем данные товара в JSON страницы, затем текст таблицы. Значения берутся как есть, без подсчётов. */
export function parsePage(html: string): ParsedPage {
  const text = pageText(html);
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const heading = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
  const structured = fromJsonLd(html);
  const table = fromText(text);
  const useStructured = structured !== null && structured.basis !== null && hasValues(structured.nutrition);
  const embedded = useStructured ? null : fromEmbeddedJson(html);
  const nutrition = useStructured ? structured.nutrition : embedded?.nutrition ?? table.nutrition;
  const relevantText = relevantFragment(text, table.window);
  const fielded = structured?.ingredients ?? embeddedIngredients(html);
  const sections = fielded ? [] : ingredientsSections(html, text);
  const ingredients = fielded ?? sections.map(ingredientValue).find((value) => value !== null) ?? null;
  const identityText = [structured?.name, title, heading].filter(Boolean).map((part) => pageText(part!)).join(' ');
  return {
    identityText,
    productText: [structured?.name, title?.split('|')[0], heading].filter(Boolean).map((part) => pageText(part!)).join(' '),
    brand: structured?.brand ?? null,
    barcodes: [...new Set([...(structured?.barcodes ?? []), ...(embedded?.barcodes ?? [])])],
    basis: useStructured ? structured.basis : embedded?.basis ?? table.basis,
    nutrition,
    method: useStructured ? 'json_ld' : embedded ? 'embedded_json' : hasValues(table.nutrition) ? 'html' : null,
    ingredients,
    ingredientsIssue: ingredients === null && sections.length > 0 ? 'not_ingredients_content' : null,
    relevantText,
    text,
    malformed: BROKEN_TEXT.test(relevantText) || (useStructured ? structured.malformed : embedded ? embedded.malformed : table.malformed),
  };
}

/** Значение от AI считается, только если это число есть в тексте страницы: выдуманное отбрасывается. */
export function printedOnPage(value: number | null, text: string): number | null {
  if (value === null) return null;
  const plain = String(value);
  const pattern = new RegExp(`(?<![\\d.,])${plain.replace('.', '[.,]')}(?:[.,]0+)?(?!\\d|[.,]\\d)`);
  return pattern.test(text) ? value : null;
}
