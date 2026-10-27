import type { Meal, MealPlan, Product } from '@foodlens/core';
import type {
  AnalyzeProductInput,
  ExplainProductInput,
  GenerateMealPlanInput,
  ProductExplanation,
  ReplaceMealInput,
} from './ai-provider.types';

/**
 * Контракт AI-провайдера. Остальной код зависит только от этого интерфейса,
 * поэтому провайдер (Meta или любой другой) меняется без правок потребителей.
 */
export interface AIProvider {
  readonly name: string;

  /** Распознаёт продукт и возвращает его в нормализованном виде. */
  analyzeProduct(input: AnalyzeProductInput): Promise<Product>;

  explainProduct(input: ExplainProductInput): Promise<ProductExplanation>;

  generateMealPlan(input: GenerateMealPlanInput): Promise<MealPlan>;

  replaceMeal(input: ReplaceMealInput): Promise<Meal>;
}

export type AIProviderMethod = Exclude<keyof AIProvider, 'name'>;
