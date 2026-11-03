import { MEAL_SLOTS } from '@foodlens/core';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useNutritionTargets } from '@/features/today';
import { Button, CenteredMessage, colors, FormScreen, spacing, typography } from '@/shared/ui';
import { MealCard } from '../components/MealCard';
import { PlanSummaryCard } from '../components/PlanSummaryCard';
import { useMealPlan } from '../hooks/useMealPlan';
import { MEAL_PLAN_FAILURES, MEAL_PLAN_LOADING_TEXT } from '../mealPlanLabels';

export function MealPlanScreen() {
  const { state, generate } = useMealPlan();
  const nutrition = useNutritionTargets();

  if (state.status === 'loading' || nutrition.status === 'loading') return <CenteredMessage loading />;
  if (nutrition.status === 'error') {
    return <CenteredMessage title="Couldn’t Load Goals" description="Check your internet connection" actionLabel="Try Again" onAction={nutrition.reload} />;
  }

  const result = state.status === 'empty' ? null : state.result;
  const day = result?.plan.days[0] ?? null;
  const meals = day ? [...day.meals].sort((a, b) => MEAL_SLOTS.indexOf(a.slot) - MEAL_SLOTS.indexOf(b.slot)) : [];
  const generating = state.status === 'generating';

  return (
    <FormScreen
      title="Your Meal Plan"
      safeBottom={false}
      footer={<Button label={day ? 'Refresh Plan' : 'Create Plan'} onPress={generate} loading={generating} />}
    >
      <PlanSummaryCard targets={nutrition.targets} totals={day?.totals ?? null} />
      {state.status === 'error' ? <Text style={[typography.body, styles.error]}>{MEAL_PLAN_FAILURES[state.failure]}</Text> : null}
      {generating ? (
        <View style={styles.progress}>
          <ActivityIndicator color={colors.accent} size="large" />
          <Text style={[typography.subtitle, styles.center]}>{MEAL_PLAN_LOADING_TEXT}</Text>
        </View>
      ) : day ? (
        <View style={styles.meals}>
          {meals.map((meal) => (
            <MealCard key={meal.id} meal={meal} />
          ))}
          {result?.withinTargets === false ? <Text style={typography.caption}>This plan is slightly off your goal. You can refresh it.</Text> : null}
          <Text style={typography.caption}>This is general guidance based on your profile, not medical advice.</Text>
        </View>
      ) : (
        <Text style={[typography.subtitle, styles.center]}>We’ll build a one-day meal plan around the goal, calories, preferences and allergens in your profile.</Text>
      )}
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  center: { textAlign: 'center' },
  error: { color: colors.danger },
  progress: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xl, paddingHorizontal: spacing.md },
  meals: { gap: spacing.sm },
});
