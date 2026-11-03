import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NOT_DETECTED, observed, type Allergen, type Detected, type Additive, type Product } from '@foodlens/core';
import { withIngredientFacts } from '../ingredient-facts';

function product(ingredients: readonly string[] | null, overrides: Partial<Product> = {}): Product {
  return {
    ingredients: ingredients ? observed(ingredients.map((name) => ({ name, percent: null }))) : NOT_DETECTED,
    allergens: NOT_DETECTED, additives: NOT_DETECTED, ...overrides,
  } as Product;
}

const codes = (result: Product) => result.additives.value?.map((item) => item.code);
const allergen = (result: Product, presence: Allergen['presence']) => result.allergens.value?.filter((item) => item.presence === presence).map((item) => item.code);

describe('withIngredientFacts: добавки', () => {
  it('E-номера находятся латинской и кириллической буквой, с пробелом и дефисом', () => {
    const result = withIngredientFacts(product(['усилитель вкуса E621', 'Е635', 'краситель e 150d', 'разрыхлитель E-500']));
    assert.deepEqual(codes(result), ['E621', 'E635', 'E150d', 'E500']);
    assert.equal(result.additives.value![0]!.name, 'усилитель вкуса');
    assert.equal(result.additives.provenance, 'inferred');
  });

  it('несколько кодов в одной скобке и повторы', () => {
    assert.deepEqual(codes(withIngredientFacts(product(['усилители вкуса (E621, E635)', 'E621']))), ['E621', 'E635']);
  });

  it('явная добавка без номера показывается своим текстом', () => {
    const result = withIngredientFacts(product(['сахар', 'консервант сорбат калия', 'ароматизатор']));
    assert.deepEqual(result.additives.value, [{ code: null, name: 'консервант сорбат калия' }, { code: null, name: 'ароматизатор' }]);
  });

  it('обычные продукты и числа не становятся добавками', () => {
    const result = withIngredientFacts(product(['мука пшеничная', 'вода 100 г', 'масло подсолнечное', 'белок 500']));
    assert.deepEqual(result.additives.value, []);
    assert.equal(result.additives.provenance, 'inferred', 'состав известен: добавок в нём нет');
  });

  it('список источника дополняется, а не заменяется', () => {
    const additives: Detected<readonly Additive[]> = observed([{ code: 'E330', name: 'лимонная кислота' }]);
    assert.deepEqual(codes(withIngredientFacts(product(['E330', 'E621'], { additives }))), ['E330', 'E621']);
  });
});

describe('withIngredientFacts: аллергены', () => {
  it('прямые упоминания в составе становятся contains', () => {
    const result = withIngredientFacts(product(['мука пшеничная', 'сухое молоко', 'молочный белок', 'яйцо', 'соевый лецитин', 'арахис', 'фундук']));
    assert.deepEqual(allergen(result, 'contains')!.sort(), ['eggs', 'gluten', 'milk', 'peanuts', 'soy', 'tree_nuts']);
    assert.equal(result.allergens.value![0]!.provenance, 'inferred');
  });

  it('«может содержать» различается и не становится contains', () => {
    const result = withIngredientFacts(product(['сахар', 'какао', 'может содержать следы арахиса', 'молока']));
    assert.deepEqual(allergen(result, 'contains'), []);
    assert.deepEqual(allergen(result, 'may_contain')!.sort(), ['milk', 'peanuts']);
  });

  it('contains важнее may_contain из источника', () => {
    const allergens: Detected<readonly Allergen[]> = observed([{ code: 'milk', presence: 'may_contain', provenance: 'observed' }]);
    assert.deepEqual(allergen(withIngredientFacts(product(['сухое молоко'], { allergens })), 'contains'), ['milk']);
  });

  it('заменители не дают ложного аллергена, но свой аллерген сохраняют', () => {
    const coconut = withIngredientFacts(product(['кокосовое молоко', 'рисовая мука', 'мука кукурузная', 'манит']));
    assert.equal(coconut.allergens.value, null);
    assert.deepEqual(allergen(withIngredientFacts(product(['соевое молоко'])), 'contains'), ['soy']);
    assert.deepEqual(allergen(withIngredientFacts(product(['миндальное молоко'])), 'contains'), ['tree_nuts']);
    assert.deepEqual(allergen(withIngredientFacts(product(['арахисовое масло'])), 'contains'), ['peanuts']);
  });

  it('ничего не найдено: аллергены остаются неизвестными, а не «нет»', () => {
    assert.equal(withIngredientFacts(product(['картофель', 'соль'])).allergens.value, null);
  });
});

describe('withIngredientFacts: без состава', () => {
  it('нет подтверждённого состава: продукт не меняется, ничего не придумывается', () => {
    const empty = product(null);
    assert.equal(withIngredientFacts(empty), empty);
  });
});
