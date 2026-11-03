import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, colors, spacing, typography } from '@/shared/ui';
import type { ScanMode, ScanPhoto } from '../types/scan.types';

export const ANALYZING_STAGES: Readonly<Record<ScanMode, readonly string[]>> = {
  product: ['Распознаём продукт', 'Ищем данные', 'Анализируем состав', 'Рассчитываем оценку'],
  label: ['Распознаём таблицу', 'Анализируем состав', 'Рассчитываем оценку'],
};

/** Сервер отвечает одним ответом, поэтому этапы идут по времени; последний ждёт результата. */
export const STAGE_MS = 2500;

export function currentStage(elapsedMs: number, stages: number): number {
  return Math.min(stages - 1, Math.floor(elapsedMs / STAGE_MS));
}

interface AnalyzingViewProps {
  readonly photo: ScanPhoto | null;
  readonly mode: ScanMode;
  readonly onCancel: () => void;
}

export function AnalyzingView({ photo, mode, onCancel }: AnalyzingViewProps) {
  const stages = ANALYZING_STAGES[mode];
  const current = currentStage(useElapsedMs(), stages.length);

  return (
    <SafeAreaView style={styles.container}>
      {photo ? <Image source={{ uri: photo.uri }} style={styles.thumbnail} resizeMode="cover" /> : null}
      <View style={styles.stages}>
        {stages.map((label, index) => (
          <View key={label} style={styles.stage}>
            {index < current ? (
              <Text style={styles.done}>✓</Text>
            ) : index === current ? (
              <ActivityIndicator color={colors.accent} />
            ) : (
              <Text style={styles.pending}>•</Text>
            )}
            <Text style={[typography.body, index === current && styles.currentText, index > current && styles.pendingText]}>{label}</Text>
          </View>
        ))}
      </View>
      <Button label="Отменить" variant="secondary" onPress={onCancel} />
    </SafeAreaView>
  );
}

function useElapsedMs(): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const startedAt = Date.now();
    const timer = setInterval(() => setElapsed(Date.now() - startedAt), 250);
    return () => clearInterval(timer);
  }, []);
  return elapsed;
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.lg, gap: spacing.lg, justifyContent: 'center', backgroundColor: colors.background },
  thumbnail: { width: 112, height: 112, borderRadius: 16, alignSelf: 'center', backgroundColor: colors.border },
  stages: { gap: spacing.md, alignSelf: 'center' },
  stage: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  done: { width: 20, textAlign: 'center', color: colors.accent, fontSize: 16, fontWeight: '700' },
  pending: { width: 20, textAlign: 'center', color: colors.inactive, fontSize: 16 },
  currentText: { fontWeight: '600' },
  pendingText: { color: colors.inactive },
});
