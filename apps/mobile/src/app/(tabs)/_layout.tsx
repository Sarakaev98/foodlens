import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import type { BottomTabNavigationOptions } from 'expo-router/tabs';
import type { ComponentProps } from 'react';
import { useFeatureFlag } from '@/shared/feature-flags';
import { colors } from '@/shared/ui';

type IconName = ComponentProps<typeof Ionicons>['name'];

function tabIcon(name: IconName): BottomTabNavigationOptions['tabBarIcon'] {
  return ({ focused, size }) => (
    <Ionicons name={name} size={size} color={focused ? colors.accent : colors.inactive} />
  );
}

export default function TabsLayout() {
  const mealPlanEnabled = useFeatureFlag('mealPlan');

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.inactive,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Today', tabBarIcon: tabIcon('today-outline') }} />
      <Tabs.Screen name="scan" options={{ title: 'Scan', tabBarIcon: tabIcon('scan-outline') }} />
      <Tabs.Protected guard={mealPlanEnabled}>
        <Tabs.Screen name="plan" options={{ title: 'Plan', tabBarIcon: tabIcon('restaurant-outline') }} />
      </Tabs.Protected>
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: tabIcon('person-outline') }} />
    </Tabs>
  );
}
