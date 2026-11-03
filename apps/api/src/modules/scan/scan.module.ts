import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { GoalMatchModule } from '../goal-match/goal-match.module';
import { NutritionTargetsModule } from '../nutrition-targets/nutrition-targets.module';
import { ProductLookupModule } from '../product-lookup/product-lookup.module';
import { ScanController } from './scan.controller';
import { MealPhotoController } from './meal-photo.controller';
import { MealPhotoService } from './meal-photo.service';
import { IngredientsDisplayService } from './ingredients-display.service';
import { ScanService } from './scan.service';

@Module({
  imports: [AiModule, NutritionTargetsModule, GoalMatchModule, ProductLookupModule],
  controllers: [ScanController, MealPhotoController],
  providers: [ScanService, MealPhotoService, IngredientsDisplayService],
})
export class ScanModule {}
