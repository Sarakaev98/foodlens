import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { GoalMatchModule } from '../goal-match/goal-match.module';
import { NutritionTargetsModule } from '../nutrition-targets/nutrition-targets.module';
import { ProductLookupModule } from '../product-lookup/product-lookup.module';
import { ScanController } from './scan.controller';
import { ScanService } from './scan.service';

@Module({
  imports: [AiModule, NutritionTargetsModule, GoalMatchModule, ProductLookupModule],
  controllers: [ScanController],
  providers: [ScanService],
})
export class ScanModule {}
