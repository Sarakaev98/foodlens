import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { inferred, NOT_DETECTED, observed, type Product, type ProductCategory } from '@foodlens/core';
import { demoProduct } from '../../goal-match/test/goal-match-v4.fixtures';
import { analyzeNutritionIngredients, estimateSugarShare } from '../nutrition-ingredient-signals';
import { estimateMissingNutrition } from '../nutrition-estimator';

const analyze = (names: readonly string[]) => analyzeNutritionIngredients(names.map(name => ({ name, percent: null })));
const food = (category: ProductCategory, names: readonly string[], carbs = 56): Product => ({
  ...demoProduct({ id: 'generic-regression', name: 'Пищевой продукт', portion: 100, values: [400,6.5,17,carbs,null,null,null,null], sugarSource: 'added', processing: 'ultra_processed', productForm: 'food', ingredients: names }), category: observed(category),
});
const sugars = (category: ProductCategory, names: readonly string[], carbs = 56) => estimateMissingNutrition(food(category, names, carbs)).nutrition!.sugarsG.value!;

describe('Ingredient tokens, component roles and sugar category constraints', () => {
  for (const word of ['мед','мёд','МЁД','меда','honey','сахар','сахара','сироп','glucose','fructose','maltose','мальтоза','sugar','syrup']) {
    it(`${word}: explicit sugar ingredient recognized`, () => {
      const signal = analyze([word]); assert.equal(signal.sugarPosition, 0); assert.equal(signal.strongTopLevelSugar, true);
    });
  }
  for (const word of ['камедь','гуаровая камедь','медовый ароматизатор','honeycomb','sugarcane fiber','glucosamine','fructooligosaccharides','мальтодекстрин','крахмал','мука','carbohydrates','flavoring','сахарный колер IV']) {
    it(`${word}: no substring sugar/honey signal`, () => {
      const signal = analyze([word]); assert.equal(signal.sugarPosition, -1); assert.deepEqual(signal.nestedSugars, []);
    });
  }
  it('a honey ingredient inside a component is recognized as nested, not primary', () => {
    const signal = analyze(['Начинка (орехи, мёд)', 'мука']);
    assert.equal(signal.sugarPosition, -1); assert.equal(signal.nestedSugars[0]!.matchedTokens[0], 'мед');
    assert.equal(signal.strongTopLevelSugar, false);
  });
  it('explicit sugar first permits a high signal, including a strong exception in a savory category', () => {
    const signal = analyze(['сахар','мука']);
    assert.equal(estimateSugarShare('ready_meal',0.06,signal,true).share,0.65);
    assert.equal(sugars('bakery',['сахар','мука']),56*0.65);
  });
  it('gum plus sugar inside seasoning keeps the savory category prior', () => {
    const names=['Лапша (мука пшеничная, загуститель (гуаровая камедь), соль)', 'Приправа (соль, мальтодекстрин, овощи, сахар, ароматизатор)', 'овощи'];
    const signal=analyze(names), policy=estimateSugarShare('ready_meal',0.06,signal,true);
    assert.equal(signal.sugarPosition,-1); assert.equal(signal.nestedSugars[0]!.componentIndex,1);
    assert.equal(signal.saltPosition,-1); assert.equal(signal.strongTopLevelSugar,false);
    assert.equal(policy.share,0.06); assert.equal(sugars('ready_meal',names),3.36);
  });
  it('nested first-child sugar never becomes first ingredient of the product', () => {
    for(const name of ['Приправа (сахар, соль)','Соус [сироп, вода]','Лапша (мука, соус (сахар, соль))']) {
      const signal=analyze([name,'овощи']);
      assert.equal(signal.sugarPosition,-1); assert.ok(signal.nestedSugars.length>0);
      assert.equal(estimateSugarShare('ready_meal',0.06,signal,true).share,0.06);
    }
  });
  it('an unclosed component bracket stays nested', () => {
    const signal=analyze(['Приправа (соль, сахар']);
    assert.equal(signal.sugarPosition,-1); assert.ok(signal.nestedSugars.length>0);
  });
  it('one coarse OCR ingredient string is split into actual top-level ingredients', () => {
    const signal=analyze(['мука, сахар; соль']);
    assert.equal(signal.sugarPosition,1); assert.equal(signal.saltPosition,2);
  });
  it('savory positional overrides are capped unless sugar is explicitly the primary ingredient', () => {
    for(const category of ['ready_meal','snack','meat','fish','sauce'] as const) {
      const signal=analyze(['мука','сахар']); const prior=category==='snack'?0.05:category==='sauce'?0.3:0.06;
      const policy=estimateSugarShare(category,prior,signal,true);
      assert.ok(policy.share<=Math.max(prior,Math.min(0.2,2*prior)));
      assert.equal(policy.strongTopLevelSugar,false);
    }
    const policy=estimateSugarShare('ready_meal',0.06,analyze(['мука','сахар']),true);
    assert.equal(policy.share,0.12);assert.equal(policy.capped,true);
  });
  it('chocolate, cookies, candy, soda and sweet dairy retain high sugar estimates', () => {
    for(const category of ['chocolate','bakery','sweets','beverage','dairy','yogurt'] as const) {
      assert.ok(sugars(category,['мука','сахар','масло'])>=56*0.45,category);
    }
  });
  it('fat, fiber, salt and sweetener matchers reject substring collisions and keep actual ingredients', () => {
    const falseSignals=analyze(['brandy','goat milk','butternut','butterfly','olivewood','palmaria','солист','saltwater','steviamoside']);
    assert.equal(falseSignals.hasFiber,false);assert.equal(falseSignals.hasSaturatedFat,false);assert.equal(falseSignals.hasUnsaturatedFat,false);assert.equal(falseSignals.saltPosition,-1);assert.equal(falseSignals.sweetenerOnly,false);
    assert.equal(analyze(['цельнозерновая мука','отруби','овсяные хлопья','whole grain flour','oat bran']).hasFiber,true);
    assert.equal(analyze(['пальмовое масло']).hasSaturatedFat,true);assert.equal(analyze(['butter']).hasSaturatedFat,true);
    assert.equal(analyze(['подсолнечное масло']).hasUnsaturatedFat,true);assert.equal(analyze(['olive oil']).hasUnsaturatedFat,true);
    assert.equal(analyze(['морская соль']).saltPosition,0);assert.equal(analyze(['salt']).saltPosition,0);
    assert.equal(analyze(['подсластитель (сукралоза)']).sweetenerOnly,true);
  });
  it('estimates stay bounded by carbs and exact sugar values never change', () => {
    for(const category of ['ready_meal','bakery','chocolate'] as const)for(const carbs of [0,0.008,1,20,56,100]){
      const value=sugars(category,['сахар','мука'],carbs);assert.ok(value>=0&&value<=carbs);
    }
    const source=food('ready_meal',['лапша (камедь)','приправа (сахар)']);
    const exact={...source,nutrition:{...source.nutrition!,sugarsG:observed(2)}};
    assert.equal(estimateMissingNutrition(exact).nutrition!.sugarsG,exact.nutrition.sugarsG);
    const derived={...source,nutrition:{...source.nutrition!,sugarsG:inferred(2)}};
    assert.equal(estimateMissingNutrition(derived).nutrition!.sugarsG,derived.nutrition.sugarsG);
  });
  it('production matching and category policy have no concrete barcode or brand branches', () => {
    const code=['nutrition-estimator.js','nutrition-ingredient-signals.js'].map(file=>readFileSync(join(__dirname,'..',file),'utf8')).join('\n');
    for(const forbidden of ['4605496016700','4605496000815','4607084351385','7622202395697','Rollton','Роллтон','Choco Pie','Alpen Gold'])assert.ok(!code.includes(forbidden),forbidden);
  });
});
