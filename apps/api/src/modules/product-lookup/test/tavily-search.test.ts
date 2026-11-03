import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Logger } from '@nestjs/common';
import type { ExtractedPage } from '@foodlens/ai';
import { loadAppConfig } from '../../../config/app-config';
import { WebSearchProductLookupProvider, type NutritionSearcher } from '../web-search-lookup.provider';
import type { ProductLookupContext } from '../product-lookup.provider';
import { PageFetchError } from '../web/page-fetcher';
import { sourceTier } from '../web/source-tier';
import { TavilyCreditBudget, TavilySearch, TavilySearchError, tavilyQuery } from '../web/tavily-search';

// Все ответы Tavily подставные: тесты не выходят в сеть и не используют настоящий ключ.
Logger.overrideLogger(false);
const KEY = 'tvly-unit-key-not-real';
const INPUT = { barcode: '4011100000000', brand: 'Snickers', name: 'Snickers лесной орех', serving: '81 g' };
const CONTEXT: ProductLookupContext = { brand: 'Snickers', name: 'Snickers лесной орех', serving: '81 g', basis: 'per_100g', kcal: 514, protein: 7.5, carbs: 56, fat: 28.6, missingFields: ['sugars', 'saturatedFat', 'salt', 'sodiumMg', 'fiber'] };
const results = (urls: readonly string[]) => ({ results: urls.map((url) => ({ url, title: 'Snickers лесной орех', content: 'snippet-body', score: 0.9 })), usage: { credits: 1 } });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const TABLE = (code = '4011100000000') => `Штрихкод ${code}\n\n| Пищевая ценность на 100 г | |\n| Энергетическая ценность | 510 ккал |\n| Белки | 7,3 г |\n| Углеводы | 55 г |\n| в т.ч. сахара | 48 г |\n| Жиры | 28 г |\n| в т.ч. насыщенные | 10 г |\n| Соль | 0,37 г |`;

function client(answer: (url: string) => Response, limit = 900, now: () => number = Date.now) {
  const requests: { url: string; init: RequestInit; body: Record<string, any> }[] = [];
  const logs: { message: string; fields: any }[] = [];
  const logger = { log: (message: string, fields: unknown) => logs.push({ message, fields }), warn: (message: string, fields: unknown) => logs.push({ message, fields }) };
  const budget = new TavilyCreditBudget(limit, now);
  const search = new TavilySearch({ apiKey: KEY, budget, logger, fetch: (async (url: unknown, init: RequestInit) => {
    requests.push({ url: String(url), init, body: JSON.parse(String(init.body)) });
    return answer(String(url));
  }) as typeof fetch });
  return { search, budget, requests, logs };
}
const usage = (logs: { message: string; fields: any }[]) => logs.filter((line) => line.message === 'tavily_usage').map((line) => line.fields);

describe('Tavily request', () => {
  it('POST search with a Bearer key: basic depth, few results, no raw content', async () => {
    const { search, requests } = client(() => json(results(['https://ozon.ru/p'])));
    await search.discoverSources(INPUT);
    assert.equal(requests.length, 1);
    const { url, init, body } = requests[0]!;
    assert.equal(url, 'https://api.tavily.com/search');
    assert.equal(init.method, 'POST');
    assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${KEY}`);
    assert.ok(!url.includes(KEY)); assert.ok(!String(init.body).includes(KEY));
    assert.deepEqual(Object.keys(body).sort(), ['include_usage', 'max_results', 'query', 'search_depth']);
    assert.equal(body.search_depth, 'basic'); assert.equal(body.max_results, 5);
  });
  it('the query has only barcode, brand, name and package; no macros, photo or profile', () => {
    assert.equal(tavilyQuery(INPUT), '4011100000000 Snickers лесной орех 81 g пищевая ценность');
    assert.equal(tavilyQuery({ barcode: null, brand: 'Orion', name: 'Choco Pie', serving: null }), 'Orion Choco Pie пищевая ценность');
    assert.equal(tavilyQuery({ barcode: '123', brand: null, name: null, serving: null }), '123 пищевая ценность');
  });
  it('maps results to real URLs and domains, dropping anything else', async () => {
    const { search } = client(() => json({ results: [{ url: 'https://www.ozon.ru/p?a=1', title: 'T' }, { url: 'ftp://x.example/', title: 'T' }, { url: 'broken' }, { title: 'no url' }, 'junk'], usage: { credits: 1 } }));
    const { sources, webSearchQueries } = await search.discoverSources(INPUT);
    assert.deepEqual(sources, [{ url: 'https://www.ozon.ru/p?a=1', title: 'T', domain: 'ozon.ru' }]);
    assert.equal(webSearchQueries, 1);
  });
  it('the snippet is kept whole: the barcode may be far from its start', async () => {
    const content = `${'x'.repeat(3000)} 5449000022431`;
    const { search } = client(() => json({ results: [{ url: 'https://shop.example/p', title: 'T', content }] }));
    const { sources } = await search.discoverSources(INPUT);
    assert.equal(sources[0]!.snippet, content);
  });
  it('the log has numbers and domains only: no key, query or response body', async () => {
    const { search, logs } = client(() => json(results(['https://ozon.ru/p', 'https://vprok.ru/p'])));
    await search.discoverSources(INPUT);
    const [line] = usage(logs);
    assert.equal(line.endpoint, 'search'); assert.equal(line.credits, 1); assert.equal(line.creditsThisMonth, 1); assert.equal(line.resultCount, 2);
    assert.deepEqual(line.domains, ['ozon.ru', 'vprok.ru']);
    const text = JSON.stringify(logs);
    for (const secret of [KEY, 'Bearer', 'snippet-body', 'пищевая ценность', '4011100000000']) assert.ok(!text.includes(secret), secret);
  });
  it('errors are typed, not retried and never show the key', async () => {
    for (const status of [401, 429, 432, 433, 500, 503]) {
      const { search, requests, logs } = client(() => new Response(`bad ${KEY}`, { status }));
      await assert.rejects(search.discoverSources(INPUT), (error: unknown) => error instanceof TavilySearchError && error.code === `http_${status}` && !String(error).includes(KEY));
      assert.equal(requests.length, 1);
      assert.ok(!JSON.stringify(logs).includes(KEY));
    }
  });
  it('a dead network, bad JSON and a slow server are failures, not crashes', async () => {
    const down = new TavilySearch({ apiKey: KEY, budget: new TavilyCreditBudget(9), logger: client(() => json({})).search['config'].logger, fetch: (async () => { throw new Error(`boom ${KEY}`); }) as typeof fetch });
    await assert.rejects(down.discoverSources(INPUT), (error: unknown) => error instanceof TavilySearchError && error.code === 'unavailable' && !String(error).includes(KEY));
    await assert.rejects(client(() => new Response('<html>')).search.discoverSources(INPUT), (error: unknown) => error instanceof TavilySearchError && error.code === 'invalid_response');
    const slow = new TavilySearch({ apiKey: KEY, budget: new TavilyCreditBudget(9), timeoutMs: 5, logger: { log: () => undefined, warn: () => undefined },
      fetch: ((_: unknown, init: RequestInit) => new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(new Error('aborted'))))) as typeof fetch });
    const keepAlive = setTimeout(() => undefined, 1000);
    await assert.rejects(slow.discoverSources(INPUT), (error: unknown) => error instanceof TavilySearchError && error.code === 'unavailable');
    clearTimeout(keepAlive);
  });
  it('no key: nothing is sent', async () => {
    let calls = 0;
    const search = new TavilySearch({ apiKey: '', budget: new TavilyCreditBudget(9), logger: { log: () => undefined, warn: () => undefined }, fetch: (async () => { calls++; return json({}); }) as typeof fetch });
    assert.equal(search.isAvailable(), false);
    await assert.rejects(search.discoverSources(INPUT), (error: unknown) => error instanceof TavilySearchError && error.code === 'not_configured');
    assert.equal(calls, 0);
  });
});

describe('Tavily credit budget', () => {
  it('counts what Tavily reports and stops at the limit', async () => {
    const { search, budget, logs } = client(() => json({ ...results(['https://ozon.ru/p']), usage: { credits: 2 } }), 3);
    await search.discoverSources(INPUT);
    assert.equal(budget.spent, 2); assert.equal(search.isAvailable(), true);
    await search.discoverSources(INPUT);
    assert.equal(budget.spent, 4); assert.equal(search.isAvailable(), false);
    assert.equal(usage(logs)[1].creditsThisMonth, 4);
  });
  it('without a usage field one search still counts', async () => {
    const { search, budget } = client(() => json({ results: [] }));
    await search.discoverSources(INPUT);
    assert.equal(budget.spent, 1);
  });
  it('a new month starts from zero', () => {
    let now = Date.UTC(2026, 10, 30);
    const budget = new TavilyCreditBudget(2, () => now);
    budget.spend(2);
    assert.equal(budget.hasCredits(), false);
    now = Date.UTC(2026, 11, 1);
    assert.equal(budget.spent, 0); assert.equal(budget.hasCredits(), true);
  });
  it('432 and 433 from Tavily close the month, other errors do not', async () => {
    for (const status of [432, 433]) {
      const { search, budget } = client(() => new Response('', { status }));
      await assert.rejects(search.discoverSources(INPUT));
      assert.equal(budget.hasCredits(), false, String(status));
    }
    const { search, budget } = client(() => new Response('', { status: 500 }));
    await assert.rejects(search.discoverSources(INPUT));
    assert.equal(budget.hasCredits(), true);
  });
  it('the limit comes from env, default 900; an unknown search name stops the start', () => {
    const env = { DATABASE_URL: 'postgresql://unit' };
    assert.equal(loadAppConfig(env).productLookup.tavily.monthlyCreditLimit, 900);
    assert.equal(loadAppConfig(env).productLookup.webSearch, 'off');
    assert.equal(loadAppConfig({ ...env, TAVILY_MONTHLY_CREDIT_LIMIT: '50' }).productLookup.tavily.monthlyCreditLimit, 50);
    assert.equal(loadAppConfig({ ...env, WEB_SEARCH_LOOKUP: 'tavily' }).productLookup.webSearch, 'tavily');
    assert.throws(() => loadAppConfig({ ...env, WEB_SEARCH_LOOKUP: 'bing' }), /Unknown WEB_SEARCH_LOOKUP/);
  });
});

describe('Tavily extract', () => {
  const page = (url: string) => ({ url, raw_content: 'page text' });
  it('POST extract with basic depth: one credit, numbers in the log', async () => {
    const { search, requests, budget, logs } = client(() => json({ results: [page('https://ozon.ru/p'), page('https://vprok.ru/p')], failed_results: [] }));
    const pages = await search.readPages(['https://ozon.ru/p', 'https://vprok.ru/p']);
    assert.equal(pages.length, 2);
    assert.equal(requests[0]!.url, 'https://api.tavily.com/extract');
    assert.deepEqual(requests[0]!.body.urls, ['https://ozon.ru/p', 'https://vprok.ru/p']);
    assert.equal(requests[0]!.body.extract_depth, 'basic');
    assert.equal(budget.spent, 1);
    assert.equal(usage(logs)[0].credits, 1);
    assert.ok(!JSON.stringify(logs).includes('page text'));
  });
  it('all failed: nothing is counted', async () => {
    const { search, budget } = client(() => json({ results: [], failed_results: [{ url: 'https://ozon.ru/p', error: 'x' }] }));
    assert.deepEqual(await search.readPages(['https://ozon.ru/p']), []);
    assert.equal(budget.spent, 0);
  });
  it('no credit left or nothing to read: no request', async () => {
    const empty = client(() => json({}), 0);
    assert.deepEqual(await empty.search.readPages(['https://ozon.ru/p']), []);
    assert.deepEqual(await client(() => json({})).search.readPages([]), []);
    assert.equal(empty.requests.length, 0);
  });
});

describe('Tavily inside the web lookup', () => {
  type Body = string | Error;
  function lookup(direct: Readonly<Record<string, Body>>, options: { extract?: (url: string) => string | null; limit?: number; extracted?: readonly ExtractedPage[] } = {}) {
    const urls = Object.keys(direct);
    const stub = client((url) => (url.endsWith('/search') ? json(results(urls)) : json({ results: urls.flatMap((item) => { const content = options.extract?.(item); return content ? [{ url: item, raw_content: content }] : []; }) })), options.limit ?? 900);
    const reads: string[] = [];
    const logs: { message: string; fields: any }[] = [];
    const logger = { log: (message: string, fields: unknown) => logs.push({ message, fields }), warn: (message: string, fields: unknown) => logs.push({ message, fields }) };
    const searcher: NutritionSearcher = {
      discoverSources: (input) => stub.search.discoverSources(input), extractNutrition: async () => options.extracted ?? [],
      isAvailable: () => stub.search.isAvailable(), readPages: (items) => stub.search.readPages(items), creditsSpent: () => stub.budget.spent,
    };
    const reader = { fetchPage: async (url: string) => {
      reads.push(url);
      const body = direct[url]!;
      if (body instanceof Error) throw body;
      return { finalUrl: url, domain: new URL(url).hostname, contentType: 'text/html', body };
    } };
    return { provider: new WebSearchProductLookupProvider(searcher, reader, logger), stub, reads, logs, verdict: () => logs.find((line) => line.message === 'web_lookup')?.fields };
  }
  const extractCalls = (requests: { url: string }[]) => requests.filter((request) => request.url.endsWith('/extract')).length;
  const CODE = '4011100000000';
  const OK_PAGE = `<title>Snickers лесной орех</title><p>${TABLE()}</p>`;

  it('a page read directly needs no extract: one credit per scan', async () => {
    const run = lookup({ 'https://ozon.ru/p': OK_PAGE });
    const result = await run.provider.lookup(CODE, CONTEXT);
    assert.equal(result!.nutrition!.values.sugarsG, 48);
    assert.equal(extractCalls(run.stub.requests), 0);
    assert.equal(run.stub.budget.spent, 1);
  });
  it('a blocked site falls back to extract, once, for all unread URLs: two credits', async () => {
    const run = lookup({ 'https://ozon.ru/p': new PageFetchError('http_error'), 'https://vprok.ru/p': new PageFetchError('unavailable'), 'https://perekrestok.ru/p': new PageFetchError('bad_content_type') }, { extract: (url) => (url.includes('ozon') ? TABLE() : null) });
    const result = await run.provider.lookup(CODE, CONTEXT);
    assert.equal(result!.nutrition!.values.sugarsG, 48);
    assert.equal(extractCalls(run.stub.requests), 1);
    assert.equal(run.stub.requests.find((request) => request.url.endsWith('/extract'))!.body.urls.length, 3);
    assert.equal(run.stub.budget.spent, 2);
    assert.equal(run.verdict().pages[0].reader, 'search_extract');
    assert.equal(result!.evidence!.fields.sugarsG!.url, 'https://ozon.ru/p');
  });
  it('the credits in the log are what was really spent: an extract that read nothing costs nothing', async () => {
    const failed = lookup({ 'https://ozon.ru/p': new PageFetchError('http_error') }, { extract: () => null });
    await failed.provider.lookup(CODE, CONTEXT);
    assert.equal(extractCalls(failed.stub.requests), 1); assert.equal(failed.verdict().extracts, 1);
    assert.equal(failed.verdict().credits, 1); assert.equal(failed.stub.budget.spent, 1);
    const read = lookup({ 'https://ozon.ru/p': new PageFetchError('http_error') }, { extract: () => TABLE() });
    await read.provider.lookup(CODE, CONTEXT);
    assert.equal(read.verdict().credits, 2); assert.equal(read.stub.budget.spent, 2);
  });
  it('an empty JavaScript shell counts as unread', async () => {
    const run = lookup({ 'https://ozon.ru/p': '<title>Загрузка</title><div id="root"></div>' }, { extract: () => TABLE() });
    const result = await run.provider.lookup(CODE, CONTEXT);
    assert.equal(result!.nutrition!.values.sugarsG, 48);
    assert.equal(extractCalls(run.stub.requests), 1);
  });
  it('a blocked private address is never passed to extract', async () => {
    const run = lookup({ 'https://ozon.ru/p': new PageFetchError('blocked_url') }, { extract: () => TABLE() });
    assert.equal(await run.provider.lookup(CODE, CONTEXT), null);
    assert.equal(extractCalls(run.stub.requests), 0);
  });
  it('a verified direct page saves the extract credit even if another page failed', async () => {
    const run = lookup({ 'https://ozon.ru/p': OK_PAGE, 'https://vprok.ru/p': new PageFetchError('http_error') }, { extract: () => TABLE() });
    await run.provider.lookup(CODE, CONTEXT);
    assert.equal(extractCalls(run.stub.requests), 0);
  });
  it('a verified page that only repeats known macros does not save the extract: the missing values are still wanted', async () => {
    const macrosOnly = `<title>Snickers лесной орех</title><p>Штрихкод ${CODE}</p><p>Пищевая ценность на 100 г: 510 ккал, белки 7,3 г, углеводы 55 г, жиры 28 г</p>`;
    const run = lookup({ 'https://ozon.ru/p': macrosOnly, 'https://vprok.ru/p': new PageFetchError('http_error') }, { extract: () => TABLE() });
    const result = await run.provider.lookup(CODE, CONTEXT);
    assert.equal(extractCalls(run.stub.requests), 1);
    assert.equal(result!.nutrition!.values.sugarsG, 48);
  });
  it('extracted text passes the same identity check: a wrong recipe is still rejected', async () => {
    const wrong = TABLE().replace('28 г', '25 г').replace('55 г', '58 г');
    const run = lookup({ 'https://ozon.ru/p': new PageFetchError('http_error') }, { extract: () => wrong });
    assert.equal(await run.provider.lookup(CODE, CONTEXT), null);
    assert.equal(run.verdict().status, 'recipe_version_conflict');
  });
  it('a failed extract does not break the scan', async () => {
    const failing = lookup({ 'https://ozon.ru/p': new PageFetchError('http_error') });
    const provider = new WebSearchProductLookupProvider({
      discoverSources: (input) => failing.stub.search.discoverSources(input), extractNutrition: async () => [], readPages: async () => { throw new TavilySearchError('http_500'); },
    }, { fetchPage: async () => { throw new PageFetchError('http_error'); } });
    assert.equal(await provider.lookup(CODE, CONTEXT), null);
  });
  it('budget exhausted: no request, no error, the lookup is a quiet miss', async () => {
    const run = lookup({ 'https://ozon.ru/p': OK_PAGE }, { limit: 0 });
    assert.equal(await run.provider.lookup(CODE, CONTEXT), null);
    assert.equal(run.stub.requests.length, 0);
    assert.equal(run.verdict().status, 'budget_exhausted');
  });
  it('the last credit pays the search; extract is skipped, nothing fails', async () => {
    const run = lookup({ 'https://ozon.ru/p': new PageFetchError('http_error') }, { limit: 1, extract: () => TABLE() });
    assert.equal(await run.provider.lookup(CODE, CONTEXT), null);
    assert.equal(run.stub.requests.length, 1);
  });
  it('Tavily down: the lookup rejects so that the scan logs it and goes on without caching', async () => {
    const stub = client(() => new Response('', { status: 429 }));
    const provider = new WebSearchProductLookupProvider({ discoverSources: (input) => stub.search.discoverSources(input), extractNutrition: async () => [] }, { fetchPage: async () => { throw new Error('unused'); } });
    await assert.rejects(provider.lookup(CODE, CONTEXT), TavilySearchError);
  });
  describe('dev diagnostics', () => {
    const run = (direct: Readonly<Record<string, Body>>, debug = true) => {
      const logs: { message: string; fields: any }[] = [];
      const logger = { log: (message: string, fields: unknown) => logs.push({ message, fields }), warn: (message: string, fields: unknown) => logs.push({ message, fields }) };
      const urls = Object.keys(direct);
      const searcher: NutritionSearcher = {
        discoverSources: async () => ({ sources: urls.map((url) => ({ url, title: 't'.repeat(300), domain: new URL(url).hostname })), webSearchQueries: 1 }),
        extractNutrition: async () => [],
      };
      const reader = { fetchPage: async (url: string) => {
        const body = direct[url]!;
        if (body instanceof Error) throw body;
        return { finalUrl: url, domain: new URL(url).hostname, contentType: 'text/html', body };
      } };
      return { provider: new WebSearchProductLookupProvider(searcher, reader, logger, Date.now, debug), candidates: () => logs.filter((line) => line.message === 'web_candidate').map((line) => line.fields), logs };
    };
    const page = (title: string, kcal = 510, fat = 28) => `<title>${title}</title><p>${TABLE('0000000').replace('510 ккал', `${kcal} ккал`).replace('| 28 г', `| ${fat} г`)}</p>`;

    it('every candidate gets values, comparisons with tolerance and a decision', async () => {
      const { provider, candidates } = run({
        'https://snickers.ru/ok?token=abc123': page('Snickers лесной орех'),
        'https://ozon.ru/closed': new PageFetchError('http_error'),
        'https://vprok.ru/other': page('Snickers Super'),
        'https://perekrestok.ru/late': page('Snickers лесной орех'),
        'https://a.example/x': page('x'), 'https://b.example/y': page('y'),
      });
      await provider.lookup(null, CONTEXT);
      const byDomain = Object.fromEntries(candidates().map((item: any) => [item.domain, item]));
      assert.equal(candidates().length, 6);
      assert.equal(byDomain['snickers.ru'].decision, 'accepted');
      assert.equal(byDomain['snickers.ru'].url, 'https://snickers.ru/ok', 'no query string');
      assert.equal(byDomain['snickers.ru'].values.sugars, 48);
      assert.equal(byDomain['snickers.ru'].variantMatch, true);
      assert.equal(byDomain['snickers.ru'].title.length, 160);
      const fat = byDomain['snickers.ru'].macroComparisons.find((item: any) => item.field === 'fat');
      assert.deepEqual(fat, { field: 'fat', label: 28.6, page: 28, allowed: 2.86, passed: true });
      assert.equal(byDomain['vprok.ru'].decision, 'variant_mismatch');
      assert.equal(byDomain['vprok.ru'].pageName, 'Snickers Super');
      assert.equal(byDomain['ozon.ru'].decision, 'inaccessible');
      assert.equal(byDomain['ozon.ru'].reason, 'Page fetch: http_error');
      const notSelected = candidates().filter((item: any) => ['not_selected', 'not_relevant', 'not_in_allowlist', 'not_product_site'].includes(item.reason));
      assert.equal(notSelected.length + 5, 5, 'five pages read and one closed');
      assert.equal(byDomain['b.example'].decision, 'other');
      assert.ok(notSelected.every((item: any) => item.decision === 'other'));
    });
    it('macro mismatch and too few macros have their own decisions', async () => {
      const wrong = run({ 'https://snickers.ru/a': page('Snickers лесной орех', 496, 25) });
      await wrong.provider.lookup(null, CONTEXT);
      assert.equal(wrong.candidates()[0].decision, 'macro_mismatch');
      assert.equal(wrong.candidates()[0].macroComparisons.find((item: any) => item.field === 'fat').passed, false);
      const few = run({ 'https://snickers.ru/a': '<title>Snickers лесной орех</title><p>На 100 г: белки 7,5 г, сахара 48 г</p>' });
      await few.provider.lookup(null, CONTEXT);
      assert.equal(few.candidates()[0].reason, 'needs_second_source');
    });
    it('a single page with the exact name is logged as unconfirmed', async () => {
      const single = run({ 'https://calorizator.ru/a': page('Snickers лесной орех') });
      await single.provider.lookup(null, CONTEXT);
      assert.equal(single.candidates()[0].decision, 'other');
      assert.equal(single.candidates()[0].reason, 'exact_name_single_source');
    });
    it('no secrets, query strings or page body; nothing at all with debug off', async () => {
      const on = run({ 'https://snickers.ru/ok?key=tvly-secret': page('Snickers лесной орех') });
      await on.provider.lookup(null, CONTEXT);
      const text = JSON.stringify(on.logs);
      for (const hidden of ['tvly-', 'key=', 'Энергетическая', 'base64', '| Белки']) assert.ok(!text.includes(hidden), hidden);
      const off = run({ 'https://snickers.ru/ok': page('Snickers лесной орех') }, false);
      await off.provider.lookup(null, CONTEXT);
      assert.equal(off.logs.filter((line) => ['web_candidate', 'web_label'].includes(line.message)).length, 0);
    });
    it('the query is logged only in debug, the key never', async () => {
      const logs: { message: string; fields: any }[] = [];
      const logger = { log: (message: string, fields: unknown) => logs.push({ message, fields }), warn: () => undefined };
      const search = new TavilySearch({ apiKey: KEY, budget: new TavilyCreditBudget(9), logger, debug: true, fetch: (async (url: unknown) => json(String(url).endsWith('/search') ? results([]) : { results: [], failed_results: [{ url: 'https://ozon.ru/p', error: `blocked ${'x'.repeat(300)}` }] })) as typeof fetch });
      await search.discoverSources(INPUT);
      await search.readPages(['https://ozon.ru/p']);
      assert.equal(logs.find((line) => line.message === 'tavily_query')!.fields.query, tavilyQuery(INPUT));
      const failed = logs.find((line) => line.message === 'tavily_extract_failed')!.fields.failed[0];
      assert.equal(failed.domain, 'ozon.ru'); assert.equal(failed.error.length, 160);
      assert.ok(!JSON.stringify(logs).includes(KEY));
    });
  });

  it('megamarket is a retailer: below the manufacturer, read before weak sources', async () => {
    const run = lookup({ 'https://a.example/p': OK_PAGE, 'https://b.example/p': OK_PAGE, 'https://c.example/p': OK_PAGE, 'https://megamarket.ru/p': OK_PAGE, 'https://snickers.ru/p': OK_PAGE });
    await run.provider.lookup(CODE, CONTEXT);
    assert.deepEqual(run.reads.slice(0, 2), ['https://snickers.ru/p', 'https://megamarket.ru/p']);
    assert.equal(sourceTier('megamarket.ru', 'Snickers'), 2);
    assert.equal(sourceTier('www.megamarket.ru', null), 2);
  });
});
