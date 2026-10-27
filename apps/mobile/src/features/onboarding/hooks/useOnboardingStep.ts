import { useRouter } from 'expo-router';
import { useDraftValidation } from '@/features/profile';
import { ONBOARDING_STEPS, type OnboardingStepKey } from '../onboardingSteps';
import { useOnboardingDraft } from '../state/OnboardingDraftProvider';

export function useOnboardingStep(key: OnboardingStepKey) {
  const router = useRouter();
  const { draft, update } = useOnboardingDraft();
  const index = ONBOARDING_STEPS.findIndex((step) => step.key === key);
  const step = ONBOARDING_STEPS[index];
  if (!step) throw new Error(`Unknown onboarding step "${key}"`);

  const { issues, attempt } = useDraftValidation(draft, step.fields);
  const nextStep = ONBOARDING_STEPS[index + 1];

  return {
    step,
    stepNumber: index + 1,
    totalSteps: ONBOARDING_STEPS.length,
    draft,
    update,
    issues,
    goNext: () => {
      if (attempt() && nextStep) router.push(nextStep.href);
    },
  };
}
