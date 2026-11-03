import type { MealMacros } from '../meal-plan';

/** Откуда запись в Today. Пока только оценка по фото блюда. */
export const TODAY_ENTRY_SOURCES = ['meal_photo_estimate'] as const;
export type TodayEntrySource = (typeof TODAY_ENTRY_SOURCES)[number];

/** Съеденное за день: название и приблизительные калории и БЖУ. */
export interface TodayEntry extends MealMacros {
  /** Создаёт клиент: повторная отправка той же записи не создаёт дубль. */
  readonly id: string;
  readonly name: string;
  readonly source: TodayEntrySource;
  /** ISO-время добавления. */
  readonly addedAt: string;
}

/** Журнал одного дня. totals всегда сумма записей. */
export interface TodayLog {
  /** Локальная дата пользователя, YYYY-MM-DD. */
  readonly date: string;
  readonly entries: readonly TodayEntry[];
  readonly totals: MealMacros;
}

/** Тело POST /today/entries. */
export interface AddTodayEntryInput extends MealMacros {
  readonly id: string;
  readonly date: string;
  readonly name: string;
  readonly source: TodayEntrySource;
}
