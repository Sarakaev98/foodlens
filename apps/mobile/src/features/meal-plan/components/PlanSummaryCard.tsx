import type { MealMacros } from '@foodlens/core';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '@/shared/ui';

interface PlanSummaryCardProps {
  readonly targets: MealMacros;
  /** Сумма блюд. null: плана ещё нет. */
  readonly totals: MealMacros | null;
}

const MACROS: readonly { readonly key: 'proteinG' | 'carbsG' | 'fatG'; readonly label: string }[] = [
  { key: 'proteinG', label: 'Белки' },
  { key: 'carbsG', label: 'Углеводы' },
  { key: 'fatG', label: 'Жиры' },
];

export function PlanSummaryCard({ targets, totals }: PlanSummaryCardProps) {
  return (
    <View style={styles.card}>
      <Text style={typography.caption}>Цель на день</Text>
      <View style={styles.calories}>
        <Text style={styles.kcal}>{Math.round(targets.caloriesKcal)}</Text>
        <Text style={styles.unit}>ккал</Text>
      </View>
      <View style={styles.macros}>
        {MACROS.map(({ key, label }) => (
          <View key={key} style={styles.macro}>
            <Text style={typography.caption}>{label}</Text>
            <Text style={styles.macroValue}>{Math.round(targets[key])} г</Text>
          </View>
        ))}
      </View>
      {totals ? <Text style={typography.caption}>В рационе: {totals.caloriesKcal} ккал · Б {totals.proteinG} · У {totals.carbsG} · Ж {totals.fatG}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.md, gap: spacing.sm, borderRadius: radius.lg, backgroundColor: colors.accentSoft },
  calories: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  kcal: { fontSize: 38, fontWeight: '700', color: colors.accent, fontVariant: ['tabular-nums'] },
  unit: { fontSize: 17, fontWeight: '600', color: colors.accent },
  macros: { flexDirection: 'row', gap: spacing.sm },
  macro: { flex: 1, gap: 2 },
  macroValue: { fontSize: 17, fontWeight: '700', color: colors.textPrimary },
});
