import { Stack } from 'expo-router';
import { OnboardingDraftProvider } from '@/features/onboarding';
import { colors } from '@/shared/ui';

export default function OnboardingLayout() {
  return (
    <OnboardingDraftProvider>
      <Stack
        screenOptions={{
          title: '',
          headerBackTitle: 'Back',
          headerShadowVisible: false,
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.accent,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
      </Stack>
    </OnboardingDraftProvider>
  );
}
