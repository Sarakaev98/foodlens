import { BadRequestException, Injectable } from '@nestjs/common';
import { sumMeals, TODAY_ENTRY_SOURCES, type AddTodayEntryInput, type TodayEntry, type TodayLog } from '@foodlens/core';

const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const MAX_ENTRIES_PER_DAY = 50;
/** Границы одной записи: защита от опечаток и мусора, а не нормы питания. */
const MAX_KCAL = 5000;
const MAX_MACRO_G = 1000;

/**
 * Журнал съеденного за день. Хранится в памяти, как Meal Plan: после перезапуска API журнал пуст.
 * Дату присылает клиент (локальный день пользователя), поэтому сервер не гадает о часовом поясе.
 * Повтор записи с тем же id ничего не добавляет: двойное нажатие или повтор запроса не создают дубль.
 */
@Injectable()
export class TodayService {
  private readonly logs = new Map<string, Map<string, TodayEntry[]>>();

  get(userId: string, date: unknown): TodayLog {
    const day = parseDate(date);
    return toLog(day, this.logs.get(userId)?.get(day) ?? []);
  }

  add(userId: string, body: unknown, now = new Date()): TodayLog {
    const input = parseEntry(body);
    const days = this.logs.get(userId) ?? new Map<string, TodayEntry[]>();
    this.logs.set(userId, days);
    const entries = days.get(input.date) ?? [];
    if (!entries.some((entry) => entry.id === input.id)) {
      if (entries.length >= MAX_ENTRIES_PER_DAY) throw new BadRequestException('Too many entries for one day');
      const { date: _date, ...entry } = input;
      entries.push({ ...entry, addedAt: now.toISOString() });
      days.set(input.date, entries);
    }
    return toLog(input.date, entries);
  }
}

function toLog(date: string, entries: readonly TodayEntry[]): TodayLog {
  return { date, entries: [...entries], totals: sumMeals(entries) };
}

function parseDate(value: unknown): string {
  if (typeof value !== 'string' || !DATE.test(value) || Number.isNaN(Date.parse(value))) {
    throw new BadRequestException('date must be YYYY-MM-DD');
  }
  return value;
}

function parseEntry(body: unknown): AddTodayEntryInput {
  const raw = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const text = (key: string, max: number) => {
    const value = raw[key];
    if (typeof value !== 'string' || !value.trim() || value.length > max) throw new BadRequestException(`${key} is invalid`);
    return value.trim();
  };
  const amount = (key: string, max: number) => {
    const value = raw[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) throw new BadRequestException(`${key} is invalid`);
    return Math.round(value);
  };
  const source = raw.source;
  if (!(TODAY_ENTRY_SOURCES as readonly unknown[]).includes(source)) throw new BadRequestException('source is invalid');
  return {
    id: text('id', 64),
    date: parseDate(raw.date),
    name: text('name', 80),
    source: source as AddTodayEntryInput['source'],
    caloriesKcal: amount('caloriesKcal', MAX_KCAL),
    proteinG: amount('proteinG', MAX_MACRO_G),
    carbsG: amount('carbsG', MAX_MACRO_G),
    fatG: amount('fatG', MAX_MACRO_G),
  };
}
