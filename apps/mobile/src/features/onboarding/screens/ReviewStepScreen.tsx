import { useRouter } from 'expo-router';
import { Text } from 'react-native';
import { ProfileSummary, completeDraft, useSaveProfile } from '@/features/profile';
import { typography } from '@/shared/ui';
import { OnboardingStepLayout } from '../components/OnboardingStepLayout';
import { useOnboardingStep } from '../hooks/useOnboardingStep';

export function ReviewStepScreen() {
  const router = useRouter();
  const { step, stepNumber, totalSteps, draft } = useOnboardingStep('review');
  const { saveDraft, saving, error } = useSaveProfile();
  const completed = completeDraft(draft);

  const finish = async () => {
    const saved = await saveDraft(draft);
    if (saved) router.replace('/');
  };

  return (
    <OnboardingStepLayout
      step={step}
      stepNumber={stepNumber}
      totalSteps={totalSteps}
      actionLabel="Continue"
      onAction={finish}
      loading={saving}
      error={error}
    >
      {completed.ok ? (
        <ProfileSummary profile={completed.value} />
      ) : (
        <Text style={typography.error}>Some details are missing. Go back to the previous steps.</Text>
      )}
    </OnboardingStepLayout>
  );
}
