import { parseFeatureFlagOverrides, resolveFeatureFlags, type FeatureFlag, type FeatureFlags } from '@foodlens/core';

/**
 * Expo встраивает EXPO_PUBLIC_* только при статическом обращении к process.env,
 * поэтому переменные перечислены явно. `satisfies` заставит добавить сюда новый флаг.
 */
const envOverrides = {
  compare: process.env.EXPO_PUBLIC_FEATURE_COMPARE,
  mealPlan: process.env.EXPO_PUBLIC_FEATURE_MEAL_PLAN,
  history: process.env.EXPO_PUBLIC_FEATURE_HISTORY,
  barcode: process.env.EXPO_PUBLIC_FEATURE_BARCODE,
  mealPhoto: process.env.EXPO_PUBLIC_FEATURE_MEAL_PHOTO,
} satisfies Record<FeatureFlag, string | undefined>;

export const featureFlags: FeatureFlags = resolveFeatureFlags(parseFeatureFlagOverrides(envOverrides));
