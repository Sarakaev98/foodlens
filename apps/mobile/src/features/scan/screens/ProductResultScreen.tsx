import type { Detected, Product } from '@foodlens/core';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, colors, radius, spacing, typography } from '@/shared/ui';
import { NutritionTable } from '../components/NutritionTable';
import { NotDetected, ProductSection } from '../components/ProductSection';
import { ALLERGEN_LABELS, BASIS_LABELS, CATEGORY_LABELS, CONFIDENCE_LABELS, NOT_DETECTED_LABEL } from '../productLabels';
import type { ScanPhoto } from '../types/scan.types';

interface ProductResultScreenProps {
  readonly product: Product;
  readonly photo: ScanPhoto;
  readonly onScanAnother: () => void;
}

function inferredNote(field: Detected<unknown>): string {
  return field.provenance === 'inferred' ? ' (по виду упаковки)' : '';
}

export function ProductResultScreen({ product, photo, onScanAnother }: ProductResultScreenProps) {
  const { name, brand, category, nutrition, ingredients, allergens, additives, confidence } = product;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.identity}>
          <Image source={{ uri: photo.uri }} style={styles.photo} resizeMode="cover" />
          <View style={styles.identityText}>
            <Text style={styles.name} numberOfLines={4}>
              {name.value ?? 'Название не распознано'}
            </Text>
            <Text style={typography.subtitle}>{brand.value ? `Бренд: ${brand.value}` : `Бренд: ${NOT_DETECTED_LABEL.toLowerCase()}`}</Text>
          </View>
        </View>

        <View style={styles.badges}>
          <Text style={styles.badge}>
            {category.value ? `${CATEGORY_LABELS[category.value]}${inferredNote(category)}` : `Категория: ${NOT_DETECTED_LABEL.toLowerCase()}`}
          </Text>
          <Text style={[styles.badge, confidence.overall === 'low' && styles.badgeLow]}>
            Уверенность: {CONFIDENCE_LABELS[confidence.overall]}
          </Text>
        </View>
        {confidence.overall === 'low' ? (
          <Text style={typography.caption}>Фото читается плохо или данных мало. Проверьте значения по упаковке или переснимите.</Text>
        ) : null}

        <ProductSection
          title="Пищевая ценность"
          subtitle={nutrition ? `${BASIS_LABELS[nutrition.basis]} · уверенность ${CONFIDENCE_LABELS[confidence.nutrition ?? 'low']}` : undefined}
        >
          {nutrition ? (
            <NutritionTable nutrition={nutrition} />
          ) : (
            <NotDetected text="Таблица пищевой ценности на фото не найдена. Сфотографируйте её отдельно." />
          )}
        </ProductSection>

        <ProductSection
          title="Состав"
          subtitle={confidence.ingredients ? `уверенность ${CONFIDENCE_LABELS[confidence.ingredients]}` : undefined}
        >
          {ingredients.value ? (
            <Text style={typography.body}>
              {ingredients.value.map((item) => (item.percent !== null ? `${item.name} (${item.percent}%)` : item.name)).join(', ')}
            </Text>
          ) : (
            <NotDetected text={`${NOT_DETECTED_LABEL}: состава на фото нет`} />
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

        <ProductSection title="Пищевые добавки">
          {additives.value === null ? (
            <NotDetected text={NOT_DETECTED_LABEL} />
          ) : additives.value.length === 0 ? (
            <Text style={typography.body}>В составе не найдены</Text>
          ) : (
            additives.value.map((additive) => (
              <Text key={additive.code ?? additive.name} style={typography.body}>
                {[additive.code, additive.name].filter(Boolean).join(' · ')}
              </Text>
            ))
          )}
        </ProductSection>

        <Text style={typography.caption}>
          Данные распознаны AI по фотографии и могут содержать ошибки. Сверяйтесь с упаковкой. Фото не сохраняется.
        </Text>
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
  badgeLow: { color: colors.danger, backgroundColor: '#FDECE3' },
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
