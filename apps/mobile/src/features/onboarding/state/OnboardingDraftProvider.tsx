import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { EMPTY_PROFILE_DRAFT, type DraftChange, type UserNutritionProfileDraft } from '@/features/profile';

interface OnboardingDraftContextValue {
  readonly draft: UserNutritionProfileDraft;
  readonly update: DraftChange;
}

const OnboardingDraftContext = createContext<OnboardingDraftContextValue | null>(null);

/** Черновик профиля живёт только пока открыт onboarding и до сохранения на сервер. */
export function OnboardingDraftProvider({ children }: { readonly children: ReactNode }) {
  const [draft, setDraft] = useState<UserNutritionProfileDraft>(EMPTY_PROFILE_DRAFT);
  const update = useCallback<DraftChange>((patch) => setDraft((current) => ({ ...current, ...patch })), []);
  const value = useMemo(() => ({ draft, update }), [draft, update]);
  return <OnboardingDraftContext.Provider value={value}>{children}</OnboardingDraftContext.Provider>;
}

export function useOnboardingDraft(): OnboardingDraftContextValue {
  const context = useContext(OnboardingDraftContext);
  if (!context) throw new Error('useOnboardingDraft must be used inside OnboardingDraftProvider');
  return context;
}
