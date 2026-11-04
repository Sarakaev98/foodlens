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
    title: 'What’s your goal?',
    subtitle: 'It shapes your recommendations and product ratings.',
    fields: ['goal'],
  },
  {
    key: 'basics',
    href: '/onboarding/basics',
    title: 'Tell us about yourself',
    subtitle: 'We use this to calculate your daily targets.',
    fields: ['age', 'sex', 'heightCm', 'weightKg'],
  },
  {
    key: 'activity',
    href: '/onboarding/activity',
    title: 'How active are you?',
    subtitle: 'Pick the option closest to a typical week.',
    fields: ['activityLevel'],
  },
  {
    key: 'preferences',
    href: '/onboarding/preferences',
    title: 'Food preferences',
    subtitle: 'We’ll use them for product ratings and your meal plan.',
    fields: ['dietaryPreferences', 'allergens', 'avoidedIngredients'],
  },
  {
    key: 'review',
    href: '/onboarding/review',
    title: 'Does this look right?',
    subtitle: 'You can change this later in your profile.',
    fields: [],
  },
];
