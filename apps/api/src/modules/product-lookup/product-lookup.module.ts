import { Module } from '@nestjs/common';
import { GoogleNutritionSearch } from '@foodlens/ai';
import { scanDebugEnabled } from '../../common/scan-debug';
import type { AppConfig } from '../../config/app-config';
import { APP_CONFIG } from '../../config/app-config.module';
import { AiModule } from '../ai/ai.module';
import { nestLogger } from '../ai/ai-provider.factory';
import { CachedProductLookupProvider } from './cached-product-lookup.provider';
import { FatSecretProductLookupProvider } from './fatsecret.provider';
import { WebSearchProductLookupProvider, MAX_PAGES_PER_SCAN, MAX_SEARCHES_PER_PRODUCT, type NutritionSearcher } from './web-search-lookup.provider';
import { MultiSourceProductLookup } from './multi-source-product-lookup';
import { OpenFoodFactsProductLookupProvider } from './open-food-facts.provider';
import { PageFetcher } from './web/page-fetcher';
import { TavilyCreditBudget, TavilySearch } from './web/tavily-search';
import { PRODUCT_LOOKUP, type ProductLookupProvider } from './product-lookup.provider';

/** Условия FatSecret запрещают хранить данные дольше 24 часов: держим меньше с запасом. */
const FATSECRET_FOUND_TTL_MS = 12 * 60 * 60 * 1000;

/** Страницы ищет выбранный сервис, а текст без таблицы разбирает Gemini без Search. Без ключа Tavily источник не подключается. */
function createWebSearcher(config: AppConfig, textAI?: GoogleNutritionSearch): NutritionSearcher | null {
  const { webSearch, tavily } = config.productLookup;
  if (webSearch === 'off') return null;
  const google = textAI ?? new GoogleNutritionSearch({ ...config.goalMatchAi.google, logger: nestLogger('GoogleNutritionSearch') });
  if (webSearch === 'gemini') return google;
  if (!tavily.apiKey) return null;
  const budget = new TavilyCreditBudget(tavily.monthlyCreditLimit);
  const search = new TavilySearch({ apiKey: tavily.apiKey, budget, logger: nestLogger('TavilySearch'), debug: scanDebugEnabled() });
  return {
    discoverSources: (input) => search.discoverSources(input), searchQuery: (query) => search.searchQuery(query), extractNutrition: (pages) => google.extractNutrition(pages), extractIngredients: (text) => google.extractIngredients(text),
    isAvailable: () => search.isAvailable(), readPages: (urls) => search.readPages(urls), creditsSpent: () => budget.spent,
  };
}

/** Порядок задаёт приоритет. Новый источник добавляется здесь, scoring и ScanService о нём не знают. */
export function createProductLookupSources(config: AppConfig, textAI?: GoogleNutritionSearch): readonly ProductLookupProvider[] {
  if (config.productLookup.provider === 'none') return [];
  const { contact, fatSecret } = config.productLookup;
  const sources: ProductLookupProvider[] = [new CachedProductLookupProvider(new OpenFoodFactsProductLookupProvider({ contact }))];
  if (fatSecret.clientId && fatSecret.clientSecret) {
    sources.push(new CachedProductLookupProvider(new FatSecretProductLookupProvider(fatSecret), Date.now, FATSECRET_FOUND_TTL_MS));
  }
  const searcher = createWebSearcher(config, textAI);
  if (searcher) {
    const reader = new PageFetcher({ userAgent: `FoodLens/0.1.0 (${contact})` });
    const { maxQueries = MAX_SEARCHES_PER_PRODUCT, maxPages = MAX_PAGES_PER_SCAN } = config.productLookup.webSearchLimits;
    sources.push(new CachedProductLookupProvider(new WebSearchProductLookupProvider(searcher, reader, nestLogger('WebLookup'), Date.now, scanDebugEnabled(), { maxQueries, maxPages })));
  }
  return sources;
}

function createProductLookup(config: AppConfig, textAI: GoogleNutritionSearch): MultiSourceProductLookup {
  return new MultiSourceProductLookup(createProductLookupSources(config, textAI));
}

@Module({
  imports: [AiModule],
  providers: [{ provide: PRODUCT_LOOKUP, useFactory: createProductLookup, inject: [APP_CONFIG, GoogleNutritionSearch] }],
  exports: [PRODUCT_LOOKUP],
})
export class ProductLookupModule {}
