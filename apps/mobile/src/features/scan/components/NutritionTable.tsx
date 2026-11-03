import type { NutrientKey, NutritionFacts } from '@foodlens/core';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '@/shared/ui';
import { NOT_DETECTED_LABEL } from '../productLabels';

const ROWS: readonly { readonly key: NutrientKey; readonly label: string; readonly unit: string; readonly nested?: boolean }[] = [
  { key: 'caloriesKcal', label: 'Energy', unit: 'kcal' },
  { key: 'proteinG', label: 'Protein', unit: 'g' },
  { key: 'carbsG', label: 'Carbohydrates', unit: 'g' },
  { key: 'sugarsG', label: 'of which sugars', unit: 'g', nested: true },
  { key: 'fatG', label: 'Fat', unit: 'g' },
  { key: 'saturatedFatG', label: 'of which saturates', unit: 'g', nested: true },
  { key: 'fiberG', label: 'Fiber', unit: 'g' },
  { key: 'saltG', label: 'Salt', unit: 'g' },
  { key: 'sodiumMg', label: 'Sodium', unit: 'mg' },
];

function formatValue(value: number): string {
  return String(value);
}

/** null показывается как «Not detected», никогда как 0. Выведенные значения помечены «≈». */
export function NutritionTable({ nutrition, estimated = [] }: { readonly nutrition: NutritionFacts; readonly estimated?: readonly string[] }) {
  const isEstimated = (key: NutrientKey) => estimated.includes(key);
  const hasInferred = ROWS.some((row) => nutrition[row.key].provenance === 'inferred' && !isEstimated(row.key));
  const hasEstimated = ROWS.some((row) => nutrition[row.key].value !== null && isEstimated(row.key));
  return (
    <View style={styles.table}>
      {ROWS.map((row) => {
        const nutrient = nutrition[row.key];
        return (
          <View key={row.key} style={styles.row}>
            <Text style={[styles.label, row.nested && styles.nested]}>{row.label}</Text>
            {nutrient.value === null ? (
              <Text style={styles.missing}>{NOT_DETECTED_LABEL}</Text>
            ) : (
              <Text style={styles.value}>
                {nutrient.provenance === 'inferred' || isEstimated(row.key) ? '≈' : ''}
                {formatValue(nutrient.value)} {row.unit}
              </Text>
            )}
          </View>
        );
      })}
      {nutrition.servingSize.value ? (
        <Text style={styles.footnote}>
          Serving: {formatValue(nutrition.servingSize.value.amount)} {nutrition.servingSize.value.unit === 'g' ? 'g' : 'ml'}
        </Text>
      ) : null}
      {hasEstimated ? <Text style={styles.footnote}>Some nutrition values were estimated automatically.</Text> : null}
      {hasInferred ? <Text style={styles.footnote}>≈ calculated from other label values (kJ → kcal, sodium ↔ salt)</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  table: { gap: 2 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  label: { fontSize: 15, color: colors.textPrimary },
  nested: { paddingLeft: spacing.md, color: colors.textSecondary },
  value: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  missing: { fontSize: 15, color: colors.inactive },
  footnote: { fontSize: 12, color: colors.textSecondary, paddingTop: spacing.xs },
});
