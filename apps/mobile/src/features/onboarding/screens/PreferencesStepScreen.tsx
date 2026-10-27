import { FoodPreferencesFields } from '@/features/profile';
import { OnboardingStepLayout } from '../components/OnboardingStepLayout';
import { useOnboardingStep } from '../hooks/useOnboardingStep';

export function PreferencesStepScreen() {
  const { step, stepNumber, totalSteps, draft, update, issues, goNext } = useOnboardingStep('preferences');
  return (
    <OnboardingStepLayout step={step} stepNumber={stepNumber} totalSteps={totalSteps} onAction={goNext}>
      <FoodPreferencesFields draft={draft} onChange={update} issues={issues} />
    </OnboardingStepLayout>
  );
}
