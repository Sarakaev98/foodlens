import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from './Button';
import { inputStyles } from './inputStyles';
import { colors, spacing } from './theme';

interface TagInputProps {
  readonly values: readonly string[];
  readonly onChange: (values: string[]) => void;
  readonly placeholder?: string;
  readonly accessibilityLabel: string;
  readonly maxLength?: number;
}

/** Список строк, вводимых пользователем: поле + кнопка «Добавить» + удаляемые чипы. */
export function TagInput({ values, onChange, placeholder, accessibilityLabel, maxLength }: TagInputProps) {
  const [text, setText] = useState('');

  const add = () => {
    const value = text.trim();
    if (value && !values.some((item) => item.toLowerCase() === value.toLowerCase())) {
      onChange([...values, value]);
    }
    setText('');
  };

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <TextInput
          accessibilityLabel={accessibilityLabel}
          value={text}
          onChangeText={setText}
          onSubmitEditing={add}
          placeholder={placeholder}
          placeholderTextColor={colors.inactive}
          maxLength={maxLength}
          returnKeyType="done"
          style={[inputStyles.input, styles.input]}
        />
        <Button label="Add" variant="secondary" onPress={add} disabled={text.trim() === ''} />
      </View>
      {values.length > 0 ? (
        <View style={styles.tags}>
          {values.map((value) => (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${value}`}
              onPress={() => onChange(values.filter((item) => item !== value))}
              style={styles.tag}
            >
              <Text style={styles.tagLabel}>{value} ✕</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
  input: { flex: 1, minWidth: 0 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tag: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.accentSoft,
  },
  tagLabel: { fontSize: 14, color: colors.accent },
});
