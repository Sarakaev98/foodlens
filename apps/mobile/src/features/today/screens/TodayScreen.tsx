import { StyleSheet, Text, View } from 'react-native';
import { CenteredMessage, FormScreen, spacing, typography } from '@/shared/ui';
import { CaloriesCard } from '../components/CaloriesCard';
import { MacroCard } from '../components/MacroCard';
import { useNutritionTargets } from '../hooks/useNutritionTargets';

export function TodayScreen() {
  const targets = useNutritionTargets();

  if (targets.status === 'loading') return <CenteredMessage loading />;
  if (targets.status === 'error') {
    return (
      <CenteredMessage
        title="Не удалось загрузить цели"
        description="Проверьте подключение к интернету"
        actionLabel="Повторить"
        onAction={targets.reload}
      />
    );
  }

  const { caloriesKcal, proteinG, carbsG, fatG } = targets.targets;
  return (
    <FormScreen title="Сегодня">
      <CaloriesCard caloriesKcal={caloriesKcal} />
      <View style={styles.macros}>
        <MacroCard label="Белки" grams={proteinG} />
        <MacroCard label="Углеводы" grams={carbsG} />
        <MacroCard label="Жиры" grams={fatG} />
      </View>
      <Text style={typography.caption}>
        Это приблизительная персональная оценка на основе вашего профиля, а не медицинская рекомендация. Цели
        пересчитываются автоматически при изменении профиля.
      </Text>
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  macros: { flexDirection: 'row', gap: spacing.sm },
});
