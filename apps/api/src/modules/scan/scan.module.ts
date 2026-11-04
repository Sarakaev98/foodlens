import { ProductIngredientsDisplayService } from './product-ingredient-facts';
import { Module } from '@nestjs/common';
import { GoogleNutritionSearch } from '@foodlens/ai';
import type { AppConfig } from '../../config/app-config';
import { PRODUCT_TEXT_AI, PRODUCT_GOAL_MATCH, PRODUCT_INGREDIENTS_DISPLAY, createProductGoalMatchAI } from '../ai/product-ai-support.factory';
import { GoalMatchService } from '../goal-match/goal-match.service';
import { APP_CONFIG } from '../../config/app-config.module';
import { SCAN_AI_PROVIDER, createScanAIProvider, LABEL_SCAN_AI_PROVIDER, createLabelScanAIProvider } from './scan-ai-provider.factory';
import { AiModule } from '../ai/ai.module';
import { GoalMatchModule } from '../goal-match/goal-match.module';
import { NutritionTargetsModule } from '../nutrition-targets/nutrition-targets.module';
import { ProductLookupModule } from '../product-lookup/product-lookup.module';
import { ScanController } from './scan.controller';
import { MealPhotoController } from './meal-photo.controller';
import { MEAL_SCAN_AI_PROVIDER, createMealScanAIProvider } from './meal-scan-ai-provider.factory';
import { MealPhotoService } from './meal-photo.service';
import { IngredientsDisplayService } from './ingredients-display.service';
import { ScanService } from './scan.service';

@Module({
  imports: [AiModule, NutritionTargetsModule, GoalMatchModule, ProductLookupModule],
  controllers: [ScanController, MealPhotoController],
  providers: [
    { provide: MEAL_SCAN_AI_PROVIDER, useFactory: createMealScanAIProvider, inject: [APP_CONFIG] },
    { provide: PRODUCT_INGREDIENTS_DISPLAY, useFactory: (text: GoogleNutritionSearch) => new ProductIngredientsDisplayService(text), inject: [PRODUCT_TEXT_AI] },
    { provide: PRODUCT_GOAL_MATCH, useFactory: (config: AppConfig) => new GoalMatchService(createProductGoalMatchAI(config)), inject: [APP_CONFIG] },{ provide: LABEL_SCAN_AI_PROVIDER, useFactory: createLabelScanAIProvider, inject: [APP_CONFIG] }, { provide: SCAN_AI_PROVIDER, useFactory: createScanAIProvider, inject: [APP_CONFIG] }, ScanService, MealPhotoService, IngredientsDisplayService],
})
export class ScanModule {}
