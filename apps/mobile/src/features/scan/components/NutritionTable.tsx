import type { NutrientKey, NutritionFacts } from '@foodlens/core';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '@/shared/ui';
import { NOT_DETECTED_LABEL } from '../productLabels';

const ROWS: readonly { readonly key: NutrientKey; readonly label: string; readonly unit: string; readonly nested?: boolean }[] = [
  { key: 'caloriesKcal', label: 'Энергия', unit: 'ккал' },
  { key: 'proteinG', label: 'Белки', unit: 'г' },
  { key: 'carbsG', label: 'Углеводы', unit: 'г' },
  { key: 'sugarsG', label: 'в т. ч. сахара', unit: 'г', nested: true },
  { key: 'fatG', label: 'Жиры', unit: 'г' },
  { key: 'saturatedFatG', label: 'в т. ч. насыщенные', unit: 'г', nested: true },
  { key: 'fiberG', label: 'Клетчатка', unit: 'г' },
  { key: 'saltG', label: 'Соль', unit: 'г' },
  { key: 'sodiumMg', label: 'Натрий', unit: 'мг' },
];

function formatValue(value: number): string {
  return String(value).replace('.', ',');
}

/** null показывается как «Не обнаружено», никогда как 0. Выведенные значения помечены «≈». */
export function NutritionTable({ nutrition }: { readonly nutrition: NutritionFacts }) {
  const hasInferred = ROWS.some((row) => nutrition[row.key].provenance === 'inferred');
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
                {nutrient.provenance === 'inferred' ? '≈ ' : ''}
                {formatValue(nutrient.value)} {row.unit}
              </Text>
            )}
          </View>
        );
      })}
      {nutrition.servingSize.value ? (
        <Text style={styles.footnote}>
          Порция: {formatValue(nutrition.servingSize.value.amount)} {nutrition.servingSize.value.unit === 'g' ? 'г' : 'мл'}
        </Text>
      ) : null}
      {hasInferred ? <Text style={styles.footnote}>≈ рассчитано по другим данным этикетки (кДж → ккал, натрий ↔ соль)</Text> : null}
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
