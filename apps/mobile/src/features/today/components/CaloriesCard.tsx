import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '@/shared/ui';
import { formatInteger } from '../formatNumber';

interface CaloriesCardProps {
  readonly caloriesKcal: number;
  /** Съедено за сегодня. Нет: журнал не загружен, показываем только цель. */
  readonly consumedKcal?: number;
}

export function CaloriesCard({ caloriesKcal, consumedKcal }: CaloriesCardProps) {
  if (consumedKcal === undefined) {
    return (
      <View style={styles.card}>
        <Text style={typography.caption}>Daily Goal</Text>
        <View style={styles.valueRow}>
          <Text style={styles.value}>{formatInteger(caloriesKcal)}</Text>
          <Text style={styles.unit}>kcal</Text>
        </View>
      </View>
    );
  }
  const share = caloriesKcal > 0 ? Math.min(1, consumedKcal / caloriesKcal) : 0;
  return (
    <View style={styles.card}>
      <Text style={typography.caption}>Eaten Today</Text>
      <View style={styles.valueRow}>
        <Text style={styles.value}>{formatInteger(consumedKcal)}</Text>
        <Text style={styles.unit}>of {formatInteger(caloriesKcal)} kcal</Text>
      </View>
      <View style={styles.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: caloriesKcal, now: consumedKcal }}>
        <View style={[styles.fill, { width: `${Math.round(share * 100)}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: spacing.lg,
    gap: spacing.xs,
    borderRadius: radius.lg,
    backgroundColor: colors.accentSoft,
  },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  value: { fontSize: 44, fontWeight: '700', color: colors.accent },
  unit: { fontSize: 18, fontWeight: '600', color: colors.accent },
  track: { height: 8, marginTop: spacing.sm, borderRadius: 4, backgroundColor: colors.surface, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4, backgroundColor: colors.accent },
});
