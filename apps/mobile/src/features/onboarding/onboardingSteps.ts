import type { Href } from 'expo-router';
import type { UserNutritionProfileField } from '@foodlens/core';

export type OnboardingStepKey = 'goal' | 'basics' | 'activity' | 'preferences' | 'review';

export interface OnboardingStep {
  readonly key: OnboardingStepKey;
  readonly href: Href;
  readonly title: string;
  readonly subtitle: string;
  /** Поля профиля, которые проверяются перед переходом дальше. */
  readonly fields: readonly UserNutritionProfileField[];
}

/** Порядок шагов. Добавить или убрать шаг = изменить этот список и маршрут в src/app/onboarding. */
export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    key: 'goal',
    href: '/onboarding',
    title: 'Какая у вас цель?',
    subtitle: 'От неё зависят рекомендации и оценка продуктов.',
    fields: ['goal'],
  },
  {
    key: 'basics',
    href: '/onboarding/basics',
    title: 'Расскажите о себе',
    subtitle: 'Это нужно для расчёта дневной нормы.',
    fields: ['age', 'sex', 'heightCm', 'weightKg'],
  },
  {
    key: 'activity',
    href: '/onboarding/activity',
    title: 'Насколько вы активны?',
    subtitle: 'Выберите вариант, который ближе к обычной неделе.',
    fields: ['activityLevel'],
  },
  {
    key: 'preferences',
    href: '/onboarding/preferences',
    title: 'Предпочтения в еде',
    subtitle: 'Учтём их при оценке продуктов и в плане питания.',
    fields: ['dietaryPreferences', 'allergens', 'avoidedIngredients'],
  },
  {
    key: 'review',
    href: '/onboarding/review',
    title: 'Всё верно?',
    subtitle: 'Данные можно будет изменить в профиле.',
    fields: [],
  },
];
