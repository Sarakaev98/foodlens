import type { GoalMatch, GoalMatchAiFactor, GoalMatchFactor, GoalMatchLevel, GoalMatchUnavailableReason, GoalMatchV4,
  GoalMatchV4UnavailableReason, Product } from '@foodlens/core';
import { ALLERGEN_LABELS } from '@/features/profile';
import { missingNutrientsMessage, type MissingNutrient } from '@/shared/nutrition';

/**
 * Всё, что может прийти от API: v1 (0–100), v3 (0–10) и v4 (0–10, при GOAL_MATCH_AI на сервере).
 * v4 повторяет поля v3, поэтому почти везде показывается так же, как v3.
 */
export type AnyGoalMatch = GoalMatch | GoalMatchV4;

/** v3 и v4: шкала 0–10, факторы, состояния и неопределённость в формате v3. */
export function isTenPointScale(goalMatch: AnyGoalMatch): goalMatch is Extract<AnyGoalMatch, { readonly version: 'goal-match-v3' | 'goal-match-v4' }> {
  return goalMatch.version === 'goal-match-v3' || goalMatch.version === 'goal-match-v4';
}

/** Подписи для matches у фактора diet: кроме аллергенов, там бывает категория продукта. */
const DIET_MATCH_LABELS: Readonly<Record<string, string>> = { meat: 'meat', fish: 'fish' };

export const LEVEL_VERDICTS: Readonly<Record<GoalMatchLevel, string>> = {
  great: 'Great fit',
  good: 'Good fit',
  fair: 'Fair fit',
  poor: 'Poor fit',
  conflict: 'Not a fit',
};

export const UNAVAILABLE_MESSAGES: Readonly<Record<GoalMatchUnavailableReason, string>> = {
  no_profile: 'Complete your profile to see how this product fits your goal.',
  profile_unavailable: 'Couldn’t load your profile. Try scanning again.',
  no_nutrition: 'No nutrition label in the photo, so we can’t compare this product with your plan.',
  unknown_basis: 'The label doesn’t show what amount the values refer to, so we can’t compare them with your plan.',
  no_calories: 'We couldn’t read the calories, and without them we can’t compare this product with your daily plan.',
  missing_nutrients: 'Not enough nutrition data for a personal rating.',
  unknown_portion: 'Couldn’t determine the serving size to compare with your plan.',
  ai_context_unavailable: 'Couldn’t determine the product’s ingredients and properties for a rating.',
  ambiguous: 'Not enough data for a reliable personal rating.',
};

/** Presentation only: the API gate remains the sole authority for availability. */
export function unavailableMessage(goalMatch: AnyGoalMatch, product?: Product): string {
  const anyReason: GoalMatchV4UnavailableReason | null = goalMatch.unavailableReason;
  if (!anyReason) return '';
  if (anyReason === 'invalid_nutrition') return 'The label values contradict each other, so we can’t rate this product.';
  const reason: GoalMatchUnavailableReason = anyReason;
  if (!isTenPointScale(goalMatch)) return UNAVAILABLE_MESSAGES[reason];
  const messages: Partial<Record<GoalMatchUnavailableReason, string>> = {
    unknown_basis: 'Not enough data to rate: couldn’t tell what amount the nutrition values refer to.',
    unknown_portion: 'Not enough data to rate: couldn’t determine the serving size.',
    ai_context_unavailable: 'Not enough data to rate this product.',
    ambiguous: 'Not enough data for a reliable rating.',
  };
  if (reason !== 'missing_nutrients') return messages[reason] ?? UNAVAILABLE_MESSAGES[reason];
  const generic = UNAVAILABLE_MESSAGES.missing_nutrients;
  const n = product?.nutrition;
  if (!n) return generic;
  const known = (value: number | null | undefined): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const serving = n.servingSize.value;
  const scale = n.basis !== 'per_serving' ? 1
    : serving && Number.isFinite(serving.amount) && serving.amount > 0 ? 100 / serving.amount : null;
  // Do not call an omitted nutrient missing when v3 can infer it from low carbs/fat.
  const inferredZero = (value: number | null) => known(value) && scale !== null && value * scale <= 0.5;
  const missing: MissingNutrient[] = [];
  if (!known(n.sugarsG.value) && !inferredZero(n.carbsG.value)) missing.push('sugars');
  if (!known(n.saturatedFatG.value) && !inferredZero(n.fatG.value)) missing.push('saturatedFat');
  if (!known(n.saltG.value) && !known(n.sodiumMg.value)) missing.push('salt');
  // Same list as the Product Score card; protein alone never blocks either, so it is only a last explanation.
  if (missing.length === 0 && !known(n.proteinG.value)) missing.push('protein');
  return missing.length > 0 ? missingNutrientsMessage(missing) : generic;
}

/** Без порции с упаковки расчёт идёт на 100 г/мл. */
export function approximateNote(goalMatch: AnyGoalMatch): string {
  return `Approximate rating per 100 ${goalMatch.portion?.unit === 'ml' ? 'ml' : 'g'}: serving size not listed.`;
}

/** v3 and v4 API are 0–10; unchanged v1 API is 0–100. One decimal in all presentations. */
export function formatGoalMatchValue(goalMatch: AnyGoalMatch): string | null {
  if (goalMatch.value === null) return null;
  const value = isTenPointScale(goalMatch) ? goalMatch.value : goalMatch.value / 10;
  return value.toFixed(1);
}

function v3Reason(factor: GoalMatchFactor): FactorReason | null {
  if (factor.impact === 'neutral' || factor.points === 0) return null;
  const share = factor.portionShare === null ? null : `${percent(factor.portionShare)} of daily limit per serving`;
  switch (factor.kind) {
    case 'protein': return { text: 'Protein helps you reach your daily goal',
      detail: portionShare(factor, 'of daily protein goal') };
    case 'fiber': return { text: 'Source of fiber',
      detail: factor.value === null ? null : `${factor.value.toFixed(1)} g per serving` };
    case 'whole': return { text: factor.value === 1 ? 'Whole or minimally processed' : 'Moderately processed', detail: null };
    case 'processing': return { text: 'Ultra-processed product', detail: null };
    case 'sugars': return { text: 'Free sugars', detail: share ? `${share}; concentration considered` : null };
    case 'saturatedFat': return { text: 'Saturated fat', detail: share ? `${share}; concentration considered` : null };
    case 'salt': return { text: 'Salt', detail: share ? `${share}; concentration considered` : null };
    default: return null;
  }
}

function percent(value: number): string {
  return `${String(Math.round(value))}%`;
}

function list(codes: readonly string[]): string {
  return codes.map((code) => (ALLERGEN_LABELS as Record<string, string>)[code]?.toLowerCase() ?? DIET_MATCH_LABELS[code] ?? code).join(', ');
}

/** «serving: 8% of daily protein goal». null без размера порции. */
function portionShare(factor: GoalMatchFactor, what: string): string | null {
  return factor.portionShare === null ? null : `serving: ${percent(factor.portionShare)} ${what}`;
}

interface FactorReason {
  readonly text: string;
  readonly detail: string | null;
  /** Тон пояснения может быть нейтральным, даже если плотность нутриента немного снижает балл. */
  readonly impact?: GoalMatchFactor['impact'];
}

/** Только порог подачи текста, не правило расчёта Goal Match. */
const SMALL_PORTION_SHARE_MAX = 10;

function nutrientReason(factor: GoalMatchFactor, name: string, daily: string): FactorReason {
  const ratio = String(factor.value);
  const density = `${ratio}× your daily plan for the same calories`;
  if (factor.portionShare === null) {
    return { text: name, detail: density };
  }
  return {
    text: `${name}: ${percent(factor.portionShare)} ${daily}`,
    detail: `Per serving. ${density}`,
    impact: factor.portionShare <= SMALL_PORTION_SHARE_MAX ? 'neutral' : factor.impact,
  };
}

/** Поддерживаемая диета, для проверки которой не хватило состава. */
export function dietVerificationNotes(factor: GoalMatchFactor | undefined): string[] {
  if (factor?.level !== 'not_counted') return [];
  const messages: Readonly<Record<string, string>> = {
    vegan: 'Vegan: not enough ingredient data to check. Please check the package.',
    vegetarian: 'Vegetarian: not enough ingredient data to check. Please check the package.',
    pescatarian: 'Pescatarian: not enough ingredient data to check. Please check the package.',
  };
  return [...new Set(factor.matches)].flatMap((diet) => messages[diet] ? [messages[diet]!] : []);
}

/**
 * Причина для пользователя: основной текст и пояснение с числами. Тексты детерминированы, без AI.
 * null: фактор нейтральный и не стоит места на карточке.
 */
export function factorReason(factor: GoalMatchFactor, version: AnyGoalMatch['version'] = 'goal-match-v1'): FactorReason | null {
  const positive = factor.impact === 'positive';
  switch (factor.kind) {
    case 'allergens':
      if (factor.level === 'conflict') return { text: `Contains an allergen from your profile: ${list(factor.matches)}`, detail: null };
      if (factor.level === 'may_contain') return { text: `May contain traces of: ${list(factor.matches)}`, detail: null };
      return null;
    case 'diet':
      return factor.level === 'conflict' ? { text: `Doesn’t fit your diet: ${list(factor.matches)}`, detail: null } : null;
    case 'avoidedIngredients':
      return factor.level === 'conflict' ? { text: `Contains something you avoid: ${factor.matches.join(', ')}`, detail: null } : null;
  }
  // v4 deterministic factors are the v3 snapshot's factors.
  if (version === 'goal-match-v3' || version === 'goal-match-v4') return v3Reason(factor);
  if (factor.impact === 'neutral' || factor.value === null) return null;
  switch (factor.kind) {
    case 'calories':
      return {
        text: positive ? 'Serving fits easily into your daily calories' : 'Serving’s share of your daily calorie goal',
        detail: `${percent(factor.value)} of daily calories`,
      };
    case 'energyDensity':
      return {
        text: positive
          ? factor.level === 'high'
            ? 'Calorie-dense: helps you gain weight'
            : 'Lower in calories, good for your goal'
          : 'More calories than ideal for your goal',
        detail: `${String(Math.round(factor.value))} kcal per 100 g`,
      };
    case 'protein':
      return {
        text: positive ? 'High in protein, helps you hit your protein goal' : 'Low in protein for your plan',
        detail: portionShare(factor, 'of daily protein goal'),
      };
    case 'fiber':
    case 'whole':
    case 'processing':
      return null;
    case 'fat':
      return nutrientReason(factor, 'Fat', 'of daily fat goal');
    case 'carbs':
      return nutrientReason(factor, 'Carbs', 'of daily carb goal');
    case 'sugars':
      return nutrientReason(factor, 'Sugar', 'of daily sugar limit');
    case 'saturatedFat':
      return nutrientReason(factor, 'Saturated fat', 'of daily limit');
    case 'salt':
      return nutrientReason(factor, 'Salt', 'of daily salt limit');
  }
}

/** Причина из ответа AI (v4, source=ai): текст уже прошёл серверную проверку фактов. */
export function aiFactorReason(factor: GoalMatchAiFactor): FactorReason & { readonly impact: GoalMatchFactor['impact'] } {
  return { text: factor.text.replace(/[.!]+$/u, ''), detail: null, impact: factor.direction };
}

/** Небольшая метка источника оценки v4. Технические флаги (adjusted, ai_disagreement) пользователю не показываются. */
export function goalMatchSourceLabel(goalMatch: AnyGoalMatch): string | null {
  if (goalMatch.version !== 'goal-match-v4' || goalMatch.value === null) return null;
  return goalMatch.source === 'ai' ? 'AI analysis' : 'Calculated rating';
}
