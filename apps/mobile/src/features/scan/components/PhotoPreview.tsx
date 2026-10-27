import { Image, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, colors, spacing } from '@/shared/ui';
import type { ScanPhoto } from '../types/scan.types';

interface PhotoPreviewProps {
  readonly photo: ScanPhoto;
  readonly onAnalyze: () => void;
  readonly onRetake: () => void;
}

export function PhotoPreview({ photo, onAnalyze, onRetake }: PhotoPreviewProps) {
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Image source={{ uri: photo.uri }} style={styles.image} resizeMode="contain" accessibilityLabel="Снимок продукта" />
      <View style={styles.actions}>
        <Button label="Анализировать" onPress={onAnalyze} />
        <Button label="Переснять" variant="secondary" onPress={onRetake} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  image: { flex: 1, margin: spacing.md, borderRadius: 12, backgroundColor: '#000' },
  actions: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.sm },
});
