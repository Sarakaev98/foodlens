import { randomUUID } from 'node:crypto';
import { sumMeals, type Meal, type MealId, type MealPlan, type MealPlanId } from '@foodlens/core';
import type { GenerateMealPlanInput } from '../../ai-provider.types';
import { SILENT_AI_LOGGER, type AILogger } from '../../ai-logger';
import { AIProviderError, type AIProviderErrorCode } from '../../errors';
import { findSchemaViolation } from '../../json-schema/json-schema';
import { MEAL_PLAN_OUTPUT_SCHEMA, vertexMealPlanResponseSchema, type MealPlanOutput } from '../../meal-plan/meal-plan-output-schema';
import { MEAL_PLAN_SYSTEM_PROMPT, mealPlanUserPrompt } from '../../meal-plan/meal-plan-prompt';
import { logGeminiUsage } from './gemini-usage';

export const GOOGLE_MEAL_PLAN_TIMEOUT_MS = 60000;

export interface GoogleMealPlanProviderConfig {
  readonly apiKey: string;
  readonly project: string;
  readonly location: string;
  readonly model: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly logger?: AILogger;
  /** Подменяются в unit tests. */
  readonly createId?: () => string;
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const failure = (code: AIProviderErrorCode, httpStatus?: number) => new AIProviderError('google', code, `Google meal plan: ${code}`, { httpStatus });

/** Один запрос generateContent с JSON-схемой. Повторов здесь нет: единственную попытку исправления делает API. */
export class GoogleMealPlanProvider {
  private readonly logger: AILogger;
  private readonly createId: () => string;
  private readonly transport: typeof globalThis.fetch;

  constructor(private readonly config: GoogleMealPlanProviderConfig) {
    this.logger = config.logger ?? SILENT_AI_LOGGER;
    this.createId = config.createId ?? randomUUID;
    this.transport = config.fetch ?? globalThis.fetch;
  }

  async generate(input: GenerateMealPlanInput): Promise<MealPlan> {
    const { apiKey, project, location, model } = this.config;
    if (!apiKey || !project) throw failure('not_configured');
    const url = `https://aiplatform.googleapis.com/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;
    const signal = AbortSignal.timeout(GOOGLE_MEAL_PLAN_TIMEOUT_MS);
    try {
      const response = await this.transport(url, {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: MEAL_PLAN_SYSTEM_PROMPT }] },
          contents: [{ role: 'user', parts: [{ text: mealPlanUserPrompt(input) }] }],
          generationConfig: {
            ...(model.startsWith('gemini-3.5-flash-lite') ? { thinkingConfig: { thinkingLevel: 'MINIMAL' } } : { temperature: 0.4, thinkingConfig: { thinkingBudget: 0 } }),
            responseMimeType: 'application/json',
            responseSchema: vertexMealPlanResponseSchema(),
            maxOutputTokens: 4096,
          },
        }),
      });
      if (!response.ok) {
        const status = response.status;
        await response.body?.cancel().catch(() => undefined);
        throw failure(status === 401 || status === 403 ? 'authentication_failed' : status === 429 ? 'rate_limited' : status >= 500 ? 'unavailable' : 'bad_request', status);
      }
      const envelope: unknown = await response.json().catch(() => null);
      logGeminiUsage(this.logger, 'meal_plan', model, envelope);
      return this.toPlan(parseOutput(envelope), input.startDate);
    } catch (error) {
      if (error instanceof AIProviderError) throw error;
      // Тексты внешних ошибок наружу не уходят: в них могут быть данные запроса.
      throw failure(signal.aborted ? 'timeout' : 'unavailable');
    }
  }

  private toPlan(output: MealPlanOutput, date: string): MealPlan {
    const meals: Meal[] = output.meals.map((meal) => ({
      id: `meal_${this.createId()}` as MealId,
      slot: meal.slot,
      name: meal.name,
      description: meal.description,
      ingredients: meal.ingredients,
      portion: meal.portion,
      caloriesKcal: meal.calories_kcal,
      proteinG: meal.protein_g,
      carbsG: meal.carbs_g,
      fatG: meal.fat_g,
    }));
    return { id: `plan_${this.createId()}` as MealPlanId, days: [{ date, meals, totals: sumMeals(meals) }] };
  }
}

function parseOutput(envelope: unknown): MealPlanOutput {
  const candidate = record(envelope) && Array.isArray(envelope.candidates) ? envelope.candidates[0] : null;
  if (!record(candidate) || candidate.finishReason !== 'STOP') throw failure('invalid_response');
  const content = record(candidate.content) ? candidate.content : null;
  const parts = content && Array.isArray(content.parts) ? content.parts : [];
  const text = parts.filter((part) => record(part) && typeof part.text === 'string' && part.thought !== true).map((part) => (part as { text: string }).text).join('');
  let output: unknown;
  try {
    output = JSON.parse(text);
  } catch {
    throw failure('invalid_response');
  }
  if (findSchemaViolation(MEAL_PLAN_OUTPUT_SCHEMA, output) !== null || !validNumbers(output as MealPlanOutput)) throw failure('invalid_response');
  return output as MealPlanOutput;
}

function validNumbers({ meals }: MealPlanOutput): boolean {
  return meals.length > 0 && meals.every((meal) => meal.name.trim() && meal.calories_kcal > 0 && meal.protein_g >= 0 && meal.carbs_g >= 0 && meal.fat_g >= 0);
}
