import type { Detected, Product, ProductScore } from '@foodlens/core';
import { Image, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GoalMatchCard, type AnyGoalMatch } from '@/features/goal-match';
import { ProductScoreCard } from '@/features/product-score';
import { Button, colors, radius, spacing, typography } from '@/shared/ui';
import { NutritionTable } from '../components/NutritionTable';
import { NotDetected, ProductSection } from '../components/ProductSection';
import {
  additiveLabel, ALLERGEN_LABELS, BASIS_LABELS, CATEGORY_LABELS, isForeignText, NOT_DETECTED_LABEL, ORIGINAL_TEXT_LABEL,
  usesFatSecret, usesOpenFoodFacts,
} from '../productLabels';
import type { ScanPhoto } from '../types/scan.types';

interface ProductResultScreenProps {
  readonly product: Product;
  readonly score: ProductScore;
  readonly goalMatch: AnyGoalMatch;
  readonly photo: ScanPhoto | null;
  readonly barcode?: string | null;
  /** Есть, если стоит доснять таблицу питания. */
  readonly onTakeNutritionPhoto?: () => void;
  readonly onScanAnother: () => void;
}

/** Оценка сравнивает значения на 100 мл для напитков и на 100 г для остального. */
function nutritionPer(product: Product): 'g' | 'ml' {
  const nutrition = product.nutrition;
  if (!nutrition) return 'g';
  return nutrition.basis === 'per_100ml' || nutrition.servingSize.value?.unit === 'ml' ? 'ml' : 'g';
}

function inferredNote(field: Detected<unknown>): string {
  return field.provenance === 'inferred' ? ' (по виду упаковки)' : '';
}

export function ProductResultScreen({ product, score, goalMatch, photo, barcode, onTakeNutritionPhoto, onScanAnother }: ProductResultScreenProps) {
  const { name, brand, category, nutrition, ingredients, allergens, additives } = product;
  const estimated = [...new Set([
    ...(product.fieldEvidence?.filter(item => item.dataQuality === 'estimated').map(item => item.field) ?? []),
    ...Object.entries(product.nutritionMetadata?.fields ?? {}).filter(([, item]) => item.quality !== 'verified').map(([key]) => key),
  ])];
  const foreignIngredients = ingredients.value?.some((item) => isForeignText(item.name)) ?? false;
  const foreignAdditives = additives.value?.some((item) => !item.code && item.name !== null && isForeignText(item.name)) ?? false;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.identity}>
          {photo ? <Image source={{ uri: photo.uri }} style={styles.photo} resizeMode="cover" /> : null}
          <View style={styles.identityText}>
            <Text style={styles.name} numberOfLines={4}>
              {name.value ?? 'Отсканированный продукт'}
            </Text>
            {barcode ? <Text style={typography.caption}>Штрихкод: {barcode}</Text> : null}
            {brand.value ? <Text style={typography.subtitle}>{brand.value}</Text> : null}
          </View>
        </View>

        {onTakeNutritionPhoto ? (
          <View style={styles.photoHint}>
            <Text style={typography.subtitle}>Данные о питании неполные. Сфотографируйте таблицу на упаковке, чтобы уточнить оценку.</Text>
            <Button label="Сфотографировать таблицу" onPress={onTakeNutritionPhoto} />
          </View>
        ) : null}

        {category.value ? (
          <View style={styles.badges}>
            <Text style={styles.badge}>{`${CATEGORY_LABELS[category.value]}${inferredNote(category)}`}</Text>
          </View>
        ) : null}

        <ProductScoreCard score={score} per={nutritionPer(product)} estimated={estimated.length > 0 || product.nutritionMetadata?.basis.quality === 'estimated'} />
        <GoalMatchCard goalMatch={goalMatch} product={product} />

        <ProductSection
          title="Пищевая ценность"
          subtitle={nutrition ? BASIS_LABELS[nutrition.basis] : undefined}
        >
          {nutrition ? (
            <NutritionTable nutrition={nutrition} estimated={estimated} />
          ) : (
            <NotDetected text="Таблица пищевой ценности не найдена. Сфотографируйте её отдельно." />
          )}
        </ProductSection>

        <ProductSection
          title="Состав"
          subtitle={foreignIngredients ? ORIGINAL_TEXT_LABEL : undefined}
        >
          {ingredients.value ? (
            <Text style={typography.body}>
              {ingredients.value.map((item) => (item.percent !== null ? `${item.name} (${item.percent}%)` : item.name)).join(', ')}
            </Text>
          ) : (
            <NotDetected text="Состав не найден" />
          )}
        </ProductSection>

        <ProductSection title="Аллергены">
          {allergens.value === null ? (
            <NotDetected text={NOT_DETECTED_LABEL} />
          ) : allergens.value.length === 0 ? (
            <Text style={typography.body}>На упаковке не указаны</Text>
          ) : (
            <View style={styles.chips}>
              {allergens.value.map((allergen) => (
                <Text key={allergen.code} style={[styles.chip, allergen.presence === 'contains' && styles.chipStrong]}>
                  {allergen.presence === 'may_contain' ? 'Может содержать: ' : ''}
                  {ALLERGEN_LABELS[allergen.code]}
                  {allergen.provenance === 'inferred' ? ' (по составу)' : ''}
                </Text>
              ))}
            </View>
          )}
        </ProductSection>

        <ProductSection title="Пищевые добавки" subtitle={foreignAdditives ? ORIGINAL_TEXT_LABEL : undefined}>
          {additives.value === null ? (
            <NotDetected text={NOT_DETECTED_LABEL} />
          ) : additives.value.length === 0 ? (
            <Text style={typography.body}>В составе не найдены</Text>
          ) : (
            additives.value.map((additive) => (
              <Text key={additive.code ?? additive.name} style={typography.body}>
                {additiveLabel(additive)}
              </Text>
            ))
          )}
        </ProductSection>

        <Text style={typography.caption}>
          Данные могут содержать неточности, сверяйтесь с упаковкой. Фото не сохраняется.
        </Text>
        {usesOpenFoodFacts(product) ? (
          <Text style={typography.caption} accessibilityRole="link" onPress={() => void Linking.openURL('https://world.openfoodfacts.org')}>
            Часть данных: Open Food Facts, лицензия ODbL.
          </Text>
        ) : null}
        {usesFatSecret(product) ? (
          <Text style={typography.caption} accessibilityRole="link" onPress={() => void Linking.openURL('https://platform.fatsecret.com')}>
            Powered by fatsecret Platform API
          </Text>
        ) : null}
        <Button label="Сканировать другой продукт" onPress={onScanAnother} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  identity: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  identityText: { flex: 1, minWidth: 0, gap: spacing.xs },
  name: { fontSize: 22, lineHeight: 27, fontWeight: '700', color: colors.textPrimary },
  photoHint: { gap: spacing.sm },
  photo: { width: 84, height: 84, borderRadius: radius.md, backgroundColor: colors.border },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  badge: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.accent,
    backgroundColor: colors.accentSoft,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    overflow: 'hidden',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    fontSize: 14,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    overflow: 'hidden',
  },
  chipStrong: { borderColor: colors.danger, color: colors.danger, fontWeight: '600' },
});
