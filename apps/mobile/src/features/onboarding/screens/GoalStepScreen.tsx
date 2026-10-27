import { GoalField } from '@/features/profile';
import { OnboardingStepLayout } from '../components/OnboardingStepLayout';
import { useOnboardingStep } from '../hooks/useOnboardingStep';

export function GoalStepScreen() {
  const { step, stepNumber, totalSteps, draft, update, issues, goNext } = useOnboardingStep('goal');
  return (
    <OnboardingStepLayout step={step} stepNumber={stepNumber} totalSteps={totalSteps} onAction={goNext}>
      <GoalField draft={draft} onChange={update} issues={issues} />
    </OnboardingStepLayout>
  );
}
