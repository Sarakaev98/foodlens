/**
 * Единый реестр feature flags. Добавить флаг = добавить ключ сюда.
 * Выключенный флаг скрывает функцию, но её код остаётся на месте.
 */
export const DEFAULT_FEATURE_FLAGS = {
  compare: true,
  mealPlan: true,
  history: true,
  barcode: true,
} as const satisfies Record<string, boolean>;

export type FeatureFlag = keyof typeof DEFAULT_FEATURE_FLAGS;

export type FeatureFlags = Readonly<Record<FeatureFlag, boolean>>;

export const FEATURE_FLAG_KEYS = Object.keys(DEFAULT_FEATURE_FLAGS) as readonly FeatureFlag[];

/** Накладывает переопределения (env, удалённый конфиг) на значения по умолчанию. */
export function resolveFeatureFlags(overrides: Partial<FeatureFlags> = {}): FeatureFlags {
  return { ...DEFAULT_FEATURE_FLAGS, ...overrides };
}

/** "mealPlan" -> "MEAL_PLAN": общее соглашение для имён переменных окружения. */
export function featureFlagEnvName(flag: FeatureFlag): string {
  return flag.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();
}

/** Превращает сырые строковые значения ("true" / "false" / "1" / "0") в переопределения флагов. */
export function parseFeatureFlagOverrides(
  raw: Partial<Record<FeatureFlag, string | undefined>>,
): Partial<FeatureFlags> {
  const overrides: Partial<Record<FeatureFlag, boolean>> = {};
  for (const flag of FEATURE_FLAG_KEYS) {
    const value = raw[flag]?.trim().toLowerCase();
    if (value === 'true' || value === '1') overrides[flag] = true;
    if (value === 'false' || value === '0') overrides[flag] = false;
  }
  return overrides;
}
