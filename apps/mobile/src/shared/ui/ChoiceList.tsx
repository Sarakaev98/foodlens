import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from './theme';
import { typography } from './typography';

export interface ChoiceOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly description?: string;
}

interface ChoiceListProps<T extends string> {
  readonly options: readonly ChoiceOption<T>[];
  readonly value: T | undefined;
  readonly onChange: (value: T) => void;
}

/** Выбор одного варианта из списка карточек. */
export function ChoiceList<T extends string>({ options, value, onChange }: ChoiceListProps<T>) {
  return (
    <View style={styles.list}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={[styles.option, selected && styles.selected]}
          >
            <Text style={[typography.body, selected && styles.selectedLabel]}>{option.label}</Text>
            {option.description ? <Text style={typography.caption}>{option.description}</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  option: {
    padding: spacing.md,
    gap: spacing.xs,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  selected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  selectedLabel: { fontWeight: '600', color: colors.accent },
});
