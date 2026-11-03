import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { TodayService } from '../today.service';

const entry = (overrides: Record<string, unknown> = {}) => ({
  id: 'meal_1', date: '2026-11-03', name: 'Курица с рисом и овощами', source: 'meal_photo_estimate',
  caloriesKcal: 607, proteinG: 53, carbsG: 62, fatG: 15, ...overrides,
});

describe('TodayService', () => {
  it('пустой день: нет записей, итоги нулевые', () => {
    assert.deepEqual(new TodayService().get('u', '2026-11-03'), {
      date: '2026-11-03', entries: [], totals: { caloriesKcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
    });
  });

  it('после добавления калории и БЖУ дня увеличиваются на значения записи', () => {
    const today = new TodayService();
    today.add('u', entry(), new Date('2026-11-03T12:00:00Z'));
    const log = today.add('u', entry({ id: 'meal_2', name: 'Салат', caloriesKcal: 180, proteinG: 4, carbsG: 10, fatG: 14 }));
    assert.deepEqual(log.totals, { caloriesKcal: 787, proteinG: 57, carbsG: 72, fatG: 29 });
    assert.deepEqual(log.entries.map((item) => [item.name, item.source]), [['Курица с рисом и овощами', 'meal_photo_estimate'], ['Салат', 'meal_photo_estimate']]);
    assert.equal(log.entries[0]!.addedAt, '2026-11-03T12:00:00.000Z');
    assert.deepEqual(today.get('u', '2026-11-03').totals, log.totals);
  });

  it('повтор с тем же id (двойное нажатие, повтор запроса) не создаёт дубль', () => {
    const today = new TodayService();
    today.add('u', entry());
    const log = today.add('u', entry());
    assert.equal(log.entries.length, 1);
    assert.equal(log.totals.caloriesKcal, 607);
  });

  it('дни и пользователи не смешиваются', () => {
    const today = new TodayService();
    today.add('u', entry());
    assert.equal(today.get('u', '2026-11-04').entries.length, 0);
    assert.equal(today.get('other', '2026-11-03').entries.length, 0);
  });

  it('некорректные данные отклоняются', () => {
    const today = new TodayService();
    for (const bad of [
      entry({ caloriesKcal: -1 }), entry({ proteinG: Number.NaN }), entry({ caloriesKcal: 99999 }), entry({ name: '  ' }),
      entry({ source: 'manual' }), entry({ date: '03.11.2026' }), entry({ id: '' }), null,
    ]) {
      assert.throws(() => today.add('u', bad), BadRequestException);
    }
    assert.throws(() => today.get('u', undefined), BadRequestException);
    assert.equal(today.get('u', '2026-11-03').entries.length, 0);
  });
});
