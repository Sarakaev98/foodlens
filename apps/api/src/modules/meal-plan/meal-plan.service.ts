import { HttpException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AIProvider, GenerateMealPlanInput } from '@foodlens/ai';
import { normalizeDietaryPreferences, type GoalMatchUserPlan, type MealPlan, type MealPlanResult } from '@foodlens/core';
import { chooseMealPlanVariation, validateMealPlan, type MealPlanIssue, type MealPlanVariation } from '@foodlens/nutrition';
import { AI_PROVIDER } from '../ai/ai.tokens';
import { NutritionTargetsService } from '../nutrition-targets/nutrition-targets.service';

interface Attempt {
  readonly plan: MealPlan;
  readonly issues: readonly MealPlanIssue[];
}

function profileKey(plan: GoalMatchUserPlan): string {
  return JSON.stringify({ goal: plan.goal, targets: plan.targets,
    dietaryPreferences: normalizeDietaryPreferences(plan.dietaryPreferences),
    allergens: plan.allergens, avoidedIngredients: plan.avoidedIngredients });
}

const hasRestrictionIssue = ({ issues }: Attempt) => issues.some((issue) => issue.kind === 'restriction');

/** Сколько последних названий блюд помнить на пользователя: модель их не повторяет. */
export const RECENT_MEAL_NAMES = 12;

/**
 * Профиль и цели → AI → детерминированная проверка → не больше одного исправления.
 * План с нарушением диеты, аллергенов или нежелательных продуктов не показывается никогда.
 * Если после исправления не сходятся только калории или БЖУ, план показывается с withinTargets=false.
 * Последний план хранится в памяти до перезапуска API или изменения целей: повторное открытие экрана не стоит запроса к AI.
 * Для разнообразия в той же памяти лежат последние названия блюд и прошлая подсказка: AI получает их при каждой генерации.
 */
@Injectable()
export class MealPlanService {
  private readonly logger = new Logger(MealPlanService.name);
  private readonly latest = new Map<string, { readonly profileKey: string; readonly result: MealPlanResult }>();
  private readonly recentMeals = new Map<string, readonly string[]>();
  private readonly lastVariation = new Map<string, MealPlanVariation>();
  /** Подменяется в тестах. */
  random: () => number = Math.random;

  constructor(
    @Inject(AI_PROVIDER) private readonly ai: AIProvider,
    private readonly nutritionTargets: NutritionTargetsService,
  ) {}

  /** null, если плана ещё нет или он составлен под другие цели или ограничения. */
  async getLatest(userId: string): Promise<MealPlanResult | null> {
    const stored = this.latest.get(userId);
    if (!stored) return null;
    const plan = await this.nutritionTargets.findPlanForUser(userId);
    return plan && profileKey(plan) === stored.profileKey ? stored.result : null;
  }

  async generate(userId: string, mealsPerDay: 3 | 4 = 4): Promise<MealPlanResult> {
    const plan = await this.nutritionTargets.findPlanForUser(userId);
    if (!plan) throw new NotFoundException('Profile not found');
    const input: GenerateMealPlanInput = {
      goal: plan.goal,
      targets: plan.targets,
      preferences: { dietaryPreferences: normalizeDietaryPreferences(plan.dietaryPreferences), allergens: plan.allergens, avoidedIngredients: plan.avoidedIngredients },
      startDate: new Date().toISOString().slice(0, 10),
      days: 1,
      mealsPerDay,
      locale: 'ru',
      recentMealNames: this.recentMeals.get(userId) ?? [],
      variation: chooseMealPlanVariation(plan, this.lastVariation.get(userId) ?? null, this.random),
    };

    const best = await this.bestAttempt(input, plan);
    if (hasRestrictionIssue(best)) throw new HttpException({ statusCode: 422, code: 'MEAL_PLAN_INVALID', message: 'Could not build a plan that respects the profile' }, 422);
    const result: MealPlanResult = { plan: best.plan, targets: plan.targets, withinTargets: best.issues.length === 0 };
    this.latest.set(userId, { profileKey: profileKey(plan), result });
    this.remember(userId, best.plan, input.variation!);
    return result;
  }

  /** Новые названия впереди, без повторов, не больше RECENT_MEAL_NAMES. */
  private remember(userId: string, mealPlan: MealPlan, variation: MealPlanVariation): void {
    const names = [...mealPlan.days.flatMap((day) => day.meals.map((meal) => meal.name.trim())), ...(this.recentMeals.get(userId) ?? [])].filter(Boolean);
    const unique = names.filter((name, index) => names.findIndex((other) => other.toLowerCase() === name.toLowerCase()) === index);
    this.recentMeals.set(userId, unique.slice(0, RECENT_MEAL_NAMES));
    this.lastVariation.set(userId, variation);
  }

  private async bestAttempt(input: GenerateMealPlanInput, plan: GoalMatchUserPlan): Promise<Attempt> {
    const first = await this.attempt(input, plan);
    if (first.issues.length === 0) return first;
    this.logger.warn(`meal plan needs correction ${JSON.stringify({ issues: first.issues.length, kinds: [...new Set(first.issues.map((issue) => issue.kind))] })}`);
    try {
      const second = await this.attempt({ ...input, correction: first.issues.map((issue) => issue.message) }, plan);
      this.logger.log(`meal plan corrected ${JSON.stringify({ issues: second.issues.length })}`);
      return hasRestrictionIssue(second) && !hasRestrictionIssue(first) ? first : second;
    } catch (error) {
      // Сбой исправления не должен терять безопасный план с небольшим отклонением от цели.
      if (hasRestrictionIssue(first)) throw this.unavailable(error);
      return first;
    }
  }

  private async attempt(input: GenerateMealPlanInput, plan: GoalMatchUserPlan): Promise<Attempt> {
    try {
      const generated = await this.ai.generateMealPlan(input);
      return { plan: generated, issues: validateMealPlan(generated, plan.targets, input.preferences) };
    } catch (error) {
      throw this.unavailable(error);
    }
  }

  private unavailable(error: unknown): HttpException {
    if (error instanceof HttpException) return error;
    this.logger.warn(`meal plan unavailable ${JSON.stringify({ error: (error as Error)?.message })}`);
    return new HttpException({ statusCode: 503, code: 'MEAL_PLAN_UNAVAILABLE', message: 'Meal plan generation is unavailable' }, 503);
  }
}
