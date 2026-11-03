import type { MealPhotoEstimate } from '@foodlens/core';
import { useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { addMealEstimateToToday, formatInteger, newTodayEntryId } from '@/features/today';
import { Button, colors, radius, spacing, typography } from '@/shared/ui';
import type { ScanPhoto } from '../types/scan.types';

export const MEAL_ESTIMATE_DISCLAIMER = 'Approximate estimate from the photo. Actual values depend on portion size and cooking method.';

type AddState = 'idle' | 'adding' | 'added' | 'error';

interface MealResultScreenProps {
  readonly estimate: MealPhotoEstimate;
  readonly photo: ScanPhoto;
  readonly onScanAnother: () => void;
  /** Подменяется в тестах. */
  readonly addToToday?: typeof addMealEstimateToToday;
}

/** Диапазон показываем, только если оценка не уверенная; главная цифра всегда одна. */
export function calorieRangeText(estimate: MealPhotoEstimate): string | null {
  if (estimate.confidence === 'high') return null;
  const { min, max } = estimate.calorieRange;
  return min < max ? `≈ ${formatInteger(min)}–${formatInteger(max)} kcal` : null;
}

export function MealResultScreen({ estimate, photo, onScanAnother, addToToday = addMealEstimateToToday }: MealResultScreenProps) {
  // Один id на результат: повтор после ошибки или двойное нажатие сервер не продублирует.
  const [entryId] = useState(newTodayEntryId);
  const [addState, setAddState] = useState<AddState>('idle');
  const { total } = estimate;
  const range = calorieRangeText(estimate);

  const add = () => {
    if (addState === 'adding' || addState === 'added') return;
    setAddState('adding');
    addToToday(entryId, estimate).then(
      () => setAddState('added'),
      () => setAddState('error'),
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.identity}>
          <Image source={{ uri: photo.uri }} style={styles.photo} resizeMode="cover" accessibilityIgnoresInvertColors />
          <Text style={styles.name} numberOfLines={3}>
            {estimate.mealName}
          </Text>
        </View>

        <View style={styles.hero}>
          <Text style={styles.kcal} accessibilityLabel={`About ${formatInteger(total.caloriesKcal)} calories`}>
            ≈{formatInteger(total.caloriesKcal)} <Text style={styles.kcalUnit}>kcal</Text>
          </Text>
          {range ? <Text style={styles.range}>{range}</Text> : null}
          <Text style={styles.heroCaption}>Approximate estimate from photo</Text>
        </View>

        <View style={styles.macros}>
          <Macro label="Protein" grams={total.proteinG} />
          <Macro label="Fat" grams={total.fatG} />
          <Macro label="Carbs" grams={total.carbsG} />
        </View>

        <View style={styles.section}>
          <Text style={typography.subtitle}>What We Found</Text>
          {estimate.items.map((item, index) => (
            <View key={`${item.name}-${index}`} style={styles.item}>
              <Text style={[typography.body, styles.itemName]} numberOfLines={2}>
                {item.name}
              </Text>
              <Text style={styles.itemValue}>≈{formatInteger(item.estimatedGrams)} g</Text>
              <Text style={styles.itemValue}>≈{formatInteger(item.caloriesKcal)} kcal</Text>
            </View>
          ))}
        </View>

        {estimate.assumptions.length > 0 ? <Text style={typography.caption}>{estimate.assumptions.join('. ')}</Text> : null}
        <Text style={typography.caption}>{MEAL_ESTIMATE_DISCLAIMER}</Text>

        {addState === 'added' ? (
          <View style={styles.added} accessibilityLiveRegion="polite">
            <Text style={styles.addedText}>✓ Added to Today</Text>
          </View>
        ) : (
          <Button label={addState === 'error' ? 'Try Adding Again' : 'Add to Today'} loading={addState === 'adding'} onPress={add} />
        )}
        {addState === 'error' ? <Text style={[typography.caption, styles.error]}>Couldn’t add. Check your connection and try again.</Text> : null}
        <Button label="Scan Another Meal" variant="secondary" onPress={onScanAnother} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Macro({ label, grams }: { readonly label: string; readonly grams: number }) {
  return (
    <View style={styles.macro}>
      <Text style={typography.caption}>{label}</Text>
      <Text style={styles.macroValue}>
        ≈{formatInteger(grams)} <Text style={styles.macroUnit}>g</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  photo: { width: 72, height: 72, borderRadius: radius.md, backgroundColor: colors.border },
  name: { flex: 1, fontSize: 20, fontWeight: '700', color: colors.textPrimary },
  hero: { padding: spacing.lg, gap: spacing.xs, borderRadius: radius.lg, backgroundColor: colors.accentSoft, alignItems: 'center' },
  kcal: { fontSize: 48, fontWeight: '800', color: colors.accent },
  kcalUnit: { fontSize: 22, fontWeight: '600' },
  range: { fontSize: 15, fontWeight: '600', color: colors.accent },
  heroCaption: { fontSize: 13, color: colors.textSecondary },
  macros: { flexDirection: 'row', gap: spacing.sm },
  macro: {
    flex: 1,
    padding: spacing.md,
    gap: spacing.xs,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  macroValue: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
  macroUnit: { fontSize: 15, fontWeight: '500', color: colors.textSecondary },
  section: {
    padding: spacing.md,
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  item: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  itemName: { flex: 1 },
  itemValue: { minWidth: 64, textAlign: 'right', fontSize: 15, fontWeight: '600', color: colors.textSecondary },
  added: { minHeight: 50, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
  addedText: { fontSize: 16, fontWeight: '600', color: colors.accent },
  error: { color: colors.danger, textAlign: 'center' },
});
