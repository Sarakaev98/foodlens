import { saltGFromSodiumMg, type NutrientValue, type NutritionFacts, type Product } from '@foodlens/core';

/** Калории и БЖУ могут расходиться из-за клетчатки и полиолов: подозрительным считается только заметное расхождение. */
const KCAL_MARGIN = { relative: 0.15, absolute: 30 };
const SUBSET_MARGIN = 0.5;
const SALT_MARGIN = { relative: 0.25, absolute: 0.2 };
const MAX_GRAMS = 100;
const MAX_KCAL = 900;

/** Значения с этикетки не проверяются: фото главнее внутренних сверок. */
const fromBase = ({ value, provenance }: NutrientValue): number | null => (provenance === 'observed' ? null : value);
const broken = (value: number | null, max: number): boolean => value !== null && (!Number.isFinite(value) || value < 0 || value > max);

function caloriesConflict(n: NutritionFacts): boolean {
  const [kcal, protein, carbs, fat] = [fromBase(n.caloriesKcal), n.proteinG.value, n.carbsG.value, n.fatG.value];
  if (kcal === null || protein === null || carbs === null || fat === null) return false;
  const expected = 4 * protein + 4 * carbs + 9 * fat;
  return Math.abs(kcal - expected) > Math.max(KCAL_MARGIN.relative * expected, KCAL_MARGIN.absolute);
}

function saltConflict(n: NutritionFacts): boolean {
  const [salt, sodium] = [n.saltG.value, n.sodiumMg.value];
  if (fromBase(n.saltG) === null || sodium === null || salt === null) return false;
  const expected = saltGFromSodiumMg(sodium);
  return Math.abs(salt - expected) > Math.max(SALT_MARGIN.relative * expected, SALT_MARGIN.absolute);
}

/**
 * Поля записи базы, которые противоречат сами себе. Детерминированно, без сети.
 * Они проверяются в вебе, даже если запись формально полная. Пустой список: запись выглядит правдоподобно.
 */
export function nutritionAnomalies(product: Product): readonly string[] {
  const n = product.nutrition;
  if (!n) return [];
  const known = (['kcal', 'protein', 'carbs', 'fat'] as const).filter((field) => ({ kcal: n.caloriesKcal, protein: n.proteinG, carbs: n.carbsG, fat: n.fatG })[field].value !== null);
  if (n.basis === 'unknown') return known;
  const perHundred = n.basis !== 'per_serving';
  const grams = perHundred ? MAX_GRAMS : Number.POSITIVE_INFINITY;
  const found = new Set<string>();
  if (broken(fromBase(n.caloriesKcal), perHundred ? MAX_KCAL : Number.POSITIVE_INFINITY) || caloriesConflict(n)) found.add('kcal');
  for (const [field, value] of [['protein', n.proteinG], ['carbs', n.carbsG], ['fat', n.fatG], ['sugars', n.sugarsG], ['saturatedFat', n.saturatedFatG], ['salt', n.saltG]] as const) {
    if (broken(fromBase(value), grams)) found.add(field);
  }
  const [sugars, carbs, saturated, fat] = [fromBase(n.sugarsG), n.carbsG.value, fromBase(n.saturatedFatG), n.fatG.value];
  if (sugars !== null && carbs !== null && sugars > carbs + SUBSET_MARGIN) found.add('sugars');
  if (saturated !== null && fat !== null && saturated > fat + SUBSET_MARGIN) found.add('saturatedFat');
  if (saltConflict(n)) found.add('salt');
  return [...found];
}
