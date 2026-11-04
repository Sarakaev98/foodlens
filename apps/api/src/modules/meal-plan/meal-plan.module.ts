import { Module } from '@nestjs/common';
import { APP_CONFIG } from '../../config/app-config.module';
import { createMealPlanProvider, MEAL_PLAN_PROVIDER } from './meal-plan-provider.factory';
import { NutritionTargetsModule } from '../nutrition-targets/nutrition-targets.module';
import { MealPlanController } from './meal-plan.controller';
import { MealPlanService } from './meal-plan.service';

@Module({
  imports: [NutritionTargetsModule],
  controllers: [MealPlanController],
  providers: [MealPlanService, { provide: MEAL_PLAN_PROVIDER, useFactory: createMealPlanProvider, inject: [APP_CONFIG] }],
})
export class MealPlanModule {}
