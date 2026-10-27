import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ChoiceOption } from './ChoiceList';
import { colors, spacing } from './theme';

interface ChipGroupProps<T extends string> {
  readonly options: readonly ChoiceOption<T>[];
  readonly selected: readonly T[];
  readonly onToggle: (value: T) => void;
}

/** Множественный выбор в виде чипов. */
export function ChipGroup<T extends string>({ options, selected, onToggle }: ChipGroupProps<T>) {
  return (
    <View style={styles.group}>
      {options.map((option) => {
        const isSelected = selected.includes(option.value);
        return (
          <Pressable
            key={option.value}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: isSelected }}
            onPress={() => onToggle(option.value)}
            style={[styles.chip, isSelected && styles.chipSelected]}
          >
            <Text style={[styles.label, isSelected && styles.labelSelected]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: spacing.sm,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipSelected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  label: { fontSize: 14, color: colors.textPrimary },
  labelSelected: { color: colors.accent, fontWeight: '600' },
});
