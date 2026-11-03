import { useRouter } from 'expo-router';
import { Button, FormScreen } from '@/shared/ui';
import { ProfileSummary } from '../components/ProfileSummary';
import { useProfile } from '../state/ProfileProvider';

export function ProfileScreen() {
  const router = useRouter();
  const state = useProfile();
  const profile = state.status === 'ready' ? state.profile : null;

  if (!profile) return null;

  return (
    <FormScreen
      title="Profile"
      subtitle="We use this to personalize your recommendations."
      footer={<Button label="Edit" variant="secondary" onPress={() => router.push('/profile-edit')} />}
    >
      <ProfileSummary profile={profile} />
    </FormScreen>
  );
}
