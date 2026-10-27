import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { inputStyles } from './inputStyles';
import { colors, spacing } from './theme';

interface NumberInputProps {
  readonly value: number | undefined;
  /** undefined — поле пустое, NaN — введено не число. */
  readonly onChange: (value: number | undefined) => void;
  readonly unit?: string;
  readonly placeholder?: string;
  readonly accessibilityLabel: string;
  readonly invalid?: boolean;
}

function parseNumber(text: string): number | undefined {
  const normalized = text.trim().replace(',', '.');
  return normalized === '' ? undefined : Number(normalized);
}

export function NumberInput({ value, onChange, unit, placeholder, accessibilityLabel, invalid }: NumberInputProps) {
  // Текст хранится отдельно, чтобы не мешать вводу ("80," → "80,5").
  const [text, setText] = useState(value === undefined || Number.isNaN(value) ? '' : String(value));

  return (
    <View style={styles.row}>
      <TextInput
        accessibilityLabel={accessibilityLabel}
        value={text}
        onChangeText={(next) => {
          setText(next);
          onChange(parseNumber(next));
        }}
        keyboardType="decimal-pad"
        placeholder={placeholder}
        placeholderTextColor={colors.inactive}
        style={[inputStyles.input, styles.input, invalid && inputStyles.invalid]}
      />
      {unit ? <Text style={styles.unit}>{unit}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  input: { flex: 1, minWidth: 0 },
  unit: { width: 32, fontSize: 15, color: colors.textSecondary },
});
