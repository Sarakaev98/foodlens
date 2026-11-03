import type { GoalMatchAiInput, GoalMatchAiOutput, Meal, MealPlan, Product } from '@foodlens/core';
import type { MealPhotoAiOutput } from './meal-photo/meal-photo-output-schema';
import type {
  AnalyzeMealPhotoInput,
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

  /**
   * Оценка готового блюда по одному фото. Возвращает ответ модели после проверки схемы;
   * числа проверяет и сводит в одну модель normalizeMealPhotoEstimate (@foodlens/nutrition).
   */
  analyzeMealPhoto(input: AnalyzeMealPhotoInput): Promise<MealPhotoAiOutput>;

  explainProduct(input: ExplainProductInput): Promise<ProductExplanation>;

  generateMealPlan(input: GenerateMealPlanInput): Promise<MealPlan>;

  replaceMeal(input: ReplaceMealInput): Promise<Meal>;

  /**
   * Goal Match v4: второй AI-вызов после распознавания. Получает только факты (без Product Score и балла v3)
   * и возвращает сырой ответ модели; его проверяют validate/reconcile в @foodlens/scoring.
   * Нет ответа для этого продукта или провайдер недоступен: AIUnavailableError, тогда включается расчётная оценка.
   */
  evaluateGoalMatch(input: GoalMatchAiInput): Promise<GoalMatchAiOutput>;
}

export type AIProviderMethod = Exclude<keyof AIProvider, 'name'>;
