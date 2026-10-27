import { Controller, Get } from '@nestjs/common';
import type { NutritionTargets } from '@foodlens/core';
import { CurrentUserId } from '../../common/current-user-id.decorator';
import { NutritionTargetsService } from './nutrition-targets.service';

@Controller('nutrition-targets')
export class NutritionTargetsController {
  constructor(private readonly nutritionTargets: NutritionTargetsService) {}

  /** 404, если пользователь ещё не прошёл onboarding. */
  @Get()
  get(@CurrentUserId() userId: string): Promise<NutritionTargets> {
    return this.nutritionTargets.getForUser(userId);
  }
}
