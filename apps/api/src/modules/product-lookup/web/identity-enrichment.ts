import type { DiscoveredSource } from '@foodlens/ai';
import type { ProductLookupContext } from '../product-lookup.provider';
import { nameAddition, nameSpan, nameWords } from './product-identity';
import { isListPage, registrableDomain, sourceTier } from './source-tier';

/** Сильный источник: производитель или крупный магазин. На решение не влияет, виден в журнале. */
const MAX_STRONG_TIER = 2;

/** provisional: только для поиска. confirmed: может заменить штрихкод на странице производителя. conflict: источники спорят. */
export type AliasState = 'provisional' | 'confirmed' | 'conflict';

export interface AliasStanding {
  readonly state: AliasState;
  /** Домен, который подтвердил название или вступил с ним в спор. */
  readonly by: string | null;
}

export interface NameEnrichment {
  readonly name: string;
  readonly addition: string;
  readonly domains: readonly string[];
  readonly reason: 'strong_source' | 'independent_sources' | 'single_barcode_result';
}

/** Штрихкод целиком: он не должен быть частью более длинного числа. */
export const barcodeInResult = (source: DiscoveredSource, barcode: string | null): boolean =>
  barcode !== null && new RegExp(`(?<!\\d)${barcode}(?!\\d)`).test(`${source.title} ${source.snippet ?? ''} ${source.url}`);

const IDENTITY_WINDOW = 120;
const LOG_WINDOW = 80;
const MAX_MATCHES = 3;

const barcodePattern = (barcode: string) => new RegExp(`(?<!\\d)${barcode}(?!\\d)`, 'g');
const around = (text: string, index: number, length: number, radius: number) => text.slice(Math.max(0, index - radius), index + length + radius).replace(/\s+/g, ' ').trim();

/** Название рядом со штрихкодом: если в тексте много товаров, только оно говорит, какой из них нужен. */
export function namesNearBarcode(text: string, barcode: string, context: ProductLookupContext): readonly string[] {
  return [...text.matchAll(barcodePattern(barcode))].slice(0, MAX_MATCHES).map((match) => nameSpan(around(text, match.index, barcode.length, IDENTITY_WINDOW), context)).filter((span) => span !== null);
}

/** Для журнала: короткие куски вокруг штрихкода и слов бренда. Весь текст в журнал не идёт. */
export function identityContext(text: string, barcode: string, context: ProductLookupContext): readonly string[] {
  const lower = text.toLowerCase();
  const word = nameWords(context.brand)[0] ?? nameWords(context.name)[0] ?? null;
  const at = word ? lower.indexOf(word) : -1;
  const found = [...text.matchAll(barcodePattern(barcode))].slice(0, MAX_MATCHES).map((match) => around(text, match.index, barcode.length, LOG_WINDOW));
  return [...new Set(at < 0 ? found : [...found, around(text, at, word!.length, LOG_WINDOW)])];
}

/** Вариант, который называет результат, если он один. */
function resultAddition(source: DiscoveredSource, barcode: string, context: ProductLookupContext): string | null {
  const snippet = source.snippet ?? '';
  const near = namesNearBarcode(snippet, barcode, context);
  // Отрывок из списка товаров: рядом со штрихкодом ответ точнее, чем по всему предложению.
  const pieces = [source.title.split('|')[0]!, ...(near.length > 0 ? near : snippet.split(/(?<=[.!?])\s+|\n/))];
  const additions = new Set(pieces.map((piece) => nameAddition(piece, context)).filter((word) => word !== null));
  const [addition] = additions;
  return additions.size === 1 && addition ? addition : null;
}

/**
 * Можно ли верить уточнённому названию настолько, чтобы принять значения без штрихкода на странице.
 * Слабый алиас (один результат вне сильных источников) требует второго результата с тем же брендом и вариантом с другого домена.
 * Страница, значения которой принимаются, сама себя не подтверждает. Другой вариант при точном штрихкоде значит спор.
 * witnesses: результаты запросов со штрихкодом. Результаты поиска по названию не считаются: они находят это название потому, что его искали.
 */
export function aliasState(enrichment: NameEnrichment, witnesses: readonly DiscoveredSource[], barcode: string, context: ProductLookupContext, pageDomain?: string): AliasStanding {
  const named = witnesses.map((source) => ({ source, word: resultAddition(source, barcode, context) }));
  const rival = named.find(({ source, word }) => word !== null && word !== enrichment.addition && barcodeInResult(source, barcode));
  if (rival) return { state: 'conflict', by: rival.source.domain };
  if (enrichment.reason !== 'single_barcode_result') return { state: 'confirmed', by: enrichment.domains.join(', ') };
  const second = named.find(({ source, word }) => word === enrichment.addition && !enrichment.domains.includes(registrableDomain(source.domain)) && registrableDomain(source.domain) !== (pageDomain && registrableDomain(pageDomain)));
  return second ? { state: 'confirmed', by: second.source.domain } : { state: 'provisional', by: null };
}

/**
 * База могла дать неполное название: «Coca Cola Orange» вместо «Coca-Cola Zero Orange».
 * Хватает одного результата с точным штрихкодом, если в нём есть бренд и слова названия из базы. Сайт может быть любым:
 * уточнение только для поиска и сверки. Из результата берётся одно известное слово варианта, значения и состав не берутся.
 * Разные варианты в результатах значат, что уточнения нет.
 */
export function enrichedName(sources: readonly DiscoveredSource[], barcode: string, context: ProductLookupContext): NameEnrichment | null {
  const found = new Map<string, { readonly domains: Set<string>; strong: boolean }>();
  for (const source of sources) {
    if (!barcodeInResult(source, barcode)) continue;
    const addition = resultAddition(source, barcode, context);
    if (!addition) continue;
    const item = found.get(addition) ?? { domains: new Set<string>(), strong: false };
    item.domains.add(registrableDomain(source.domain));
    item.strong ||= sourceTier(source.domain, context.brand) <= MAX_STRONG_TIER && !isListPage(source.url, source.title);
    found.set(addition, item);
  }
  const [first] = found;
  if (found.size !== 1 || !first) return null;
  const [addition, item] = first;
  const brand = new Set(nameWords(context.brand));
  const rest = nameWords(context.name).filter((word) => !brand.has(word));
  return { name: [context.brand, addition, ...rest].filter(Boolean).join(' '), addition, domains: [...item.domains], reason: item.strong ? 'strong_source' : item.domains.size > 1 ? 'independent_sources' : 'single_barcode_result' };
}
