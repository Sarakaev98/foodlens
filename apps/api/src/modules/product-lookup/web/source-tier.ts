/** 1: сайт производителя или бренда; 2: крупный магазин или дистрибьютор; 3: базы продуктов; 4: всё остальное. */
export type SourceTier = 1 | 2 | 3 | 4;

/** Известные домены. Дополняются здесь: логика проверки от них не зависит. */
const MANUFACTURERS: readonly string[] = ['coca-cola.com', 'coca-cola.ru', 'coca-colacompany.com', 'rollton.ru', 'mars.com', 'snickers.com', 'snickers.ru', 'orionworld.com', 'orionworld.ru', 'orion.ru', 'nestle.com', 'nestle.ru', 'mondelezinternational.com', 'ferrero.com'];
const RETAILERS: readonly string[] = [
  'ozon.ru', 'wildberries.ru', 'vprok.ru', 'perekrestok.ru', 'lenta.com', 'auchan.ru', 'magnit.ru', 'metro-cc.ru', 'utkonos.ru', 'samokat.ru', 'okeydostavka.ru', 'megamarket.ru', 'vkusvill.ru', 'kuper.ru', 'sbermarket.ru', 'dixy.ru', 'igooods.ru',
  'tesco.com', 'carrefour.com', 'amazon.com', 'walmart.com', 'migros.com.tr', 'carrefoursa.com', 'goodwill.ge', 'carrefour.ge', 'nikora.ge',
];
const DATABASES: readonly string[] = ['openfoodfacts.org', 'fatsecret.com', 'fatsecret.ru', 'myfitnesspal.com', 'fddb.info', 'yazio.com', 'calorizator.ru', 'health-diet.ru', 'nutritionix.com'];
/** Слова SEO-страниц: такой домен не может быть официальным, даже если в нём есть название бренда. */
const SEO_WORDS = /calori|kalori|kaloriy|kbzhu|kbju|nutrition|nutri|diet|recipe|recept|review|otzyv|price|tsena|shop-|-shop|buy|info|wiki|blog/i;

function matchesDomain(domain: string, list: readonly string[]): boolean {
  return list.some((item) => domain === item || domain.endsWith(`.${item}`));
}

function brandTokens(brand: string | null): readonly string[] {
  return (brand ?? '').toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 4);
}

/**
 * Уровень доверия к источнику. Слова страницы о себе на него не влияют: только домен.
 * Бренд в домене даёт уровень 1 лишь для чистого домена вида snickers.de, а не для snickers-calories.ru.
 */
export function sourceTier(domain: string, brand: string | null): SourceTier {
  const host = domain.toLowerCase().replace(/^www\./, '');
  if (matchesDomain(host, MANUFACTURERS)) return 1;
  if (matchesDomain(host, RETAILERS)) return 2;
  if (matchesDomain(host, DATABASES)) return 3;
  const label = registrableDomain(host).split('.')[0] ?? '';
  const compact = (brand ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!SEO_WORDS.test(host) && (brandTokens(brand).includes(label) || (compact.length >= 4 && compact === label.replace(/-/g, '')))) return 1;
  return 4;
}

const LIST_URL = /[/?&](search|tag|tags|catalogsearch|q|s|text|query|category|categories|catalog|poisk|blog|news|article|articles|recipe|recipes|stati|novosti)(=|\/|$)/i;
const LIST_TITLE = /^\s*(поиск|результаты поиска|search results|каталог|категория|category)\b|proizvodi označeni|страница \d+/i;

/** Страница поиска, тега, каталога или статья: на ней нет одного конкретного товара. */
export function isListPage(url: string, title: string): boolean {
  let path = url;
  try {
    path = decodeURIComponent(url);
  } catch {
    // Адрес с битой кодировкой проверяется как есть.
  }
  return LIST_URL.test(path) || /поиск/i.test(path) || LIST_TITLE.test(title);
}

/** Домен самого бренда: из списка производителей или полное имя бренда. Часть имени (cola.com для Coca-Cola) не подходит. */
export function isManufacturerDomain(domain: string, brand: string | null): boolean {
  const host = domain.toLowerCase().replace(/^www\./, '');
  const compact = (brand ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return matchesDomain(host, MANUFACTURERS) || (compact.length >= 4 && !SEO_WORDS.test(host) && compact === (registrableDomain(host).split('.')[0] ?? '').replace(/-/g, ''));
}

/** Домен похож на сайт бренда: orionworld.ru для Orion. Только повод прочитать страницу, уровень доверия от этого не растёт. */
export function isBrandLikeDomain(domain: string, brand: string | null): boolean {
  const host = domain.toLowerCase().replace(/^www\./, '');
  const label = registrableDomain(host).split('.')[0] ?? '';
  return !SEO_WORDS.test(host) && brandTokens(brand).some((token) => label.includes(token));
}

/** Последние две части имени: разделы одного сайта не считаются независимыми источниками. */
export function registrableDomain(domain: string): string {
  const parts = domain.toLowerCase().replace(/^www\./, '').split('.');
  const secondLevel = ['com', 'co', 'org', 'net'].includes(parts.at(-2) ?? '') && parts.length > 2;
  return parts.slice(secondLevel ? -3 : -2).join('.');
}
