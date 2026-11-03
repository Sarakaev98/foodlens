import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import type { MealPlanResult } from '@foodlens/core';
import { CurrentUserId } from '../../common/current-user-id.decorator';
import { MealPlanService } from './meal-plan.service';

@Controller('meal-plan')
export class MealPlanController {
  constructor(private readonly mealPlans: MealPlanService) {}

  /** Последний план или null. AI не вызывается. */
  @Get()
  get(@CurrentUserId() userId: string): Promise<MealPlanResult | null> {
    return this.mealPlans.getLatest(userId);
  }

  /** Составляет новый план на день. Необязательное mealsPerDay: 3 или 4 (по умолчанию). 404, если профиля нет. */
  @Post('generate')
  @HttpCode(200)
  generate(@CurrentUserId() userId: string, @Body() body: { readonly mealsPerDay?: unknown } | undefined): Promise<MealPlanResult> {
    return this.mealPlans.generate(userId, body?.mealsPerDay === 3 ? 3 : 4);
  }
}
