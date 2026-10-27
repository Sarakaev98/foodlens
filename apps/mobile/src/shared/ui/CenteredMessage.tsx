import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Button } from './Button';
import { colors, spacing } from './theme';
import { typography } from './typography';

interface CenteredMessageProps {
  readonly loading?: boolean;
  readonly title?: string;
  readonly description?: string;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
}

/** Полноэкранное состояние: загрузка или ошибка с действием. */
export function CenteredMessage({ loading, title, description, actionLabel, onAction }: CenteredMessageProps) {
  return (
    <View style={styles.container}>
      {loading ? <ActivityIndicator size="large" color={colors.accent} /> : null}
      {title ? <Text style={[typography.label, styles.center]}>{title}</Text> : null}
      {description ? <Text style={[typography.caption, styles.center]}>{description}</Text> : null}
      {actionLabel && onAction ? <Button label={actionLabel} onPress={onAction} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    backgroundColor: colors.background,
  },
  center: { textAlign: 'center' },
});
