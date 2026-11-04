import { NOT_DETECTED, observed, type GoalMatchAiOutput, type GoalMatchUserPlan, type Product, type ProductId,
  type ProcessingLevel, type ProductForm, type SugarSource } from '@foodlens/core';
import type { AIProvider } from '@foodlens/ai';

/** План из архитектурного документа и sanity matrix: 2000 ккал, цель по белку 139 г. */
export function eatHealthierPlan(overrides: Partial<GoalMatchUserPlan> = {}): GoalMatchUserPlan {
  return {
    goal: 'eat_healthier',
    targets: { caloriesKcal: 2000, proteinG: 139, fatG: 67, carbsG: 225,
      calculation: { version: 'test', bmrKcal: 1400, tdeeKcal: 2000, goalAdjustmentPercent: 0,
        macroSplit: { proteinPercent: 25, fatPercent: 30, carbsPercent: 45 } } },
    dietaryPreferences: [], allergens: [], avoidedIngredients: [], ...overrides,
  };
}

interface DemoProduct {
  readonly id: string; readonly name: string; readonly portion: number;
  /** kcal, protein, fat, carbs, sugars, saturated fat, salt, fiber; per 100 g/ml (как HEALTH_FIXTURES в @foodlens/scoring). */
  readonly values: readonly (number | null)[];
  readonly sugarSource: SugarSource; readonly processing: ProcessingLevel; readonly productForm: ProductForm;
  readonly ingredients: readonly string[];
}

export function demoProduct(d: DemoProduct): Product {
  const value = (i: number) => d.values[i] === null ? NOT_DETECTED : observed(d.values[i]!);
  return {
    id: d.id as ProductId, name: observed(d.name), brand: NOT_DETECTED, category: NOT_DETECTED,
    nutrition: {
      basis: d.productForm === 'beverage' ? 'per_100ml' : 'per_100g',
      servingSize: observed({ amount: d.portion, unit: d.productForm === 'beverage' ? 'ml' : 'g' }),
      caloriesKcal: value(0), proteinG: value(1), fatG: value(2), carbsG: value(3), sugarsG: value(4),
      saturatedFatG: value(5), saltG: value(6), fiberG: value(7), sodiumMg: NOT_DETECTED,
    },
    semantics: {
      version: 'semantics-v1',
      sugarSource: { value: d.sugarSource, confidence: 'high', evidence: [d.ingredients[0]!] },
      processing: { value: d.processing, confidence: 'high', evidence: [d.ingredients[0]!] },
      productForm: { value: d.productForm, confidence: 'high' }, typicalServing: null,
    },
    ingredients: observed(d.ingredients.map((name) => ({ name, percent: null }))), allergens: observed([]), additives: observed([]),
    confidence: { overall: 'high', identity: 'high', nutrition: 'high', ingredients: 'high' },
    source: { type: 'manual' },
  };
}

/** Те же этикетки, что у golden-фикстур v3 (v3: яблоко 8.5, чипсы 4.2, кола 2.5), с русскими названиями и составом. */
export const APPLE = demoProduct({ id: 'apple', name: 'Яблоко', portion: 180, values: [52, 0.3, 0.2, 14, 10.4, 0.03, 0, 2.4],
  sugarSource: 'intrinsic', processing: 'whole_or_minimal', productForm: 'food', ingredients: ['яблоко'] });
export const CHIPS = demoProduct({ id: 'chips', name: 'Чипсы картофельные', portion: 30, values: [536, 6.5, 34, 53, 0.6, 3.1, 1.4, 4.4],
  sugarSource: 'added', processing: 'ultra_processed', productForm: 'food',
  ingredients: ['картофель', 'растительное масло', 'соль', 'сахар', 'ароматизатор'] });
export const COLA = demoProduct({ id: 'cola', name: 'Кола', portion: 330, values: [42, 0, 0, 10.6, 10.6, 0, 0, 0],
  sugarSource: 'added', processing: 'ultra_processed', productForm: 'beverage',
  ingredients: ['вода', 'сахар', 'диоксид углерода', 'краситель сахарный колер', 'регулятор кислотности', 'ароматизатор', 'кофеин'] });
/** Батончик из sanity matrix: v3 8.9 (слепая зона формулы), подсластитель в составе. */
export const PROTEIN_BAR = demoProduct({ id: 'protein_bar', name: 'Протеиновый батончик', portion: 60, values: [350, 30, 12, 25, 2, 2, 0.2, 8],
  sugarSource: 'added', processing: 'ultra_processed', productForm: 'food',
  ingredients: ['молочный белок', 'изолят соевого белка', 'пищевые волокна', 'какао-масло', 'сукралоза'] });
/** Продукт, для которого у mock нет записанного ответа. */
export const PEAR = demoProduct({ id: 'pear', name: 'Груша', portion: 170, values: [57, 0.4, 0.1, 15, 9.8, 0, 0, 3.1],
  sugarSource: 'intrinsic', processing: 'whole_or_minimal', productForm: 'food', ingredients: ['груша'] });

export const noProtein = (product: Product): Product => ({ ...product, nutrition: { ...product.nutrition!, proteinG: NOT_DETECTED } });
export const noCalories = (product: Product): Product => ({ ...product, nutrition: { ...product.nutrition!, caloriesKcal: NOT_DETECTED } });

/** «Галлюцинация»: кола как отличный продукт. Формально проходит validator, отклоняется коридором v3. */
export const COLA_HALLUCINATION: GoalMatchAiOutput = {
  version: 'goal-match-ai-v1', band: 'excellent_fit', score: 9, confidence: 'high',
  dimensions: { nutrientDensity: 'positive', processing: 'positive', sugar: 'positive', fatQuality: 'strong_positive', sodium: 'strong_positive', portion: 'positive' },
  factors: [
    { code: 'low_salt', direction: 'positive', impact: 'high', facts: ['product.per100.saltG'], text: 'No salt.' },
    { code: 'fits_portion', direction: 'positive', impact: 'medium', facts: ['facts.share.dailyKcalPct'], text: 'The serving fits your daily plan.' },
  ],
  summary: 'An excellent choice for healthy eating.', warnings: [],
};

/** Умеренное расхождение: чипсы на 6.5 при v3 4.2 (коридор до 5.7). */
export const CHIPS_TOO_HIGH: GoalMatchAiOutput = {
  version: 'goal-match-ai-v1', band: 'mixed_fit', score: 6.5, confidence: 'high',
  dimensions: { nutrientDensity: 'neutral', processing: 'strong_negative', sugar: 'positive', fatQuality: 'neutral', sodium: 'negative', portion: 'positive' },
  factors: [
    { code: 'ultra_processed', direction: 'negative', impact: 'medium', facts: ['semantics.processing.value'], text: 'Ultra-processed snack.' },
    { code: 'fits_portion', direction: 'positive', impact: 'low', facts: ['facts.share.dailyKcalPct'], text: 'Small serving.' },
  ],
  summary: 'Fine now and then: the serving is small, but the product is ultra-processed.', warnings: [],
};

/** Не проходит validator: band не совпадает с оценкой. */
export const INVALID_OUTPUT = { ...CHIPS_TOO_HIGH, band: 'excellent_fit' } as GoalMatchAiOutput;

/** Утверждение о белке, которого нет на этикетке: validator обязан отклонить. */
export const CHIPS_PROTEIN_CLAIM: GoalMatchAiOutput = {
  version: 'goal-match-ai-v1', band: 'poor_fit', score: 3, confidence: 'high',
  dimensions: { nutrientDensity: 'negative', processing: 'strong_negative', sugar: 'neutral', fatQuality: 'negative', sodium: 'strong_negative', portion: 'neutral' },
  factors: [
    { code: 'ultra_processed', direction: 'negative', impact: 'high', facts: ['semantics.processing.value'], text: 'Ultra-processed snack.' },
    { code: 'high_protein', direction: 'positive', impact: 'medium', facts: ['facts.perServing.proteinG'], text: 'High in protein.' },
  ],
  summary: 'A snack with protein, but ultra-processed.', warnings: [],
};

/** Провайдер-шпион поверх любого AIProvider: считает вызовы evaluateGoalMatch и запоминает входы. */
export function spyGoalMatch(provider: AIProvider): AIProvider & { readonly inputs: unknown[] } {
  const inputs: unknown[] = [];
  return Object.assign(Object.create(provider) as AIProvider, {
    inputs,
    evaluateGoalMatch: (input: Parameters<AIProvider['evaluateGoalMatch']>[0]) => { inputs.push(input); return provider.evaluateGoalMatch(input); },
  });
}
