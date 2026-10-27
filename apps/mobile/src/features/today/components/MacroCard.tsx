import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '@/shared/ui';
import { formatInteger } from '../formatNumber';

interface MacroCardProps {
  readonly label: string;
  readonly grams: number;
}

export function MacroCard({ label, grams }: MacroCardProps) {
  return (
    <View style={styles.card}>
      <Text style={typography.caption}>{label}</Text>
      <Text style={styles.value}>
        {formatInteger(grams)} <Text style={styles.unit}>г</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    padding: spacing.md,
    gap: spacing.xs,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  value: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
  unit: { fontSize: 15, fontWeight: '500', color: colors.textSecondary },
});
