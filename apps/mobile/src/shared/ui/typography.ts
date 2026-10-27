import { StyleSheet } from 'react-native';
import { colors } from './theme';

export const typography = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '700', color: colors.textPrimary },
  subtitle: { fontSize: 15, lineHeight: 21, color: colors.textSecondary },
  label: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  body: { fontSize: 15, color: colors.textPrimary },
  caption: { fontSize: 13, color: colors.textSecondary },
  error: { fontSize: 13, color: colors.danger },
});
