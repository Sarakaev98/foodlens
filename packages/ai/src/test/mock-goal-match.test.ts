import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GoalMatchAiInput } from '@foodlens/core';
import { AIUnavailableError, MockProvider, MOCK_GOAL_MATCH_MODEL, MOCK_GOAL_MATCH_RECORDINGS } from '../index';

/** Mock смотрит только на название и ккал на 100 г/мл; остальной вход для выбора записи не нужен. */
const input = (name: string | null, kcal: number) => ({ product: { name, per100: { kcal } } }) as unknown as GoalMatchAiInput;
const recorded = (id: string) => MOCK_GOAL_MATCH_RECORDINGS.find((r) => r.id === id)!.responses[0];

describe('MockProvider.evaluateGoalMatch', () => {
  it('узнаёт демо-продукты по названию (регистр, ё) и калорийности', async () => {
    const mock = new MockProvider();
    assert.equal(mock.model, MOCK_GOAL_MATCH_MODEL);
    assert.deepEqual(await mock.evaluateGoalMatch(input('Греческий йогурт 2%', 66)), recorded('greek_yogurt'));
    assert.deepEqual(await mock.evaluateGoalMatch(input('ЧИПСЫ картофельные', 536)), recorded('chips'));
    assert.deepEqual(await mock.evaluateGoalMatch(input('Кока-кола', 42)), recorded('cola'));
    assert.deepEqual(await mock.evaluateGoalMatch(input('Apple', 52)), recorded('apple'));
    assert.deepEqual(await mock.evaluateGoalMatch(input('Протеиновый батончик', 350)), recorded('protein_bar'));
  });

  it('нет записи → AIUnavailableError (code unavailable), случайной оценки нет', async () => {
    for (const [name, kcal] of [['Груша', 57], [null, 66], ['Кола', 20], ['Чипсы', 400]] as const) {
      await assert.rejects(new MockProvider().evaluateGoalMatch(input(name, kcal)),
        (error: unknown) => error instanceof AIUnavailableError && error.code === 'unavailable');
    }
  });

  it('сценарий из нескольких ответов: по порядку, последний повторяется', async () => {
    const [first, second] = [recorded('chips'), { ...recorded('chips'), score: 3.5 }];
    const mock = new MockProvider({ goalMatchRecordings: [{ id: 'chips', names: ['чипсы'], kcalPer100: 536, responses: [first, second] }] });
    const scores = [];
    for (let i = 0; i < 3; i++) scores.push((await mock.evaluateGoalMatch(input('Чипсы', 536))).score);
    assert.deepEqual(scores, [3, 3.5, 3.5]);
  });
});
