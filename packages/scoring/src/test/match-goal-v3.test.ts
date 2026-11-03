import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NOT_DETECTED, observed, type GoalMatchV3, type Product, type TypicalServing } from '@foodlens/core';
import { matchGoal } from '../match-goal';
import { scoreProduct } from '../score-product';
import { calculateEatHealthier } from '../goal-match-v3-calculation';
import { HEALTH_FIXTURES, fixtureFeatures, fixtureProduct, healthPlan } from './eat-healthier.fixtures';

const pick = (id: string) => HEALTH_FIXTURES.find((f) => f.id === id)!;
const product = (id = 'yogurt') => fixtureProduct(pick(id));
function evaluate(p = product(), plan = healthPlan()): GoalMatchV3 {
  const result = matchGoal(p, plan);
  assert.ok(result.version === 'goal-match-v3');
  return result;
}
const points = (r: GoalMatchV3, kind: string) => r.factors.find((f) => f.kind === kind)?.points ?? 0;
function withoutServing(p: Product, serving: TypicalServing | null): Product {
  return { ...p, nutrition: { ...p.nutrition!, servingSize: NOT_DETECTED },
    semantics: { ...p.semantics!, typicalServing: serving } };
}


describe('v3 additional representation and routing regressions', () => {
  it('all three other goals keep v1 units, factors and ignore semantic changes', () => {
    const p = product();
    for (const goal of ['lose_weight', 'maintain_weight', 'gain_weight'] as const) {
      const plan = { ...healthPlan(), goal };
      const first = matchGoal(p, plan);
      assert.equal(first.version, 'goal-match-v1');
      assert.equal(first.state, undefined);
      assert.ok(Number.isInteger(first.value));
      assert.deepEqual(first, matchGoal({ ...p, semantics: null }, plan));
      assert.deepEqual(first, matchGoal({ ...p, semantics: { ...p.semantics!,
        sugarSource: { value: 'added', confidence: 'low', evidence: ['changed'] },
        processing: { value: 'ultra_processed', confidence: 'low', evidence: ['changed'] },
      } }, plan));
    }
  });
  it('nonempty evidence wording never changes the score', () => {
    const p = product();
    const changed = { ...p, semantics: { ...p.semantics!,
      sugarSource: { ...p.semantics!.sugarSource, evidence: ['different supporting quote'] },
      processing: { ...p.semantics!.processing, evidence: ['another supporting quote'] },
    } };
    assert.deepEqual(evaluate(changed), evaluate(p));
  });
  it('low-confidence productForm falls back to food unless per_100ml is deterministic', () => {
    const p = product('juice');
    const n = { ...p.nutrition!, basis: 'per_100g' as const, servingSize: observed({ amount: 50, unit: 'g' as const }) };
    const r = evaluate({ ...p, nutrition: n, semantics: { ...p.semantics!,
      productForm: { value: 'beverage', confidence: 'low' } } });
    const food = evaluate({ ...p, nutrition: n, semantics: { ...p.semantics!,
      productForm: { value: 'food', confidence: 'high' } } });
    assert.equal(r.value, food.value);
    assert.equal(r.value, 6.4);
  });
  it('AI typicalServing cannot rescue a per_serving label without a printed serving', () => {
    const p = product('chicken');
    for (const confidence of ['high', 'medium', 'low'] as const) {
      const r = evaluate({ ...p, nutrition: { ...p.nutrition!, basis: 'per_serving', servingSize: NOT_DETECTED },
        semantics: { ...p.semantics!, typicalServing: { amount: 150, unit: 'g', confidence, evidence: ['package'] } } });
      assert.equal(r.state, 'insufficient_data'); assert.equal(r.value, null); assert.equal(r.unavailableReason, 'unknown_portion');
    }
  });
  it('unknown processing on a zero-energy product does not incorrectly make it not_applicable', () => {
    const p = product('trace_water');
    const r = evaluate({ ...p, semantics: { ...p.semantics!,
      processing: { value: 'unknown', confidence: 'low', evidence: [] } } });
    assert.equal(r.state, 'goal_match'); assert.equal(r.value, 6);
    assert.deepEqual(r.range, { min: 5.5, max: 7 });
  });
  it('fixed concentration risks survive arbitrarily small usual portions', () => {
    for (const id of ['cola', 'butter', 'chips']) {
      const f = fixtureFeatures(pick(id));
      const tiny = calculateEatHealthier({ ...f, servingMultiplier: .01 });
      const regular = calculateEatHealthier(f);
      const kind = id === 'cola' ? 'sugars' : id === 'butter' ? 'saturatedFat' : 'salt';
      assert.equal(tiny.risks[kind], regular.risks[kind]);
    }
  });
  it('nonfinite arithmetic never escapes as a numerical API score/range', () => {
    const p = product();
    const r = evaluate({ ...p, nutrition: { ...p.nutrition!, basis: 'per_serving',
      servingSize: observed({ amount: Number.MIN_VALUE, unit: 'g' }) } });
    assert.equal(r.state, 'insufficient_data');
    assert.equal(r.value, null);
  });
  it('unknown sugar is never favorable across all golden inputs', () => {
    for (const f of HEALTH_FIXTURES) {
      const input = fixtureFeatures(f);
      assert.ok(calculateEatHealthier({ ...input, sugarSource: 'unknown' }).score <=
        calculateEatHealthier({ ...input, sugarSource: 'intrinsic' }).score + 1e-10);
    }
  });
});

describe('eat_healthier v3: exact approved formula / golden fixtures', () => {
  for (const f of HEALTH_FIXTURES) {
    it(f.label, () => {
      const p = fixtureProduct(f);
      const result = evaluate(p);
      assert.equal(result.state, 'goal_match');
      assert.equal(result.value, f.expected);
      const raw = calculateEatHealthier(fixtureFeatures(f));
      assert.ok(Math.abs(raw.score - (6 + raw.factors.reduce((sum, x) => sum + x.points, 0))) < 1e-10);
      assert.deepEqual(result, evaluate(p));
      assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
    });
  }
  it('documents sanity deviations instead of changing the formula', () => {
    const deviations = HEALTH_FIXTURES.filter((f) => f.sanity &&
      (f.expected < f.sanity[0]! || f.expected > f.sanity[1]!)).map((f) => f.id);
    assert.deepEqual(deviations, ['bread', 'cake', 'butter']);
  });
  it('water dilution preserves the same oatmeal nutrients and score', () => {
    assert.equal(evaluate(product('oatmeal')).value, evaluate(product('oatmeal_water')).value);
  });
  it('a smaller-than-2g protein portion never earns a bonus, including zero kcal', () => {
    const p = product('trace_water');
    assert.equal(points(evaluate(p), 'protein'), 0);
    const edge = { ...p, nutrition: { ...p.nutrition!, proteinG: observed(0.399) } };
    assert.equal(points(evaluate(edge), 'protein'), 0); // 1.995 g / 500 ml.
  });
  it('all bonuses together respect the cap, with actual proportional factor contributions', () => {
    const f = { ...fixtureFeatures(pick('chicken')), fiberG: 20 };
    const calc = calculateEatHealthier(f);
    assert.ok(Math.abs(calc.factors.filter((x) => ['protein', 'fiber', 'whole'].includes(x.kind))
      .reduce((sum, x) => sum + x.points, 0) - 4) < 1e-10);
    assert.equal(calc.score, 10);
  });
  it('ranked risk discounts are applied to the real explanation points', () => {
    const calc = calculateEatHealthier({ ...fixtureFeatures(pick('cake')), saltG: 3 });
    const sorted = Object.values(calc.risks).sort((a, b) => b - a);
    const actual = -calc.factors.filter((f) => ['sugars', 'salt', 'saturatedFat'].includes(f.kind))
      .reduce((sum, f) => sum + f.points, 0);
    assert.ok(Math.abs(actual - (sorted[0]! + .5 * sorted[1]! + .25 * sorted[2]!)) < 1e-10);
  });
  it('daily calories never change the sugar/saturated-fat/salt risks', () => {
    for (const id of ['yogurt', 'apple', 'cola', 'butter', 'chips']) {
      const results = [1400, 2000, 3000].map((caloriesKcal) => evaluate(product(id), {
        ...healthPlan(), targets: { ...healthPlan().targets, caloriesKcal },
      }));
      const risks = (r: GoalMatchV3) => r.factors.filter((f) => ['sugars', 'saturatedFat', 'salt'].includes(f.kind));
      assert.deepEqual(risks(results[0]!), risks(results[1]!));
      assert.deepEqual(risks(results[1]!), risks(results[2]!));
    }
  });
  it('product names and categories cannot change the numerical result', () => {
    const p = product('yogurt'), first = evaluate(p);
    assert.deepEqual(evaluate({ ...p, name: observed('Cola apple healthy superfood'), category: observed('other') }), first);
  });
  it('Product Score is independent of v3 and the profile', () => {
    for (const f of HEALTH_FIXTURES) {
      const p = fixtureProduct(f), before = scoreProduct(p);
      evaluate(p);
      assert.deepEqual(scoreProduct(p), before);
    }
    assert.equal(scoreProduct(product()).value, 9.4);
  });
});

describe('eat_healthier v3: gate order and missing data', () => {
  it('profile unavailability is unchanged', () => assert.equal(matchGoal(product(), null).unavailableReason, 'no_profile'));
  it('known allergen/diet conflict wins even without nutrition or semantics', () => {
    const p = { ...product(), nutrition: null, semantics: null,
      allergens: observed([{ code: 'milk' as const, presence: 'contains' as const, provenance: 'observed' as const }]) };
    const r = evaluate(p, { ...healthPlan(), allergens: ['milk'] });
    assert.equal(r.state, 'goal_match'); assert.equal(r.value, 0); assert.equal(r.level, 'conflict');
    assert.equal(evaluate(p, { ...healthPlan(), dietaryPreferences: ['vegan'] }).value, 0);
  });
  it('missing nutrition, basis and energy precede later gates', () => {
    assert.equal(evaluate({ ...product(), nutrition: null }).unavailableReason, 'no_nutrition');
    const p = product();
    assert.equal(evaluate({ ...p, nutrition: { ...p.nutrition!, basis: 'unknown' } }).unavailableReason, 'unknown_basis');
    assert.equal(evaluate({ ...p, nutrition: { ...p.nutrition!, caloriesKcal: NOT_DETECTED } }).unavailableReason, 'no_calories');
  });
  it('missing critical nutrients cannot be treated as zero', () => {
    const p = product();
    for (const key of ['sugarsG', 'saturatedFatG', 'saltG'] as const) {
      const r = evaluate({ ...p, nutrition: { ...p.nutrition!, [key]: NOT_DETECTED } });
      assert.equal(r.state, 'insufficient_data'); assert.equal(r.unavailableReason, 'missing_nutrients');
      assert.equal(r.value, null);
    }
  });
  it('only the documented low-carb / low-fat exceptions may fill missing sugars / saturated fat', () => {
    const p = product('chicken');
    const r = evaluate({ ...p, nutrition: { ...p.nutrition!, fatG: observed(.5), carbsG: observed(.5),
      sugarsG: NOT_DETECTED, saturatedFatG: NOT_DETECTED } });
    assert.equal(r.state, 'goal_match');
    assert.equal(points(r, 'sugars'), 0); assert.equal(points(r, 'saturatedFat'), 0);
  });
  it('salt may be calculated from observed sodium, with the fixed conversion', () => {
    const p = product(), r = evaluate({ ...p, nutrition: { ...p.nutrition!, saltG: NOT_DETECTED, sodiumMg: observed(40) } });
    assert.equal(r.state, 'goal_match'); assert.equal(r.value, evaluate(p).value);
  });
  it('missing fiber is not critical and forces at most medium confidence', () => {
    const r = evaluate(product());
    assert.equal(r.confidence, 'medium'); assert.ok(r.uncertainty.includes('fiber'));
  });
  it('legacy scans without semantics remain readable and v3 becomes explicitly unavailable', () => {
    assert.equal(evaluate({ ...product(), semantics: undefined }).unavailableReason, 'ai_context_unavailable');
  });
  it('unknown portion precedes missing AI context', () => {
    const p = product();
    const r = evaluate({ ...p, semantics: null, nutrition: { ...p.nutrition!, basis: 'per_serving', servingSize: NOT_DETECTED } });
    assert.equal(r.unavailableReason, 'unknown_portion');
  });
  it('without AI serving scenarios a very low-energy product is not_applicable: sugar source alone stays within the ambiguous width', () => {
    const p = product('trace_water');
    const r = evaluate({ ...p, nutrition: { ...p.nutrition!,
      caloriesKcal: observed(2), proteinG: observed(.1), carbsG: observed(.4), sugarsG: observed(.4),
      servingSize: observed({ amount: 10000, unit: 'ml' }),
    }, semantics: { ...p.semantics!,
      sugarSource: { value: 'unknown', confidence: 'low', evidence: [] },
      processing: { value: 'whole_or_minimal', confidence: 'high', evidence: ['visible structure'] },
    } });
    assert.equal(r.state, 'not_applicable'); assert.equal(r.value, null);
  });
  it('known zero energy is not missing; whole water is not_applicable but UPF water gets 5.5', () => {
    const p = product('trace_water');
    const whole = { ...p, semantics: { ...p.semantics!, processing: {
      value: 'whole_or_minimal' as const, confidence: 'high' as const, evidence: ['water'],
    } } };
    assert.equal(evaluate(whole).state, 'not_applicable');
    assert.equal(evaluate(p).value, 5.5);
    assert.equal(evaluate({ ...whole, nutrition: { ...whole.nutrition!, proteinG: NOT_DETECTED } }).state, 'goal_match');
  });
  it('v3 restrictions keep their exact v1 magnitude after conversion to 0–10', () => {
    const p = product('chicken');
    const traces = evaluate({ ...p, allergens: observed([{ code: 'milk', presence: 'may_contain', provenance: 'observed' }]) },
      { ...healthPlan(), allergens: ['milk'] });
    assert.equal(points(traces, 'allergens'), -3); assert.equal(traces.value, 6.5);
    const avoided = evaluate({ ...p, ingredients: observed([{ name: 'cilantro', percent: null }]) },
      { ...healthPlan(), avoidedIngredients: ['cilantro'] });
    assert.equal(points(avoided, 'avoidedIngredients'), -4); assert.equal(avoided.value, 5.5);
  });
});

describe('eat_healthier v3: AI portions, conservative confidence and ranges', () => {
  it('printed serving overrides any AI serving, including low confidence or nonsense', () => {
    const p = product();
    const r = evaluate({ ...p, semantics: { ...p.semantics!, typicalServing: {
      amount: 99999, unit: 'ml', confidence: 'low', evidence: [],
    } } });
    assert.deepEqual(r, evaluate(p));
  });
  it('AI typicalServing is ignored at every confidence: the result equals having none', () => {
    const p = product('chicken');
    const none = evaluate(withoutServing(p, null));
    for (const confidence of ['high', 'medium', 'low'] as const) {
      assert.deepEqual(evaluate(withoutServing(p, { amount: 150, unit: 'g', evidence: ['package size'], confidence })), none);
      assert.deepEqual(evaluate(withoutServing(p, { amount: 99999, unit: 'ml', evidence: [], confidence })), none);
    }
  });
  it('per_100g without a printed serving: low-confidence estimate on 100 g, no portion figures', () => {
    const p = product('chicken');
    const r = evaluate(withoutServing(p, null));
    assert.equal(r.state, 'goal_match'); assert.equal(r.unavailableReason, null); assert.equal(r.confidence, 'low');
    assert.equal(r.value, evaluate({ ...p, nutrition: { ...p.nutrition!, servingSize: observed({ amount: 100, unit: 'g' }) } }).value);
    assert.deepEqual([r.portion!.basis, r.portion!.amount, r.portion!.unit], ['per_100', 100, 'g']);
    assert.equal(r.portion!.caloriesKcal, p.nutrition!.caloriesKcal.value);
    for (const factor of r.factors.filter((f) => f.kind !== 'whole')) { assert.equal(factor.portionShare, null); assert.equal(factor.value, null); }
    assert.ok(r.uncertainty.includes('typicalServing'));
  });
  it('per_100ml without a printed serving uses 100 ml', () => {
    const r = evaluate(withoutServing(product('cola'), null));
    assert.equal(r.state, 'goal_match'); assert.equal(r.confidence, 'low');
    assert.deepEqual([r.portion!.basis, r.portion!.amount, r.portion!.unit], ['per_100', 100, 'ml']);
  });
  it('a printed serving in another unit is not usable, so a per-100 label still falls back to 100 g', () => {
    const p = product('chicken');
    const r = evaluate({ ...p, nutrition: { ...p.nutrition!, servingSize: observed({ amount: 150, unit: 'ml' }) } });
    assert.equal(r.portion!.basis, 'per_100'); assert.equal(r.confidence, 'low');
  });
  it('per_serving and unknown basis without a printed serving stay insufficient_data', () => {
    const p = product('chicken');
    const perServing = evaluate({ ...p, nutrition: { ...p.nutrition!, basis: 'per_serving', servingSize: NOT_DETECTED } });
    assert.deepEqual([perServing.state, perServing.value, perServing.unavailableReason], ['insufficient_data', null, 'unknown_portion']);
    const unknown = evaluate({ ...p, nutrition: { ...p.nutrition!, basis: 'unknown', servingSize: NOT_DETECTED } });
    assert.deepEqual([unknown.state, unknown.value, unknown.unavailableReason], ['insufficient_data', null, 'unknown_basis']);
  });
  it('a printed serving is still used exactly as before', () => {
    const p = product('chicken');
    const r = evaluate(p);
    assert.equal(r.portion!.basis, 'serving'); assert.equal(r.portion!.amount, p.nutrition!.servingSize.value!.amount);
    assert.notEqual(r.confidence, 'low');
  });
  it('the per-100 estimate still needs a full table: missing nutrients stay insufficient_data', () => {
    const p = product();
    const r = evaluate({ ...p, nutrition: { ...p.nutrition!, servingSize: NOT_DETECTED, sugarsG: NOT_DETECTED } });
    assert.equal(r.unavailableReason, 'missing_nutrients');
  });
  it('a profile conflict still wins over the per-100 estimate', () => {
    const p = withoutServing(product('chicken'), null);
    const r = evaluate({ ...p, allergens: observed([{ code: 'milk', presence: 'contains', provenance: 'observed' }]) }, { ...healthPlan(), allergens: ['milk'] });
    assert.equal(r.level, 'conflict'); assert.equal(r.value, 0);
  });
  it('low-confidence intrinsic / whole fields use unknown main fallback while preserving extremes', () => {
    const p = product('cola');
    const low = evaluate({ ...p, semantics: { ...p.semantics!,
      sugarSource: { value: 'intrinsic', confidence: 'low', evidence: ['uncertain'] },
      processing: { value: 'whole_or_minimal', confidence: 'high', evidence: ['visible structure'] },
    } });
    const unknown = evaluate({ ...p, semantics: { ...p.semantics!,
      sugarSource: { value: 'unknown', confidence: 'high', evidence: [] },
      processing: { value: 'whole_or_minimal', confidence: 'high', evidence: ['visible structure'] },
    } });
    assert.equal(low.value, unknown.value);
    assert.ok(low.range!.max > low.range!.min);
    const uncertainWhole = evaluate({ ...product('chicken'), semantics: { ...product('chicken').semantics!,
      processing: { value: 'whole_or_minimal', confidence: 'low', evidence: ['uncertain'] } } });
    assert.equal(uncertainWhole.value, 8.5);
    assert.equal(uncertainWhole.range!.min, 8); assert.equal(uncertainWhole.range!.max, 9.5);
  });
  it('unknown sugarSource is never more favorable than intrinsic', () => {
    const p = product('apple');
    const r = evaluate({ ...p, semantics: { ...p.semantics!, sugarSource: { value: 'unknown', confidence: 'high', evidence: [] } } });
    assert.ok(r.value === null || r.value <= evaluate(p).value!);
  });
  it('unknown sugar source does not lower confidence when its score effect is zero', () => {
    const p = product('chicken');
    const r = evaluate({ ...p, semantics: { ...p.semantics!, sugarSource: { value: 'unknown', confidence: 'low', evidence: [] } } });
    assert.equal(r.confidence, 'high'); assert.equal(r.range!.min, r.range!.max);
  });
  it('mixed sugar uses coefficient 0.5 and cannot be high confidence', () => {
    const p = product('cola');
    const r = evaluate({ ...p, semantics: { ...p.semantics!, sugarSource: { value: 'mixed', confidence: 'high', evidence: ['milk', 'sugar'] } } });
    assert.equal(r.confidence, 'medium');
    const raw = calculateEatHealthier({ ...fixtureFeatures(pick('cola')), sugarSource: 'mixed' });
    assert.ok(raw.risks.sugars < 3);
  });
  it('combined extreme scenarios wider than 3 points yield ambiguous, not a confident number', () => {
    const p = product('cola');
    const r = evaluate({ ...p, semantics: { ...p.semantics!,
      sugarSource: { value: 'unknown', confidence: 'low', evidence: [] },
      processing: { value: 'unknown', confidence: 'low', evidence: [] },
    } });
    assert.equal(r.state, 'insufficient_data'); assert.equal(r.unavailableReason, 'ambiguous');
    assert.equal(r.value, null); assert.ok(r.range!.max - r.range!.min > 3);
  });
  it('basis deterministically identifies per_100ml beverages even when AI says food', () => {
    const p = product('cola');
    assert.equal(evaluate({ ...p, semantics: { ...p.semantics!, productForm: { value: 'food', confidence: 'low' } } }).value, 2.5);
  });
  it('per-serving and per-100 values are equivalent when the label serving is known', () => {
    const p = product();
    const n = p.nutrition!;
    const converted = { ...n, basis: 'per_serving' as const };
    for (const key of ['caloriesKcal', 'proteinG', 'fatG', 'carbsG', 'sugarsG', 'saturatedFatG', 'saltG', 'fiberG'] as const) {
      const value = n[key].value;
      converted[key] = value === null ? NOT_DETECTED : observed(value * 1.3);
    }
    assert.equal(evaluate({ ...p, nutrition: converted }).value, evaluate(p).value);
  });
});


describe('eat_healthier v3: optional unknown protein', () => {
  it('keeps protein unknown and omits its bonus without inventing an uncertainty range', () => {
    for (const [id, expected] of [['chips', 4.2], ['yogurt', 6.6]] as const) {
      const p = product(id);
      const missing = { ...p, nutrition: { ...p.nutrition!, proteinG: NOT_DETECTED } };
      const before = JSON.stringify(missing);
      const r = evaluate(missing);
      assert.equal(r.state, 'goal_match'); assert.equal(r.value, expected);
      assert.equal(r.unavailableReason, null);
      const factor = r.factors.find((f) => f.kind === 'protein')!;
      assert.equal(factor.points, 0); assert.equal(factor.value, null); assert.equal(factor.portionShare, null);
      assert.equal(r.confidence, 'medium'); assert.ok(r.uncertainty.includes('protein'));
      assert.deepEqual(r.range, { min: expected, max: expected });
      assert.equal(JSON.stringify(missing), before);
      assert.deepEqual(scoreProduct(missing), scoreProduct(JSON.parse(before)));
    }
  });
  it('supports missing protein and fiber together without losing either note', () => {
    const p = product('apple');
    const r = evaluate({ ...p, nutrition: { ...p.nutrition!, proteinG: NOT_DETECTED, fiberG: NOT_DETECTED } });
    assert.equal(r.state, 'goal_match'); assert.equal(r.confidence, 'medium');
    assert.ok(r.uncertainty.includes('protein')); assert.ok(r.uncertainty.includes('fiber'));
    assert.equal(points(r, 'protein'), 0); assert.equal(points(r, 'fiber'), 0);
  });
  it('known zero protein differs from unknown and only confirmed protein permits not_applicable', () => {
    const p = product('trace_water');
    const whole = { ...p, semantics: { ...p.semantics!, processing: {
      value: 'whole_or_minimal' as const, confidence: 'high' as const, evidence: ['water'],
    } } };
    const known = { ...whole, nutrition: { ...whole.nutrition!, proteinG: observed(0) } };
    assert.equal(evaluate(known).state, 'not_applicable');
    const unknown = evaluate({ ...whole, nutrition: { ...whole.nutrition!, proteinG: NOT_DETECTED } });
    assert.equal(unknown.state, 'goal_match'); assert.equal(unknown.confidence, 'medium');
    assert.ok(unknown.uncertainty.includes('protein'));
    const zero = evaluate({ ...product('cola'), nutrition: { ...product('cola').nutrition!, proteinG: observed(0) } });
    assert.equal(zero.factors.find((f) => f.kind === 'protein')!.value, 0);
    assert.ok(!zero.uncertainty.includes('protein')); assert.equal(zero.confidence, 'high');
  });
  it('missing protein cannot hide missing risk nutrients', () => {
    const p = product();
    for (const key of ['sugarsG', 'saturatedFatG', 'saltG'] as const) {
      const r = evaluate({ ...p, nutrition: { ...p.nutrition!, proteinG: NOT_DETECTED, [key]: NOT_DETECTED } });
      assert.equal(r.state, 'insufficient_data'); assert.equal(r.unavailableReason, 'missing_nutrients');
    }
  });
  it('preserves a lower confidence caused by existing semantic uncertainty', () => {
    const p = product('cola');
    const r = evaluate({ ...p, nutrition: { ...p.nutrition!, proteinG: NOT_DETECTED },
      semantics: { ...p.semantics!, sugarSource: { value: 'unknown', confidence: 'low', evidence: [] } } });
    assert.equal(r.state, 'goal_match'); assert.equal(r.confidence, 'low');
    assert.ok(r.uncertainty.includes('protein'));
  });
});
