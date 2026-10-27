import { ActivityLevelField } from '@/features/profile';
import { OnboardingStepLayout } from '../components/OnboardingStepLayout';
import { useOnboardingStep } from '../hooks/useOnboardingStep';

export function ActivityStepScreen() {
  const { step, stepNumber, totalSteps, draft, update, issues, goNext } = useOnboardingStep('activity');
  return (
    <OnboardingStepLayout step={step} stepNumber={stepNumber} totalSteps={totalSteps} onAction={goNext}>
      <ActivityLevelField draft={draft} onChange={update} issues={issues} />
    </OnboardingStepLayout>
  );
}
