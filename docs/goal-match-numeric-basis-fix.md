# Goal Match numeric basis validation fix

29 October 2026, dev. No commit/push. No new live Google calls.

## Exact change

Only supportedText numeric fact matching changed.

- A valid numeric reference under product.per100.* authorizes standard RU basis syntax:
  “на 100 г” or “на 100 мл”.
- The validator records the character offset of the 100 token inside each such construction.
- Only that exact numeric token is exempt from matching a measured fact.
- All other numbers, including the measured amount before the basis, must still match
  referenced numeric values (or the existing permitted integer percentage rounding).
- Whitespace/NBSP, case and an adjoining unit such as “100г” are supported.
- Whole-word boundaries prevent arbitrary word/unit suffixes being treated as the basis.
- No generic whitelist of 100, no unrelated perServing authorization, no new EN syntax.
- The existing supportedText function is shared by factors and summary. A summary can use
  the same basis context through references of its surviving validated factors.
- Sentence/medical/missing-field/code/band checks were not changed.

Examples:
- “Соль — 1.4 г на 100 г”, ref product.per100.saltG=1.4: valid.
- “Сахара — 10.6 г на 100 мл”, matching product.per100.sugarsG: valid.
- “Соль — 2.4 г на 100 г”, ref saltG=1.4: invalid.
- “В продукте 100 г сахара”, no referenced 100: invalid.
- A matching perServing measurement plus “на 100 г”, without a per100 reference: invalid.
- A second standalone 100 in the same sentence is not exempt merely because a valid basis
  construction appears elsewhere.
- RU summary “Соль — 1,4 г на 100 г.” is covered; invented summary measurements still fail.

## Saved Chips response: before / after

Input is the exact raw AI response captured in goal-match-google-ordinal-live.json.
No new generation, manual factor edits or score changes were made.
The source raw object was deep-compared with the before-fix snapshot.

| Field | Before | After |
|---|---|---|
| validator.valid | true | true |
| removedFactors | 1 | 0 |
| adjusted | true | false |
| AI/final score | 3.5 | 3.5 |
| source | ai | ai |
| final confidence | medium | high |
| surviving factors | ultra_processed, fits_portion | ultra_processed, high_salt, fits_portion |

The full original high_salt factor now survives:
“Содержание соли умеренное и составляет 1.4 г на 100 г”
with references product.per100.saltG and facts.levels.salt.
The measured 1.4 matches the fact; the 100 is the contextual denominator.

The existing reconciliation function is unchanged. With no factor removed, its existing
validationAdjusted cap no longer lowers confidence. No confidence rule was edited.

Full raw input, both validation results and both reconciliations:
[goal-match-numeric-basis-replay.json](goal-match-numeric-basis-replay.json).

## Tests

Full pnpm typecheck passed.
Full pnpm test passed: 321 runtime tests plus core type-contract checks:
- scoring 186;
- AI 54;
- API 52;
- mobile 12;
- nutrition 17.

Ten new numeric-basis tests cover the five required cases plus summary, decimal comma,
NBSP/case/unit formatting, contextual offsets, missing/unknown references and fake bases.
Existing numeric hallucination tests remain green.
The old saved-response regression expectation was updated: the previously removed salt
factor is now correctly retained.

Only after all tests passed, the saved Chips response was replayed offline.
globalThis.fetch was replaced with a throwing guard in that replay; call count remained 0.

## Exact files in this task

1. packages/scoring/src/goal-match-ai-validate.ts — contextual numeric-basis exception only.
2. packages/scoring/src/test/goal-match-numeric-basis.test.ts — ten regression tests.
3. apps/api/src/modules/goal-match/test/prompt-v2-regression.test.ts — saved-response
   removedFactors expectation updated to 0.
4. docs/goal-match-numeric-basis-replay.json — offline before/after results.
5. docs/goal-match-numeric-basis-fix.md — this report.

## Unchanged

Prompt and promptVersion eat-healthier-rubric-v2, score/band/dimension rules, ordinal fix,
v3, reconciliation, corridor, risk ceilings, Product Score, Nutrition Engine, provider,
Mobile, output schema and .env are unchanged.
The previous live result files remain unchanged.
No API key is included in the new report/replay artifacts.
No live Gemini call, commit or push was performed.
