import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { FireworksMealPlanProvider, GoogleMealPlanProvider, type AIProvider, type AILogger } from '@foodlens/ai';
import type { AppConfig } from '../../config/app-config';

export const MEAL_PLAN_PROVIDER = Symbol('MEAL_PLAN_PROVIDER');
export type MealPlanGenerator = Pick<AIProvider, 'generateMealPlan'>;

/** Meal Plan selection is independent of Scan and Goal Match. No provider fallback. */
export function createMealPlanProvider(config: AppConfig): MealPlanGenerator {
  const nest = new Logger('MealPlanProvider');
  const logger: AILogger = {
    log: (message, fields) => nest.log(`${message} ${JSON.stringify(fields)}`),
    warn: (message, fields) => nest.warn(`${message} ${JSON.stringify(fields)}`),
  };
  if (config.mealPlan.provider === 'fireworks') {
    const provider = new FireworksMealPlanProvider({ apiKey: config.mealPlan.fireworksApiKey, timeoutMs: config.mealPlan.timeoutMs, logger });
    return { generateMealPlan: input => provider.generate(input) };
  }
  return { generateMealPlan: async input => {
    const requestId = randomUUID(), started = Date.now();
    const fields = { requestId, provider: 'google', model: config.goalMatchAi.google.model, type: 'meal_plan', correction: !!input.correction };
    // Correlate the existing numeric-only Gemini usage log with this attempt and plan ID.
    const attempt = new GoogleMealPlanProvider({ ...config.goalMatchAi.google, logger: {
      log: (message, usage) => logger.log(message, { ...usage, ...fields }),
      warn: (message, usage) => logger.warn(message, { ...usage, ...fields }),
    } });
    try {
      const plan = await attempt.generate(input);
      logger.log('meal_plan_provider', { ...fields, planId: plan.id, success: true, latencyMs: Date.now() - started, estimatedCostUsd: null });
      return plan;
    } catch (error) {
      logger.warn('meal_plan_provider', { ...fields, success: false, latencyMs: Date.now() - started });
      throw error;
    }
  } };
}
