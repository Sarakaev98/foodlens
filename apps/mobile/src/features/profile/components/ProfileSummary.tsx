import { normalizeDietaryPreferences, type UserNutritionProfileInput } from '@foodlens/core';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '@/shared/ui';
import {
  ACTIVITY_LEVEL_LABELS,
  ALLERGEN_LABELS,
  DIETARY_PREFERENCE_LABELS,
  GOAL_LABELS,
  SEX_LABELS,
} from '../profile.labels';

function joinOrDash(values: readonly string[]): string {
  return values.length > 0 ? values.join(', ') : '—';
}

/** Сводка профиля только для чтения (Profile, шаг Review в onboarding). */
export function ProfileSummary({ profile }: { readonly profile: UserNutritionProfileInput }) {
  const rows: [string, string][] = [
    ['Цель', GOAL_LABELS[profile.goal]],
    ['Возраст', `${profile.age} лет`],
    ['Пол', SEX_LABELS[profile.sex]],
    ['Рост', `${profile.heightCm} см`],
    ['Вес', `${profile.weightKg} кг`],
    ['Активность', ACTIVITY_LEVEL_LABELS[profile.activityLevel].label],
    ['Тип питания', joinOrDash(normalizeDietaryPreferences(profile.dietaryPreferences).map((value) => DIETARY_PREFERENCE_LABELS[value]))],
    ['Аллергены', joinOrDash(profile.allergens.map((value) => ALLERGEN_LABELS[value]))],
    ['Не хочу в составе', joinOrDash(profile.avoidedIngredients)],
  ];

  return (
    <View style={styles.card}>
      {rows.map(([label, value], index) => (
        <View key={label} style={[styles.row, index > 0 && styles.divider]}>
          <Text style={typography.caption}>{label}</Text>
          <Text style={[typography.body, styles.value]}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: 12,
  },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  value: { flexShrink: 1, textAlign: 'right' },
});
