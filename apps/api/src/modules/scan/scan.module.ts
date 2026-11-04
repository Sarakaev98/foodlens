import { Module } from '@nestjs/common';
import { APP_CONFIG } from '../../config/app-config.module';
import { SCAN_AI_PROVIDER, createScanAIProvider, LABEL_SCAN_AI_PROVIDER, createLabelScanAIProvider } from './scan-ai-provider.factory';
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
  providers: [{ provide: LABEL_SCAN_AI_PROVIDER, useFactory: createLabelScanAIProvider, inject: [APP_CONFIG] }, { provide: SCAN_AI_PROVIDER, useFactory: createScanAIProvider, inject: [APP_CONFIG] }, ScanService, MealPhotoService, IngredientsDisplayService],
})
export class ScanModule {}
