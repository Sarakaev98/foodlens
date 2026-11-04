import {
  featureFlagEnvName,
  FEATURE_FLAG_KEYS,
  parseFeatureFlagOverrides,
  resolveFeatureFlags,
  type FeatureFlag,
  type FeatureFlags,
} from '@foodlens/core';

/** meta: настоящий анализ (нужен MODEL_API_KEY); mock: фиксированный демо-продукт для локальной разработки. */
export const AI_PROVIDER_NAMES = ['meta', 'mock', 'google'] as const;

export type AIProviderName = (typeof AI_PROVIDER_NAMES)[number];

/**
 * Goal Match v4 для eat_healthier. off (по умолчанию): прежняя расчётная v3 без второго AI-вызова.
 * mock: записанные ответы AI для демо-продуктов. meta: зарезервировано, запрос к Meta пока не отправляется.
 */
export const PRODUCT_LOOKUP_NAMES = ['open_food_facts', 'none'] as const;
export type ProductLookupName = (typeof PRODUCT_LOOKUP_NAMES)[number];

/** Поиск страниц для недостающих значений. gemini (Google Grounding) оставлен в коде, но его условия не разрешают читать найденные страницы. */
export const WEB_SEARCH_NAMES = ['off', 'gemini', 'tavily'] as const;
export type WebSearchName = (typeof WEB_SEARCH_NAMES)[number];
/** Ниже бесплатных 1000 в месяц: счётчик живёт в памяти и обнуляется при перезапуске. */
export const TAVILY_DEFAULT_MONTHLY_CREDITS = 900;

export const GOAL_MATCH_AI_MODES = ['off', 'mock', 'google', 'meta'] as const;

export type GoalMatchAiMode = (typeof GOAL_MATCH_AI_MODES)[number];

export interface AppConfig {
  readonly port: number;
  readonly databaseUrl: string;
  readonly ai: {
    readonly provider: AIProviderName;
    /** Ключ Meta Model API. Только на backend; если пуст, API запускается, а сканирование вернёт AI_NOT_CONFIGURED. */
    readonly modelApiKey: string;
    readonly model: string | undefined;
    readonly timeoutMs: number | undefined;
  };
  readonly labelAi: { readonly provider: 'google' | 'fireworks' };
  readonly scanAi: { readonly provider: 'google' | 'fireworks'; readonly fireworksApiKey: string; readonly timeoutMs: number };
  readonly mealPlan: { readonly provider: 'google' | 'fireworks'; readonly fireworksApiKey: string; readonly timeoutMs: number };
  readonly goalMatchAi: { readonly mode: GoalMatchAiMode; readonly google: {
    readonly apiKey: string; readonly project: string; readonly location: string; readonly model: string;
  } };
  readonly productLookup: {
    /** none отключает поиск по штрихкоду; скан работает только по фото. */
    readonly provider: ProductLookupName;
    /** Контакт в User-Agent, как требует Open Food Facts. */
    readonly contact: string;
    /** Второй источник. Без обоих ключей он просто не подключается. */
    /** Третий источник: поиск страниц. Включается только явно. */
    readonly webSearch: WebSearchName;
    readonly tavily: { readonly apiKey: string; readonly monthlyCreditLimit: number };
    /** Пустое значение: лимиты по умолчанию из источника. */
    readonly webSearchLimits: { readonly maxQueries: number | undefined; readonly maxPages: number | undefined };
    readonly fatSecret: { readonly clientId: string; readonly clientSecret: string; readonly region: string | undefined; readonly language: string | undefined };
  };
  readonly featureFlags: FeatureFlags;
}

type Env = Readonly<Record<string, string | undefined>>;

export function loadAppConfig(env: Env): AppConfig {
  return {
    port: Number(env.API_PORT ?? 3000),
    productLookup: { provider: parseProductLookupName(env.PRODUCT_LOOKUP), contact: env.OFF_CONTACT?.trim() || 'foodlens-dev',
      webSearch: parseWebSearchName(env.WEB_SEARCH_LOOKUP),
      tavily: { apiKey: env.TAVILY_API_KEY?.trim() ?? '', monthlyCreditLimit: parsePositiveInt(env.TAVILY_MONTHLY_CREDIT_LIMIT, 'TAVILY_MONTHLY_CREDIT_LIMIT') ?? TAVILY_DEFAULT_MONTHLY_CREDITS },
      webSearchLimits: { maxQueries: parsePositiveInt(env.WEB_SEARCH_MAX_QUERIES, 'WEB_SEARCH_MAX_QUERIES'), maxPages: parsePositiveInt(env.WEB_SEARCH_MAX_PAGES, 'WEB_SEARCH_MAX_PAGES') },
      fatSecret: { clientId: env.FATSECRET_CLIENT_ID?.trim() ?? '', clientSecret: env.FATSECRET_CLIENT_SECRET?.trim() ?? '',
        region: env.FATSECRET_REGION?.trim() || undefined, language: env.FATSECRET_LANGUAGE?.trim() || undefined } },
    databaseUrl: requireEnv(env, 'DATABASE_URL'),
    ai: {
      provider: parseAIProviderName(env.AI_PROVIDER),
      modelApiKey: env.MODEL_API_KEY?.trim() ?? '',
      model: env.MODEL_NAME?.trim() || undefined,
      timeoutMs: parsePositiveInt(env.MODEL_TIMEOUT_MS, 'MODEL_TIMEOUT_MS'),
    },
    labelAi: { provider: parseScanAIProvider(env.LABEL_SCAN_AI_PROVIDER, 'LABEL_SCAN_AI_PROVIDER') },
    scanAi: { provider: parseScanAIProvider(env.PRODUCT_SCAN_AI_PROVIDER ?? env.SCAN_AI_PROVIDER,
      env.PRODUCT_SCAN_AI_PROVIDER !== undefined ? 'PRODUCT_SCAN_AI_PROVIDER' : 'SCAN_AI_PROVIDER'), fireworksApiKey: env.FIREWORKS_API_KEY?.trim() ?? '',
      timeoutMs: parsePositiveInt(env.FIREWORKS_SCAN_TIMEOUT_MS, 'FIREWORKS_SCAN_TIMEOUT_MS') ?? 60000 },
    mealPlan: { provider: parseMealPlanProvider(env.MEAL_PLAN_PROVIDER), fireworksApiKey: env.FIREWORKS_API_KEY?.trim() ?? '',
      timeoutMs: parsePositiveInt(env.FIREWORKS_MEAL_PLAN_TIMEOUT_MS, 'FIREWORKS_MEAL_PLAN_TIMEOUT_MS') ?? 60000 },
    goalMatchAi: { mode: parseGoalMatchAiMode(env.GOAL_MATCH_AI), google: {
      apiKey: env.GOOGLE_API_KEY?.trim() ?? '', project: env.GOOGLE_CLOUD_PROJECT?.trim() ?? '',
      location: env.GOOGLE_CLOUD_LOCATION?.trim() || 'global', model: env.GOOGLE_GEMINI_MODEL?.trim() || 'gemini-3.5-flash-lite',
    } },
    featureFlags: resolveFeatureFlags(parseFeatureFlagOverrides(readFeatureFlagEnv(env))),
  };
}

function parseScanAIProvider(value: string | undefined, setting = 'SCAN_AI_PROVIDER'): 'google' | 'fireworks' {
  const name = value?.trim() || 'google';
  if (name !== 'google' && name !== 'fireworks') throw new Error(`Unknown ${setting}. Expected google or fireworks`);
  return name;
}

function parseMealPlanProvider(value: string | undefined): 'google' | 'fireworks' {
  const name = value?.trim() || 'google';
  if (name !== 'google' && name !== 'fireworks') throw new Error('Unknown MEAL_PLAN_PROVIDER. Expected google or fireworks');
  return name;
}

function requireEnv(env: Env, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`Environment variable ${name} is required`);
  return value;
}

function parsePositiveInt(value: string | undefined, name: string): number | undefined {
  if (!value) return undefined;
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`Environment variable ${name} must be a positive integer`);
  return number;
}

function parseAIProviderName(value: string | undefined): AIProviderName {
  const name = value ?? 'meta';
  if (!(AI_PROVIDER_NAMES as readonly string[]).includes(name)) {
    throw new Error(`Unknown AI_PROVIDER "${name}". Expected one of: ${AI_PROVIDER_NAMES.join(', ')}`);
  }
  return name as AIProviderName;
}

function parseProductLookupName(value: string | undefined): ProductLookupName {
  const name = value?.trim() || 'open_food_facts';
  if (!(PRODUCT_LOOKUP_NAMES as readonly string[]).includes(name)) {
    throw new Error(`Unknown PRODUCT_LOOKUP "${name}". Expected one of: ${PRODUCT_LOOKUP_NAMES.join(', ')}`);
  }
  return name as ProductLookupName;
}

function parseWebSearchName(value: string | undefined): WebSearchName {
  const name = value?.trim() || 'off';
  if (!(WEB_SEARCH_NAMES as readonly string[]).includes(name)) {
    throw new Error(`Unknown WEB_SEARCH_LOOKUP "${name}". Expected one of: ${WEB_SEARCH_NAMES.join(', ')}`);
  }
  return name as WebSearchName;
}

function parseGoalMatchAiMode(value: string | undefined): GoalMatchAiMode {
  const mode = value ?? 'off';
  if (!(GOAL_MATCH_AI_MODES as readonly string[]).includes(mode)) {
    throw new Error(`Unknown GOAL_MATCH_AI "${mode}". Expected one of: ${GOAL_MATCH_AI_MODES.join(', ')}`);
  }
  return mode as GoalMatchAiMode;
}

function readFeatureFlagEnv(env: Env): Partial<Record<FeatureFlag, string | undefined>> {
  return Object.fromEntries(
    FEATURE_FLAG_KEYS.map((flag) => [flag, env[`FEATURE_${featureFlagEnvName(flag)}`]]),
  );
}
