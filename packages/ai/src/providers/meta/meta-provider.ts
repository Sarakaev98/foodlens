import type { AIProvider } from '../../ai-provider';
import { AIMethodNotImplementedError } from '../../errors';

export interface MetaProviderConfig {
  readonly apiKey: string;
  readonly model?: string;
  readonly baseUrl?: string;
}

/**
 * Каркас провайдера Meta. Интеграция с Meta API будет добавлена
 * на следующем этапе, пока каждый метод явно сообщает, что не реализован.
 */
export class MetaProvider implements AIProvider {
  readonly name = 'meta';

  constructor(private readonly config: MetaProviderConfig) {}

  async analyzeProduct(): Promise<never> {
    throw new AIMethodNotImplementedError(this.name, 'analyzeProduct');
  }

  async explainProduct(): Promise<never> {
    throw new AIMethodNotImplementedError(this.name, 'explainProduct');
  }

  async generateMealPlan(): Promise<never> {
    throw new AIMethodNotImplementedError(this.name, 'generateMealPlan');
  }

  async replaceMeal(): Promise<never> {
    throw new AIMethodNotImplementedError(this.name, 'replaceMeal');
  }
}
