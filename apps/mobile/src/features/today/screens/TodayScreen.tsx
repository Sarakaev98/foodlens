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
        title="Не удалось загрузить цели"
        description="Проверьте подключение к интернету"
        actionLabel="Повторить"
        onAction={targets.reload}
      />
    );
  }

  const { caloriesKcal, proteinG, carbsG, fatG } = targets.targets;
  const eaten = log?.totals;
  return (
    <FormScreen title="Сегодня">
      <CaloriesCard caloriesKcal={caloriesKcal} consumedKcal={eaten?.caloriesKcal} />
      <View style={styles.macros}>
        <MacroCard label="Белки" grams={proteinG} consumedG={eaten?.proteinG} />
        <MacroCard label="Углеводы" grams={carbsG} consumedG={eaten?.carbsG} />
        <MacroCard label="Жиры" grams={fatG} consumedG={eaten?.fatG} />
      </View>
      {log && log.entries.length > 0 ? (
        <View style={styles.entries}>
          <Text style={typography.subtitle}>Съедено</Text>
          {log.entries.map((entry) => (
            <View key={entry.id} style={styles.entry}>
              <Text style={[typography.body, styles.entryName]} numberOfLines={2}>
                {entry.name}
              </Text>
              <Text style={typography.body}>≈{formatInteger(entry.caloriesKcal)} ккал</Text>
            </View>
          ))}
        </View>
      ) : null}
      <Text style={typography.caption}>
        Это приблизительная персональная оценка на основе вашего профиля, а не медицинская рекомендация. Цели
        пересчитываются автоматически при изменении профиля.
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
