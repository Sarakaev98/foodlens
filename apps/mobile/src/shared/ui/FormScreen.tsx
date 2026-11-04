import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { colors, spacing } from './theme';
import { typography } from './typography';

interface FormScreenProps {
  readonly title?: string;
  readonly subtitle?: string;
  readonly children: ReactNode;
  /** Закреплённая снизу область, например кнопка «Далее». */
  readonly footer?: ReactNode;
  /** false, если верхний отступ уже даёт заголовок навигации. */
  readonly safeTop?: boolean;
  /** false, если нижнюю safe area уже учитывает tab bar. */
  readonly safeBottom?: boolean;
}

export function FormScreen({ title, subtitle, children, footer, safeTop = true, safeBottom = true }: FormScreenProps) {
  const edges: Edge[] = safeTop ? ['top', 'left', 'right'] : ['left', 'right'];
  return (
    <SafeAreaView style={styles.safeArea} edges={edges}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {title ? <Text style={typography.title}>{title}</Text> : null}
          {subtitle ? <Text style={typography.subtitle}>{subtitle}</Text> : null}
          <View style={styles.body}>{children}</View>
        </ScrollView>
        {footer ? <SafeAreaView edges={safeBottom ? ['bottom'] : []} style={styles.footer}>{footer}</SafeAreaView> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { padding: spacing.md, gap: spacing.sm },
  body: { marginTop: spacing.md, gap: spacing.lg },
  footer: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
});
