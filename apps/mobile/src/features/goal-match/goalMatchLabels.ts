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
const DIET_MATCH_LABELS: Readonly<Record<string, string>> = { meat: 'мясо', fish: 'рыба' };

export const LEVEL_VERDICTS: Readonly<Record<GoalMatchLevel, string>> = {
  great: 'Отлично подходит',
  good: 'Подходит',
  fair: 'Подходит с оговорками',
  poor: 'Плохо подходит',
  conflict: 'Не подходит',
};

export const UNAVAILABLE_MESSAGES: Readonly<Record<GoalMatchUnavailableReason, string>> = {
  no_profile: 'Заполните профиль, чтобы увидеть, подходит ли продукт вашей цели.',
  profile_unavailable: 'Не удалось загрузить ваш профиль. Попробуйте отсканировать ещё раз.',
  no_nutrition: 'На фото нет таблицы пищевой ценности, поэтому сравнить продукт с вашим планом нельзя.',
  unknown_basis: 'Не видно, к какому количеству относятся значения на этикетке, поэтому сравнить их с планом нельзя.',
  no_calories: 'Калорийность не прочитана, а без неё продукт не сравнить с вашим дневным планом.',
  missing_nutrients: 'Для персональной оценки не хватает данных о пищевой ценности.',
  unknown_portion: 'Не удалось определить порцию для сравнения с вашим планом.',
  ai_context_unavailable: 'Не удалось определить состав и свойства продукта для оценки.',
  ambiguous: 'Данных недостаточно для надёжной персональной оценки.',
};

/** Presentation only: the API gate remains the sole authority for availability. */
export function unavailableMessage(goalMatch: AnyGoalMatch, product?: Product): string {
  const anyReason: GoalMatchV4UnavailableReason | null = goalMatch.unavailableReason;
  if (!anyReason) return '';
  if (anyReason === 'invalid_nutrition') return 'Значения на этикетке противоречат друг другу, поэтому оценить продукт нельзя.';
  const reason: GoalMatchUnavailableReason = anyReason;
  if (!isTenPointScale(goalMatch)) return UNAVAILABLE_MESSAGES[reason];
  const messages: Partial<Record<GoalMatchUnavailableReason, string>> = {
    unknown_basis: 'Недостаточно данных для оценки: не удалось определить основу пищевой ценности.',
    unknown_portion: 'Недостаточно данных для оценки: не удалось определить размер порции.',
    ai_context_unavailable: 'Недостаточно данных для оценки продукта.',
    ambiguous: 'Недостаточно данных для надёжной оценки.',
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
  return `Примерная оценка. Оценка на 100 ${goalMatch.portion?.unit === 'ml' ? 'мл' : 'г'}: размер порции не указан.`;
}

/** v3 and v4 API are 0–10; unchanged v1 API is 0–100. One decimal in all presentations. */
export function formatGoalMatchValue(goalMatch: AnyGoalMatch): string | null {
  if (goalMatch.value === null) return null;
  const value = isTenPointScale(goalMatch) ? goalMatch.value : goalMatch.value / 10;
  return value.toFixed(1).replace('.', ',');
}

function v3Reason(factor: GoalMatchFactor): FactorReason | null {
  if (factor.impact === 'neutral' || factor.points === 0) return null;
  const share = factor.portionShare === null ? null : `${percent(factor.portionShare)} дневного лимита в порции`;
  switch (factor.kind) {
    case 'protein': return { text: 'Белок помогает выполнить дневную цель',
      detail: portionShare(factor, 'дневной цели по белку') };
    case 'fiber': return { text: 'Источник клетчатки',
      detail: factor.value === null ? null : `${factor.value.toFixed(1).replace('.', ',')} г в порции` };
    case 'whole': return { text: factor.value === 1 ? 'Цельный или минимально обработанный продукт' : 'Умеренная обработка', detail: null };
    case 'processing': return { text: 'Ультраобработанный продукт', detail: null };
    case 'sugars': return { text: 'Свободные сахара', detail: share ? `${share}; учтена концентрация` : null };
    case 'saturatedFat': return { text: 'Насыщенные жиры', detail: share ? `${share}; учтена концентрация` : null };
    case 'salt': return { text: 'Соль', detail: share ? `${share}; учтена концентрация` : null };
    default: return null;
  }
}

function percent(value: number): string {
  return `${String(Math.round(value)).replace('.', ',')}%`;
}

function list(codes: readonly string[]): string {
  return codes.map((code) => (ALLERGEN_LABELS as Record<string, string>)[code]?.toLowerCase() ?? DIET_MATCH_LABELS[code] ?? code).join(', ');
}

/** «порция — 8% дневной цели по белку». null без размера порции. */
function portionShare(factor: GoalMatchFactor, what: string): string | null {
  return factor.portionShare === null ? null : `порция — ${percent(factor.portionShare)} ${what}`;
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
  const ratio = String(factor.value).replace('.', ',');
  const density = `На ту же калорийность — в ${ratio} раза больше, чем в дневном плане`;
  if (factor.portionShare === null) {
    return { text: name, detail: density };
  }
  return {
    text: `${name} — ${percent(factor.portionShare)} ${daily}`,
    detail: `В порции. ${density}`,
    impact: factor.portionShare <= SMALL_PORTION_SHARE_MAX ? 'neutral' : factor.impact,
  };
}

/** Конкретная непроверенная диета из снимка плана; для «другое» полезного пояснения нет. */
export function dietVerificationNotes(factor: GoalMatchFactor | undefined): string[] {
  if (factor?.level !== 'not_counted') return [];
  const messages: Readonly<Record<string, string>> = {
    halal: 'Халяль: по распознанным данным сертификацию подтвердить нельзя — проверьте маркировку на упаковке.',
    vegan: 'Веганство: недостаточно данных о составе для проверки — проверьте упаковку.',
    vegetarian: 'Вегетарианство: недостаточно данных о составе для проверки — проверьте упаковку.',
    pescatarian: 'Пескетарианство: недостаточно данных о составе для проверки — проверьте упаковку.',
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
      if (factor.level === 'conflict') return { text: `Содержит аллерген из вашего профиля: ${list(factor.matches)}`, detail: null };
      if (factor.level === 'may_contain') return { text: `Может содержать следы: ${list(factor.matches)}`, detail: null };
      return null;
    case 'diet':
      return factor.level === 'conflict' ? { text: `Не подходит вашей диете: ${list(factor.matches)}`, detail: null } : null;
    case 'avoidedIngredients':
      return factor.level === 'conflict' ? { text: `Есть то, чего вы избегаете: ${factor.matches.join(', ')}`, detail: null } : null;
  }
  // v4 deterministic factors are the v3 snapshot's factors.
  if (version === 'goal-match-v3' || version === 'goal-match-v4') return v3Reason(factor);
  if (factor.impact === 'neutral' || factor.value === null) return null;
  switch (factor.kind) {
    case 'calories':
      return {
        text: positive ? 'Порция легко вписывается в дневную норму калорий' : 'Доля порции в дневной цели по калориям',
        detail: `${percent(factor.value)} дневной нормы`,
      };
    case 'energyDensity':
      return {
        text: positive
          ? factor.level === 'high'
            ? 'Калорийный продукт: помогает набрать вес'
            : 'Невысокая калорийность — хорошо для вашей цели'
          : 'Калорийность выше ориентира для вашей цели',
        detail: `${String(Math.round(factor.value))} ккал на 100 г`,
      };
    case 'protein':
      return {
        text: positive ? 'Много белка — помогает выполнить цель по белку' : 'Мало белка относительно вашего плана',
        detail: portionShare(factor, 'дневной цели по белку'),
      };
    case 'fiber':
    case 'whole':
    case 'processing':
      return null;
    case 'fat':
      return nutrientReason(factor, 'Жиры', 'дневной цели по жирам');
    case 'carbs':
      return nutrientReason(factor, 'Углеводы', 'дневной цели по углеводам');
    case 'sugars':
      return nutrientReason(factor, 'Сахар', 'дневного лимита сахара');
    case 'saturatedFat':
      return nutrientReason(factor, 'Насыщенные жиры', 'дневного лимита');
    case 'salt':
      return nutrientReason(factor, 'Соль', 'дневного лимита соли');
  }
}

/** Причина из ответа AI (v4, source=ai): текст уже прошёл серверную проверку фактов. */
export function aiFactorReason(factor: GoalMatchAiFactor): FactorReason & { readonly impact: GoalMatchFactor['impact'] } {
  return { text: factor.text.replace(/[.!]+$/u, ''), detail: null, impact: factor.direction };
}

/** Небольшая метка источника оценки v4. Технические флаги (adjusted, ai_disagreement) пользователю не показываются. */
export function goalMatchSourceLabel(goalMatch: AnyGoalMatch): string | null {
  if (goalMatch.version !== 'goal-match-v4' || goalMatch.value === null) return null;
  return goalMatch.source === 'ai' ? 'AI-анализ' : 'Расчётная оценка';
}
