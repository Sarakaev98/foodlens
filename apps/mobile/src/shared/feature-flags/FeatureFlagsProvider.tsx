import { createContext, useContext, type ReactNode } from 'react';
import type { FeatureFlag, FeatureFlags } from '@foodlens/core';
import { featureFlags as defaultFlags } from './featureFlags.config';

const FeatureFlagsContext = createContext<FeatureFlags>(defaultFlags);

interface FeatureFlagsProviderProps {
  /** Позволяет позже подставить флаги с сервера (GET /feature-flags). */
  readonly flags?: FeatureFlags;
  readonly children: ReactNode;
}

export function FeatureFlagsProvider({ flags = defaultFlags, children }: FeatureFlagsProviderProps) {
  return <FeatureFlagsContext.Provider value={flags}>{children}</FeatureFlagsContext.Provider>;
}

export function useFeatureFlags(): FeatureFlags {
  return useContext(FeatureFlagsContext);
}

export function useFeatureFlag(flag: FeatureFlag): boolean {
  return useFeatureFlags()[flag];
}
