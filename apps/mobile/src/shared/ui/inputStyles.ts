import { StyleSheet } from 'react-native';
import { colors, radius, spacing } from './theme';

export const inputStyles = StyleSheet.create({
  input: {
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    fontSize: 16,
    color: colors.textPrimary,
  },
  invalid: { borderColor: colors.danger },
});
