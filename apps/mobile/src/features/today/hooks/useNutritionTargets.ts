import { useCallback, useEffect, useState } from 'react';
import type { NutritionTargets } from '@foodlens/core';
import { useProfile } from '@/features/profile';
import { nutritionTargetsApi } from '../services/nutritionTargetsApi';

type NutritionTargetsState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly targets: NutritionTargets };

/**
 * Цели считает сервер из профиля. Запрос повторяется, когда профиль сохраняют заново
 * (меняется updatedAt), поэтому Today сразу показывает пересчитанные значения.
 */
export function useNutritionTargets() {
  const profile = useProfile();
  const profileVersion = profile.status === 'ready' ? profile.profile?.updatedAt : undefined;
  const [state, setState] = useState<NutritionTargetsState>({ status: 'loading' });

  const load = useCallback(() => {
    setState({ status: 'loading' });
    nutritionTargetsApi.get().then(
      (targets) => setState({ status: 'ready', targets }),
      () => setState({ status: 'error' }),
    );
  }, []);

  useEffect(() => {
    if (profileVersion) load();
  }, [profileVersion, load]);

  return { ...state, reload: load };
}
