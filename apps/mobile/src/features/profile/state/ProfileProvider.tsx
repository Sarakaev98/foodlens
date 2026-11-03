import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { UserNutritionProfile, UserNutritionProfileInput } from '@foodlens/core';
import { profileApi } from '../services/profileApi';

type ProfileState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly profile: UserNutritionProfile | null };

type ProfileContextValue = ProfileState & {
  readonly reload: () => void;
  /** Сохраняет на сервере и показывает то, что вернул сервер (он источник истины). */
  readonly save: (input: UserNutritionProfileInput) => Promise<UserNutritionProfile>;
};

const ProfileContext = createContext<ProfileContextValue | null>(null);

export function ProfileProvider({ children }: { readonly children: ReactNode }) {
  const [state, setState] = useState<ProfileState>({ status: 'loading' });

  const fetchProfile = useCallback(() => {
    profileApi.get().then(
      (profile) => setState({ status: 'ready', profile }),
      () => setState({ status: 'error' }),
    );
  }, []);

  const reload = useCallback(() => {
    setState({ status: 'loading' });
    fetchProfile();
  }, [fetchProfile]);

  const save = useCallback(async (input: UserNutritionProfileInput) => {
    const saved = await profileApi.save(input);
    setState({ status: 'ready', profile: saved });
    return saved;
  }, []);

  useEffect(fetchProfile, [fetchProfile]);

  const value = useMemo(() => ({ ...state, reload, save }), [state, reload, save]);
  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile(): ProfileContextValue {
  const context = useContext(ProfileContext);
  if (!context) throw new Error('useProfile must be used inside ProfileProvider');
  return context;
}
