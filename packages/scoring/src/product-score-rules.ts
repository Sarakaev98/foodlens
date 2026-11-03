/**
 * Правила Product Score v6. Все пороги и веса собраны здесь, чтобы оценку можно было проверить вручную.
 *
 * 1. Оценка = BASE_SCORE − штрафы + бонусы. Значения сравниваются на 100 г (еда) или на 100 мл (напитки).
 * 2. Штраф растёт линейно: 0 на пороге «мало» (lowMax), weight на пороге «много» (highAbove),
 *    дальше с тем же наклоном до maxPenalty. Пороги сахаров, насыщенных жиров и соли — «светофор» UK FSA.
 * 3. Бонусы за белок и клетчатку (пороги заявлений ЕС «источник» / «высокое содержание»)
 *    в сумме не больше MAX_BONUS: полезное помогает, но не перекрывает серьёзные минусы.
 * 4. Если сахара, насыщенные жиры или соль выше порога «много», оценка не выше HIGH_LEVEL_CEILING.
 * 5. Фактор без значения на этикетке не учитывается (0 баллов, not_detected): неизвестное не равно нулю и не штрафуется.
 *    Оценка считается по подтверждённым данным, если известно хотя бы MIN_KNOWN_NUTRIENTS значений.
 *    Известные факторы сохраняют свои веса: ни перенормировки, ни вычитания за неизвестное нет. Полнота данных видна в confidence и missingFactors.
 *    Единственная защита: если неизвестны два и больше из REQUIRED_FACTORS, оценка не выше PARTIAL_DATA_CEILING.
 * 6. Сумма ниже 4 сжимается линейно: LOW_SCALE_FLOOR становится 0, 4 остаётся 4. Сумма 4 и выше не меняется.
 *    Штрафы вместе намного больше базы, и без этого разные плохие продукты упирались в один ноль.
 *    Граница не подобрана: это худшая сумма по самим правилам, поэтому 0 значит все штрафы сразу, а порядок сохраняется на всей шкале.
 * 7. Итог ограничен 0–10 и округлён до 0.1.
 */
export const PRODUCT_SCORE_VERSION = 'product-score-v6';

export const BASE_SCORE = 8;

/** Сумма бонусов (белок + клетчатка) не больше этого. */
export const MAX_BONUS = 2;

/** Потолок оценки, если хотя бы один из REQUIRED_FACTORS на уровне high. */
export const HIGH_LEVEL_CEILING = 4;

/** Главные минусы этикетки. Без них оценка приблизительная: она ограничена, а confidence снижается. */
export const REQUIRED_FACTORS = ['sugars', 'saturatedFat', 'salt'] as const;

/** Общий потолок при двух и более неизвестных REQUIRED_FACTORS: «отличный выбор» нельзя подтвердить без главных минусов. */
export const PARTIAL_DATA_CEILING = 8;
export const PARTIAL_DATA_MIN_UNKNOWN = 2;

/** Сколько значений пищевой ценности нужно для оценки. Меньше: оценка была бы случайной. */
export const MIN_KNOWN_NUTRIENTS = 3;

/** Факторы, которые попадают в missingFactors. Клетчатку часто не указывают, поэтому её здесь нет. */
export const EXPECTED_FACTORS = ['energy', 'protein', ...REQUIRED_FACTORS, 'additives'] as const;

export const SCORE_MIN = 0;
export const SCORE_MAX = 10;

export type ProductForm = 'food' | 'drink';

/**
 * Нутриент, которого должно быть мало. Уровень: low при значении ≤ lowMax, high при > highAbove, иначе moderate.
 * Штраф: 0 при ≤ lowMax, weight при highAbove, линейно между ними и дальше, не больше maxPenalty.
 */
export interface LimitRule {
  readonly lowMax: Readonly<Record<ProductForm, number>>;
  readonly highAbove: Readonly<Record<ProductForm, number>>;
  readonly weight: Readonly<Record<ProductForm, number>>;
  readonly maxPenalty: number;
}

/**
 * Нутриент, которого хорошо побольше. Уровень: high при ≥ highFrom, moderate при ≥ moderateFrom, иначе low.
 * Бонус: 0 при moderateFrom, maxBonus при highFrom и выше, линейно между ними.
 */
export interface BenefitRule {
  readonly moderateFrom: number;
  readonly highFrom: number;
  readonly maxBonus: number;
}

/**
 * Сахара, г. Для напитков вес выше: 100 мл — малая часть обычной порции (250–500 мл),
 * а сахар в напитках почти всегда «свободный».
 */
export const SUGARS_RULE: LimitRule = {
  lowMax: { food: 5, drink: 2.5 },
  highAbove: { food: 22.5, drink: 11.25 },
  weight: { food: 3, drink: 5 },
  maxPenalty: 6,
};

/**
 * Насыщенные жиры, г. Для напитков используются пороги для еды: жирные напитки почти всегда молочные,
 * и пороги для напитков (0.75 / 2.5 г) сделали бы обычное молоко «красным».
 */
export const SATURATED_FAT_RULE: LimitRule = {
  lowMax: { food: 1.5, drink: 1.5 },
  highAbove: { food: 5, drink: 5 },
  weight: { food: 3, drink: 3 },
  maxPenalty: 5,
};

/** Соль, г. Пороги для еды и для напитков одинаковые по той же причине. */
export const SALT_RULE: LimitRule = {
  lowMax: { food: 0.3, drink: 0.3 },
  highAbove: { food: 1.5, drink: 1.5 },
  weight: { food: 3, drink: 3 },
  maxPenalty: 5,
};

/**
 * Энергетическая плотность, ккал. Для еды небольшой штраф выше 80 ккал (порог Nutri-Score).
 * Для напитков без штрафа: их калории — это сахар, который уже учтён.
 */
export const ENERGY_RULE: LimitRule = {
  lowMax: { food: 80, drink: 20 },
  highAbove: { food: 400, drink: 60 },
  weight: { food: 1.5, drink: 0 },
  maxPenalty: 2.5,
};

/** Белок, г: «источник белка» ≈ 5 г, «высокое содержание» ≈ 10 г на 100 г. */
export const PROTEIN_RULE: BenefitRule = { moderateFrom: 5, highFrom: 10, maxBonus: 1.5 };

/** Клетчатка, г: «источник» 3 г, «высокое содержание» 6 г на 100 г. */
export const FIBER_RULE: BenefitRule = { moderateFrom: 3, highFrom: 6, maxBonus: 1.5 };

/**
 * Пищевые добавки (из распознанного состава): штраф за каждую, с ограничением.
 * Само наличие добавки не делает продукт вредным, но длинный список обычно означает сильную переработку.
 */
export const ADDITIVES_RULE = {
  someFrom: 1,
  manyFrom: 4,
  penaltyEach: 0.4,
  maxPenalty: 2,
  /** Дополнительно за каждый технологический класс из ADDITIVE_CLASSES. */
  classPenalty: 0.5,
  maxClassPenalty: 1.5,
} as const;

/** Классы по E-номеру или слову в составе. Усилители вкуса, подсластители, консерванты и красители говорят об индустриальной рецептуре. */
export const ADDITIVE_CLASSES: readonly { readonly codes: RegExp; readonly words: RegExp }[] = [
  { codes: /^E\s*-?6[2-4]\d/i, words: /усилител[а-я]* вкуса|ароматизатор|flavou?r/i },
  { codes: /^E\s*-?9[56]\d/i, words: /подсластител|сахарозаменител|аспартам|ацесульфам|сукралоз|сахарин|sweetener|aspartame|acesulfame|sucralose/i },
  { codes: /^E\s*-?2\d\d/i, words: /консервант|preservative/i },
  { codes: /^E\s*-?1\d\d/i, words: /краситель|colou?r/i },
];

/** Обработка по составу: заметный, но ограниченный штраф за ультрапереработку. Обычная обработка и цельные продукты баллов не меняют. */
export const PROCESSING_RULE = { ultraProcessedPenalty: 2 } as const;

/** Нижняя точка сжатия: база минус все штрафы на максимуме. */
export const LOW_SCALE_FLOOR = BASE_SCORE - ENERGY_RULE.maxPenalty - SUGARS_RULE.maxPenalty - SATURATED_FAT_RULE.maxPenalty - SALT_RULE.maxPenalty
  - ADDITIVES_RULE.maxPenalty - ADDITIVES_RULE.maxClassPenalty - PROCESSING_RULE.ultraProcessedPenalty;
