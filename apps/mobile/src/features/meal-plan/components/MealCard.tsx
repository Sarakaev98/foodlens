import Ionicons from '@expo/vector-icons/Ionicons';
import type { Meal } from '@foodlens/core';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '@/shared/ui';
import { MEAL_SLOT_LABELS } from '../mealPlanLabels';

/** Карточка блюда: главное сразу, ингредиенты и порция по нажатию. */
export function MealCard({ meal }: { readonly meal: Meal }) {
  const [open, setOpen] = useState(false);
  const macros = `P ${Math.round(meal.proteinG)} · C ${Math.round(meal.carbsG)} · F ${Math.round(meal.fatG)}`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityHint="Shows ingredients"
      onPress={() => setOpen((value) => !value)}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.header}>
        <Text style={styles.slot}>{MEAL_SLOT_LABELS[meal.slot]}</Text>
        <Text style={styles.kcal}>{Math.round(meal.caloriesKcal)} kcal</Text>
      </View>
      <Text style={styles.name}>{meal.name}</Text>
      <Text style={typography.subtitle}>{meal.description}</Text>
      <View style={styles.footer}>
        <Text style={styles.macros}>{macros}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSecondary} />
      </View>
      {open ? (
        <View style={styles.details}>
          <Text style={typography.caption}>{meal.portion}</Text>
          {meal.ingredients.map((ingredient) => (
            <Text key={ingredient} style={typography.body}>
              • {ingredient}
            </Text>
          ))}
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: spacing.md,
    gap: spacing.xs,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pressed: { opacity: 0.85 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  slot: { fontSize: 13, fontWeight: '700', color: colors.accent },
  kcal: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  name: { fontSize: 18, lineHeight: 23, fontWeight: '700', color: colors.textPrimary },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.xs },
  macros: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  details: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    gap: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
