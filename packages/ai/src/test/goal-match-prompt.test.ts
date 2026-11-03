import assert from 'node:assert/strict';
import {it} from 'node:test';
import {GOAL_MATCH_AI_BANDS} from '@foodlens/core';
import {GOAL_MATCH_RUBRIC_PROMPT} from '../goal-match/goal-match-prompt';

it('prompt v2 explicitly states all band predicates and disambiguates enum counts',()=>{
  assert.ok(GOAL_MATCH_RUBRIC_PROMPT.includes('Рубрика: eat-healthier-rubric-v2.'));
  for(const band of GOAL_MATCH_AI_BANDS)assert.ok(GOAL_MATCH_RUBRIC_PROMPT.includes('If band = '+band+','));
  assert.ok(GOAL_MATCH_RUBRIC_PROMPT.includes('(SN == 2) OR (SN == 1 AND dimensions.processing == "negative")'));
  assert.ok(GOAL_MATCH_RUBRIC_PROMPT.includes('N == 0 AND P >= 2 AND SP >= 1'));
  assert.ok(GOAL_MATCH_RUBRIC_PROMPT.includes('SN == 0 AND N <= 1'));
  assert.ok(GOAL_MATCH_RUBRIC_PROMPT.includes('SN <= 1'));
  assert.ok(GOAL_MATCH_RUBRIC_PROMPT.includes('НЕ SN >= 2'));
  assert.ok(GOAL_MATCH_RUBRIC_PROMPT.includes('Не усиливай и не ослабляй dimensions'));
});
