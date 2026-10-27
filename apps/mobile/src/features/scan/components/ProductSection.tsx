import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '@/shared/ui';

interface ProductSectionProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly children: ReactNode;
}

export function ProductSection({ title, subtitle, children }: ProductSectionProps) {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={typography.caption}>{subtitle}</Text> : null}
      </View>
      {children}
    </View>
  );
}

export function NotDetected({ text }: { readonly text: string }) {
  return <Text style={styles.notDetected}>{text}</Text>;
}

const styles = StyleSheet.create({
  card: {
    padding: spacing.md,
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: spacing.sm },
  title: { fontSize: 17, fontWeight: '700', color: colors.textPrimary },
  notDetected: { fontSize: 15, color: colors.inactive },
});
