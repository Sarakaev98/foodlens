import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, FormScreen, colors, spacing, typography } from '@/shared/ui';
import type { OnboardingStep } from '../onboardingSteps';

interface OnboardingStepLayoutProps {
  readonly step: OnboardingStep;
  readonly stepNumber: number;
  readonly totalSteps: number;
  readonly children: ReactNode;
  readonly actionLabel?: string;
  readonly onAction: () => void;
  readonly loading?: boolean;
  readonly error?: string | null;
}

export function OnboardingStepLayout({
  step,
  stepNumber,
  totalSteps,
  children,
  actionLabel = 'Next',
  onAction,
  loading,
  error,
}: OnboardingStepLayoutProps) {
  return (
    <FormScreen
      safeTop={stepNumber === 1}
      footer={
        <>
          {error ? <Text style={typography.error}>{error}</Text> : null}
          <Button label={actionLabel} onPress={onAction} loading={loading} />
        </>
      }
    >
      <View style={styles.progressRow}>
        <Text style={typography.caption}>
          Step {stepNumber} of {totalSteps}
        </Text>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${(stepNumber / totalSteps) * 100}%` }]} />
        </View>
      </View>
      <View style={styles.header}>
        <Text style={typography.title}>{step.title}</Text>
        <Text style={typography.subtitle}>{step.subtitle}</Text>
      </View>
      {children}
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  progressRow: { gap: spacing.sm },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: 4, backgroundColor: colors.accent },
  header: { gap: spacing.sm },
});
