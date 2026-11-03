import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Product } from '@foodlens/core';

/**
 * Офлайн-набор для калибровки Product Score. Значения на 100 г/мл типичные, а не измеренные,
 * кроме source = 'scan' и 'off-fixture'. Только то, что читает формула: цели, порции и AI здесь нет.
 * off-fixture: настоящая запись Open Food Facts, сохранённая локально или показанная в скане. Значения не дополнялись.
 */
export interface BenchmarkItem {
  readonly name: string;
  readonly category: string;
  readonly unit: 'g' | 'ml';
  readonly kcal: number;
  readonly protein: number | null;
  readonly fiber: number | null;
  readonly sugars: number | null;
  readonly saturatedFat: number | null;
  readonly salt: number | null;
  readonly additives: number | null;
  readonly source: 'typical' | 'scan' | 'off-fixture' | 'off-real';
  readonly barcode?: string;
  /** Сомнительные места записи OFF. Значения при этом не исправляются. */
  readonly warnings?: readonly string[];
  /** Нули, которые нельзя подтвердить по снимку. */
  readonly unverifiedZeros?: readonly string[];
}

type Row = readonly [name: string, category: string, unit: 'g' | 'ml', kcal: number, protein: number | null, fiber: number | null, sugars: number, saturatedFat: number, salt: number, additives: number | null, source?: 'scan' | 'off-fixture', barcode?: string];

const ROWS: readonly Row[] = [
  ['Вода', 'напитки', 'ml', 0, 0, 0, 0, 0, 0, 0],
  ['Минеральная вода', 'напитки', 'ml', 0, 0, 0, 0, 0, 0.05, 0],
  ['Яблоко', 'фрукты', 'g', 52, 0.3, 2.4, 10.4, 0.03, 0, 0],
  ['Банан', 'фрукты', 'g', 89, 1.1, 2.6, 12.2, 0.1, 0, 0],
  ['Апельсин', 'фрукты', 'g', 47, 0.9, 2.4, 9.4, 0, 0, 0],
  ['Морковь', 'овощи', 'g', 41, 0.9, 2.8, 4.7, 0, 0.1, 0],
  ['Брокколи', 'овощи', 'g', 34, 2.8, 2.6, 1.7, 0.1, 0.08, 0],
  ['Помидор', 'овощи', 'g', 18, 0.9, 1.2, 2.6, 0, 0.01, 0],
  ['Миндаль', 'орехи', 'g', 579, 21, 12.5, 4.4, 3.8, 0, 0],
  ['Грецкий орех', 'орехи', 'g', 654, 15, 6.7, 2.6, 6.1, 0, 0],
  ['Арахис солёный', 'орехи', 'g', 600, 25, 8.5, 4, 7, 1.2, 0],
  ['Овсянка', 'крупы', 'g', 370, 12, 10, 1, 1.2, 0.02, 0],
  ['Рис', 'крупы', 'g', 360, 7, 1.3, 0.1, 0.1, 0, 0],
  ['Чечевица', 'крупы', 'g', 350, 25, 11, 2, 0.2, 0.02, 0],
  ['Хлеб цельнозерновой', 'хлеб', 'g', 250, 9, 7, 4, 0.6, 1.1, 1],
  ['Хлеб белый', 'хлеб', 'g', 265, 8.5, 2.7, 4, 0.5, 1.2, 1],
  ['Творог 5%', 'молочные', 'g', 121, 17, 0, 1.8, 3, 0.1, 0],
  ['Творожный продукт (наш кейс)', 'молочные', 'g', 97, 11, null, 1.5, 3.5, 0.7, null, 'scan'],
  ['Йогурт натуральный', 'молочные', 'g', 62, 3.5, 0, 4.7, 2.1, 0.12, 0],
  ['Греческий йогурт', 'молочные', 'g', 97, 9, 0, 3.6, 2.4, 0.1, 0],
  ['Йогурт сладкий', 'молочные', 'g', 95, 3.2, 0, 12.5, 1.5, 0.12, 2],
  ['Десертный йогурт', 'молочные', 'g', 130, 3, 0, 16, 3.5, 0.15, 3],
  ['Сыр гауда', 'молочные', 'g', 356, 25, 0, 2.2, 19, 1.8, 1],
  ['Молоко 2.5%', 'молочные', 'ml', 52, 2.9, 0, 4.7, 1.6, 0.1, 0],
  ['Яйца', 'белок', 'g', 143, 12.6, 0, 0.7, 3.1, 0.36, 0],
  ['Куриная грудка', 'белок', 'g', 165, 31, 0, 0, 1, 0.18, 0],
  ['Лосось', 'белок', 'g', 208, 20, 0, 0, 3.1, 0.15, 0],
  ['Тунец в воде', 'белок', 'g', 116, 26, 0, 0, 0.3, 0.9, 0],
  ['Говядина постная', 'белок', 'g', 176, 26, 0, 0, 3.7, 0.15, 0],
  ['Протеиновый батончик', 'батончики', 'g', 400, 30, 10, 5, 5, 0.5, 5],
  ['Кукурузные хлопья', 'хлопья', 'g', 378, 7, 3, 8, 0.3, 1.1, 1],
  ['Сладкие хлопья', 'хлопья', 'g', 390, 7, 3.5, 30, 1.5, 0.9, 2],
  ['Шоколадные шарики', 'хлопья', 'g', 410, 7, 5, 35, 2.5, 0.6, 3],
  ['Апельсиновый сок', 'напитки', 'ml', 45, 0.7, 0.2, 8.4, 0, 0, 0],
  ['Cola', 'напитки', 'ml', 42, 0, 0, 10.6, 0, 0.01, 3],
  ['Cola без сахара', 'напитки', 'ml', 0.3, 0, 0, 0, 0, 0.02, 4],
  ['Энергетик', 'напитки', 'ml', 45, 0, 0, 11, 0, 0.2, 4],
  ['Шоколад Roshen (скан)', 'сладости', 'g', 456, 3.3, null, 58.6, 11.2, 0.01, 1, 'off-fixture', '4823077621154'],
  ['Nutella', 'сладости', 'g', 539, 6.3, 0, 56.3, 10.6, 0.107, null, 'off-fixture', '3017620422003'],
  ['Молочный шоколад', 'сладости', 'g', 540, 7, 2.5, 55, 19, 0.3, 2],
  ['Тёмный шоколад 70%', 'сладости', 'g', 550, 7, 10, 30, 19, 0.03, 1],
  ['Snickers', 'сладости', 'g', 488, 9, 2, 50, 8.5, 0.6, 3],
  ['Snickers лесной орех', 'сладости', 'g', 514, 7.5, 2, 48, 10, 0.37, 3],
  ['Choco Pie', 'сладости', 'g', 430, 4.5, 4, 37, 10, 0.69, 5],
  ['Печенье', 'сладости', 'g', 470, 6, 2, 25, 8, 0.6, 3],
  ['Карамель', 'сладости', 'g', 400, 1, 0, 60, 3, 0.3, 3],
  ['Мороженое', 'сладости', 'g', 207, 3.5, 0.5, 21, 7, 0.2, 3],
  ['Мёд', 'сладости', 'g', 304, 0.3, 0.2, 82, 0, 0, 0],
  ['Чипсы', 'снеки', 'g', 540, 6, 4, 1, 3.5, 1.5, 3],
  ['Чипсы (наш кейс)', 'снеки', 'g', 536, null, 4.4, 0.6, 3.1, 1.4, null, 'scan'],
  ['Крекеры', 'снеки', 'g', 430, 10, 3, 5, 3, 1.8, 2],
  ['Варёная колбаса', 'мясные изделия', 'g', 260, 12, 0, 1, 9, 2, 4],
  ['Салями', 'мясные изделия', 'g', 480, 22, 0, 1, 17, 4, 4],
  ['Лапша быстрого приготовления', 'готовые блюда', 'g', 450, 9, 2.5, 3, 9, 3, 4],
  ['Замороженная пицца', 'готовые блюда', 'g', 250, 10, 2, 4, 4.5, 1.3, 3],
  ['Кетчуп', 'соусы', 'g', 110, 1.5, 0.5, 22, 0, 1.8, 2],
  ['Майонез', 'соусы', 'g', 620, 0.5, 0, 3, 5.5, 1.5, 3],
  ['Сливочное масло', 'жиры', 'g', 717, 0.6, 0, 0.1, 51, 0.02, 0],
  ['Оливковое масло', 'жиры', 'g', 884, 0, 0, 0, 14, 0, 0],
];

interface SnapshotProduct {
  readonly slot: string; readonly unit: 'g' | 'ml'; readonly barcode: string; readonly name: string; readonly brands: string | null;
  readonly kcal: number; readonly protein: number | null; readonly fiber: number | null; readonly sugars: number; readonly saturatedFat: number; readonly salt: number;
  readonly additives: number | null; readonly warnings: readonly string[];
  readonly rawRecord: { readonly nutriments: Readonly<Record<string, unknown>> } | null;
  /** Значения после настоящего маппера FoodLens по ответу v3.6. */
  readonly normalized?: { readonly kcal: number | null; readonly protein: number | null; readonly fiber: number | null; readonly sugars: number | null; readonly saturatedFat: number | null; readonly salt: number | null };
}

const ZERO_FIELDS = [['protein', 'proteins'], ['fiber', 'fiber'], ['sugars', 'sugars'], ['saturatedFat', 'saturated-fat'], ['salt', 'salt']] as const;

/**
 * То же правило, что в маппере, для устаревшего формата v2: там нет поля source. Введённое значение имеет ключ _value,
 * а пометка лежит в _modifier. Для продуктов без сырой записи ноль подтвердить нечем.
 */
function zeroIsConfirmed(product: SnapshotProduct, name: string): boolean {
  const nutriments = product.rawRecord?.nutriments;
  return nutriments !== undefined && nutriments[`${name}_value`] !== undefined && nutriments[`${name}_modifier`] === undefined;
}

function unverifiedZeros(product: SnapshotProduct): readonly string[] {
  return ZERO_FIELDS.filter(([field, name]) => product[field] === 0 && !zeroIsConfirmed(product, name)).map(([field]) => field);
}

/** Читается только из снимка в репозитории: бенчмарк и тесты в сеть не ходят. */
function offSnapshot(): readonly SnapshotProduct[] {
  const file = join(__dirname, '..', '..', '..', 'src', 'test', 'benchmark', 'off-products.snapshot.json');
  return (JSON.parse(readFileSync(file, 'utf8')) as { readonly products: readonly SnapshotProduct[] }).products;
}

const SNAPSHOT = offSnapshot();
const barcodeOf = (product: SnapshotProduct) => product.barcode;

export const OFF_REAL: readonly BenchmarkItem[] = SNAPSHOT.map((product) => {
  const { slot, name, brands, unit, barcode, kcal, protein, fiber, sugars, saturatedFat, salt, additives, warnings } = product;
  return { name: `${name}${brands ? ` (${brands.split(',')[0]!.trim()})` : ''}`, category: slot, source: 'off-real', unit, barcode, kcal, protein, fiber, sugars, saturatedFat, salt, additives, warnings, unverifiedZeros: unverifiedZeros(product) };
});

/** После нормализации: значения маппера по v3.6, а без ответа v3.6 неподтверждённые нули становятся пропусками. */
export const OFF_REAL_STRICT: readonly BenchmarkItem[] = OFF_REAL.map((item) => {
  const normalized = SNAPSHOT.find((product) => barcodeOf(product) === item.barcode)!.normalized;
  if (normalized) return { ...item, ...normalized, kcal: normalized.kcal ?? item.kcal, unverifiedZeros: [] };
  return { ...item, ...Object.fromEntries((item.unverifiedZeros ?? []).map((field) => [field, null])) };
});

const named = (slot: string) => OFF_REAL.find((item) => item.category === slot)!.name;

export const BENCHMARK: readonly BenchmarkItem[] = [...ROWS.map(([name, category, unit, kcal, protein, fiber, sugars, saturatedFat, salt, additives, source, barcode]): BenchmarkItem =>
  ({ name, category, unit, kcal, protein, fiber, sugars, saturatedFat, salt, additives, source: source ?? 'typical', ...(barcode ? { barcode } : {}) })), ...OFF_REAL];

/** Настоящая запись OFF без сахаров, насыщенных жиров и соли: оценки у неё нет, в расчёт распределения она не входит. */
export const OFF_INCOMPLETE: readonly BenchmarkItem[] = [
  { name: 'Choco Pie (OFF)', category: 'сладости', unit: 'g', kcal: 507, protein: null, fiber: null, sugars: null, saturatedFat: null, salt: null, additives: null, source: 'off-fixture', barcode: '4607084351385' },
];

const v = (value: unknown) => ({ value, provenance: value === null ? 'not_detected' : 'observed' });

export function benchmarkProduct(item: BenchmarkItem): Product {
  return {
    nutrition: { basis: item.unit === 'ml' ? 'per_100ml' : 'per_100g', servingSize: v(null), caloriesKcal: v(item.kcal), proteinG: v(item.protein), carbsG: v(null), sugarsG: v(item.sugars),
      fatG: v(null), saturatedFatG: v(item.saturatedFat), fiberG: v(item.fiber), saltG: v(item.salt), sodiumMg: v(null) },
    additives: v(item.additives === null ? null : Array.from({ length: item.additives }, (_, index) => ({ code: `E10${index}`, name: null }))),
    confidence: { overall: 'high', identity: 'high', nutrition: 'high', ingredients: 'high' },
  } as unknown as Product;
}

/** Пары «первый заметно лучше второго» по здравому смыслу. Это относительный порядок, а не заранее придуманные оценки. */
export const EXPECTED_ORDER: readonly (readonly [better: string, worse: string])[] = [
  ['Вода', 'Cola'], ['Вода', 'Чипсы'], ['Вода', 'Молочный шоколад'],
  ['Яблоко', 'Чипсы'], ['Яблоко', 'Cola'], ['Яблоко', 'Молочный шоколад'],
  ['Йогурт натуральный', 'Чипсы'], ['Йогурт натуральный', 'Cola'], ['Йогурт натуральный', 'Шоколад Roshen (скан)'],
  ['Йогурт натуральный', 'Йогурт сладкий'], ['Йогурт сладкий', 'Десертный йогурт'],
  ['Хлеб цельнозерновой', 'Хлеб белый'], ['Овсянка', 'Сладкие хлопья'], ['Овсянка', 'Кукурузные хлопья'],
  ['Кукурузные хлопья', 'Шоколадные шарики'], ['Куриная грудка', 'Варёная колбаса'], ['Варёная колбаса', 'Салями'],
  ['Апельсин', 'Апельсиновый сок'], ['Апельсиновый сок', 'Cola'], ['Тёмный шоколад 70%', 'Молочный шоколад'],
  ['Творог 5%', 'Десертный йогурт'], ['Миндаль', 'Чипсы'], ['Йогурт натуральный', 'Nutella'], ['Яблоко', 'Nutella'],
  [named('натуральный йогурт'), named('сладкий йогурт')], [named('напиток без сахара'), named('напиток с сахаром')], [named('натуральный йогурт'), named('напиток с сахаром')],
  [named('рыба'), named('колбаса/мясо')], [named('орехи'), named('колбаса/мясо')], [named('хлеб'), named('соус')], [named('снеки'), named('соус')], [named('хлопья'), 'Шоколадные шарики'], ['Молоко 2.5%', 'Cola'], ['Хлеб цельнозерновой', 'Замороженная пицца'],
];
