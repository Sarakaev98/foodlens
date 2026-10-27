import { BasicInfoFields } from '@/features/profile';
import { OnboardingStepLayout } from '../components/OnboardingStepLayout';
import { useOnboardingStep } from '../hooks/useOnboardingStep';

export function BasicInfoStepScreen() {
  const { step, stepNumber, totalSteps, draft, update, issues, goNext } = useOnboardingStep('basics');
  return (
    <OnboardingStepLayout step={step} stepNumber={stepNumber} totalSteps={totalSteps} onAction={goNext}>
      <BasicInfoFields draft={draft} onChange={update} issues={issues} />
    </OnboardingStepLayout>
  );
}
