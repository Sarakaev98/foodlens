import { Module, type DynamicModule } from '@nestjs/common';
import type { AppConfig } from './config/app-config';
import { AppConfigModule } from './config/app-config.module';
import { AiModule } from './modules/ai/ai.module';
import { DatabaseModule } from './modules/database/database.module';
import { FeatureFlagsModule } from './modules/feature-flags/feature-flags.module';
import { HealthModule } from './modules/health/health.module';
import { MealPlanModule } from './modules/meal-plan/meal-plan.module';
import { NutritionTargetsModule } from './modules/nutrition-targets/nutrition-targets.module';
import { ProfileModule } from './modules/profile/profile.module';
import { ScanModule } from './modules/scan/scan.module';

@Module({})
export class AppModule {
  static register(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        AppConfigModule.register(config),
        DatabaseModule,
        HealthModule,
        FeatureFlagsModule,
        AiModule,
        ProfileModule,
        NutritionTargetsModule,
        ScanModule,
        MealPlanModule,
      ],
    };
  }
}
