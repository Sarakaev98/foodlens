import { StyleSheet, Text, View } from 'react-native';
import { CenteredMessage, colors, FormScreen, radius, spacing, typography } from '@/shared/ui';
import { CaloriesCard } from '../components/CaloriesCard';
import { MacroCard } from '../components/MacroCard';
import { formatInteger } from '../formatNumber';
import { useNutritionTargets } from '../hooks/useNutritionTargets';
import { useTodayLog } from '../hooks/useTodayLog';

export function TodayScreen() {
  const targets = useNutritionTargets();
  const log = useTodayLog();

  if (targets.status === 'loading') return <CenteredMessage loading />;
  if (targets.status === 'error') {
    return (
      <CenteredMessage
        title="Couldn’t Load Goals"
        description="Check your internet connection"
        actionLabel="Try Again"
        onAction={targets.reload}
      />
    );
  }

  const { caloriesKcal, proteinG, carbsG, fatG } = targets.targets;
  const eaten = log?.totals;
  return (
    <FormScreen title="Today">
      <CaloriesCard caloriesKcal={caloriesKcal} consumedKcal={eaten?.caloriesKcal} />
      <View style={styles.macros}>
        <MacroCard label="Protein" grams={proteinG} consumedG={eaten?.proteinG} />
        <MacroCard label="Carbs" grams={carbsG} consumedG={eaten?.carbsG} />
        <MacroCard label="Fat" grams={fatG} consumedG={eaten?.fatG} />
      </View>
      {log && log.entries.length > 0 ? (
        <View style={styles.entries}>
          <Text style={typography.subtitle}>Eaten</Text>
          {log.entries.map((entry) => (
            <View key={entry.id} style={styles.entry}>
              <Text style={[typography.body, styles.entryName]} numberOfLines={2}>
                {entry.name}
              </Text>
              <Text style={typography.body}>≈{formatInteger(entry.caloriesKcal)} kcal</Text>
            </View>
          ))}
        </View>
      ) : null}
      <Text style={typography.caption}>
        This is an approximate personal estimate based on your profile, not medical advice. Goals update
        automatically when you change your profile.
      </Text>
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  macros: { flexDirection: 'row', gap: spacing.sm },
  entries: {
    padding: spacing.md,
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  entry: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  entryName: { flex: 1 },
});
