import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '@/shared/ui';
import { formatInteger } from '../formatNumber';

export function CaloriesCard({ caloriesKcal }: { readonly caloriesKcal: number }) {
  return (
    <View style={styles.card}>
      <Text style={typography.caption}>Дневная цель</Text>
      <View style={styles.valueRow}>
        <Text style={styles.value}>{formatInteger(caloriesKcal)}</Text>
        <Text style={styles.unit}>ккал</Text>
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
});
