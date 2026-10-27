import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radius, spacing } from './theme';

interface ScreenPlaceholderProps {
  readonly title: string;
  readonly description: string;
  readonly children?: ReactNode;
}

/** Временный экран-заглушка для разделов, которые ещё не реализованы. */
export function ScreenPlaceholder({ title, description, children }: ScreenPlaceholderProps) {
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.content}>
        <Text style={styles.title}>{title}</Text>
        <View style={styles.card}>
          <Text style={styles.description}>{description}</Text>
          {children}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    padding: spacing.md,
    gap: spacing.md,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  card: {
    padding: spacing.md,
    gap: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  description: {
    fontSize: 15,
    lineHeight: 21,
    color: colors.textSecondary,
  },
});
