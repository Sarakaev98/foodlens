import {
  featureFlagEnvName,
  FEATURE_FLAG_KEYS,
  parseFeatureFlagOverrides,
  resolveFeatureFlags,
  type FeatureFlag,
  type FeatureFlags,
} from '@foodlens/core';

export type AIProviderName = 'meta';

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
  readonly featureFlags: FeatureFlags;
}

type Env = Readonly<Record<string, string | undefined>>;

export function loadAppConfig(env: Env): AppConfig {
  return {
    port: Number(env.API_PORT ?? 3000),
    databaseUrl: requireEnv(env, 'DATABASE_URL'),
    ai: {
      provider: parseAIProviderName(env.AI_PROVIDER),
      modelApiKey: env.MODEL_API_KEY?.trim() ?? '',
      model: env.MODEL_NAME?.trim() || undefined,
      timeoutMs: parsePositiveInt(env.MODEL_TIMEOUT_MS, 'MODEL_TIMEOUT_MS'),
    },
    featureFlags: resolveFeatureFlags(parseFeatureFlagOverrides(readFeatureFlagEnv(env))),
  };
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
  if (name !== 'meta') throw new Error(`Unknown AI_PROVIDER "${name}"`);
  return name;
}

function readFeatureFlagEnv(env: Env): Partial<Record<FeatureFlag, string | undefined>> {
  return Object.fromEntries(
    FEATURE_FLAG_KEYS.map((flag) => [flag, env[`FEATURE_${featureFlagEnvName(flag)}`]]),
  );
}
