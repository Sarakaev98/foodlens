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
      title="Профиль"
      subtitle="Эти данные используются для персональных рекомендаций."
      footer={<Button label="Изменить" variant="secondary" onPress={() => router.push('/profile-edit')} />}
    >
      <ProfileSummary profile={profile} />
    </FormScreen>
  );
}
