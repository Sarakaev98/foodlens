import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isPrivateAddress, PageFetcher, PageFetchError, type PageFetchErrorCode } from '../web/page-fetcher';
import { parsePage, printedOnPage } from '../web/page-nutrition';
import { compareMacros, identityFacts, valuesAgree, variantTokens, wordStem } from '../web/product-identity';
import { registrableDomain, sourceTier } from '../web/source-tier';
import type { ProductLookupContext } from '../product-lookup.provider';

// Все ответы подставные: тесты не выходят в сеть и не обращаются к DNS.
const html = (body = '<p>ok</p>', headers: Record<string, string> = {}, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });
function fetcher(answers: Record<string, () => Response>, resolve: (host: string) => Promise<readonly string[]> = async () => ['93.184.216.34'], options: { maxBytes?: number; timeoutMs?: number } = {}) {
  const urls: string[] = [];
  const headers: Headers[] = [];
  const transport = (async (url: unknown, init: RequestInit) => {
    urls.push(String(url));
    headers.push(new Headers(init.headers));
    const answer = answers[String(url)];
    if (!answer) throw new Error('unexpected url');
    return answer();
  }) as typeof fetch;
  return { pages: new PageFetcher({ userAgent: 'FoodLens/0.1.0 (unit)', fetch: transport, resolve, ...options }), urls, headers };
}
const failsWith = (code: PageFetchErrorCode) => (error: unknown) => error instanceof PageFetchError && error.code === code;

describe('Page fetcher', () => {
  it('reads a public page and sends a proper User-Agent', async () => {
    const { pages, headers } = fetcher({ 'https://shop.example/p': () => html('<h1>Товар</h1>') });
    const page = await pages.fetchPage('https://shop.example/p');
    assert.equal(page.body, '<h1>Товар</h1>');
    assert.equal(page.domain, 'shop.example');
    assert.equal(page.contentType, 'text/html');
    assert.equal(headers[0]!.get('user-agent'), 'FoodLens/0.1.0 (unit)');
  });
  it('follows redirects and reports the final URL and domain', async () => {
    const { pages, urls } = fetcher({
      'https://vertexaisearch.example/r/abc': () => new Response(null, { status: 302, headers: { location: 'https://www.brand.example/product' } }),
      'https://www.brand.example/product': () => html(),
    });
    const page = await pages.fetchPage('https://vertexaisearch.example/r/abc');
    assert.equal(page.finalUrl, 'https://www.brand.example/product');
    assert.equal(page.domain, 'brand.example');
    assert.equal(urls.length, 2);
  });
  it('blocks private addresses in the URL itself, before any request', async () => {
    for (const url of ['http://127.0.0.1/', 'http://localhost/', 'http://192.168.31.187:3000/', 'http://10.0.0.1/', 'http://169.254.169.254/latest', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://2130706433/', 'http://intranet/', 'http://app.internal/']) {
      const { pages, urls } = fetcher({});
      await assert.rejects(pages.fetchPage(url), failsWith('blocked_url'), url);
      assert.equal(urls.length, 0, url);
    }
  });
  it('blocks other schemes and URLs with credentials', async () => {
    for (const url of ['file:///etc/passwd', 'ftp://shop.example/', 'https://user:secret@shop.example/', 'not a url']) await assert.rejects(fetcher({}).pages.fetchPage(url), failsWith('blocked_url'), url);
  });
  it('blocks a public name that resolves to a private address', async () => {
    const { pages, urls } = fetcher({}, async () => ['93.184.216.34', '10.1.2.3']);
    await assert.rejects(pages.fetchPage('https://rebind.example/'), failsWith('blocked_url'));
    assert.equal(urls.length, 0);
  });
  it('a redirect to a private address is blocked on that hop', async () => {
    const { pages, urls } = fetcher({ 'https://shop.example/p': () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } }) });
    await assert.rejects(pages.fetchPage('https://shop.example/p'), failsWith('blocked_url'));
    assert.equal(urls.length, 1);
  });
  it('stops an endless redirect chain', async () => {
    const { pages, urls } = fetcher({ 'https://shop.example/p': () => new Response(null, { status: 302, headers: { location: '/p' } }) });
    await assert.rejects(pages.fetchPage('https://shop.example/p'), failsWith('too_many_redirects'));
    assert.equal(urls.length, 6);
  });
  it('accepts only HTML and JSON-LD', async () => {
    for (const type of ['application/pdf', 'image/png', 'application/json', 'text/plain']) {
      const { pages } = fetcher({ 'https://shop.example/p': () => html('x', { 'content-type': type }) });
      await assert.rejects(pages.fetchPage('https://shop.example/p'), failsWith('bad_content_type'), type);
    }
    const { pages } = fetcher({ 'https://shop.example/p': () => html('{}', { 'content-type': 'application/ld+json' }) });
    assert.equal((await pages.fetchPage('https://shop.example/p')).contentType, 'application/ld+json');
  });
  it('stops at the size limit, by the header and while streaming', async () => {
    const declared = fetcher({ 'https://shop.example/p': () => html('x', { 'content-length': '999999' }) }, undefined, { maxBytes: 10 });
    await assert.rejects(declared.pages.fetchPage('https://shop.example/p'), failsWith('too_large'));
    const streamed = fetcher({ 'https://shop.example/p': () => html('x'.repeat(100)) }, undefined, { maxBytes: 10 });
    await assert.rejects(streamed.pages.fetchPage('https://shop.example/p'), failsWith('too_large'));
  });
  it('an HTTP error or a dead server is a typed failure', async () => {
    await assert.rejects(fetcher({ 'https://shop.example/p': () => html('no', {}, 404) }).pages.fetchPage('https://shop.example/p'), failsWith('http_error'));
    await assert.rejects(fetcher({}).pages.fetchPage('https://shop.example/p'), failsWith('unavailable'));
    await assert.rejects(fetcher({}, async () => { throw new Error('dns'); }).pages.fetchPage('https://shop.example/p'), failsWith('unavailable'));
  });
  it('a slow server hits the timeout', async () => {
    const transport = ((_: unknown, init: RequestInit) => new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(new Error('aborted'))))) as typeof fetch;
    const pages = new PageFetcher({ userAgent: 'u', fetch: transport, resolve: async () => ['93.184.216.34'], timeoutMs: 5 });
    // Таймер AbortSignal не держит процесс живым: настоящий fetch держит, а подставной нет.
    const keepAlive = setTimeout(() => undefined, 1000);
    await assert.rejects(pages.fetchPage('https://shop.example/p'), failsWith('unavailable'));
    clearTimeout(keepAlive);
  });
  it('address classifier', () => {
    for (const ip of ['127.0.0.1', '10.2.3.4', '172.16.0.1', '172.31.255.1', '192.168.0.1', '169.254.1.1', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::', '::1', 'fc00::1', 'fd12::1', 'fe80::1', 'ff02::1', '::ffff:10.0.0.1', '::ffff:7f00:1']) assert.equal(isPrivateAddress(ip), true, ip);
    for (const ip of ['8.8.8.8', '172.32.0.1', '100.128.0.1', '2a00:1450:4001::1', '::ffff:808:808']) assert.equal(isPrivateAddress(ip), false, ip);
  });
});

describe('Page extraction without AI', () => {
  const jsonLd = (nutrition: unknown, product: Record<string, unknown> = {}) => `<html><head><title>Страница</title><script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@graph': [{ '@type': 'BreadcrumbList' }, { '@type': 'Product', name: 'Snickers лесной орех', brand: { '@type': 'Brand', name: 'Snickers' }, gtin13: '4011100000000', nutrition, ...product }],
  })}</script></head><body>Купить</body></html>`;

  it('8. JSON-LD Product with NutritionInformation, inside @graph', () => {
    const page = parsePage(jsonLd({ '@type': 'NutritionInformation', servingSize: '100 g', calories: '514 kcal', proteinContent: '7.5 g', carbohydrateContent: '56 g', sugarContent: '48 g', fatContent: '28,6 g', saturatedFatContent: '10 g', fiberContent: '3 g', sodiumContent: '200 mg' }));
    assert.equal(page.method, 'json_ld');
    assert.equal(page.basis, 'per_100g');
    assert.deepEqual(page.barcodes, ['4011100000000']);
    assert.equal(page.brand, 'Snickers');
    assert.deepEqual(page.nutrition, { kcal: 514, protein: 7.5, carbs: 56, fat: 28.6, sugars: 48, saturatedFat: 10, fiber: 3, salt: null, sodiumMg: 200 });
    assert.ok(page.identityText.includes('лесной орех'));
  });
  it('JSON-LD: kJ to kcal, sodium in grams', () => {
    const page = parsePage(jsonLd({ servingSize: '100 g', calories: '2150 kJ', sodiumContent: '0.2 g' }));
    assert.equal(page.nutrition.kcal, 514);
    assert.equal(page.nutrition.sodiumMg, 200);
  });
  it('JSON-LD per serving is not treated as per 100 g', () => {
    const page = parsePage(jsonLd({ servingSize: '1 bar (50 g)', calories: '257 kcal', fatContent: '14 g' }));
    assert.equal(page.basis, null);
    assert.equal(page.method, null);
  });
  it('a broken JSON-LD block does not break the page', () => {
    const page = parsePage('<script type="application/ld+json">{broken</script><title>x</title><p>Пищевая ценность на 100 г: белки 7,5 г</p>');
    assert.equal(page.method, 'html');
    assert.equal(page.nutrition.protein, 7.5);
  });
  it('9. a Russian HTML table: subgroups do not leak into their parents', () => {
    const page = parsePage(`<title>SNICKERS</title><table><tr><th>Пищевая ценность на 100 г</th></tr>
      <tr><td>Энергетическая ценность</td><td>2150 кДж / 514 ккал</td></tr><tr><td>Жиры</td><td>28,6 г</td></tr><tr><td>в т.ч. насыщенные жиры</td><td>10 г</td></tr>
      <tr><td>Углеводы</td><td>56 г</td></tr><tr><td>в т.ч. сахара</td><td>48 г</td></tr><tr><td>Пищевые волокна</td><td>3,1 г</td></tr><tr><td>Белки</td><td>7,5 г</td></tr><tr><td>Соль</td><td>0,37 г</td></tr></table>`);
    assert.equal(page.method, 'html');
    assert.deepEqual(page.nutrition, { kcal: 514, protein: 7.5, carbs: 56, fat: 28.6, sugars: 48, saturatedFat: 10, fiber: 3.1, salt: 0.37, sodiumMg: null });
  });
  it('an English table: "of which", kJ only, sodium in mg', () => {
    const page = parsePage(`<p>Nutrition per 100g: Energy 2150 kJ. Fat 28.6 g, of which saturates 10 g. Carbohydrate 56 g, of which sugars 48 g. Fibre 3 g. Protein 7.5 g. Sodium 150 mg.</p>`);
    assert.deepEqual(page.nutrition, { kcal: 514, protein: 7.5, carbs: 56, fat: 28.6, sugars: 48, saturatedFat: 10, fiber: 3, salt: null, sodiumMg: 150 });
  });
  it('rows with the unit in the row name', () => {
    const page = parsePage('<p>Пищевая ценность на 100 г. Белки, г 7,5. Жиры, г 28,6. Углеводы, г: 56</p>');
    assert.deepEqual([page.nutrition.protein, page.nutrition.fat, page.nutrition.carbs], [7.5, 28.6, 56]);
  });
  it('per 100 ml basis', () => {
    assert.equal(parsePage('<p>На 100 мл: белки 3 г, жиры 2,5 г, углеводы 4,7 г</p>').basis, 'per_100ml');
  });
  it('a service line with 100 kcal does not replace the real energy value', () => {
    assert.equal(parsePage('<p>Пищевая ценность на 100 г: 100 ккал это 5% нормы. Калорийность 514 ккал, белки 7 г</p>').nutrition.kcal, 514);
    assert.equal(parsePage('<p>На 100 г: 100 ккал, белки 3 г</p>').nutrition.kcal, 100, 'the only value stays');
  });
  it('no "per 100" marker: serving values are not taken', () => {
    const page = parsePage('<p>В одном батончике: белки 3,8 г, жиры 14 г, углеводы 28 г</p>');
    assert.equal(page.basis, null);
    assert.equal(page.nutrition.protein, null);
  });
  it('percentages in ingredients and values without a unit are not nutrition', () => {
    const page = parsePage('<p>Состав: сахар 12%, какао 30%. На 100 г: сахара 48 г</p>');
    assert.equal(page.nutrition.sugars, 48);
    assert.equal(parsePage('<p>На 100 г: сахар 12%</p>').nutrition.sugars, null);
  });
  it('impossible numbers are dropped', () => {
    assert.equal(parsePage('<p>На 100 г: белки 750 г</p>').nutrition.protein, null);
  });
  it('script, style and entities are cleaned', () => {
    const page = parsePage('<style>.a{}</style><script>var a="белки 99 г"</script><p>На&nbsp;100&nbsp;г: белки 7,5&nbsp;г</p>');
    assert.equal(page.nutrition.protein, 7.5);
    assert.ok(!page.text.includes('99'));
  });
  it('the text for AI is a fragment, not the whole page', () => {
    const page = parsePage(`<p>${'реклама '.repeat(3000)}</p><p>Пищевая ценность: белок — 7,5</p><p>${'подвал '.repeat(3000)}</p>`);
    assert.ok(page.relevantText.includes('белок'));
    assert.ok(page.relevantText.length <= 4000);
    assert.equal(parsePage('<p>Ничего о продукте</p>').relevantText, '');
  });
  it('a number from AI must be printed on the page', () => {
    const text = 'белок 7,5; жир 28.6; сахар 48; ещё 9,5';
    assert.equal(printedOnPage(7.5, text), 7.5);
    assert.equal(printedOnPage(28.6, text), 28.6);
    assert.equal(printedOnPage(48, text), 48);
    assert.equal(printedOnPage(9, text), null, '9 is only a part of 9,5');
    assert.equal(printedOnPage(5, text), null, '5 is only a part of 7,5');
    assert.equal(printedOnPage(99, text), null);
    assert.equal(printedOnPage(null, text), null);
  });
});

describe('Source tiers', () => {
  it('manufacturer, retailer, database, the rest', () => {
    assert.equal(sourceTier('mars.com', 'Snickers'), 1);
    assert.equal(sourceTier('www.ozon.ru', null), 2);
    assert.equal(sourceTier('vkusvill.ru', null), 2);
    assert.equal(sourceTier('fatsecret.ru', null), 3);
    assert.equal(sourceTier('random-site.ru', 'Snickers'), 4);
  });
  it('a clean domain of the brand is official; SEO sites with the brand in the name are not', () => {
    assert.equal(sourceTier('snickers.de', 'Snickers'), 1);
    assert.equal(sourceTier('snickers-calories.ru', 'Snickers'), 4);
    assert.equal(sourceTier('calories-snickers.info', 'Snickers'), 4);
    assert.equal(sourceTier('snickersinfo.com', 'Snickers'), 4);
    assert.equal(sourceTier('orion.example', null), 4);
  });
  it('sections of a site are one source', () => {
    assert.equal(registrableDomain('m.ozon.ru'), registrableDomain('www.ozon.ru'));
    assert.equal(registrableDomain('shop.tesco.co.uk'), 'tesco.co.uk');
  });
});

describe('Deterministic checks', () => {
  const context: ProductLookupContext = { brand: 'Snickers', name: 'Snickers лесной орех', serving: null, basis: 'per_100g', kcal: 514, protein: 7.5, carbs: 56, fat: 28.6, missingFields: [] };
  const page = (kcal: number, protein: number, carbs: number, fat: number) => ({ kcal, protein, carbs, fat, sugars: null, saturatedFat: null, salt: null, sodiumMg: null, fiber: null });

  it('rounding and kJ conversion pass', () => {
    assert.deepEqual(compareMacros(context, page(520, 7.3, 55, 28)).conflicts, []);
    assert.equal(compareMacros(context, page(520, 7.3, 55, 28)).compared, 4);
  });
  it('regular Snickers differs in fat, the wrong Choco Pie in carbs and fat', () => {
    assert.deepEqual(compareMacros(context, page(496, 7.5, 58, 25)).conflicts.map((conflict) => conflict.field), ['fat']);
    const choco = { ...context, kcal: 430, protein: 4.5, carbs: 63, fat: 18 };
    assert.deepEqual(compareMacros(choco, page(443, 4.5, 70.5, 16.1)).conflicts.map((conflict) => conflict.field), ['carbs', 'fat']);
  });
  it('48 and 48.2 agree, 48 and 32 do not', () => {
    assert.equal(valuesAgree('sugars', 48, 48.2), true);
    assert.equal(valuesAgree('sugars', 48, 32), false);
    assert.equal(valuesAgree('salt', 0.4, 0.45), true);
    assert.equal(valuesAgree('salt', 0.4, 0.6), false);
  });
  it('grammatical forms of one word have one stem; other words do not merge', () => {
    for (const forms of [['лесной', 'лесного', 'лесным', 'лесном'], ['орех', 'ореха', 'орехом'], ['молочный', 'молочная', 'молочного'], ['клубника', 'клубникой', 'клубнику']]) {
      assert.equal(new Set(forms.map(wordStem)).size, 1, forms.join());
    }
    assert.notEqual(wordStem('черный'), wordStem('черника'));
    assert.notEqual(wordStem('молочный'), wordStem('темный'));
    assert.equal(wordStem('snickers'), 'snickers'); assert.equal(wordStem('сыр'), 'сыр');
  });
  it('Gemini spelling variants of one product match the same page; another variant does not', () => {
    const page = (identityText: string) => ({ identityText, productText: identityText, brand: null, barcodes: [], basis: 'per_100g', nutrition: {}, method: 'html', ingredients: null, relevantText: '', text: identityText }) as unknown as Parameters<typeof identityFacts>[0];
    const label = (name: string) => ({ ...context, name, brand: 'SNICKERS' });
    for (const name of ['С лесным орехом', 'Шоколадный батончик С лесного орехом', 'Лесной орех', 'Snickers hazelnut']) {
      for (const title of ['Шоколад Snickers с лесным орехом', 'Шоколадный батончик Snickers Лесной Орех 81 г', 'СНИКЕРС с лесным орехом']) {
        assert.equal(identityFacts(page(title), label(name), null).variantMatch, true, `${name} / ${title}`);
      }
    }
    assert.equal(identityFacts(page('Snickers Классический'), label('С лесным орехом'), null).variantMatch, false);
    assert.equal(identityFacts(page('Snickers Белый'), label('С лесным орехом'), null).variantMatch, false);
    assert.equal(identityFacts(page('Snickers Crisper'), label('С лесным орехом'), null).variantMatch, false);
    assert.equal(identityFacts(page('Twix с лесным орехом'), label('С лесным орехом'), null).brandMatch, false);
  });
  it('the variant is what is left of the name without the brand and generic words', () => {
    assert.deepEqual(variantTokens('SNICKERS шоколадный батончик лесной орех 81 г', 'Snickers'), ['лесной', 'орех']);
    assert.deepEqual(variantTokens('Сникерс', 'Snickers'), []);
  });
});
