import type {
  GoalMatch,
  GoalMatchFactor,
  GoalMatchFactorKind,
  GoalMatchFactorLevel,
  GoalMatchLevel,
  GoalMatchPortion,
  GoalMatchUnavailableReason,
  GoalMatchUserPlan,
  NutrientValue,
  NutritionFacts,
  Product,
} from '@foodlens/core';
import { matchEatHealthier } from './goal-match-v3';
import {
  AVOIDED_INGREDIENT_POINTS,
  BASE_MATCH,
  CALORIE_SHARE_LEVELS,
  DIET_CONFLICTS,
  ENERGY_DENSITY_LEVELS,
  GOAL_MATCH_VERSION,
  GOAL_RULES,
  MATCH_LEVELS,
  MATCH_MAX,
  MATCH_MIN,
  MAY_CONTAIN_ALLERGEN_POINTS,
  MIN_KCAL_FOR_RATIOS,
  RATIO_LEVELS,
  dailyAmount,
  type MatchCurve,
  type RatioKind,
} from './goal-match-rules';

const RATIO_NUTRIENTS: Readonly<Record<RatioKind, keyof NutritionFacts>> = {
  protein: 'proteinG',
  fat: 'fatG',
  carbs: 'carbsG',
  sugars: 'sugarsG',
  saturatedFat: 'saturatedFatG',
  salt: 'saltG',
};

/** Значения с этикетки на основе nutrition.basis и множитель, переводящий их в выбранную порцию. */
interface PortionScale {
  readonly portion: GoalMatchPortion;
  /** null: порции нет (per_100), доли дневных целей на порцию не считаются. */
  readonly toPortion: number | null;
  /** Множитель к значениям на 100 г еды. null: напиток или вес порции неизвестен. */
  readonly toPer100g: number | null;
}

/**
 * Насколько продукт подходит цели пользователя, 0–100. Чистая функция: тот же Product и план — тот же результат.
 * Product Score сюда не передаётся и от плана не зависит. AI здесь не участвует.
 * plan = null: профиля нет, угадывать цели нельзя.
 */
export function matchGoal(product: Product, plan: GoalMatchUserPlan | null): GoalMatch {
  if (!plan) return goalMatchUnavailable('no_profile');

  const restrictions = [allergensFactor(product, plan), dietFactor(product, plan), avoidedIngredientsFactor(product, plan)].filter(
    (item): item is GoalMatchFactor => item !== null,
  );
  if (plan.goal === 'eat_healthier') return matchEatHealthier(product, plan, restrictions);
  const conflict = restrictions.some((item) => item.level === 'conflict' && item.kind !== 'avoidedIngredients');

  const nutrition = product.nutrition;
  const scale = nutrition ? portionScale(nutrition) : null;
  const unavailableReason: GoalMatchUnavailableReason | null = !nutrition
    ? 'no_nutrition'
    : !scale
      ? 'unknown_basis'
      : nutrition.caloriesKcal.value === null
        ? 'no_calories'
        : null;

  if (conflict) {
    // Противоречие профилю важнее любых цифр: value 0 даже без таблицы пищевой ценности.
    const factors = nutrition && scale && !unavailableReason ? [...nutrientFactors(nutrition, scale, plan), ...restrictions] : restrictions;
    return result(0, 'conflict', null, plan, scale?.portion ?? null, factors);
  }
  if (unavailableReason || !nutrition || !scale) {
    return result(null, null, unavailableReason, plan, scale?.portion ?? null, restrictions.map(withoutPoints));
  }

  const factors = [...nutrientFactors(nutrition, scale, plan), ...restrictions];
  const value = clampMatch(factors.reduce((sum, item) => sum + item.points, BASE_MATCH));
  return result(value, matchLevel(value), null, plan, scale.portion, factors);
}

/** Goal Match без значения: профиля нет или его не удалось загрузить. */
export function goalMatchUnavailable(reason: 'no_profile' | 'profile_unavailable'): GoalMatch {
  return { value: null, level: null, unavailableReason: reason, goal: null, portion: null, factors: [], version: GOAL_MATCH_VERSION };
}

export function matchLevel(value: number): Exclude<GoalMatchLevel, 'conflict'> {
  if (value >= MATCH_LEVELS.great) return 'great';
  if (value >= MATCH_LEVELS.good) return 'good';
  if (value >= MATCH_LEVELS.fair) return 'fair';
  return 'poor';
}

/** Линейная интерполяция по точкам кривой, за краями — значение крайней точки. */
export function curvePoints(curve: MatchCurve, x: number): number {
  const first = curve[0]!;
  const last = curve[curve.length - 1]!;
  if (x <= first[0]) return first[1];
  if (x >= last[0]) return last[1];
  for (let index = 1; index < curve.length; index++) {
    const [x1, y1] = curve[index]!;
    const [x0, y0] = curve[index - 1]!;
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return last[1];
}

function result(
  value: number | null,
  level: GoalMatchLevel | null,
  unavailableReason: GoalMatchUnavailableReason | null,
  plan: GoalMatchUserPlan,
  portion: GoalMatchPortion | null,
  factors: readonly GoalMatchFactor[],
): GoalMatch {
  return { value, level, unavailableReason, goal: plan.goal, portion, factors, version: GOAL_MATCH_VERSION };
}

function clampMatch(raw: number): number {
  return Math.round(Math.min(MATCH_MAX, Math.max(MATCH_MIN, raw)));
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function factor(
  kind: GoalMatchFactorKind,
  level: GoalMatchFactorLevel,
  points: number,
  value: number | null,
  portionShare: number | null = null,
  matches: readonly string[] = [],
): GoalMatchFactor {
  const impact = points > 0 ? 'positive' : points < 0 || level === 'conflict' ? 'negative' : 'neutral';
  return { id: `${kind}.${level}`, kind, level, impact, points: round(points, 2) || 0, value, portionShare, matches };
}

function withoutPoints(item: GoalMatchFactor): GoalMatchFactor {
  return { ...item, points: 0 };
}

/**
 * Порция для сравнения с дневными целями. Размер порции только с этикетки: если его нет,
 * сравнение идёт на 100 г/мл и доля дневной нормы калорий не считается.
 */
function portionScale(nutrition: NutritionFacts): PortionScale | null {
  const kcal = nutrition.caloriesKcal.value;
  const size = nutrition.servingSize.value;
  switch (nutrition.basis) {
    case 'per_100g':
    case 'per_100ml': {
      const unit = nutrition.basis === 'per_100ml' ? 'ml' : 'g';
      // Порция в других единицах (мл при значениях на 100 г) не пересчитывается: плотность неизвестна.
      const toPer100g = unit === 'g' ? 1 : null;
      if (!size || size.unit !== unit) {
        return { portion: { basis: 'per_100', amount: 100, unit, caloriesKcal: kcal }, toPortion: null, toPer100g };
      }
      const toPortion = size.amount / 100;
      return {
        portion: { basis: 'serving', amount: size.amount, unit, caloriesKcal: kcal === null ? null : round(kcal * toPortion, 1) },
        toPortion,
        toPer100g,
      };
    }
    case 'per_serving':
      return {
        portion: { basis: 'serving', amount: size?.amount ?? null, unit: size?.unit ?? null, caloriesKcal: kcal },
        toPortion: 1,
        toPer100g: size?.unit === 'g' ? 100 / size.amount : null,
      };
    case 'unknown':
      return null;
  }
}

function nutrientFactors(nutrition: NutritionFacts, scale: PortionScale, plan: GoalMatchUserPlan): GoalMatchFactor[] {
  const rules = GOAL_RULES[plan.goal];
  const targets = plan.targets;
  const kcal = nutrition.caloriesKcal.value ?? 0;

  const calories =
    scale.toPortion === null
      ? factor('calories', 'not_counted', 0, null)
      : (() => {
          const share = round(((kcal * scale.toPortion) / targets.caloriesKcal) * 100, 1);
          const level = share <= CALORIE_SHARE_LEVELS.lowMax ? 'low' : share > CALORIE_SHARE_LEVELS.highAbove ? 'high' : 'moderate';
          return factor('calories', level, curvePoints(rules.calories, share), share, share);
        })();

  // Калорийность на 100 г имеет смысл только для еды. Для напитков фактора нет, без веса порции — не учтён.
  const isDrink = scale.portion.unit === 'ml';
  const energyDensity = isDrink
    ? []
    : scale.toPer100g === null
      ? [factor('energyDensity', 'not_counted', 0, null)]
      : (() => {
          const per100 = round(kcal * scale.toPer100g, 1);
          const level = per100 <= ENERGY_DENSITY_LEVELS.lowMax ? 'low' : per100 > ENERGY_DENSITY_LEVELS.highAbove ? 'high' : 'moderate';
          return [factor('energyDensity', level, curvePoints(rules.energyDensity, per100), per100)];
        })();

  const ratios = (Object.keys(RATIO_NUTRIENTS) as RatioKind[]).map((kind) => {
    const amount = (nutrition[RATIO_NUTRIENTS[kind]] as NutrientValue).value;
    if (amount === null) return factor(kind, 'not_counted', 0, null);
    const daily = dailyAmount(kind, targets);
    const portionShare = scale.toPortion === null ? null : round(((amount * scale.toPortion) / daily) * 100, 1);
    // У почти некалорийных продуктов «доля в калориях» бессмысленна: 0,1 г соли в воде не делает её солёной едой.
    if (kcal < MIN_KCAL_FOR_RATIOS) return factor(kind, 'not_counted', 0, null, portionShare);
    const ratio = round(amount / kcal / (daily / targets.caloriesKcal), 2);
    const level = ratio < RATIO_LEVELS.lowBelow ? 'low' : ratio >= RATIO_LEVELS.highFrom ? 'high' : 'moderate';
    return factor(kind, level, curvePoints(rules.ratios[kind], ratio), ratio, portionShare);
  });

  return [calories, ...energyDensity, ...ratios];
}

/** null: в профиле нет аллергенов, фактор не нужен. */
function allergensFactor(product: Product, plan: GoalMatchUserPlan): GoalMatchFactor | null {
  if (plan.allergens.length === 0) return null;
  const found = product.allergens.value;
  if (found === null) return factor('allergens', 'not_counted', 0, null);
  const relevant = found.filter((allergen) => plan.allergens.includes(allergen.code));
  const contains = relevant.filter((allergen) => allergen.presence === 'contains').map((allergen) => allergen.code);
  if (contains.length > 0) return factor('allergens', 'conflict', 0, null, null, contains);
  const traces = relevant.map((allergen) => allergen.code);
  if (traces.length > 0) return factor('allergens', 'may_contain', MAY_CONTAIN_ALLERGEN_POINTS, null, null, traces);
  return factor('allergens', 'ok', 0, null);
}

/** null: в профиле нет диеты. Диеты, которые по этикетке не проверить (halal, other), дают not_counted. */
function dietFactor(product: Product, plan: GoalMatchUserPlan): GoalMatchFactor | null {
  const diets = plan.dietaryPreferences.filter((diet) => diet !== 'none');
  if (diets.length === 0) return null;
  const checkable = diets.map((diet) => DIET_CONFLICTS[diet]).filter((rule) => rule !== undefined);
  const allergens = product.allergens.value;
  const category = product.category.value;
  if (checkable.length === 0 || (allergens === null && category === null)) return factor('diet', 'not_counted', 0, null, null, diets);

  const matches = new Set<string>();
  for (const rule of checkable) {
    for (const allergen of allergens ?? []) {
      if (allergen.presence === 'contains' && rule.allergens.includes(allergen.code)) matches.add(allergen.code);
    }
    if (category !== null && rule.categories.includes(category)) matches.add(category);
  }
  return matches.size > 0 ? factor('diet', 'conflict', 0, null, null, [...matches]) : factor('diet', 'ok', 0, null);
}

/** null: список «избегать» пуст. Сравнение без учёта регистра и «ё», по вхождению слова в название ингредиента. */
function avoidedIngredientsFactor(product: Product, plan: GoalMatchUserPlan): GoalMatchFactor | null {
  const avoided = plan.avoidedIngredients.map(normalizeText).filter((term) => term.length >= 2);
  if (avoided.length === 0) return null;
  const ingredients = product.ingredients.value;
  if (ingredients === null) return factor('avoidedIngredients', 'not_counted', 0, null);
  const names = ingredients.map((ingredient) => normalizeText(ingredient.name));
  const matches = avoided.filter((term) => names.some((name) => name.includes(term)));
  return matches.length > 0
    ? factor('avoidedIngredients', 'conflict', AVOIDED_INGREDIENT_POINTS, null, null, matches)
    : factor('avoidedIngredients', 'ok', 0, null);
}

function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
}
