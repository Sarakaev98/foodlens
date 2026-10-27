import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, colors, spacing, typography } from '@/shared/ui';
import type { AnalyzingStage } from '../hooks/useProductScan';
import type { ScanPhoto } from '../types/scan.types';

const STAGES: readonly { readonly id: AnalyzingStage; readonly label: string }[] = [
  { id: 'preparing', label: 'Подготовка фото' },
  { id: 'analyzing', label: 'Распознавание упаковки, состава и пищевой ценности' },
];

interface AnalyzingViewProps {
  readonly photo: ScanPhoto;
  readonly stage: AnalyzingStage;
  readonly onCancel: () => void;
}

/** Реальные этапы и прошедшее время, без выдуманных процентов. */
export function AnalyzingView({ photo, stage, onCancel }: AnalyzingViewProps) {
  const seconds = useElapsedSeconds();
  const current = STAGES.findIndex((item) => item.id === stage);

  return (
    <SafeAreaView style={styles.container}>
      <Image source={{ uri: photo.uri }} style={styles.thumbnail} resizeMode="cover" />
      <Text style={typography.title}>Анализируем продукт…</Text>
      <View style={styles.stages}>
        {STAGES.map((item, index) => (
          <View key={item.id} style={styles.stage}>
            {index < current ? (
              <Text style={styles.done}>✓</Text>
            ) : index === current ? (
              <ActivityIndicator color={colors.accent} />
            ) : (
              <Text style={styles.pending}>•</Text>
            )}
            <Text style={[typography.body, index > current && styles.pendingText]}>{item.label}</Text>
          </View>
        ))}
      </View>
      <Text style={typography.caption}>Прошло {seconds} с</Text>
      <Button label="Отменить" variant="secondary" onPress={onCancel} />
    </SafeAreaView>
  );
}

function useElapsedSeconds(): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const startedAt = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);
  return seconds;
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.lg, gap: spacing.md, justifyContent: 'center', backgroundColor: colors.background },
  thumbnail: { width: 96, height: 96, borderRadius: 12, alignSelf: 'center', backgroundColor: colors.border },
  stages: { gap: spacing.sm },
  stage: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  done: { width: 20, textAlign: 'center', color: colors.accent, fontSize: 16, fontWeight: '700' },
  pending: { width: 20, textAlign: 'center', color: colors.inactive, fontSize: 16 },
  pendingText: { color: colors.inactive },
});
