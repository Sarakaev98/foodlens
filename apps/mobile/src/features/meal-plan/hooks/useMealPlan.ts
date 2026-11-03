import type { MealPlanResult } from '@foodlens/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useProfile } from '@/features/profile';
import { ApiError } from '@/shared/api';
import { mealPlanApi } from '../services/mealPlanApi';

export type MealPlanFailure = 'restrictions' | 'unavailable' | 'no_connection';

type MealPlanState =
  | { readonly status: 'loading' }
  | { readonly status: 'empty' }
  | { readonly status: 'generating'; readonly result: MealPlanResult | null }
  | { readonly status: 'ready'; readonly result: MealPlanResult }
  | { readonly status: 'error'; readonly failure: MealPlanFailure; readonly result: MealPlanResult | null };

function toFailure(error: unknown): MealPlanFailure {
  if (error instanceof ApiError && error.status === 0) return 'no_connection';
  if (error instanceof ApiError && (error.body as { code?: unknown } | null)?.code === 'MEAL_PLAN_INVALID') return 'restrictions';
  return 'unavailable';
}

/** Загрузка последнего плана и генерация по кнопке. Сам план ничего не запускает: запрос к AI только по нажатию. */
export function useMealPlan() {
  const profile = useProfile();
  const profileVersion = profile.status === 'ready' ? profile.profile?.updatedAt : undefined;
  const [state, setState] = useState<MealPlanState>({ status: 'loading' });
  const current = useRef<MealPlanResult | null>(null);

  useEffect(() => {
    if (!profileVersion) return;
    mealPlanApi.getLatest().then(
      (result) => {
        current.current = result;
        setState(result ? { status: 'ready', result } : { status: 'empty' });
      },
      () => setState({ status: 'empty' }),
    );
  }, [profileVersion]);

  const generate = useCallback(async () => {
    setState({ status: 'generating', result: current.current });
    try {
      const result = await mealPlanApi.generate();
      current.current = result;
      setState({ status: 'ready', result });
    } catch (error) {
      setState({ status: 'error', failure: toFailure(error), result: current.current });
    }
  }, []);

  return { state, generate: () => void generate() };
}
