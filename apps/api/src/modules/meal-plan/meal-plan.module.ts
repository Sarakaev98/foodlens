import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { NutritionTargetsModule } from '../nutrition-targets/nutrition-targets.module';
import { MealPlanController } from './meal-plan.controller';
import { MealPlanService } from './meal-plan.service';

@Module({
  imports: [AiModule, NutritionTargetsModule],
  controllers: [MealPlanController],
  providers: [MealPlanService],
})
export class MealPlanModule {}
