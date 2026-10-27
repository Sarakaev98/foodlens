import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ProfileProvider, useProfile } from '@/features/profile';
import { API_URL } from '@/shared/api';
import { FeatureFlagsProvider } from '@/shared/feature-flags';
import { CenteredMessage, colors } from '@/shared/ui';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <FeatureFlagsProvider>
        <ProfileProvider>
          <StatusBar style="dark" />
          <RootNavigator />
        </ProfileProvider>
      </FeatureFlagsProvider>
    </SafeAreaProvider>
  );
}

/** Без профиля доступен только onboarding, с профилем только основное приложение. */
function RootNavigator() {
  const profile = useProfile();

  if (profile.status === 'loading') return <CenteredMessage loading />;
  if (profile.status === 'error') {
    return (
      <CenteredMessage
        title="Не удалось подключиться к серверу"
        description={`Проверьте, что API запущен: ${API_URL}`}
        actionLabel="Повторить"
        onAction={profile.reload}
      />
    );
  }

  const hasProfile = profile.profile !== null;
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Protected guard={hasProfile}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="profile-edit"
          options={{ headerShown: true, title: 'Изменить профиль', headerBackTitle: 'Назад' }}
        />
      </Stack.Protected>
      <Stack.Protected guard={!hasProfile}>
        <Stack.Screen name="onboarding" />
      </Stack.Protected>
    </Stack>
  );
}
