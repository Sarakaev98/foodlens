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

  const [requestedVersion, setRequestedVersion] = useState(profileVersion);

  // Reset before rendering targets for a changed profile, rather than in an effect.
  if (profileVersion !== requestedVersion) {
    setRequestedVersion(profileVersion);
    if (profileVersion) setState({ status: 'loading' });
  }

  const fetchTargets = useCallback(() => {
    nutritionTargetsApi.get().then(
      (targets) => setState({ status: 'ready', targets }),
      () => setState({ status: 'error' }),
    );
  }, []);

  const load = useCallback(() => {
    setState({ status: 'loading' });
    fetchTargets();
  }, [fetchTargets]);

  useEffect(() => {
    if (profileVersion) fetchTargets();
  }, [profileVersion, fetchTargets]);

  return { ...state, reload: load };
}
