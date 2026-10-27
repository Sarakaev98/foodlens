import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { spacing } from './theme';
import { typography } from './typography';

interface FormFieldProps {
  readonly label: string;
  readonly hint?: string;
  readonly error?: string;
  readonly children: ReactNode;
}

export function FormField({ label, hint, error, children }: FormFieldProps) {
  return (
    <View style={styles.field}>
      <Text style={typography.label}>{label}</Text>
      {hint ? <Text style={typography.caption}>{hint}</Text> : null}
      {children}
      {error ? <Text style={typography.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.sm },
});
