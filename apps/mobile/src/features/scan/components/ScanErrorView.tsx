import { Linking, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, colors, spacing, typography } from '@/shared/ui';
import { SCAN_FAILURE_MESSAGES, type ScanFailureCode } from '../scanErrors';

interface ScanErrorViewProps {
  readonly code: ScanFailureCode;
  readonly canRetry: boolean;
  readonly onRetry: () => void;
  readonly onScanAgain: () => void;
  /** Несколько фото: вернуться к ним и убрать неудачное, не начиная заново. */
  readonly onEditPhotos?: () => void;
}

export function ScanErrorView({ code, canRetry, onRetry, onScanAgain, onEditPhotos }: ScanErrorViewProps) {
  const message = SCAN_FAILURE_MESSAGES[code];
  const isPermission = code === 'camera_permission_denied' || code === 'library_permission_denied';

  return (
    <SafeAreaView style={styles.container}>
      <Text style={[typography.title, styles.center]}>{message.title}</Text>
      <Text style={[typography.subtitle, styles.center]}>{message.description}</Text>
      {message.retryable && canRetry ? <Button label="Try Again" onPress={onRetry} /> : null}
      {onEditPhotos ? <Button label="Edit Photos" variant="secondary" onPress={onEditPhotos} /> : null}
      {isPermission ? <Button label="Open Settings" onPress={() => void Linking.openSettings()} /> : null}
      <Button label="Scan Again" variant="secondary" onPress={onScanAgain} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.lg, gap: spacing.md, justifyContent: 'center', backgroundColor: colors.background },
  center: { textAlign: 'center' },
});
