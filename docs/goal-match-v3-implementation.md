# Goal Match v3: implementation report

Source of truth: the attached “Goal Match eat_healthier: гибридная AI-архитектура” and the user's explicit follow-up clarifications. No Claude artifact URL was accessed for this implementation.

## Scope and units

Only `eat_healthier` dispatches to `goal-match-v3`. `lose_weight`, `maintain_weight` and `gain_weight` still run the original v1 calculation, with API values 0–100. V3 API value, factor points and range use 0–10. Mobile branches on version, divides only v1 by 10, and formats both to one decimal (Russian UI uses a decimal comma).

Product Score and Nutrition Engine source/formulas were not changed. The Greek-yogurt Product Score remains 9.4. No real Meta request was made. Provider tests use injected fetch stubs; mock tests use no network. No .env, commit, push, database migration, or dependency installation.

ScanService already passes the complete Product to matchGoal, so the new Product.semantics reaches scoring without changing the response envelope or service. The API remains { product, score, goalMatch }.

## Semantic schema

```ts
type Confidence = 'high' | 'medium' | 'low';
type SemanticField<T> = {
  value: T;
  confidence: Confidence;
  evidence: string[];
};
interface ProductSemantics {
  version: 'semantics-v1';
  sugarSource: SemanticField<'intrinsic' | 'added' | 'mixed' | 'none' | 'unknown'>;
  processing: SemanticField<'whole_or_minimal' | 'processed' | 'ultra_processed' | 'unknown'>;
  productForm: {
    value: 'food' | 'beverage' | 'unknown';
    confidence: Confidence;
  };
  typicalServing: null | {
    amount: number; // finite and > 0
    unit: 'g' | 'ml';
    confidence: Confidence;
    evidence: string[];
  };
}
```

An absent/incompatible/malformed whole semantic block becomes null and yields ai_context_unavailable in v3. Invalid individual enum/confidence/evidence fields become unknown/low. Intrinsic and whole_or_minimal require nonempty evidence. Evidence wording is not a scoring input.

Only a printed serving counts as a real serving. AI typicalServing is never used as one. Without a printed serving, a per_100g/per_100ml label is calculated on 100 g/ml as a low-confidence estimate with portion.basis 'per_100' and no AI call; a per_serving label yields unknown_portion. (The earlier AI-serving behavior described below is superseded.) Medium AI servings are evaluated at 0.5×, 1× and 1.5× for the uncertainty range; high uses its stated amount.

The semantic extension is recovered before strict validation of the complete AI response. Original nutrition, identity, allergens, confidence and unexpected outer fields retain their existing strict checks. Old responses without semantics still normalize and remain usable by v1 / Product Score.

The same strict JSON Schema and normalizer are used by mock and Meta. Semantics is requested in the same image call; temperature was already 0 and remains 0. meta-product-analysis version is bumped to meta-product-analysis-v2 because schema/prompt changed; the new semantic version is semantics-v1.

## Exact v3 calculation

All equations below use the 0–10 scale. ramp(x,a,b) = clamp((x-a)/(b-a),0,1).

```text
GM = clamp(6 + min(4, B_protein + B_fiber + B_whole)
             - (R1 + 0.5*R2 + 0.25*R3)
             - P_upf
             - profile restriction penalties,
           0, 10)

B_protein = 2.5 * sqrt(
  ramp(4*protein/kcal, 0.10, 0.35)
  * ramp(protein_in_serving/protein_target, 0.02, 0.12)
)
protein_in_serving < 2g => B_protein = 0

B_fiber = 1.5
  * ramp(fiber_per_100kcal, 1, 3)
  * ramp(fiber_in_serving, 0.5, 3)

B_whole:
  whole_or_minimal = 1
  processed = 0.3
  ultra_processed / unknown = 0

P_upf:
  ultra_processed = 0.5
  otherwise = 0
```

Each risk is weight × max(portion branch, concentration branch); R1≥R2≥R3 are the three sorted risks.

| Risk | Weight | Portion branch | Concentration branch |
|---|---:|---|---|
| Free sugar | 3 | ramp(free_sugar_serving/50, 0.10, 0.50) | food: ramp(free_sugar_per100, 5, 22.5); beverage: ramp(free_sugar_per100, 2.5, 10) |
| Saturated fat | 3 | ramp(sat_serving/20, 0.10, 0.50) | ramp(sat_per_100kcal, 1.5, 5) |
| Salt | 2.5 | ramp(salt_serving/5, 0.10, 0.40) | ramp(salt_per100, 0.75, 2.0) |

Free sugar = total sugar × k: intrinsic/none=0, mixed=0.5, added/unknown=1.

No low-calorie bonus, calorie-share factor, energy-density penalty, total-fat penalty or total-carb penalty exists in this branch. Product names, brands, dietary categories and Product Score do not enter this formula.

Profile restrictions are reused from v1: contains/diet conflict forces 0; may_contain subtracts 3; avoided ingredient subtracts 4. The same existing matching rules are retained.

Positive factor points are proportionally scaled when their combined bonus exceeds 4. Negative risk factor points include their actual sorted-risk discount. Thus explanations reflect the calculation rather than raw undiscounted risks. The UI does not neutralize a negative v3 contribution merely because its daily-limit share is small.

## Gates

1. Missing/unavailable profile: retain the existing no_profile/profile_unavailable v1 unavailable contract; the user's goal is not known yet.
2. Allergen/diet conflict: state goal_match, value 0, level conflict, even with no nutrition/context.
3. insufficient_data: no_nutrition, unknown_basis, no_calories, missing_nutrients, unknown_portion, ai_context_unavailable, ambiguous.
4. not_applicable: ≤4 kcal/100, protein/fat/sugar each <0.5g/100, effective processing whole_or_minimal.
5. Otherwise goal_match.

Critical nutrients: protein, sugars, saturated fat, salt (or sodium × 2.5/1000 when sodium is in mg). Only the documented exceptions are used: missing saturated fat may become zero if normalized fat ≤0.5g/100; missing sugar may become zero if normalized carbs ≤0.5g/100. Fiber is optional, contributes no bonus when missing, and limits confidence to medium.

A declared zero is distinct from absent data. Zero-energy ultra-processed gel/trace water is evaluated normally and gets 5.5; whole/minimal water can be not_applicable. Processing unknown does not qualify for not_applicable.

V3 levels: ≥8 great; ≥6.5 good; ≥4.5 fair; otherwise poor. Classification agrees with the rounded API score.

## Uncertainty

Known values with low confidence are retained in Product but not trusted for the primary score:
- sugarSource low => unknown => added coefficient;
- processing low => unknown => zero whole bonus/UPF penalty;
- productForm: per_100ml deterministically means beverage; otherwise low/unknown means food;
- typicalServing low is not used.

For low/unknown sugarSource and processing, all combinations of the prescribed extremes are evaluated, including the original known value. Medium AI portion scenarios are combined with these semantic extremes. Evidence text is not used numerically.

Range uses the extreme scores, rounded to one decimal. Width checks use unrounded values:
- >3 => insufficient_data / ambiguous;
- >1.5 => low;
- ≤0.5 plus all critical values from the label and no medium override => high;
- otherwise medium.

AI-estimated portion, missing fiber, mixed sugar source (when relevant), or non-label critical values prevent high confidence. An uncertain field that has zero scoring effect does not itself reduce confidence. Mobile marks low confidence “примерно”; range remains available in API but is not added to the card, per MVP scope.

## Validation

- Full pnpm test: 191 passed, 0 failed.
  - scoring: 107
  - AI/provider: 42
  - API: 19
  - nutrition: 17
  - mobile presentation: 6
- Full pnpm typecheck: passed, including mobile and API.
- pnpm build: passed (all shared packages + NestJS API).
- git diff --check: passed; only repository line-ending warnings.
- Lint availability command: pnpm --filter @foodlens/mobile run lint. Result: no lint script configured. ESLint/config/dependencies were not installed or auto-generated.
- Legacy verification: 1,035 complete output comparisons against a saved pre-task match-goal.ts (23 products × 3 goals × 3 calorie profiles × 5 restriction scenarios). All outputs identical.
- Invariants include water dilution, <2g protein, zero vs missing, exact gate order (including ambiguous before not_applicable), AI serving priority, uncertainty extremes, mixed/unknown semantics, fixed nutrition risks across calorie goals, Product Score independence, all v1 routes, and v3/v1 mobile scales.

## Sanity table

Comparison uses 2000 kcal and protein target 139g (the document's reference protein target). V1 is displayed as value/10; v3 already returns 0–10. All rows below are state goal_match. Raw nutrition values and semantic assumptions are explicitly declared in packages/scoring/src/test/eat-healthier.fixtures.ts.

The document supplies approximate reference scores/ranges but no raw nutrition tables for all 23 products. These are representative declared fixtures, not claimed exact brand labels. Coefficients were not adjusted to fit the table.

| Product | Portion | v1 | v3 | Main actual v3 contributions |
|---|---:|---:|---:|---|
| Greek yogurt | 130g | 7.9 | 8.7 | protein +2.074, whole +1, sat −0.403 |
| Skyr | 150g | 8.3 | 9.5 | protein +2.484, whole +1 |
| Broccoli | 150g | 7.0 | 9.3 | fiber +1.5, whole +1, protein +0.765 |
| Carrot | 100g | 4.3 | 8.4 | fiber +1.38, whole +1 |
| Whole apple | 180g | 3.4 | 8.5 | fiber +1.5, whole +1, intrinsic sugar risk 0 |
| Almond | 30g | 4.7 | 8.4 | whole +1, fiber +0.869, protein +0.547 |
| Walnut | 30g | 4.4 | 7.0 | whole +1, fiber +0.011 |
| Avocado | 70g | 5.6 | 8.5 | fiber +1.5, whole +1 |
| Dry oatmeal | 40g | 5.7 | 8.7 | fiber +1.266, whole +1, protein +0.461 |
| Same oatmeal + water | 250g | 6.6 | 8.7 | identical nutrient intake and contributions |
| Whole-grain bread | 60g | 5.9 | 6.9 | fiber +1.05, protein +0.455, processed +0.3, salt −0.9 |
| Eggs | 100g | 6.3 | 8.5 | protein +2.101, whole +1, sat −0.572 |
| Chicken breast | 150g | 8.2 | 9.5 | protein +2.5, whole +1 |
| Salmon | 125g | 7.0 | 8.8 | protein +2.5, whole +1, sat −0.656 |
| Cola | 330ml | 3.1 | 2.5 | sugar −3, UPF −0.5 |
| Orange juice | 250ml | 3.3 | 4.6 | free sugar −2.4, whole +1 |
| Chocolate pudding | 125g | 4.0 | 3.2 | sugar −2.25, UPF −0.5, discounted sat −0.047 |
| Cake | 80g | 3.7 | 1.5 | sugar −3, discounted sat −1.05, UPF −0.5 |
| Chips | 30g | 4.9 | 4.2 | salt −1.3, UPF −0.5 |
| Milk chocolate | 25g | 1.6 | 1.7 | sugar −3, discounted sat −0.839, UPF −0.5 |
| Butter | 10g | 2.2 | 3.3 | sat −3, processed +0.3 |
| Empty low-calorie gel | 150g | 6.2 | 5.5 | no earned benefits, UPF −0.5 |
| Trace-protein water | 500ml | 6.5 | 5.5 | protein bonus 0 (<2g), UPF −0.5 |

Known range deviations:
- Cake 1.5 vs 2–4 and butter 3.3 vs 2–3 are explicitly acknowledged by the supplied design. No proposed optional cap or butter exception was added.
- Bread 6.9 vs 7–9: this fixture has 6g fiber per 250kcal and yields +1.05 fiber, while the design's illustrative row says +1.35. Salt is −0.9. Formula remains unchanged. The test records this discrepancy explicitly instead of silently broadening the document's range.
- Oatmeal 8.7 vs the illustrative 8.6 and pudding 3.2 vs 3.4 reflect explicit input fixtures; both remain within their prescribed ranges.

The existing API profile fixture has a 124g protein target, not 139g, so its Greek yogurt v3 is 8.8. This is expected personalization; Nutrition Engine and live profile data were not modified. In all cases Product Score remains 9.4.

For yogurt the new saturated-fat limit is the document's fixed 20g: 1.69g in a serving is 8.45%, rather than the old calorie-scaled 7.7%. Its modest −0.403 risk comes from the concentration branch.

## Files changed by this task

Pre-existing uncommitted changes outside this list were preserved.

- `packages/core/src/product/product-semantics.ts`
- `packages/core/src/product/product-semantics.validation.ts`
- `packages/core/src/product/product.ts`
- `packages/core/src/product/index.ts`
- `packages/core/src/scoring/goal-match.ts`
- `packages/ai/src/providers/meta/meta-product-analysis.ts`
- `packages/ai/src/providers/meta/meta-product-normalizer.ts`
- `packages/ai/src/providers/meta/meta-product-prompt.ts`
- `packages/ai/src/providers/meta/meta-product-semantics.ts`
- `packages/ai/src/providers/meta/meta-provider.ts`
- `packages/ai/src/providers/mock/mock-product-analysis.ts`
- `packages/ai/src/providers/mock/mock-provider.ts`
- `packages/ai/src/test/product-semantics.test.ts`
- `packages/ai/src/test/meta-product-normalizer.test.ts`
- `packages/scoring/src/match-goal.ts`
- `packages/scoring/src/goal-match-v3-rules.ts`
- `packages/scoring/src/goal-match-v3-calculation.ts`
- `packages/scoring/src/goal-match-v3.ts`
- `packages/scoring/src/test/eat-healthier.fixtures.ts`
- `packages/scoring/src/test/match-goal-v3.test.ts`
- `packages/scoring/src/test/match-goal.test.ts`
- `apps/api/src/modules/scan/test/scan.test.ts`
- `apps/mobile/src/features/goal-match/goalMatchLabels.ts`
- `apps/mobile/src/features/goal-match/components/GoalMatchCard.tsx`
- `apps/mobile/test/goal-match.test.cjs`
- `apps/mobile/package.json`
- `docs/goal-match-v3-implementation.md`

## iPhone visual checks

1. In mock mode, rescan: Product Score 9.4 remains; Goal Match displays the v3 value directly (8.7 for reference target 139g; actual profile may differ).
2. Verify v1 goals still display value/10, and both versions have one decimal and correct VoiceOver scale.
3. Verify top three short reasons match actual contributions; a negative v3 saturated-fat contribution is not shown as neutral.
4. Verify insufficient_data and not_applicable show text without a numeric badge.
5. Verify low confidence visibly/accessibly says “примерно”.
6. Verify labels fit on a narrow screen and missing fiber note is readable.
7. Recheck onboarding/profile edits and scan retry/navigation. No physical iPhone was controlled in this task.

## Deviations / limits

No deviations from the specified numerical formula, risk table, enum sets or clarified AI-portion behavior. The risk table's salt concentration thresholds 0.75–2.0 are used; the prose's mention of 0.3–1.5 is not substituted. API v3 0–10 units and low-confidence fallbacks follow the explicit user clarifications.

The production meta client was extended but not invoked against the real service. Lint is not configured. Tests verify JSX output/state/formatting with lightweight native host elements, not device layout or native camera operation. Full source/report and fixture assumptions remain locally reviewable; no commit/push.
